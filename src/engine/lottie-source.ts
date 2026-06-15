import type { DecodedFrame } from './playback';
import type { VideoFrameProvider } from './frame-source';

interface LottieAnimation {
	frameRate: number;
	totalFrames: number;
	goToAndStop(frame: number, isFrame: boolean): void;
	destroy(): void;
}

/**
 * Phase 38b: Lottie animation frame source using lottie-web canvas renderer on
 * an OffscreenCanvas in the pipeline worker. Renders frames on demand via
 * `goToAndStop` + `createImageBitmap`. LRU cache bounded at 16 entries.
 *
 * Fallback: if the lottie-web canvas renderer surfaces a DOM dependency in the
 * worker during integration, rasterise frames at import time on main into a
 * capped frame strip (min(totalFrames, 300) frames), cache as a VideoFrame[],
 * and serve from cache. This is the fallback plan; the primary plan is the
 * worker OffscreenCanvas path.
 */
export class LottieFrameSource implements VideoFrameProvider {
	private readonly animation: LottieAnimation;
	private readonly canvas: OffscreenCanvas;
	private readonly ctx: OffscreenCanvasRenderingContext2D;
	private readonly outputWidth: number;
	private readonly outputHeight: number;
	private readonly lruKeys: string[] = [];
	private readonly lruCache = new Map<string, VideoFrame>();
	private static readonly MAX_CACHE = 16;

	constructor(
		data: ArrayBuffer,
		outputWidth: number,
		outputHeight: number,
		lottie: { loadAnimation: (params: Record<string, unknown>) => LottieAnimation }
	) {
		this.outputWidth = outputWidth;
		this.outputHeight = outputHeight;
		this.canvas = new OffscreenCanvas(outputWidth, outputHeight);
		this.ctx = this.canvas.getContext('2d')!;
		this.animation = lottie.loadAnimation({
			renderer: 'canvas',
			autoplay: false,
			loop: true,
			rendererSettings: { context: this.ctx },
			animationData: JSON.parse(new TextDecoder().decode(data))
		});
	}

	get frameRate(): number {
		return this.animation.frameRate;
	}

	get totalFrames(): number {
		return this.animation.totalFrames;
	}

	private cacheKey(frameIndex: number): string {
		return `${frameIndex}:${this.outputWidth}x${this.outputHeight}`;
	}

	private evictIfNeeded(): void {
		while (this.lruKeys.length > LottieFrameSource.MAX_CACHE) {
			const evictKey = this.lruKeys.shift()!;
			const evicted = this.lruCache.get(evictKey);
			if (evicted) {
				evicted.close();
				this.lruCache.delete(evictKey);
			}
		}
	}

	private touchKey(key: string): void {
		const idx = this.lruKeys.indexOf(key);
		if (idx >= 0) this.lruKeys.splice(idx, 1);
		this.lruKeys.push(key);
	}

	async frameAt(time: number): Promise<DecodedFrame | null> {
		const totalFrames = this.animation.totalFrames;
		if (totalFrames <= 0) return null;
		// Positive modulo to guard against negative t
		const frameIndex =
			((Math.floor(time * this.animation.frameRate) % totalFrames) + totalFrames) % totalFrames;
		const key = this.cacheKey(frameIndex);

		const cached = this.lruCache.get(key);
		if (cached) {
			this.touchKey(key);
			const frame = cached;
			return {
				toVideoFrame: () => frame.clone(),
				close: () => {}
			};
		}

		this.animation.goToAndStop(frameIndex, true);
		const bitmap = await createImageBitmap(this.canvas);
		const frame = new VideoFrame(bitmap, { timestamp: Math.round(time * 1e6) });
		bitmap.close();

		this.lruCache.set(key, frame);
		this.touchKey(key);
		this.evictIfNeeded();

		return {
			toVideoFrame: () => frame.clone(),
			close: () => {}
		};
	}

	reset(): void {
		for (const frame of this.lruCache.values()) frame.close();
		this.lruCache.clear();
		this.lruKeys.length = 0;
	}

	dispose(): void {
		for (const frame of this.lruCache.values()) frame.close();
		this.lruCache.clear();
		this.lruKeys.length = 0;
		this.animation.destroy();
	}
}
