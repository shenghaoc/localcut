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
	track: MediaStreamTrack;
	videoEncodeConfig?: VideoEncoderConfig;
	audioEncodeConfig?: AudioEncoderConfig;
	callbacks: TrackPipelineCallbacks;
	abort: AbortController;
}

const VIDEO_QUEUE_BOUND = 8;
const AUDIO_QUEUE_BOUND = 16;
const AUDIO_OVERRUN_CONSECUTIVE = 4;
const MAX_IN_FLIGHT_CHUNKS = 2;
/** Request a key frame every N frames to start a new fragment. */
const KEYFRAME_INTERVAL = 60;

export class TrackPipeline {
	readonly sourceId: string;
	readonly kind: CaptureSourceKind;
	private readonly track: MediaStreamTrack;
	private readonly callbacks: TrackPipelineCallbacks;
	private readonly abort: AbortController;
	private encoder: VideoEncoder | AudioEncoder | null = null;
	private reader: ReadableStreamDefaultReader<VideoFrame | AudioData> | null = null;
	private preEncodeDrops = 0;
	private audioOverrunCount = 0;
	private running = false;
	private ended = false;
	private frameCount = 0;
	private inFlightChunks = 0;
	private chunkWaiters: Array<() => void> = [];

	constructor(private readonly options: TrackPipelineOptions) {
		this.sourceId = options.sourceId;
		this.kind = options.kind;
		this.track = options.track;
		this.callbacks = options.callbacks;
		this.abort = options.abort;
	}

	start(): void {
		this.running = true;
		this.ended = false;
		if (this.kind === 'screen' || this.kind === 'webcam') {
			if (this.options.videoEncodeConfig) {
				this.runVideoPipeline(this.options.videoEncodeConfig).catch((err) => {
					if (!this.abort.signal.aborted) {
						this.callbacks.onEncodeError(this.sourceId, String(err));
					}
				});
			}
		} else {
			if (this.options.audioEncodeConfig) {
				this.runAudioPipeline(this.options.audioEncodeConfig).catch((err) => {
					if (!this.abort.signal.aborted) {
						this.callbacks.onEncodeError(this.sourceId, String(err));
					}
				});
			}
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
		if (!this.running) return;

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

	private async runVideoPipeline(config: VideoEncoderConfig): Promise<void> {
		const processor = new MediaStreamTrackProcessor({ track: this.track as MediaStreamVideoTrack });

		const encoderInit: VideoEncoderInit = {
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
		};

		const encoder = new VideoEncoder(encoderInit);
		this.encoder = encoder;
		encoder.configure(config);

		const reader = processor.readable.getReader();
		this.reader = reader;
		try {
			while (this.running && !this.abort.signal.aborted) {
				const result = await reader.read();
				if (result.done) {
					break;
				}
				const frame = result.value as VideoFrame;
				try {
					if (encoder.encodeQueueSize > VIDEO_QUEUE_BOUND) {
						this.preEncodeDrops++;
						frame.close();
						continue;
					}

					const keyFrame = this.frameCount % KEYFRAME_INTERVAL === 0;
					this.frameCount++;
					try {
						encoder.encode(frame, { keyFrame });
					} catch {
						// Encode failed — close frame in finally below
					}
				} finally {
					frame.close();
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {}
			try {
				reader.releaseLock();
			} catch {}
			this.reader = null;
			this.clearChunkWaiters();
			try {
				await encoder.flush();
			} catch {}
			try {
				encoder.close();
			} catch {}
			this.encoder = null;
			this.running = false;
			this.emitEnded();
		}
	}

	private async runAudioPipeline(config: AudioEncoderConfig): Promise<void> {
		const processor = new MediaStreamTrackProcessor({ track: this.track as MediaStreamAudioTrack });

		const encoderInit: AudioEncoderInit = {
			output: (chunk: EncodedAudioChunk, _metadata?: EncodedAudioChunkMetadata) => {
				const packet = EncodedPacket.fromEncodedChunk(chunk);
				void this.onEncodedChunk(packet, chunk.timestamp, chunk.timestamp + (chunk.duration ?? 0), true, 0).catch(
					() => {}
				);
			},
			error: (err: DOMException) => {
				this.callbacks.onEncodeError(this.sourceId, `AudioEncoder error: ${err.message}`);
				this.running = false;
			}
		};

		const encoder = new AudioEncoder(encoderInit);
		this.encoder = encoder;
		encoder.configure(config);

		const reader = processor.readable.getReader();
		this.reader = reader;
		try {
			while (this.running && !this.abort.signal.aborted) {
				const result = await reader.read();
				if (result.done) {
					break;
				}
				const data = result.value as AudioData;
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
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {}
			try {
				reader.releaseLock();
			} catch {}
			this.reader = null;
			this.clearChunkWaiters();
			try {
				await encoder.flush();
			} catch {}
			try {
				encoder.close();
			} catch {}
			this.encoder = null;
			this.running = false;
			this.emitEnded();
		}
	}

	async stop(): Promise<void> {
		this.running = false;
		this.clearChunkWaiters();
		if (this.reader) {
			try {
				await this.reader.cancel();
			} catch {}
		}
	}

	dispose(): void {
		this.running = false;
		this.clearChunkWaiters();
		this.track.stop();
		if (this.reader) {
			try {
				this.reader.cancel();
			} catch {}
		}
		if (this.encoder) {
			try {
				this.encoder.close();
			} catch {}
			this.encoder = null;
		}
	}
}
