/** Sequential decoded-audio source for real-time PCM pumping (Phase 5). */

import { resampleBlock } from './audio-resampler';

export interface AudioSampleLike {
	readonly timestamp: number;
	readonly duration: number;
	readonly numberOfFrames: number;
	readonly sampleRate: number;
	allocationSize(options: { format: 'f32'; planeIndex: number }): number;
	copyTo(destination: Float32Array, options: { format: 'f32'; planeIndex: number }): void;
	close(): void;
}

export interface AudioSampleStream {
	samples(
		startTimestamp?: number,
		endTimestamp?: number
	): AsyncGenerator<AudioSampleLike, void, unknown>;
}

const DEFAULT_RESYNC_THRESHOLD_S = 0.5;

export class SequentialAudioSource {
	private iterator: AsyncGenerator<AudioSampleLike, void, unknown> | null = null;
	private current: AudioSampleLike | null = null;
	private anchor = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly source: AudioSampleStream,
		private readonly sampleRate = 48_000,
		private readonly resyncThreshold = DEFAULT_RESYNC_THRESHOLD_S
	) {}

	private needsResync(time: number): boolean {
		if (!this.iterator) return true;
		if (time + 1e-6 < this.anchor) return true;
		return time - this.anchor > this.resyncThreshold;
	}

	reset(): void {
		this.iterator = null;
		this.current?.close();
		this.current = null;
		this.anchor = Number.NEGATIVE_INFINITY;
	}

	/**
	 * Returns interleaved f32 PCM for samples overlapping `time`, or null past EOF.
	 * The caller owns the returned buffer.
	 */
	async pcmAt(time: number, channels: number): Promise<Float32Array | null> {
		if (this.needsResync(time)) {
			this.reset();
			this.iterator = this.source.samples(time);
			this.anchor = time;
		}
		const iterator = this.iterator!;
		try {
			while (!this.current || this.current.timestamp + this.current.duration <= time + 1e-6) {
				const next = await iterator.next();
				if (next.done) {
					this.current?.close();
					this.current = null;
					break;
				}
				this.current?.close();
				this.current = next.value;
				this.anchor = next.value.timestamp;
			}
		} catch (error) {
			this.reset();
			throw error;
		}
		if (!this.current) return null;
		if (time + 1e-6 < this.current.timestamp) {
			return null;
		}

		const bytes = this.current.allocationSize({ format: 'f32', planeIndex: 0 });
		const floats = new Float32Array(bytes / 4);
		this.current.copyTo(floats, { format: 'f32', planeIndex: 0 });
		if (channels <= 1) {
			const sourceChannels = Math.round(floats.length / this.current.numberOfFrames);
			if (sourceChannels <= 1) {
				return floats;
			}
			const mono = new Float32Array(this.current.numberOfFrames);
			for (let i = 0; i < mono.length; i += 1) {
				mono[i] = floats[i * sourceChannels] ?? 0;
			}
			return mono;
		}
		if (floats.length >= this.current.numberOfFrames * channels) {
			return floats.slice(0, this.current.numberOfFrames * channels);
		}
		const srcCh = Math.round(floats.length / this.current.numberOfFrames);
		const out = new Float32Array(this.current.numberOfFrames * channels);
		for (let i = 0; i < this.current.numberOfFrames; i += 1) {
			for (let ch = 0; ch < channels; ch += 1) {
				out[i * channels + ch] = floats[i * srcCh + Math.min(ch, srcCh - 1)] ?? 0;
			}
		}
		return out;
	}

	/**
	 * Returns an exact interleaved PCM window starting at `time`. Gaps and EOF are
	 * filled with silence; available decoded samples are sliced to the requested
	 * frame boundaries so export timestamps stay aligned.
	 */
	async pcmWindowAt(time: number, frameCount: number, channels: number): Promise<Float32Array> {
		const out = new Float32Array(Math.max(0, frameCount) * channels);
		if (frameCount <= 0 || channels <= 0) return out;

		if (this.needsResync(time)) {
			this.reset();
			this.iterator = this.source.samples(time);
			this.anchor = time;
		}

		let written = 0;
		let cursor = time;
		const epsilon = 1e-6;

		while (written < frameCount) {
			await this.advanceTo(cursor);
			if (!this.current) break;

			const rate = this.current.sampleRate || this.sampleRate;
			const currentStart = this.current.timestamp;
			const currentEnd = currentStart + this.current.numberOfFrames / rate;

			if (cursor + epsilon < currentStart) {
				const silentFrames = Math.min(
					frameCount - written,
					Math.max(1, Math.floor((currentStart - cursor) * this.sampleRate))
				);
				written += silentFrames;
				cursor += silentFrames / this.sampleRate;
				continue;
			}

			if (cursor >= currentEnd - epsilon) {
				this.current.close();
				this.current = null;
				continue;
			}

			const bytes = this.current.allocationSize({ format: 'f32', planeIndex: 0 });
			const floats = new Float32Array(bytes / 4);
			this.current.copyTo(floats, { format: 'f32', planeIndex: 0 });
			const sourceChannels = Math.max(1, Math.round(floats.length / this.current.numberOfFrames));
			const sourceOffset = Math.max(0, Math.floor((cursor - currentStart) * rate + epsilon));
			const available = Math.max(0, this.current.numberOfFrames - sourceOffset);

			if (rate !== this.sampleRate) {
				const srcSlice = new Float32Array(available * sourceChannels);
				for (let frame = 0; frame < available; frame++) {
					for (let ch = 0; ch < sourceChannels; ch++) {
						srcSlice[frame * sourceChannels + ch] =
							floats[(sourceOffset + frame) * sourceChannels + ch] ?? 0;
					}
				}
				const resampled = resampleBlock(srcSlice, available, rate, this.sampleRate, sourceChannels);
				const resampledFrames = Math.floor(resampled.length / sourceChannels);
				const take = Math.min(frameCount - written, resampledFrames);
				for (let frame = 0; frame < take; frame++) {
					for (let channel = 0; channel < channels; channel++) {
						const srcChannel = Math.min(channel, sourceChannels - 1);
						out[(written + frame) * channels + channel] =
							resampled[frame * sourceChannels + srcChannel] ?? 0;
					}
				}
				written += take;
				cursor += (take / this.sampleRate) * (this.sampleRate / this.sampleRate);
				this.current.close();
				this.current = null;
			} else {
				const take = Math.min(frameCount - written, available);
				for (let frame = 0; frame < take; frame += 1) {
					for (let channel = 0; channel < channels; channel += 1) {
						const srcChannel = Math.min(channel, sourceChannels - 1);
						out[(written + frame) * channels + channel] =
							floats[(sourceOffset + frame) * sourceChannels + srcChannel] ?? 0;
					}
				}

				written += take;
				cursor += take / rate;
				if (take >= available) {
					this.current.close();
					this.current = null;
				}
			}
		}

		return out;
	}

	private async advanceTo(time: number): Promise<void> {
		if (!this.iterator) {
			this.iterator = this.source.samples(time);
			this.anchor = time;
		}
		const iterator = this.iterator;
		try {
			while (!this.current || this.current.timestamp + this.current.duration <= time + 1e-6) {
				const next = await iterator.next();
				if (next.done) {
					this.current?.close();
					this.current = null;
					break;
				}
				this.current?.close();
				this.current = next.value;
				this.anchor = next.value.timestamp;
			}
		} catch (error) {
			this.reset();
			throw error;
		}
	}

	dispose(): void {
		this.reset();
	}

	/** Samples the start of the stream for waveform peak buckets. */
	async collectPeaks(maxSeconds: number, bucketCount: number): Promise<Float32Array> {
		const { computeWaveformPeaks } = await import('./waveform');
		const chunks: Float32Array[] = [];
		let totalFrames = 0;
		const maxFrames = Math.max(1, Math.floor(maxSeconds * this.sampleRate));
		let channels = 2;
		const iterator = this.source.samples(0, maxSeconds);
		try {
			for await (const sample of iterator) {
				const bytes = sample.allocationSize({ format: 'f32', planeIndex: 0 });
				const buf = new Float32Array(bytes / 4);
				sample.copyTo(buf, { format: 'f32', planeIndex: 0 });
				channels = Math.round(buf.length / sample.numberOfFrames);
				chunks.push(buf);
				totalFrames += sample.numberOfFrames;
				sample.close();
				if (totalFrames >= maxFrames) break;
			}
		} catch {
			return computeWaveformPeaks(new Float32Array(0), bucketCount, channels);
		}
		const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
		const merged = new Float32Array(totalSamples);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		return computeWaveformPeaks(merged, bucketCount, channels);
	}
}
