/**
 * Smart Reframe controller (Phase 33). Owns the lazily-spawned analysis worker
 * and exposes a single observable state to the UI. The worker (and the MediaPipe
 * face model, only when the user explicitly loads it) loads on demand, never at
 * startup (R0.3).
 *
 * Flow: the App resolves the clip's source `File` from the pipeline worker,
 * calls {@link ReframeController.beginAnalysis} while it resolves, then
 * {@link ReframeController.runStart} with the resolved `File`. Worker progress /
 * result / error messages drive the state the panel and overlay render from.
 */
import type {
	ClipKeyframesSnapshot,
	ReframeAnalysisStatsSnapshot,
	ReframeFaceModelStatus,
	SmartReframeWorkerCommand,
	SmartReframeWorkerState
} from '../protocol';
import type { SmartReframeWorkerPort } from './reframe-bridge';

export type ReframeStatus = 'idle' | 'resolving' | 'analysing' | 'review' | 'error';

/** Context captured when analysis begins, used by the overlay and on apply. */
export interface ReframeContext {
	trackId: string;
	clipId: string;
	/** Source aspect ratio (width / height, rotation-applied). */
	sourceAspect: number;
	/** Numeric target aspect ratio (e.g. 9 / 16). */
	targetAspectValue: number;
	/** Monotonic run id; lets the caller detect that a superseded/cancelled run's
	 *  async File resolution must not start analysis behind the current one. */
	runId: number;
}

export interface ReframeControllerState {
	readonly status: ReframeStatus;
	/** Analysis progress in [0,1]. */
	readonly progress: number;
	readonly framesProcessed: number;
	readonly totalFrames: number;
	readonly stats: ReframeAnalysisStatsSnapshot | null;
	readonly result: ClipKeyframesSnapshot | null;
	readonly error: string | null;
	/** Load state of the optional MediaPipe face model (persists across analyses). */
	readonly faceModelStatus: ReframeFaceModelStatus;
	readonly faceModelError: string | null;
	readonly context: ReframeContext | null;
}

export interface ReframeControllerPorts {
	spawnWorker: (
		onState: (msg: SmartReframeWorkerState) => void,
		onCrash: (message: string) => void
	) => Promise<SmartReframeWorkerPort>;
	/** Surface analysis errors to the recent-errors log / status line (R10.2). */
	onError?: (message: string) => void;
}

const INITIAL_STATE: ReframeControllerState = {
	status: 'idle',
	progress: 0,
	framesProcessed: 0,
	totalFrames: 0,
	stats: null,
	result: null,
	error: null,
	faceModelStatus: 'not-loaded',
	faceModelError: null,
	context: null
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class ReframeController {
	private state: ReframeControllerState = INITIAL_STATE;
	private readonly listeners = new Set<(state: ReframeControllerState) => void>();
	private worker: SmartReframeWorkerPort | null = null;
	private workerPromise: Promise<SmartReframeWorkerPort> | null = null;
	private disposed = false;
	private generation = 0;

	constructor(private readonly ports: ReframeControllerPorts) {}

	getState(): ReframeControllerState {
		return this.state;
	}

	subscribe(listener: (state: ReframeControllerState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private update(patch: Partial<ReframeControllerState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}

	/** Enter the resolving phase while the App fetches the source File. Returns a
	 *  monotonic run id; the caller must re-check it after its async File
	 *  resolution and abort if it no longer matches the current context. */
	beginAnalysis(context: Omit<ReframeContext, 'runId'>): number {
		const runId = ++this.generation;
		this.update({
			status: 'resolving',
			progress: 0,
			framesProcessed: 0,
			totalFrames: 0,
			stats: null,
			result: null,
			error: null,
			context: { ...context, runId }
		});
		return runId;
	}

	/** Load a face model on the user's explicit action (Phase 28/29 pattern).
	 *  When `ortManifestUrl` is supplied the worker tries the ORT/ONNX detector
	 *  first; on template/invalid manifest it falls back to MediaPipe BlazeFace.
	 *  Idempotent while loading/loaded. */
	async loadFaceModel(wasmPath: string, modelUrl: string, ortManifestUrl?: string): Promise<void> {
		if (this.state.faceModelStatus === 'loaded' || this.state.faceModelStatus === 'loading') return;
		this.update({ faceModelStatus: 'loading', faceModelError: null });
		try {
			const worker = await this.ensureWorker();
			if (this.disposed) return;
			worker.send({
				type: 'reframe-load-face-model',
				wasmPath,
				modelUrl,
				...(ortManifestUrl !== undefined ? { ortManifestUrl } : {})
			});
		} catch (error) {
			this.update({ faceModelStatus: 'failed', faceModelError: messageOf(error) });
		}
	}

	/** Spawn the worker (if needed) and post the start command. The source File
	 *  is structured-clone-copied (not transferable), so no transfer list. */
	async runStart(
		command: Extract<SmartReframeWorkerCommand, { type: 'reframe-start' }>
	): Promise<void> {
		try {
			const worker = await this.ensureWorker();
			if (this.disposed) return;
			this.update({ status: 'analysing', progress: 0 });
			worker.send(command);
		} catch (error) {
			this.fail(messageOf(error));
		}
	}

	cancel(): void {
		this.worker?.send({ type: 'reframe-cancel' });
		this.reset();
	}

	/** Throw away a reviewed result without applying (R7.3 Discard). */
	discard(): void {
		this.reset();
	}

	/** Report a failure (File resolution, worker crash, analysis error). */
	fail(message: string): void {
		this.update({ status: 'error', error: message, progress: 0 });
		this.ports.onError?.(message);
	}

	/** Reset analysis state. Leaves `faceModelStatus` intact — the loaded model
	 *  persists across analyses (discard/cancel don't unload it). */
	private reset(): void {
		this.update({
			status: 'idle',
			progress: 0,
			framesProcessed: 0,
			totalFrames: 0,
			stats: null,
			result: null,
			error: null,
			context: null
		});
	}

	dispose(): void {
		this.disposed = true;
		this.worker?.send({ type: 'reframe-dispose' });
		this.worker?.terminate();
		this.worker = null;
		this.workerPromise = null;
		this.listeners.clear();
	}

	private async ensureWorker(): Promise<SmartReframeWorkerPort> {
		if (this.worker) return this.worker;
		if (!this.workerPromise) {
			this.workerPromise = this.ports.spawnWorker(
				(msg) => this.handleWorkerState(msg),
				(crash) => this.fail(crash)
			);
		}
		const worker = await this.workerPromise;
		// dispose() may have run while the worker was still spawning; it could not
		// terminate a not-yet-resolved worker, so tear it down here instead of
		// leaking it (and its lazily-imported analyzer module).
		if (this.disposed) {
			worker.terminate();
			throw new Error('Smart Reframe controller disposed during worker spawn.');
		}
		this.worker = worker;
		return this.worker;
	}

	private handleWorkerState(msg: SmartReframeWorkerState): void {
		if (this.disposed) return;
		switch (msg.type) {
			case 'reframe-progress':
				// Ignore progress from a run the user already cancelled/discarded.
				if (this.state.status !== 'analysing') return;
				this.update({
					progress: msg.fraction,
					framesProcessed: msg.framesProcessed,
					totalFrames: msg.totalFrames
				});
				break;
			case 'reframe-result':
				// A late result from a cancelled run must not flip the UI to review.
				if (this.state.status !== 'analysing') return;
				this.update({ status: 'review', result: msg.keyframes, stats: msg.stats, progress: 1 });
				break;
			case 'reframe-error':
				this.fail(msg.reason);
				break;
			case 'reframe-cancelled':
				this.reset();
				break;
			case 'reframe-face-model-status':
				this.update({
					faceModelStatus: msg.status,
					faceModelError:
						msg.status === 'failed' ? (msg.message ?? 'Face model failed to load.') : null
				});
				break;
		}
	}
}
