import { EncodedPacket } from 'mediabunny';
import type { CaptureSourceKind } from '../../protocol';

export interface TrackPipelineCallbacks {
	onEncodedChunk(
		sourceId: string,
		packet: EncodedPacket,
		fromUs: number,
		toUs: number,
		keyFrame: boolean,
		preEncodeDrops: number
	): void;
	onChunkAck(sourceId: string): void;
	onEncodeError(sourceId: string, error: string): void;
	onAudioOverrun(sourceId: string): void;
	onPipelineEnded(sourceId: string): void;
}

export interface TrackPipelineOptions {
	sourceId: string;
	kind: CaptureSourceKind;
	/**
	 * The in-worker source track. Omit it to build a **trackless push pipeline**
	 * (bugfix B5/T5.5): on profiles without Transferable MediaStreamTrack the main
	 * thread keeps the track, runs its own `MediaStreamTrackProcessor`, and forwards
	 * each frame here via {@link TrackPipeline.pushFrame}. The encoder + chunk
	 * lifecycle is otherwise identical to the in-worker reader path.
	 */
	track?: MediaStreamTrack;
	videoEncodeConfig?: VideoEncoderConfig;
	audioEncodeConfig?: AudioEncoderConfig;
	onVideoFrame?: (sourceId: string, frame: VideoFrame) => void;
	callbacks: TrackPipelineCallbacks;
	abort: AbortController;
}

const VIDEO_QUEUE_BOUND = 8;
const AUDIO_QUEUE_BOUND = 16;
const AUDIO_OVERRUN_CONSECUTIVE = 4;
const MAX_IN_FLIGHT_CHUNKS = 2;
/**
 * Key frames are requested on a capture-timestamp cadence, not a frame count —
 * screen capture is VFR, so a frame count would stretch fragments arbitrarily
 * during static holds (R4.4 / T5.3).
 */
const DEFAULT_KEYFRAME_INTERVAL_US = 2_000_000;

export class TrackPipeline {
	readonly sourceId: string;
	readonly kind: CaptureSourceKind;
	/** Null for a trackless push pipeline; main owns the track in that mode. */
	private readonly track: MediaStreamTrack | null;
	/** True when frames arrive via {@link pushFrame} instead of an in-worker reader. */
	private readonly pushMode: boolean;
	private readonly callbacks: TrackPipelineCallbacks;
	private readonly abort: AbortController;
	private encoder: VideoEncoder | AudioEncoder | null = null;
	private reader: ReadableStreamDefaultReader<VideoFrame | AudioData> | null = null;
	private preEncodeDrops = 0;
	private audioOverrunCount = 0;
	private running = false;
	private paused = false;
	private ended = false;
	private activeRun: Promise<void> | null = null;
	private activeRunId = 0;
	private pausedRunId: number | null = null;
	private keyframeIntervalUs = DEFAULT_KEYFRAME_INTERVAL_US;
	private lastKeyframeTs: number | null = null;
	private inFlightChunks = 0;
	private chunkWaiters: Array<() => void> = [];

	constructor(private readonly options: TrackPipelineOptions) {
		this.sourceId = options.sourceId;
		this.kind = options.kind;
		this.track = options.track ?? null;
		this.pushMode = options.track === undefined;
		this.callbacks = options.callbacks;
		this.abort = options.abort;
	}

	start(keyframeIntervalUs?: number): void {
		if (this.pushMode) {
			this.startPushPipeline(keyframeIntervalUs);
			return;
		}
		if (this.running) return;
		if (keyframeIntervalUs !== undefined && keyframeIntervalUs > 0) {
			this.keyframeIntervalUs = keyframeIntervalUs;
		}
		const runId = this.activeRunId + 1;
		this.activeRunId = runId;
		this.running = true;
		this.ended = false;
		this.pausedRunId = null;
		let runner: Promise<void> | null = null;
		if (this.kind === 'screen' || this.kind === 'webcam') {
			if (this.options.videoEncodeConfig) {
				runner = this.runVideoPipeline(this.options.videoEncodeConfig, runId);
			}
		} else {
			if (this.options.audioEncodeConfig) {
				runner = this.runAudioPipeline(this.options.audioEncodeConfig, runId);
			}
		}
		if (!runner) {
			this.running = false;
			return;
		}
		const run = runner
			.catch((err) => {
				if (!this.abort.signal.aborted) {
					this.callbacks.onEncodeError(this.sourceId, String(err));
				}
			})
			.finally(() => {
				if (this.activeRun === run) {
					this.activeRun = null;
				}
			});
		this.activeRun = run;
	}

	private isRunActive(runId: number): boolean {
		return this.running && this.activeRunId === runId;
	}

	private cancelReader(): void {
		if (this.reader) {
			try {
				void this.reader.cancel();
			} catch {
				// best-effort cancel
			}
		}
	}

	private async waitForActiveRun(): Promise<void> {
		const run = this.activeRun;
		if (run) {
			await run.catch((err) => {
				if (!this.abort.signal.aborted) {
					this.callbacks.onEncodeError(this.sourceId, String(err));
				}
			});
		}
	}

	private emitEnded(): void {
		if (!this.ended) {
			this.ended = true;
			this.callbacks.onPipelineEnded(this.sourceId);
		}
	}

	private async onEncodedChunk(
		packet: EncodedPacket,
		fromUs: number,
		toUs: number,
		keyFrame: boolean,
		preEncodeDrops: number
	): Promise<void> {
		await this.waitForChunkSlot();
		if (this.abort.signal.aborted) return;

		this.inFlightChunks++;
		this.callbacks.onEncodedChunk(this.sourceId, packet, fromUs, toUs, keyFrame, preEncodeDrops);
	}

	private waitForChunkSlot(): Promise<void> {
		if (!this.running || this.inFlightChunks < MAX_IN_FLIGHT_CHUNKS) return Promise.resolve();

		return new Promise((resolve) => {
			this.chunkWaiters.push(() => {
				resolve();
			});
		});
	}

	private resolveChunkWaiters(): void {
		while (this.chunkWaiters.length > 0 && this.inFlightChunks < MAX_IN_FLIGHT_CHUNKS) {
			const waiter = this.chunkWaiters.shift();
			waiter?.();
		}
	}

	onChunkAck(): void {
		if (this.inFlightChunks > 0) {
			this.inFlightChunks -= 1;
			this.resolveChunkWaiters();
		}
		this.callbacks.onChunkAck(this.sourceId);
	}

	private clearChunkWaiters(): void {
		this.inFlightChunks = 0;
		this.resolveChunkWaiters();
	}

	/**
	 * Builds + configures a `VideoEncoder` whose output is routed through the shared
	 * chunk pipeline. Used by both the in-worker reader loop and the push pipeline so
	 * the two input paths encode identically (R0.3 close-exactly-once invariant).
	 */
	private buildVideoEncoder(config: VideoEncoderConfig): VideoEncoder {
		const encoder = new VideoEncoder({
			output: (chunk: EncodedVideoChunk, _metadata?: EncodedVideoChunkMetadata) => {
				const packet = EncodedPacket.fromEncodedChunk(chunk);
				const drops = this.preEncodeDrops;
				this.preEncodeDrops = 0;
				void this.onEncodedChunk(
					packet,
					chunk.timestamp,
					chunk.timestamp + (chunk.duration ?? 0),
					chunk.type === 'key',
					drops
				).catch(() => {});
			},
			error: (err: DOMException) => {
				this.callbacks.onEncodeError(this.sourceId, `VideoEncoder error: ${err.message}`);
				this.running = false;
			}
		});
		encoder.configure(config);
		return encoder;
	}

	/**
	 * Encodes one source frame, closing it exactly once whether it is encoded,
	 * dropped under backpressure, or fails. Shared by the reader loop and pushFrame.
	 */
	private encodeVideoFrame(encoder: VideoEncoder, frame: VideoFrame): void {
		try {
			if (this.options.onVideoFrame) {
				const composeFrame = frame.clone();
				let transferred = false;
				try {
					this.options.onVideoFrame(this.sourceId, composeFrame);
					transferred = true;
				} finally {
					if (!transferred) {
						composeFrame.close();
					}
				}
			}

			if (encoder.encodeQueueSize > VIDEO_QUEUE_BOUND) {
				this.preEncodeDrops++;
				return; // frame closed exactly once in finally
			}

			const keyFrame = this.shouldRequestKeyframe(frame.timestamp);
			try {
				encoder.encode(frame, { keyFrame });
			} catch {
				// Encode failed — close frame in finally below
			}
		} finally {
			frame.close();
		}
	}

	private async runVideoPipeline(config: VideoEncoderConfig, runId: number): Promise<void> {
		const processor = new MediaStreamTrackProcessor({ track: this.track as MediaStreamVideoTrack });

		const encoder = this.buildVideoEncoder(config);
		this.encoder = encoder;

		const reader = processor.readable.getReader();
		this.reader = reader;
		try {
			while (this.isRunActive(runId) && !this.abort.signal.aborted) {
				const result = await reader.read();
				if (result.done) {
					break;
				}
				this.encodeVideoFrame(encoder, result.value as VideoFrame);
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			try {
				reader.releaseLock();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			if (this.reader === reader) {
				this.reader = null;
			}
			this.clearChunkWaiters();
			try {
				await encoder.flush();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			try {
				encoder.close();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			if (this.encoder === encoder) {
				this.encoder = null;
			}
			if (this.activeRunId === runId) {
				this.running = false;
			}
			if (this.pausedRunId !== runId) {
				this.emitEnded();
			}
		}
	}

	private shouldRequestKeyframe(timestampUs: number): boolean {
		if (
			this.lastKeyframeTs === null ||
			timestampUs - this.lastKeyframeTs >= this.keyframeIntervalUs
		) {
			this.lastKeyframeTs = timestampUs;
			return true;
		}
		return false;
	}

	/** Builds + configures an `AudioEncoder` routed through the shared chunk pipeline. */
	private buildAudioEncoder(config: AudioEncoderConfig): AudioEncoder {
		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, _metadata?: EncodedAudioChunkMetadata) => {
				const packet = EncodedPacket.fromEncodedChunk(chunk);
				void this.onEncodedChunk(
					packet,
					chunk.timestamp,
					chunk.timestamp + (chunk.duration ?? 0),
					true,
					0
				).catch(() => {});
			},
			error: (err: DOMException) => {
				this.callbacks.onEncodeError(this.sourceId, `AudioEncoder error: ${err.message}`);
				this.running = false;
			}
		});
		encoder.configure(config);
		return encoder;
	}

	/**
	 * Encodes one AudioData, closing it exactly once. Trips the sustained-overrun
	 * stop after AUDIO_OVERRUN_CONSECUTIVE over-bound reads. Shared by the reader
	 * loop and pushFrame.
	 */
	private encodeAudioData(encoder: AudioEncoder, data: AudioData): void {
		try {
			if (encoder.encodeQueueSize > AUDIO_QUEUE_BOUND) {
				this.audioOverrunCount++;
				if (this.audioOverrunCount >= AUDIO_OVERRUN_CONSECUTIVE) {
					this.callbacks.onAudioOverrun(this.sourceId);
					this.running = false;
					data.close();
					return;
				}
			} else {
				this.audioOverrunCount = 0;
			}

			try {
				encoder.encode(data);
			} finally {
				data.close();
			}
		} catch {
			// encode after close throws; real errors surface via the encoder error callback
		}
	}

	private async runAudioPipeline(config: AudioEncoderConfig, runId: number): Promise<void> {
		const processor = new MediaStreamTrackProcessor({ track: this.track as MediaStreamAudioTrack });

		const encoder = this.buildAudioEncoder(config);
		this.encoder = encoder;

		const reader = processor.readable.getReader();
		this.reader = reader;
		try {
			while (this.isRunActive(runId) && !this.abort.signal.aborted) {
				const result = await reader.read();
				if (result.done) {
					break;
				}
				this.encodeAudioData(encoder, result.value as AudioData);
				if (!this.running) break;
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			try {
				reader.releaseLock();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			if (this.reader === reader) {
				this.reader = null;
			}
			this.clearChunkWaiters();
			try {
				await encoder.flush();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			try {
				encoder.close();
			} catch {
				// best-effort teardown — the pipeline is already stopping
			}
			if (this.encoder === encoder) {
				this.encoder = null;
			}
			if (this.activeRunId === runId) {
				this.running = false;
			}
			if (this.pausedRunId !== runId) {
				this.emitEnded();
			}
		}
	}

	/**
	 * Push-pipeline start (bugfix B5/T5.5): configure the encoder up front and wait
	 * for {@link pushFrame}, with no in-worker reader loop. Re-entry while paused —
	 * CaptureSession.resume()'s start() fallback for a source that never produced a
	 * frame — just clears the pause gate and reuses the configured encoder.
	 */
	private startPushPipeline(keyframeIntervalUs?: number): void {
		if (keyframeIntervalUs !== undefined && keyframeIntervalUs > 0) {
			this.keyframeIntervalUs = keyframeIntervalUs;
		}
		if (this.running && !this.paused) return;
		this.paused = false;
		this.ended = false;
		this.lastKeyframeTs = null; // the first frame after (re)start is a key frame
		this.running = true;
		if (this.encoder) return; // resume path: reuse the already-configured encoder
		if (this.kind === 'screen' || this.kind === 'webcam') {
			if (!this.options.videoEncodeConfig) {
				this.running = false;
				return;
			}
			this.encoder = this.buildVideoEncoder(this.options.videoEncodeConfig);
		} else {
			if (!this.options.audioEncodeConfig) {
				this.running = false;
				return;
			}
			this.encoder = this.buildAudioEncoder(this.options.audioEncodeConfig);
		}
	}

	/**
	 * Off-main-thread "main-frames" input (bugfix B5/T5.5). The main thread reads
	 * frames from the capture track with its own `MediaStreamTrackProcessor` and
	 * forwards each one here (ownership transferred across the worker boundary). The
	 * frame is closed exactly once — encoded, dropped under backpressure, or dropped
	 * because the pipeline is not running/paused. Only valid on a push pipeline.
	 */
	pushFrame(frame: VideoFrame | AudioData): void {
		if (
			!this.pushMode ||
			!this.running ||
			this.paused ||
			this.abort.signal.aborted ||
			!this.encoder
		) {
			frame.close();
			return;
		}
		if (this.kind === 'screen' || this.kind === 'webcam') {
			this.encodeVideoFrame(this.encoder as VideoEncoder, frame as VideoFrame);
		} else {
			this.encodeAudioData(this.encoder as AudioEncoder, frame as AudioData);
		}
	}

	private async flushAndCloseEncoder(): Promise<void> {
		const encoder = this.encoder;
		this.encoder = null;
		if (!encoder) return;
		try {
			await encoder.flush();
		} catch {
			// best-effort teardown — the pipeline is already stopping
		}
		try {
			encoder.close();
		} catch {
			// best-effort teardown — the pipeline is already stopping
		}
	}

	async stop(): Promise<void> {
		if (this.pushMode) {
			this.running = false;
			this.paused = false;
			this.clearChunkWaiters();
			await this.flushAndCloseEncoder();
			this.emitEnded();
			return;
		}
		this.running = false;
		this.paused = false;
		this.pausedRunId = null;
		this.clearChunkWaiters();
		this.cancelReader();
		await this.waitForActiveRun();
	}

	/**
	 * Phase 42: Pause — suspends the MSTP reader loop by setting paused=true.
	 * The async read loop will exit on its next iteration; the encoder is flushed
	 * and closed in the finally block. emitEnded() is suppressed while paused.
	 * Call resume() to restart with a fresh encoder and reader.
	 */
	async pause(): Promise<void> {
		if (this.pushMode) {
			// No reader to drain: gate pushFrame, then flush so frames already encoded
			// land before the pause manifest record. The encoder stays configured for
			// resume (unlike track mode, which closes and rebuilds it).
			if (!this.running || this.paused) return;
			this.paused = true;
			this.clearChunkWaiters();
			const encoder = this.encoder;
			if (encoder) {
				try {
					await encoder.flush();
				} catch {
					// best-effort — a flush failure surfaces via the encoder error callback
				}
			}
			return;
		}
		if (!this.running || this.paused) return;
		this.paused = true;
		const runId = this.activeRunId;
		this.pausedRunId = runId;
		this.running = false;
		this.clearChunkWaiters();
		this.cancelReader();
		await this.waitForActiveRun();
		if (this.pausedRunId === runId) {
			this.pausedRunId = null;
		}
	}

	/**
	 * Phase 42: Resume — restarts the MSTP reader loop and encoder.
	 * Cancels any lingering reader from the paused loop before restarting.
	 */
	async resume(): Promise<void> {
		if (this.pushMode) {
			if (!this.paused || this.ended) return;
			this.paused = false;
			this.lastKeyframeTs = null; // request a key frame at the resume point
			return;
		}
		if (!this.paused || this.ended) return;
		await this.waitForActiveRun();
		if (!this.paused || this.ended) return;
		this.paused = false;
		this.pausedRunId = null;
		this.start(this.keyframeIntervalUs);
	}

	dispose(): void {
		this.running = false;
		this.paused = false;
		this.pausedRunId = null;
		this.clearChunkWaiters();
		// Push pipelines never own the track — main keeps and stops it.
		this.track?.stop();
		this.cancelReader();
		if (this.encoder) {
			try {
				this.encoder.close();
			} catch {
				// best-effort close during dispose
			}
			this.encoder = null;
		}
	}
}
