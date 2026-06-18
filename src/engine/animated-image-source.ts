import type { DecodedFrame } from './playback';
import type { VideoFrameProvider } from './frame-source';

/**
 * Phase 38b: frame-accurate animated image source via `ImageDecoder`.
 * Wraps animated WebP, AVIF, and GIF — decoding individual frames on demand
 * without buffering the entire file. Uses an LRU cache of decoded VideoFrames
 * bounded at 8 entries.
 */
export class AnimatedImageFrameSource implements VideoFrameProvider {
	private decoder: ImageDecoder;
	private frameDurations: number[] = [];
	private frameCount = 0;
	private repetitionCount = 0;
	private initialized = false;
	private readonly lruKeys: number[] = [];
	private readonly lruCache = new Map<number, VideoFrame>();
	private static readonly MAX_CACHE = 8;

	constructor(stream: ReadableStream<Uint8Array>, mimeType: string) {
		this.decoder = new ImageDecoder({
			data: stream,
			type: mimeType,
			preferAnimation: true
		});
	}

	async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		const firstResult = await this.decoder.decode({ frameIndex: 0 });
		const track = this.decoder.tracks[0];
		this.frameCount = track.frameCount;
		this.repetitionCount = track.repetitionCount;
		// Decode every frame's header once up-front so animated GIF/WebP/AVIF
		// with variable per-frame delays produce frame-accurate timing rather
		// than cloning the first frame's duration across the entire track.
		// We close each frame's image immediately — no buffering is retained.
		const durations: number[] = Array.from({ length: this.frameCount }, () => 0);
		durations[0] = toDurationSeconds(firstResult.image.duration);
		firstResult.image.close();
		for (let i = 1; i < this.frameCount; i++) {
			try {
				const result = await this.decoder.decode({ frameIndex: i });
				durations[i] = toDurationSeconds(result.image.duration);
				result.image.close();
			} catch {
				// If a specific frame fails to decode its header, fall back to the
				// previous frame's duration so accumulation stays monotonic.
				durations[i] = durations[i - 1] ?? 0.033;
			}
		}
		this.frameDurations = durations;
		this.initialized = true;
	}

	/** Time-to-frame index: Infinity = infinite loop, finite = clamp, 0 = play once. */
	private timeToFrameIndex(time: number): number {
		if (this.frameDurations.length === 0) return 0;
		const totalDuration = this.frameDurations.reduce((a, b) => a + b, 0);
		if (totalDuration <= 0) return 0;
		const loopedTime =
			this.repetitionCount === Infinity
				? time % totalDuration
				: Math.min(time, totalDuration * (this.repetitionCount + 1));
		let accumulated = 0;
		for (let i = 0; i < this.frameDurations.length; i++) {
			accumulated += this.frameDurations[i]!;
			if (loopedTime < accumulated) return i;
		}
		return this.frameDurations.length - 1;
	}

	private evictIfNeeded(): void {
		while (this.lruKeys.length > AnimatedImageFrameSource.MAX_CACHE) {
			const evictKey = this.lruKeys.shift()!;
			const evicted = this.lruCache.get(evictKey);
			if (evicted) {
				evicted.close();
				this.lruCache.delete(evictKey);
			}
		}
	}

	private touchKey(key: number): void {
		const idx = this.lruKeys.indexOf(key);
		if (idx >= 0) this.lruKeys.splice(idx, 1);
		this.lruKeys.push(key);
	}

	async frameAt(time: number): Promise<DecodedFrame | null> {
		await this.ensureInitialized();
		const frameIndex = this.timeToFrameIndex(time);

		const cached = this.lruCache.get(frameIndex);
		if (cached) {
			this.touchKey(frameIndex);
			const frame = cached;
			return {
				toVideoFrame: () => frame.clone(),
				close: () => {}
			};
		}

		const result = await this.decoder.decode({ frameIndex });
		const bitmap = result.image;
		const timestamp = Math.round(time * 1e6);
		const frame = new VideoFrame(bitmap, { timestamp });
		bitmap.close();

		this.lruCache.set(frameIndex, frame);
		this.touchKey(frameIndex);
		this.evictIfNeeded();

		return {
			toVideoFrame: () => frame.clone(),
			close: () => {}
		};
	}

	get effectiveFps(): number {
		if (this.frameDurations.length === 0) return 25;
		const sorted = [...this.frameDurations].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)]!;
		return median > 0 ? 1 / median : 25;
	}

	reset(): void {
		for (const frame of this.lruCache.values()) frame.close();
		this.lruCache.clear();
		this.lruKeys.length = 0;
		this.frameDurations = [];
		this.initialized = false;
	}

	dispose(): void {
		for (const frame of this.lruCache.values()) frame.close();
		this.lruCache.clear();
		this.lruKeys.length = 0;
		this.decoder.close();
	}
}

function toDurationSeconds(durationMicros: number | null | undefined): number {
	return durationMicros && durationMicros > 0 ? durationMicros / 1_000_000 : 0.033;
}
