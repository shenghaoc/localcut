/**
 * Orchestration for Auto Captions (Phase 29). Framework-free state machine
 * between three parties:
 *
 *   pipeline worker  ──(extract-clip-audio PCM windows)──►  controller
 *   controller       ──(transcribe, transferred)──────────►  ASR worker
 *   ASR worker       ──(progress / result)────────────────►  controller
 *   controller       ──(asr-create-caption-track)─────────►  pipeline worker
 *
 * The ASR worker is spawned lazily on first action.
 */
import type {
	AsrModelStatus,
	AsrProbeResult,
	AsrRecommendedEngine,
	AsrWorkerState,
	CaptionSegmentSnapshot,
	WorkerStateMessage
} from '../protocol';
import { asrAvailable, ASR_UNAVAILABLE_MESSAGE, probeAsr } from '../engine/asr/asr-probe';
import type { AsrWorkerPort } from './asr-bridge';

export const ASR_PREVIEW_SECONDS = 30;
export const ASR_EXTRACT_WINDOW_SECONDS = 30;
export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MAX_JOB_SECONDS = 1800; // 30 minutes

export interface AsrClipTarget {
	trackId: string;
	clipId: string;
	durationS: number;
	fileName: string;
}

export type AsrJobKind = 'selected-clip' | 'timeline-range';
export type AsrJobPhase = 'extracting' | 'transcribing' | 'creating-track';

export interface AsrJobState {
	kind: AsrJobKind;
	phase: AsrJobPhase;
	fraction: number;
	processedSeconds: number;
	totalSeconds: number;
	clip: AsrClipTarget | null;
}

export interface AsrControllerState {
	probe: AsrProbeResult | null;
	available: boolean;
	recommendedEngine: AsrRecommendedEngine;
	modelStatus: AsrModelStatus;
	modelSizeBytes: number | null;
	job: AsrJobState | null;
	lastDurationMs: number | null;
	error: string | null;
}

export interface ClipAudioRequest {
	requestId: string;
	trackId: string;
	clipId: string;
	clipOffsetS: number;
	durationS: number;
	sampleRate: number;
}

export interface AsrControllerPorts {
	spawnWorker(
		onState: (msg: AsrWorkerState) => void,
		onCrash: (message: string) => void
	): Promise<AsrWorkerPort>;
	requestClipAudio(request: ClipAudioRequest): void;
	createCaptionTrack(request: {
		segments: CaptionSegmentSnapshot[];
		language: string | null;
		engine: 'webnn-whisper' | 'chrome-speech';
		phraseLevel: boolean;
		trackName: string;
	}): void;
	onError?(message: string): void;
}

interface PendingExtraction {
	resolve: (msg: Extract<WorkerStateMessage, { type: 'clip-audio' }>) => void;
	reject: (error: Error) => void;
}

interface ActiveJob {
	jobId: number;
	kind: AsrJobKind;
	clip: AsrClipTarget | null;
	durationS: number;
	cancelled: boolean;
	allSegments: CaptionSegmentSnapshot[];
	language: string | null;
	phraseLevel: boolean;
	startedAt: number;
	resultResolve?: (msg: Extract<AsrWorkerState, { type: 'asr-result' }>) => void;
	resultReject?: (error: Error) => void;
}

export class AsrCancelled extends Error {
	constructor() {
		super('cancelled');
		this.name = 'AsrCancelled';
	}
}

export class AsrController {
	private readonly ports: AsrControllerPorts;
	private state: AsrControllerState = {
		probe: null,
		available: false,
		recommendedEngine: 'none',
		modelStatus: 'not-loaded',
		modelSizeBytes: null,
		job: null,
		lastDurationMs: null,
		error: null
	};
	private readonly listeners = new Set<(state: AsrControllerState) => void>();
	private worker: AsrWorkerPort | null = null;
	private workerSpawn: Promise<AsrWorkerPort> | null = null;
	private nextJobId = 1;
	private nextRequestId = 1;
	private activeJob: ActiveJob | null = null;
	private readonly pendingExtractions = new Map<string, PendingExtraction>();

	constructor(ports: AsrControllerPorts) {
		this.ports = ports;
	}

	getState(): AsrControllerState {
		return this.state;
	}

	subscribe(listener: (state: AsrControllerState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	get workerSpawned(): boolean {
		return this.worker !== null || this.workerSpawn !== null;
	}

	private update(patch: Partial<AsrControllerState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}

	setProbe(webnnProbe?: Parameters<typeof probeAsr>[0]): void {
		const result = probeAsr(webnnProbe);
		this.update({
			probe: result,
			available: asrAvailable(result),
			recommendedEngine: result.recommended
		});
	}

	handlePipelineMessage(msg: WorkerStateMessage): void {
		if (msg.type === 'clip-audio') {
			const pending = this.pendingExtractions.get(msg.requestId);
			if (pending) {
				this.pendingExtractions.delete(msg.requestId);
				pending.resolve(msg);
			}
			return;
		}
		if (msg.type === 'clip-audio-error') {
			const pending = this.pendingExtractions.get(msg.requestId);
			if (pending) {
				this.pendingExtractions.delete(msg.requestId);
				pending.reject(new Error(msg.message));
			}
			return;
		}
		if (msg.type === 'asr-caption-track-created') {
			if (this.state.job?.phase === 'creating-track') {
				this.update({ job: null, error: null });
			}
		}
	}

	private handleWorkerState(msg: AsrWorkerState): void {
		switch (msg.type) {
			case 'asr-model-status': {
				this.update({
					modelStatus: msg.status,
					modelSizeBytes: msg.sizeBytes ?? this.state.modelSizeBytes,
					error: msg.status === 'failed' ? (msg.error ?? 'Model load failed.') : this.state.error
				});
				break;
			}
			case 'asr-progress': {
				const job = this.activeJob;
				if (!job || msg.jobId !== job.jobId || !this.state.job) break;
				this.update({
					job: {
						...this.state.job,
						phase: 'transcribing',
						fraction: msg.fraction,
						processedSeconds: msg.processedSeconds,
						totalSeconds: msg.totalSeconds
					}
				});
				break;
			}
			case 'asr-result': {
				const job = this.activeJob;
				if (job && msg.jobId === job.jobId) job.resultResolve?.(msg);
				break;
			}
			case 'asr-cancelled': {
				const job = this.activeJob;
				if (job && (msg.jobId === undefined || msg.jobId === job.jobId)) {
					job.resultReject?.(new AsrCancelled());
				}
				break;
			}
			case 'asr-error': {
				const job = this.activeJob;
				if (job && (msg.jobId === undefined || msg.jobId === job.jobId)) {
					job.resultReject?.(new Error(msg.message));
				} else if (!job) {
					this.update({ error: msg.message });
				}
				break;
			}
			case 'asr-probe-result':
				this.setProbe(msg.result.webnn);
				break;
		}
	}

	private async ensureWorker(): Promise<AsrWorkerPort> {
		if (this.worker) return this.worker;
		this.workerSpawn ??= this.ports.spawnWorker(
			(msg) => this.handleWorkerState(msg),
			(message) => {
				this.update({ modelStatus: 'not-loaded', job: null, error: message });
				if (this.activeJob) {
					this.activeJob.cancelled = true;
					this.activeJob.resultReject?.(new Error(message));
				}
				this.activeJob = null;
				this.worker = null;
				this.workerSpawn = null;
				this.ports.onError?.(message);
			}
		);
		this.worker = await this.workerSpawn;
		return this.worker;
	}

	async loadModel(): Promise<boolean> {
		if (!this.state.available || this.state.recommendedEngine === 'none') {
			this.update({ error: ASR_UNAVAILABLE_MESSAGE });
			return false;
		}
		if (this.state.modelStatus === 'loaded') return true;
		if (this.state.modelStatus === 'loading') return false;

		// Chrome Speech doesn't need a model load step
		if (this.state.recommendedEngine === 'chrome-speech') {
			this.update({ modelStatus: 'loaded' });
			return true;
		}

		this.update({ modelStatus: 'loading', error: null });
		try {
			const worker = await this.ensureWorker();
			worker.send({
				type: 'asr-load-model',
				manifest: {
					id: 'whisper-tiny-bilingual',
					version: '1.0.0',
					license: 'MIT',
					source: 'https://github.com/openai/whisper',
					sizeBytes: 0,
					checksum: 'sha256-0000000000000000000000000000000000000000000000000000000000000000',
					audio: { sampleRate: 16000, channels: 1, hopLength: 160, nMel: 80 },
					vocabSize: 0,
					encoderFramesPerSecond: 50,
					languages: ['zh', 'en']
				},
				weightsUrl: '/models/whisper/weights.bin',
				vocabUrl: '/models/whisper/vocab.json',
				preferredBackends: ['npu', 'gpu', 'cpu']
			});
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.update({ modelStatus: 'failed', error: message });
			return false;
		}
	}

	private requestExtraction(
		request: Omit<ClipAudioRequest, 'requestId'>
	): Promise<Extract<WorkerStateMessage, { type: 'clip-audio' }>> {
		const requestId = `asr-${this.nextRequestId++}`;
		return new Promise((resolve, reject) => {
			this.pendingExtractions.set(requestId, { resolve, reject });
			this.ports.requestClipAudio({ ...request, requestId });
		});
	}

	async transcribeClip(clip: AsrClipTarget, language?: string): Promise<boolean> {
		return this.runTranscribe('selected-clip', clip, language);
	}

	async transcribeRange(language?: string): Promise<boolean> {
		return this.runTranscribe('timeline-range', null, language);
	}

	private async runTranscribe(
		kind: AsrJobKind,
		clip: AsrClipTarget | null,
		language?: string
	): Promise<boolean> {
		if (this.state.job) return false;
		if (!(await this.loadModel())) return false;

		const durationS = clip
			? Math.min(clip.durationS, ASR_MAX_JOB_SECONDS)
			: ASR_PREVIEW_SECONDS;
		const engine = this.state.recommendedEngine === 'webnn-whisper'
			? 'webnn-whisper' as const
			: 'chrome-speech' as const;

		const worker = await this.ensureWorker();
		const jobId = this.nextJobId++;
		const job: ActiveJob = {
			jobId,
			kind,
			clip,
			durationS,
			cancelled: false,
			allSegments: [],
			language: null,
			phraseLevel: engine !== 'webnn-whisper',
			startedAt: Date.now()
		};
		this.activeJob = job;

		this.update({
			job: {
				kind,
				phase: 'extracting',
				fraction: 0,
				processedSeconds: 0,
				totalSeconds: durationS,
				clip
			},
			error: null
		});

		const result = new Promise<Extract<AsrWorkerState, { type: 'asr-result' }>>(
			(resolve, reject) => {
				job.resultResolve = resolve;
				job.resultReject = reject;
			}
		);
		result.catch(() => undefined);

		try {
			let offsetS = 0;
			while (offsetS < durationS) {
				if (job.cancelled) throw new AsrCancelled();
				const windowS = Math.min(ASR_EXTRACT_WINDOW_SECONDS, durationS - offsetS);
				const window = await this.requestExtraction({
					trackId: clip?.trackId ?? '',
					clipId: clip?.clipId ?? '',
					clipOffsetS: offsetS,
					durationS: windowS,
					sampleRate: ASR_SAMPLE_RATE
				});
				if (job.cancelled) throw new AsrCancelled();

				worker.send(
					{
						type: 'asr-transcribe',
						jobId,
						engine,
						pcm: window.pcm,
						sampleRate: window.sampleRate,
						channels: window.channels,
						offsetS,
						totalDurationS: durationS,
						language
					},
					[window.pcm.buffer]
				);
				offsetS += windowS;
			}

			const finalResult = await result;
			this.finishJob();

			if (finalResult.language) job.language = finalResult.language;
			if (finalResult.phraseLevel !== undefined) job.phraseLevel = finalResult.phraseLevel;

			// Create caption track in pipeline worker
			const trackName = (() => {
				const lang = finalResult.language ?? language ?? 'auto';
				const base = clip?.fileName ?? 'range';
				return `Auto (${lang}) - ${base}`;
			})();

			this.update({
				job: {
					kind,
					phase: 'creating-track',
					fraction: 1,
					processedSeconds: durationS,
					totalSeconds: durationS,
					clip
				},
				lastDurationMs: finalResult.durationMs
			});

			this.ports.createCaptionTrack({
				segments: finalResult.segments,
				language: finalResult.language,
				engine,
				phraseLevel: finalResult.phraseLevel,
				trackName
			});

			return true;
		} catch (error) {
			this.finishJob();
			if (error instanceof AsrCancelled) {
				this.update({ job: null });
				return false;
			}
			this.update({
				job: null,
				error: error instanceof Error ? error.message : String(error)
			});
			return false;
		}
	}

	private finishJob(): void {
		this.activeJob = null;
	}

	cancel(): void {
		const job = this.activeJob;
		if (job) {
			job.cancelled = true;
			this.worker?.send({ type: 'asr-cancel', jobId: job.jobId });
			job.resultReject?.(new AsrCancelled());
		}
		for (const [, pending] of [...this.pendingExtractions]) {
			this.pendingExtractions.delete(pending.resolve.toString());
			pending.reject(new AsrCancelled());
		}
		this.update({ job: null });
	}

	dispose(): void {
		this.cancel();
		this.worker?.send({ type: 'asr-dispose' });
		this.worker?.terminate();
		this.worker = null;
		this.workerSpawn = null;
		this.listeners.clear();
	}
}

export const ASR_PRIVACY_STATEMENT =
	'All speech recognition runs on this device. No audio leaves your browser. No cloud API.';

export interface AsrActionAvailability {
	loadModel: { enabled: boolean; reason: string | null };
	transcribeClip: { enabled: boolean; reason: string | null };
	transcribeRange: { enabled: boolean; reason: string | null };
	cancel: { enabled: boolean; reason: string | null };
}

export function asrActionAvailability(
	state: AsrControllerState,
	selectedClip: AsrClipTarget | null
): AsrActionAvailability {
	if (!state.available) {
		const reason = ASR_UNAVAILABLE_MESSAGE;
		return {
			loadModel: { enabled: false, reason },
			transcribeClip: { enabled: false, reason },
			transcribeRange: { enabled: false, reason },
			cancel: { enabled: false, reason }
		};
	}
	const busy = state.job !== null || state.modelStatus === 'loading';
	const noClip = selectedClip === null;
	const modelNeeded = state.recommendedEngine === 'webnn-whisper' && state.modelStatus !== 'loaded';
	const clipReason = noClip ? 'Select a clip on the timeline first.' : null;
	const modelReason = modelNeeded ? 'Load the ASR model first.' : null;
	const busyReason = busy ? 'A transcription is in progress.' : null;
	return {
		loadModel: {
			enabled: !busy && modelNeeded,
			reason: busyReason ?? (modelNeeded ? null : 'Model already loaded.')
		},
		transcribeClip: {
			enabled: !busy && !noClip && !modelNeeded,
			reason: busyReason ?? clipReason ?? modelReason
		},
		transcribeRange: {
			enabled: !busy && !modelNeeded && state.recommendedEngine === 'chrome-speech',
			reason: busyReason ?? modelReason ?? (
				state.recommendedEngine === 'webnn-whisper'
					? 'Timeline range transcription requires WebNN Whisper (pending weights). Use Chrome Speech for selected clips.'
					: null
			)
		},
		cancel: { enabled: busy, reason: busy ? null : 'Nothing to cancel.' }
	};
}
