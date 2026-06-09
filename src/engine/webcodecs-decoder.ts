/**
 * WebCodecs direct decode bridge — uses Mediabunny's EncodedPacketSink for
 * demuxing and WebCodecs VideoDecoder/AudioDecoder directly for decode.
 *
 * Advantages over Mediabunny's built-in VideoSampleSink/AudioSampleSink:
 * - Explicit backpressure control via decode queue depth
 * - Multiple simultaneous decoders (for transition dual-stream readahead)
 * - Better error recovery with decoder state tracking
 * - Configurable hardware acceleration preference
 */

import { EncodedPacketSink, type InputVideoTrack, type InputAudioTrack } from 'mediabunny';
import type { VideoSampleLike, SequentialVideoSource } from './frame-source';
import type { AudioSampleLike, AudioSampleStream } from './audio-source';

const DEFAULT_MAX_QUEUE_DEPTH = 8;

export interface WebCodecsDecoderConfig {
	maxQueueDepth?: number;
	hardwareAcceleration?: HardwarePreference;
}

type HardwarePreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

interface PendingFrame {
	frame: VideoFrame;
	timestamp: number;
}

export class WebCodecsVideoDecoder implements SequentialVideoSource {
	private readonly track: InputVideoTrack;
	private readonly maxQueueDepth: number;
	private readonly hardwareAcceleration: HardwarePreference;

	constructor(track: InputVideoTrack, config?: WebCodecsDecoderConfig) {
		this.track = track;
		this.maxQueueDepth = config?.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
		this.hardwareAcceleration = config?.hardwareAcceleration ?? 'prefer-hardware';
	}

	async *samples(
		_startTimestamp?: number,
		_endTimestamp?: number
	): AsyncGenerator<VideoSampleLike, void, unknown> {
		const trackConfig = await this.track.getDecoderConfig();
		if (!trackConfig) throw new Error('No decoder config available for video track.');
		const decoderConfig = { ...trackConfig };
		if (this.hardwareAcceleration !== 'no-preference') {
			decoderConfig.hardwareAcceleration = this.hardwareAcceleration;
		}

		if (typeof VideoDecoder === 'undefined') {
			throw new Error('WebCodecs VideoDecoder is not supported in this environment.');
		}
		const support = await VideoDecoder.isConfigSupported(decoderConfig);
		if (!support.supported) {
			throw new Error(`WebCodecs VideoDecoder does not support codec "${decoderConfig.codec}".`);
		}

		const pendingFrames: PendingFrame[] = [];
		let resolveFrame: (() => void) | null = null;
		let decoderError: Error | null = null;

		const decoder = new VideoDecoder({
			output(frame: VideoFrame) {
				pendingFrames.push({ frame, timestamp: frame.timestamp / 1e6 });
				pendingFrames.sort((a, b) => a.timestamp - b.timestamp);
				resolveFrame?.();
			},
			error(err: DOMException) {
				decoderError = new Error(`VideoDecoder error: ${err.message}`);
				resolveFrame?.();
			}
		});

		decoder.configure(decoderConfig);

		const sink = new EncodedPacketSink(this.track);
		const startPacket = _startTimestamp !== undefined
			? await sink.getKeyPacket(_startTimestamp, { skipLiveWait: true })
			: null;
		const packets = sink.packets(startPacket ?? undefined, undefined, { skipLiveWait: true });

		try {
			let packetsExhausted = false;
			let flushed = false;

			const feedDecoder = async (): Promise<void> => {
				if (packetsExhausted || decoderError) return;
				// Bound total in-flight frames: stop feeding when either the decode
				// queue or the decoded-but-unyielded backlog reaches the depth limit,
				// so pendingFrames cannot grow without bound and exhaust video memory.
				while (
					decoder.decodeQueueSize < this.maxQueueDepth &&
					pendingFrames.length < this.maxQueueDepth
				) {
					const next = await packets.next();
					if (next.done) {
						packetsExhausted = true;
						return;
					}
					const packet = next.value;
					decoder.decode(packet.toEncodedVideoChunk());
				}
			};

			const waitForFrame = (): Promise<void> =>
				new Promise<void>((resolve) => {
					if (pendingFrames.length > 0 || decoderError || packetsExhausted) {
						resolve();
						return;
					}
					resolveFrame = () => {
						resolveFrame = null;
						resolve();
					};
				});

			while (true) {
				await feedDecoder();
				if (decoderError) throw decoderError;

				if (pendingFrames.length === 0 && packetsExhausted && !flushed) {
					await decoder.flush();
					flushed = true;
					if (pendingFrames.length === 0) break;
				}

				if (pendingFrames.length === 0) {
					if (flushed) break;
					await waitForFrame();
					if (decoderError) throw decoderError;
					if (pendingFrames.length === 0) break;
				}

				const entry = pendingFrames.shift()!;
				if (_endTimestamp !== undefined && entry.timestamp > _endTimestamp) {
					entry.frame.close();
					break;
				}

				const sample = new WebCodecsVideoSample(entry.frame);
				yield sample;
			}
		} finally {
			for (const entry of pendingFrames) entry.frame.close();
			pendingFrames.length = 0;
			decoder.close();
			await packets.return(undefined);
		}
	}
}

class WebCodecsVideoSample implements VideoSampleLike {
	private frame: VideoFrame | null;
	readonly timestamp: number;
	readonly duration: number;

	constructor(frame: VideoFrame) {
		this.frame = frame;
		this.timestamp = frame.timestamp / 1e6;
		this.duration = (frame.duration ?? 0) / 1e6;
	}

	clone(): VideoSampleLike {
		if (!this.frame) throw new Error('Sample already closed.');
		return new WebCodecsVideoSample(this.frame.clone());
	}

	toVideoFrame(): VideoFrame {
		if (!this.frame) throw new Error('Sample already closed.');
		return this.frame.clone();
	}

	close(): void {
		this.frame?.close();
		this.frame = null;
	}
}

export class WebCodecsAudioDecoder implements AudioSampleStream {
	private readonly track: InputAudioTrack;

	constructor(track: InputAudioTrack) {
		this.track = track;
	}

	async *samples(
		_startTimestamp?: number,
		_endTimestamp?: number
	): AsyncGenerator<AudioSampleLike, void, unknown> {
		const decoderConfig = await this.track.getDecoderConfig();
		if (!decoderConfig) throw new Error('No decoder config available for audio track.');

		if (typeof AudioDecoder === 'undefined') {
			throw new Error('WebCodecs AudioDecoder is not supported in this environment.');
		}
		const support = await AudioDecoder.isConfigSupported(decoderConfig);
		if (!support.supported) {
			throw new Error(`WebCodecs AudioDecoder does not support codec "${decoderConfig.codec}".`);
		}

		const pending: AudioData[] = [];
		let resolveData: (() => void) | null = null;
		let decoderError: Error | null = null;

		const decoder = new AudioDecoder({
			output(data: AudioData) {
				pending.push(data);
				resolveData?.();
			},
			error(err: DOMException) {
				decoderError = new Error(`AudioDecoder error: ${err.message}`);
				resolveData?.();
			}
		});

		decoder.configure(decoderConfig);

		const sink = new EncodedPacketSink(this.track);
		const startPacket = _startTimestamp !== undefined
			? await sink.getKeyPacket(_startTimestamp, { skipLiveWait: true })
			: null;
		const packets = sink.packets(startPacket ?? undefined, undefined, { skipLiveWait: true });

		try {
			let packetsExhausted = false;
			let flushed = false;

			const feedDecoder = async (): Promise<void> => {
				if (packetsExhausted || decoderError) return;
				// Bound total in-flight data: stop feeding when either the decode queue
				// or the decoded-but-unyielded backlog reaches the depth limit.
				while (
					decoder.decodeQueueSize < DEFAULT_MAX_QUEUE_DEPTH &&
					pending.length < DEFAULT_MAX_QUEUE_DEPTH
				) {
					const next = await packets.next();
					if (next.done) {
						packetsExhausted = true;
						return;
					}
					const packet = next.value;
					decoder.decode(packet.toEncodedAudioChunk());
				}
			};

			const waitForData = (): Promise<void> =>
				new Promise<void>((resolve) => {
					if (pending.length > 0 || decoderError || packetsExhausted) {
						resolve();
						return;
					}
					resolveData = () => {
						resolveData = null;
						resolve();
					};
				});

			while (true) {
				await feedDecoder();
				if (decoderError) throw decoderError;

				if (pending.length === 0 && packetsExhausted && !flushed) {
					await decoder.flush();
					flushed = true;
					if (pending.length === 0) break;
				}

				if (pending.length === 0) {
					if (flushed) break;
					await waitForData();
					if (decoderError) throw decoderError;
					if (pending.length === 0) break;
				}

				const data = pending.shift()!;
				if (_endTimestamp !== undefined && data.timestamp / 1e6 > _endTimestamp) {
					data.close();
					break;
				}
				yield new WebCodecsAudioSample(data);
			}
		} finally {
			for (const d of pending) d.close();
			pending.length = 0;
			decoder.close();
			await packets.return(undefined);
		}
	}
}

class WebCodecsAudioSample implements AudioSampleLike {
	private data: AudioData | null;
	readonly timestamp: number;
	readonly duration: number;
	readonly numberOfFrames: number;
	readonly sampleRate: number;

	constructor(data: AudioData) {
		this.data = data;
		this.timestamp = data.timestamp / 1e6;
		this.duration = (data.duration ?? 0) / 1e6;
		this.numberOfFrames = data.numberOfFrames;
		this.sampleRate = data.sampleRate;
	}

	allocationSize(options: { format: 'f32'; planeIndex: number }): number {
		if (!this.data) throw new Error('Sample already closed.');
		return this.data.allocationSize({ format: options.format, planeIndex: options.planeIndex });
	}

	copyTo(destination: Float32Array, options: { format: 'f32'; planeIndex: number }): void {
		if (!this.data) throw new Error('Sample already closed.');
		this.data.copyTo(destination, { format: options.format, planeIndex: options.planeIndex });
	}

	close(): void {
		this.data?.close();
		this.data = null;
	}
}

export async function probeWebCodecsDecodeSupport(codec: string): Promise<boolean> {
	if (typeof VideoDecoder === 'undefined') return false;
	try {
		const support = await VideoDecoder.isConfigSupported({
			codec,
			codedWidth: 640,
			codedHeight: 480
		});
		return support.supported === true;
	} catch {
		return false;
	}
}

export async function probeWebCodecsAudioDecodeSupport(codec: string): Promise<boolean> {
	if (typeof AudioDecoder === 'undefined') return false;
	try {
		const support = await AudioDecoder.isConfigSupported({
			codec,
			sampleRate: 48000,
			numberOfChannels: 2
		});
		return support.supported === true;
	} catch {
		return false;
	}
}
