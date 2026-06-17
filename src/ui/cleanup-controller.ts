/**
 * Orchestration for Local Audio Cleanup (Phase 28). Framework-free state
 * machine between three parties:
 *
 *   pipeline worker  ──(extract-clip-audio PCM windows)──►  controller
 *   controller       ──(begin/chunk/end, transferred)────►  cleanup worker
 *   cleanup worker   ──(progress / result)───────────────►  controller
 *   controller       ──(apply-audio-cleanup WAV)─────────►  pipeline worker
 *
 * The cleanup worker is spawned lazily on the first action. All ports are
 * injected so the whole flow — lazy spawn, windowed extraction, progress,
 * cancellation — is unit-testable without workers, LiteRT, or the DOM.
 */

import type {
	CleanupAccelerator,
	CleanupBackendKind,
	CleanupModelStatus,
	CleanupProbeResult,
	CleanupWorkerState,
	WorkerStateMessage
} from '../protocol';
import type { CleanupWorkerPort } from './cleanup-bridge';

export const CLEANUP_PREVIEW_SECONDS = 10;
export const CLEANUP_EXTRACT_WINDOW_SECONDS = 10;
export const CLEANUP_SAMPLE_RATE = 16_000;
export const CLEANUP_BLOCK_SHIFT = 128;
/** Mirrors the cleanup worker's per-job bound (12 min @ 16 kHz / 128-sample shift). */
export const CLEANUP_MAX_JOB_SECONDS = 720;

const CLEANUP_BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const CLEANUP_WASM_PATH = `/litert/${CLEANUP_BUILD_SHA}/`;

export const CLEANUP_UNAVAILABLE_MESSAGE = 'WebAssembly is required for local audio cleanup.';

export function preferredCleanupAccelerator(probe: CleanupProbeResult | null): CleanupAccelerator {
	return probe?.accelerator ?? 'wasm';
}

export interface CleanupClipTarget {
	trackId: string;
	clipId: string;
	inPointS: number;
	durationS: number;
	fileName: string;
}

export type CleanupJobKind = 'preview' | 'apply';
export type CleanupJobPhase = 'extracting' | 'processing' | 'applying';

export interface CleanupJobState {
	kind: CleanupJobKind;
	phase: CleanupJobPhase;
	fraction: number;
	processedFrames: number;
	totalFrames: number;
	clip: CleanupClipTarget;
}

export interface CleanupPreviewBuffers {
	clip: CleanupClipTarget;
	original: Float32Array;
	originalChannels: number;
	cleaned: Float32Array;
	sampleRate: number;
	durationS: number;
}

export interface CleanupControllerState {
	probe: CleanupProbeResult | null;
	available: boolean;
	/** Selected DTLN inference backend (LiteRT/TFLite or ONNX Runtime). */
	backend: CleanupBackendKind;
	modelStatus: CleanupModelStatus;
	accelerator: CleanupAccelerator | null;
	modelSizeBytes: number | null;
	job: CleanupJobState | null;
	preview: CleanupPreviewBuffers | null;
	lastAnalysisMs: number | null;
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

export interface ApplyCleanupRequest {
	trackId: string;
	clipId: string;
	wav: ArrayBuffer;
	fileName: string;
	clipInPointS: number;
	durationS: number;
	modelId: string;
	modelVersion: string;
}

export interface CleanupControllerPorts {
	spawnWorker(
		backend: CleanupBackendKind,
		onState: (msg: CleanupWorkerState) => void,
		onCrash: (message: string) => void
	): Promise<CleanupWorkerPort>;
	requestClipAudio(request: ClipAudioRequest): void;
	applyToClip(request: ApplyCleanupRequest): void;
	/** Per-backend manifest URL the worker fetches when loading the model. */
	manifestUrls: Record<CleanupBackendKind, string>;
	wasmPath: string;
	onError?(message: string): void;
}

interface PendingExtraction {
	resolve: (msg: Extract<WorkerStateMessage, { type: 'clip-audio' }>) => void;
	reject: (error: Error) => void;
}

interface ActiveJob {
	jobId: number;
	kind: CleanupJobKind;
	clip: CleanupClipTarget;
	startOffsetS: number;
	durationS: number;
	totalFrames: number;
	cancelled: boolean;
	originalChunks: Float32Array[];
	originalChannels: number;
	startedAt: number;
	resultResolve?: (msg: Extract<CleanupWorkerState, { type: 'cleanup-result' }>) => void;
	resultReject?: (error: Error) => void;
}

export class CleanupCancelled extends Error {
	constructor() {
		super('cancelled');
		this.name = 'CleanupCancelled';
	}
}

function cleanupAvailable(probe: CleanupProbeResult | null | undefined): boolean {
	return probe?.wasmAvailable ?? typeof WebAssembly !== 'undefined';
}

export class CleanupController {
	private readonly ports: CleanupControllerPorts;
	private state: CleanupControllerState = {
		probe: null,
		available: typeof WebAssembly !== 'undefined',
		backend: 'ort',
		modelStatus: 'not-loaded',
		accelerator: null,
		modelSizeBytes: null,
		job: null,
		preview: null,
		lastAnalysisMs: null,
		error: null
	};
	private readonly listeners = new Set<(state: CleanupControllerState) => void>();
	private worker: CleanupWorkerPort | null = null;
	private workerSpawn: Promise<CleanupWorkerPort> | null = null;
	private nextJobId = 1;
	private nextRequestId = 1;
	private activeJob: ActiveJob | null = null;
	private readonly pendingExtractions = new Map<string, PendingExtraction>();
	private modelLoadWaiters: Array<(ok: boolean) => void> = [];
	private manifestVersion = 'unknown';
	private workerGeneration = 0;

	constructor(ports: CleanupControllerPorts) {
		this.ports = ports;
	}

	getState(): CleanupControllerState {
		return this.state;
	}

	subscribe(listener: (state: CleanupControllerState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	get workerSpawned(): boolean {
		return this.worker !== null || this.workerSpawn !== null;
	}

	private update(patch: Partial<CleanupControllerState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}

	setCleanupProbe(probe: CleanupProbeResult | null): void {
		this.update({ probe, available: cleanupAvailable(probe) });
	}

	/**
	 * Switches the DTLN inference backend. Because each backend has its own
	 * worker, runtime, and model cache, an in-flight job is cancelled and any
	 * spawned worker is torn down so the next action re-spawns the right one and
	 * reloads from a clean (`not-loaded`) state.
	 */
	setBackend(backend: CleanupBackendKind): void {
		if (backend === this.state.backend) return;
		this.workerGeneration += 1;
		this.cancel();
		if (this.worker) {
			this.worker.send({ type: 'cleanup-dispose' });
			this.worker.terminate();
		}
		this.worker = null;
		this.workerSpawn = null;
		this.manifestVersion = 'unknown';
		const waiters = this.modelLoadWaiters;
		this.modelLoadWaiters = [];
		for (const waiter of waiters) waiter(false);
		this.update({
			backend,
			modelStatus: 'not-loaded',
			accelerator: null,
			modelSizeBytes: null,
			preview: null,
			error: null
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
		if (msg.type === 'audio-cleanup-applied') {
			if (this.state.job?.phase === 'applying') {
				if (msg.ok) {
					this.update({ job: null, error: null });
				} else {
					this.update({ job: null, error: msg.message ?? 'Applying cleanup failed.' });
				}
			}
		}
	}

	private handleWorkerState(msg: CleanupWorkerState): void {
		switch (msg.type) {
			case 'cleanup-model-status': {
				if (msg.version) this.manifestVersion = msg.version;
				this.update({
					modelStatus: msg.status,
					accelerator: msg.accelerator ?? (msg.status === 'loaded' ? this.state.accelerator : null),
					modelSizeBytes: msg.sizeBytes ?? this.state.modelSizeBytes,
					error:
						msg.status === 'failed'
							? (msg.error ?? 'Model load failed.')
							: msg.status === 'loaded'
								? null
								: msg.status === 'loading'
									? (msg.error ?? this.state.error)
									: this.state.error
				});
				if (msg.status === 'loaded' || msg.status === 'failed') {
					const ok = msg.status === 'loaded';
					const waiters = this.modelLoadWaiters;
					this.modelLoadWaiters = [];
					for (const waiter of waiters) waiter(ok);
				}
				break;
			}
			case 'cleanup-progress': {
				const job = this.activeJob;
				if (!job || msg.jobId !== job.jobId || !this.state.job) break;
				this.update({
					job: {
						...this.state.job,
						phase: 'processing',
						processedFrames: msg.processedFrames,
						totalFrames: msg.totalFrames,
						fraction: msg.fraction
					}
				});
				break;
			}
			case 'cleanup-result': {
				const job = this.activeJob;
				if (job && msg.jobId === job.jobId) job.resultResolve?.(msg);
				break;
			}
			case 'cleanup-cancelled': {
				const job = this.activeJob;
				if (job && (msg.jobId === undefined || msg.jobId === job.jobId)) {
					job.resultReject?.(new CleanupCancelled());
				}
				break;
			}
			case 'cleanup-error': {
				const job = this.activeJob;
				if (job && (msg.jobId === undefined || msg.jobId === job.jobId)) {
					job.resultReject?.(new Error(msg.message));
				} else if (!job) {
					this.update({ error: msg.message });
				}
				break;
			}
			case 'cleanup-probe-result':
				this.setCleanupProbe(msg.result);
				break;
		}
	}

	private async ensureWorker(): Promise<CleanupWorkerPort> {
		if (this.worker) return this.worker;
		const backend = this.state.backend;
		const generation = this.workerGeneration;
		this.workerSpawn ??= this.ports.spawnWorker(
			backend,
			(msg) => {
				if (generation !== this.workerGeneration || backend !== this.state.backend) return;
				this.handleWorkerState(msg);
			},
			(message) => {
				if (generation !== this.workerGeneration || backend !== this.state.backend) return;
				this.update({
					modelStatus: 'not-loaded',
					accelerator: null,
					job: null,
					error: message
				});
				const waiters = this.modelLoadWaiters;
				this.modelLoadWaiters = [];
				for (const waiter of waiters) waiter(false);
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
		const spawn = this.workerSpawn;
		const worker = await spawn;
		if (generation !== this.workerGeneration || backend !== this.state.backend) {
			worker.terminate();
			throw new CleanupCancelled();
		}
		if (this.worker) return this.worker;
		if (this.workerSpawn !== spawn) {
			worker.terminate();
			throw new CleanupCancelled();
		}
		this.worker = worker;
		this.workerSpawn = null;
		return this.worker;
	}

	async loadModel(): Promise<boolean> {
		if (!this.state.available) {
			this.update({ error: CLEANUP_UNAVAILABLE_MESSAGE });
			return false;
		}
		if (this.state.modelStatus === 'loaded') return true;
		if (this.state.modelStatus === 'loading') {
			return new Promise((resolve) => this.modelLoadWaiters.push(resolve));
		}
		this.update({ modelStatus: 'loading', error: null });
		try {
			const worker = await this.ensureWorker();
			const done = new Promise<boolean>((resolve) => this.modelLoadWaiters.push(resolve));
			worker.send({
				type: 'cleanup-load-model',
				manifestUrl: this.ports.manifestUrls[this.state.backend],
				wasmPath: this.ports.wasmPath,
				preferredAccelerator: preferredCleanupAccelerator(this.state.probe)
			});
			return await done;
		} catch (error) {
			if (error instanceof CleanupCancelled) return false;
			const message = error instanceof Error ? error.message : String(error);
			this.update({ modelStatus: 'failed', error: message });
			return false;
		}
	}

	private requestExtraction(
		request: Omit<ClipAudioRequest, 'requestId'>
	): Promise<Extract<WorkerStateMessage, { type: 'clip-audio' }>> {
		const requestId = `cleanup-${this.nextRequestId++}`;
		return new Promise((resolve, reject) => {
			this.pendingExtractions.set(requestId, { resolve, reject });
			this.ports.requestClipAudio({ ...request, requestId });
		});
	}

	private async runJob(
		kind: CleanupJobKind,
		clip: CleanupClipTarget,
		output: 'pcm' | 'wav'
	): Promise<Extract<CleanupWorkerState, { type: 'cleanup-result' }>> {
		const durationS =
			kind === 'preview'
				? Math.min(clip.durationS, CLEANUP_PREVIEW_SECONDS)
				: Math.min(clip.durationS, CLEANUP_MAX_JOB_SECONDS);
		const totalFrames = Math.max(
			1,
			Math.ceil((durationS * CLEANUP_SAMPLE_RATE) / CLEANUP_BLOCK_SHIFT)
		);
		const worker = await this.ensureWorker();
		const jobId = this.nextJobId++;
		const job: ActiveJob = {
			jobId,
			kind,
			clip,
			startOffsetS: 0,
			durationS,
			totalFrames,
			cancelled: false,
			originalChunks: [],
			originalChannels: 1,
			startedAt: Date.now()
		};
		this.activeJob = job;
		this.update({
			job: { kind, phase: 'extracting', fraction: 0, processedFrames: 0, totalFrames, clip },
			preview: null,
			error: null
		});

		const result = new Promise<Extract<CleanupWorkerState, { type: 'cleanup-result' }>>(
			(resolve, reject) => {
				job.resultResolve = resolve;
				job.resultReject = reject;
			}
		);
		result.catch(() => undefined);

		worker.send({ type: 'cleanup-begin', jobId, totalFrames });
		let offsetS = 0;
		while (offsetS < durationS) {
			if (job.cancelled) throw new CleanupCancelled();
			const windowS = Math.min(CLEANUP_EXTRACT_WINDOW_SECONDS, durationS - offsetS);
			const window = await this.requestExtraction({
				trackId: clip.trackId,
				clipId: clip.clipId,
				clipOffsetS: offsetS,
				durationS: windowS,
				sampleRate: CLEANUP_SAMPLE_RATE
			});
			if (job.cancelled) throw new CleanupCancelled();
			if (kind === 'preview') {
				job.originalChunks.push(window.pcm.slice());
				job.originalChannels = window.channels;
			}
			worker.send(
				{
					type: 'cleanup-chunk',
					jobId,
					pcm: window.pcm,
					sampleRate: window.sampleRate,
					channels: window.channels
				},
				[window.pcm.buffer]
			);
			offsetS += windowS;
		}
		if (job.cancelled) throw new CleanupCancelled();
		worker.send({ type: 'cleanup-end', jobId, output });
		return result;
	}

	private finishJob(): void {
		this.activeJob = null;
	}

	async previewCleanup(clip: CleanupClipTarget): Promise<boolean> {
		if (this.state.job) return false;
		if (!(await this.loadModel())) return false;
		try {
			const result = await this.runJob('preview', clip, 'pcm');
			const job = this.activeJob;
			const original = concatFloat32(job?.originalChunks ?? []);
			const durationS = Math.min(clip.durationS, CLEANUP_PREVIEW_SECONDS);
			this.finishJob();
			this.update({
				job: null,
				lastAnalysisMs: result.durationMs,
				preview: result.pcm
					? {
							clip,
							original,
							originalChannels: job?.originalChannels ?? 1,
							cleaned: result.pcm,
							sampleRate: result.sampleRate,
							durationS
						}
					: null
			});
			return true;
		} catch (error) {
			this.finishJob();
			if (error instanceof CleanupCancelled) {
				this.update({ job: null });
				return false;
			}
			this.update({ job: null, error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	async applyCleanup(clip: CleanupClipTarget): Promise<boolean> {
		if (this.state.job) return false;
		if (clip.durationS > CLEANUP_MAX_JOB_SECONDS) {
			this.update({
				error: `Clip is too long for one cleanup pass (max ${CLEANUP_MAX_JOB_SECONDS / 60} minutes).`
			});
			return false;
		}
		if (!(await this.loadModel())) return false;
		try {
			const result = await this.runJob('apply', clip, 'wav');
			const job = this.activeJob;
			this.finishJob();
			if (!result.wav) throw new Error('Cleanup produced no audio.');
			const currentJob: CleanupJobState = this.state.job ?? {
				kind: 'apply',
				phase: 'applying',
				fraction: 1,
				processedFrames: job?.totalFrames ?? 0,
				totalFrames: job?.totalFrames ?? 0,
				clip
			};
			this.update({
				job: { ...currentJob, phase: 'applying', fraction: 1 },
				lastAnalysisMs: result.durationMs
			});
			this.ports.applyToClip({
				trackId: clip.trackId,
				clipId: clip.clipId,
				wav: result.wav,
				fileName: cleanedFileName(clip.fileName),
				clipInPointS: clip.inPointS,
				durationS: Math.min(clip.durationS, CLEANUP_MAX_JOB_SECONDS),
				modelId: this.state.backend === 'ort' ? 'dtln-onnx' : 'dtln',
				modelVersion: this.manifestVersion
			});
			return true;
		} catch (error) {
			this.finishJob();
			if (error instanceof CleanupCancelled) {
				this.update({ job: null });
				return false;
			}
			this.update({ job: null, error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	cancel(): void {
		const job = this.activeJob;
		if (job) {
			job.cancelled = true;
			this.worker?.send({ type: 'cleanup-cancel', jobId: job.jobId });
			job.resultReject?.(new CleanupCancelled());
		} else if (this.state.modelStatus === 'loading') {
			this.worker?.send({ type: 'cleanup-cancel' });
			this.update({ modelStatus: 'not-loaded' });
			const waiters = this.modelLoadWaiters;
			this.modelLoadWaiters = [];
			for (const waiter of waiters) waiter(false);
		}
		// eslint-disable-next-line unicorn/no-useless-spread — snapshot needed: deletes during iteration
		for (const [requestId, pending] of [...this.pendingExtractions]) {
			this.pendingExtractions.delete(requestId);
			pending.reject(new CleanupCancelled());
		}
		this.update({ job: null });
	}

	clearPreview(): void {
		this.update({ preview: null });
	}

	dispose(): void {
		this.workerGeneration += 1;
		this.cancel();
		this.worker?.send({ type: 'cleanup-dispose' });
		this.worker?.terminate();
		this.worker = null;
		this.workerSpawn = null;
		this.listeners.clear();
	}
}

export const CLEANUP_PRIVACY_STATEMENT =
	'Runs on this device. No upload. No API key. No server inference.';

export interface CleanupActionAvailability {
	loadModel: { enabled: boolean; reason: string | null };
	preview: { enabled: boolean; reason: string | null };
	apply: { enabled: boolean; reason: string | null };
	cancel: { enabled: boolean; reason: string | null };
}

export function cleanupActionAvailability(
	state: CleanupControllerState,
	selectedClip: CleanupClipTarget | null
): CleanupActionAvailability {
	if (!state.available) {
		const reason = CLEANUP_UNAVAILABLE_MESSAGE;
		return {
			loadModel: { enabled: false, reason },
			preview: { enabled: false, reason },
			apply: { enabled: false, reason },
			cancel: { enabled: false, reason }
		};
	}
	const busy = state.job !== null || state.modelStatus === 'loading';
	const noClip = selectedClip === null;
	const needsModelAction = state.modelStatus !== 'loaded';
	const clipReason = noClip ? 'Select an audio clip on the timeline first.' : null;
	const busyReason = busy ? 'An operation is in progress.' : null;
	return {
		loadModel: {
			enabled: !busy && needsModelAction,
			reason: busyReason ?? (needsModelAction ? null : 'Model already loaded.')
		},
		preview: { enabled: !busy && !noClip, reason: busyReason ?? clipReason },
		apply: { enabled: !busy && !noClip, reason: busyReason ?? clipReason },
		cancel: { enabled: busy, reason: busy ? null : 'Nothing to cancel.' }
	};
}

function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function cleanedFileName(originalFileName: string): string {
	const dot = originalFileName.lastIndexOf('.');
	const stem = dot > 0 ? originalFileName.slice(0, dot) : originalFileName;
	return `${stem}.cleaned.wav`;
}
