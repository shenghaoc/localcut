/**
 * Orchestration for Auto Captions (Phase 29, LiteRT.js Whisper).
 * Framework-free state machine between three parties:
 *
 *   pipeline worker  ──(extract-clip-audio PCM windows)──►  controller
 *   controller       ──(transcribe, transferred)──────────►  ASR worker (LiteRT)
 *   controller       ──(asr-create-caption-track)─────────►  pipeline worker
 *
 * The ASR worker owns LiteRT.js and all inference. The controller only extracts
 * 16 kHz mono PCM from the selected clip/range, streams it to the worker, tracks
 * progress, and turns the final result into a generated caption track. There is
 * no Browser SpeechRecognition path: LiteRT Whisper is the only engine.
 */
import type {
	AsrAccelerator,
	AsrModelStatus,
	AsrProbeResult,
	AsrRecommendedEngine,
	AsrWorkerState,
	CaptionSegmentSnapshot,
	WorkerStateMessage
} from '../protocol';
import { asrAvailable, ASR_UNAVAILABLE_MESSAGE, probeAsr } from '../engine/asr/asr-probe';
import {
	ASR_MODEL_CATALOG,
	defaultModel,
	modelById,
	type AsrModelCatalogEntry
} from '../engine/asr/model-catalog';
import type { AsrWorkerPort } from './asr-bridge';

export const ASR_EXTRACT_WINDOW_SECONDS = 30;
/** Default length of the "transcribe timeline range" window from the playhead. */
export const ASR_PREVIEW_SECONDS = 30;
export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MAX_JOB_SECONDS = 1800; // 30 minutes
/** Overlap between consecutive decode windows so boundary words keep context. */
export const ASR_WINDOW_OVERLAP_SECONDS = 5;

/** One planned decode window: the audio slice to extract and its de-overlap bounds. */
export interface AsrWindowPlan {
	offsetS: number;
	windowS: number;
	trustedFromS: number;
	trustedToS: number;
}

/**
 * Split a job duration into decode windows. When the duration exceeds one window,
 * consecutive windows overlap by {@link ASR_WINDOW_OVERLAP_SECONDS} so a word
 * straddling a window edge is decoded with full context by the later window. Each
 * window's trusted range trims half the overlap from its internal edges, so the
 * ranges tile `[0, durationS)` without overlap — every segment is claimed by
 * exactly one window and none can be emitted twice.
 */
export function planAsrWindows(durationS: number): AsrWindowPlan[] {
	const windowS = ASR_EXTRACT_WINDOW_SECONDS;
	if (durationS <= windowS) {
		return [{ offsetS: 0, windowS: durationS, trustedFromS: 0, trustedToS: durationS }];
	}
	const overlap = ASR_WINDOW_OVERLAP_SECONDS;
	const stride = windowS - overlap;
	const plan: AsrWindowPlan[] = [];
	for (let start = 0; start < durationS; start += stride) {
		const length = Math.min(windowS, durationS - start);
		const isFirst = start === 0;
		const isLast = start + length >= durationS - 1e-6;
		plan.push({
			offsetS: start,
			windowS: length,
			trustedFromS: isFirst ? 0 : start + overlap / 2,
			trustedToS: isLast ? durationS : start + length - overlap / 2
		});
		if (isLast) break;
	}
	return plan;
}
const ASR_BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const ASR_WASM_PATH = `/litert/${ASR_BUILD_SHA}/`;
/** Baseline accelerator; used when accelerated LiteRT backends are unavailable or fall back. */
export const ASR_DEFAULT_ACCELERATOR: AsrAccelerator = 'wasm';

/**
 * Prefer WebNN when enabled by this Chromium session, then WebGPU when the
 * browser exposes it; LiteRT falls back to WASM inside the worker when backend
 * compilation fails on a specific device/driver.
 */
export function preferredAccelerator(probe: AsrProbeResult | null): AsrAccelerator {
	if (probe?.webnn === 'supported') return 'webnn';
	if (probe?.webgpu === 'supported') return 'webgpu';
	return ASR_DEFAULT_ACCELERATOR;
}

export interface AsrClipTarget {
	trackId: string;
	clipId: string;
	timelineStartS: number;
	durationS: number;
	fileName: string;
}

export interface AsrTimelineRange {
	startS: number;
	durationS: number;
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
	/** The catalog model the user has selected. */
	model: AsrModelCatalogEntry;
	/** All selectable models (for the picker). */
	models: readonly AsrModelCatalogEntry[];
	modelStatus: AsrModelStatus;
	modelSizeBytes: number | null;
	accelerator: AsrAccelerator | null;
	/** Model download/compile progress in [0, 1] while loading, else null. */
	downloadFraction: number | null;
	downloadedBytes: number | null;
	/** On `loaded`: true when the model came from the on-device cache (no download). */
	cached: boolean | null;
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

export interface CreateCaptionTrackRequest {
	segments: CaptionSegmentSnapshot[];
	language: string | null;
	engine: 'litert-whisper';
	accelerator: AsrAccelerator;
	phraseLevel: boolean;
	trackName: string;
}

export interface AsrControllerPorts {
	spawnWorker(
		onState: (msg: AsrWorkerState) => void,
		onCrash: (message: string) => void
	): Promise<AsrWorkerPort>;
	requestClipAudio(request: ClipAudioRequest): void;
	createCaptionTrack(request: CreateCaptionTrackRequest): void;
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
		model: defaultModel(),
		models: ASR_MODEL_CATALOG,
		modelStatus: 'not-loaded',
		modelSizeBytes: null,
		accelerator: null,
		downloadFraction: null,
		downloadedBytes: null,
		cached: null,
		job: null,
		lastDurationMs: null,
		error: null
	};
	private readonly listeners = new Set<(state: AsrControllerState) => void>();
	private worker: AsrWorkerPort | null = null;
	private workerSpawn: Promise<AsrWorkerPort> | null = null;
	private workerSpawnGeneration = 0;
	private nextJobId = 1;
	private nextRequestId = 1;
	private activeJob: ActiveJob | null = null;
	private readonly pendingExtractions = new Map<string, PendingExtraction>();
	private loadPromise: Promise<boolean> | null = null;
	private loadResolve: ((ok: boolean) => void) | null = null;

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

	setProbe(): void {
		const result = probeAsr();
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

	private settleLoad(ok: boolean): void {
		this.loadResolve?.(ok);
		this.loadResolve = null;
		this.loadPromise = null;
	}

	private handleWorkerState(msg: AsrWorkerState): void {
		switch (msg.type) {
			case 'asr-model-status': {
				this.update({
					modelStatus: msg.status,
					modelSizeBytes: msg.sizeBytes ?? this.state.modelSizeBytes,
					accelerator: msg.accelerator ?? this.state.accelerator,
					downloadFraction: msg.status === 'loading' ? (msg.fraction ?? 0) : null,
					downloadedBytes: msg.status === 'loading' ? (msg.downloadedBytes ?? null) : null,
					cached: msg.status === 'loaded' ? (msg.cached ?? null) : this.state.cached,
					error: msg.status === 'failed' ? (msg.error ?? 'Model load failed.') : this.state.error
				});
				if (msg.status === 'loaded') this.settleLoad(true);
				else if (msg.status === 'failed') this.settleLoad(false);
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
				this.setProbe();
				break;
		}
	}

	private async ensureWorker(): Promise<AsrWorkerPort> {
		if (this.worker) return this.worker;
		const generation = this.workerSpawnGeneration;
		this.workerSpawn ??= this.ports.spawnWorker(
			(msg) => this.handleWorkerState(msg),
			(message) => {
				this.update({ modelStatus: 'not-loaded', job: null, error: message });
				this.settleLoad(false);
				if (this.activeJob) {
					this.activeJob.cancelled = true;
					this.activeJob.resultReject?.(new Error(message));
				}
				this.activeJob = null;
				this.worker?.terminate();
				this.worker = null;
				this.workerSpawn = null;
				this.workerSpawnGeneration++;
				this.ports.onError?.(message);
			}
		);
		const spawned = await this.workerSpawn;
		if (this.workerSpawn === null || generation !== this.workerSpawnGeneration) {
			spawned.terminate();
			throw new AsrCancelled();
		}
		this.worker = spawned;
		return this.worker;
	}

	async loadModel(): Promise<boolean> {
		if (!this.state.available || this.state.recommendedEngine === 'none') {
			this.update({ error: ASR_UNAVAILABLE_MESSAGE });
			return false;
		}
		if (this.state.modelStatus === 'loaded') return true;
		if (this.loadPromise) return this.loadPromise;

		this.update({
			modelStatus: 'loading',
			error: null,
			downloadFraction: 0,
			downloadedBytes: null,
			modelSizeBytes: this.state.model.sizeBytes,
			cached: null
		});
		const pending = new Promise<boolean>((resolve) => {
			this.loadResolve = resolve;
		});
		this.loadPromise = pending;
		try {
			const worker = await this.ensureWorker();
			if (this.loadPromise !== pending || this.state.modelStatus !== 'loading') {
				return pending;
			}
			worker.send({
				type: 'asr-load-model',
				manifestUrl: this.state.model.manifestUrl,
				accelerator: preferredAccelerator(this.state.probe),
				wasmPath: ASR_WASM_PATH
			});
		} catch (error) {
			if (this.loadPromise !== pending) return pending;
			const message = error instanceof Error ? error.message : String(error);
			this.update({ modelStatus: 'failed', error: message });
			this.settleLoad(false);
		}
		return pending;
	}

	/**
	 * Selects a different catalog model. Switching invalidates any model already
	 * loaded in the worker, so the next transcription re-loads the new model.
	 */
	selectModel(id: string): void {
		const entry = modelById(id);
		if (this.state.job) return;
		if (entry.id === this.state.model.id && this.state.modelStatus !== 'failed') return;
		if (this.workerSpawn && !this.worker) {
			this.workerSpawnGeneration++;
			this.workerSpawn = null;
		}
		this.worker?.send({ type: 'asr-dispose' });
		this.worker?.terminate();
		this.worker = null;
		this.workerSpawn = null;
		this.workerSpawnGeneration++;
		this.settleLoad(false);
		this.update({
			model: entry,
			modelStatus: 'not-loaded',
			modelSizeBytes: null,
			accelerator: null,
			downloadFraction: null,
			downloadedBytes: null,
			cached: null,
			error: null
		});
	}

	private requestExtraction(
		clip: AsrClipTarget,
		offsetS: number,
		durationS: number
	): Promise<Extract<WorkerStateMessage, { type: 'clip-audio' }>> {
		const requestId = `asr-${this.nextRequestId++}`;
		return new Promise((resolve, reject) => {
			this.pendingExtractions.set(requestId, { resolve, reject });
			this.ports.requestClipAudio({
				requestId,
				trackId: clip.trackId,
				clipId: clip.clipId,
				clipOffsetS: offsetS,
				durationS,
				sampleRate: ASR_SAMPLE_RATE
			});
		});
	}

	async transcribeClip(clip: AsrClipTarget, language?: string): Promise<boolean> {
		return this.runTranscribe('selected-clip', clip, language);
	}

	async transcribeRange(range: AsrTimelineRange, language?: string): Promise<boolean> {
		return this.runTranscribe('timeline-range', null, language, range);
	}

	private offsetSegments(
		segments: readonly CaptionSegmentSnapshot[],
		offsetS: number
	): CaptionSegmentSnapshot[] {
		if (!Number.isFinite(offsetS) || Math.abs(offsetS) < 1e-6) return [...segments];
		return segments.map((segment) => ({
			...segment,
			start: segment.start + offsetS
		}));
	}

	private async runTranscribe(
		kind: AsrJobKind,
		clip: AsrClipTarget | null,
		language?: string,
		timelineRange?: AsrTimelineRange
	): Promise<boolean> {
		if (this.state.job) return false;
		if (!(await this.loadModel())) return false;

		const durationS = clip
			? Math.min(clip.durationS, ASR_MAX_JOB_SECONDS)
			: Math.min(timelineRange?.durationS ?? 0, ASR_MAX_JOB_SECONDS);
		if (durationS <= 0) {
			this.update({ error: 'Nothing to transcribe in the selection.' });
			return false;
		}

		const worker = await this.ensureWorker();
		const jobId = this.nextJobId++;
		const job: ActiveJob = {
			jobId,
			kind,
			clip,
			durationS,
			cancelled: false,
			startedAt: performance.now()
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
			const windows = planAsrWindows(durationS);
			for (let i = 0; i < windows.length; i++) {
				if (job.cancelled) throw new AsrCancelled();
				const { offsetS, windowS, trustedFromS, trustedToS } = windows[i];
				const extractTarget =
					clip ??
					({
						trackId: '',
						clipId: '',
						timelineStartS: timelineRange?.startS ?? 0,
						durationS,
						fileName: 'range'
					} satisfies AsrClipTarget);
				const startS = clip ? offsetS : (timelineRange?.startS ?? 0) + offsetS;
				const window = await this.requestExtraction(extractTarget, startS, windowS);
				if (job.cancelled) throw new AsrCancelled();

				worker.send(
					{
						type: 'asr-transcribe',
						jobId,
						pcm: window.pcm,
						sampleRate: window.sampleRate,
						channels: window.channels,
						offsetS,
						totalDurationS: durationS,
						language,
						trustedFromS,
						trustedToS,
						isFinal: i === windows.length - 1
					},
					[window.pcm.buffer]
				);
			}

			const finalResult = await result;
			this.finishJob();
			const segmentOffsetS = clip?.timelineStartS ?? timelineRange?.startS ?? 0;
			const shiftedSegments = this.offsetSegments(finalResult.segments, segmentOffsetS);

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
				segments: shiftedSegments,
				language: finalResult.language,
				engine: 'litert-whisper',
				accelerator: this.state.accelerator ?? ASR_DEFAULT_ACCELERATOR,
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
			this.update({ job: null, error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	private finishJob(): void {
		this.activeJob = null;
	}

	cancel(): void {
		if (this.state.modelStatus === 'loading') {
			if (this.workerSpawn && !this.worker) {
				this.workerSpawnGeneration++;
				this.workerSpawn = null;
			}
			this.worker?.send({ type: 'asr-dispose' });
			this.settleLoad(false);
			this.update({
				modelStatus: 'not-loaded',
				accelerator: null,
				downloadFraction: null,
				downloadedBytes: null,
				cached: null,
				error: null
			});
		}
		const job = this.activeJob;
		if (job) {
			job.cancelled = true;
			this.worker?.send({ type: 'asr-cancel', jobId: job.jobId });
			job.resultReject?.(new AsrCancelled());
		}
		for (const [requestId, pending] of this.pendingExtractions) {
			this.pendingExtractions.delete(requestId);
			pending.reject(new AsrCancelled());
		}
		this.pendingExtractions.clear();
		this.update({ job: null });
	}

	dispose(): void {
		this.cancel();
		this.settleLoad(false);
		this.worker?.send({ type: 'asr-dispose' });
		this.worker?.terminate();
		this.worker = null;
		this.workerSpawn = null;
		this.workerSpawnGeneration++;
		this.pendingExtractions.clear();
		this.listeners.clear();
	}
}

export const ASR_PRIVACY_STATEMENT =
	'All speech recognition runs on this device with LiteRT.js. No audio leaves your browser. No cloud API.';

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
	const modelNeeded = state.modelStatus !== 'loaded';
	const busyReason = busy ? 'An ASR task is in progress.' : null;
	const clipReason = noClip ? 'Select a clip on the timeline first.' : null;
	const rangeReason =
		'Timeline range transcription needs mixed timeline audio extraction; transcribe a selected clip for now.';
	return {
		loadModel: {
			enabled: !busy && modelNeeded,
			reason: busyReason ?? (modelNeeded ? null : 'Model already loaded.')
		},
		transcribeClip: {
			enabled: !busy && !noClip,
			reason: busyReason ?? clipReason
		},
		transcribeRange: {
			enabled: false,
			reason: busyReason ?? rangeReason
		},
		cancel: {
			enabled: busy,
			reason: busy ? null : 'Nothing to cancel.'
		}
	};
}
