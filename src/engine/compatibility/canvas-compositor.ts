import { TITLE_RASTER_HEIGHT, type TitleContent } from '../title';
import { computeFitRect, type TransformParams } from '../transform';
import { rasterizeTitleToCanvas, TITLE_RASTER_WIDTH } from '../titles';

export interface CloseableFrame {
	close: () => void;
}

export interface CloseableBitmap {
	readonly width: number;
	readonly height: number;
	close: () => void;
}

export interface CanvasLayer {
	bitmap: CloseableBitmap;
	opacity: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DrawTarget {
	clearRect: (x: number, y: number, width: number, height: number) => void;
	drawImage: (bitmap: CloseableBitmap, x: number, y: number, width: number, height: number) => void;
	globalAlpha: number;
}

export type CanvasCompatibilityLayer =
	| {
			kind: 'frame';
			frame: VideoFrame;
			transform: TransformParams;
	  }
	| {
			kind: 'title';
			content: TitleContent;
			transform: TransformParams;
	  };

export function fitWithin720p(
	sourceWidth: number,
	sourceHeight: number
): { width: number; height: number } {
	const width = Math.max(1, sourceWidth);
	const height = Math.max(1, sourceHeight);
	const scale = Math.min(1, 1280 / width, 720 / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

export class BoundedFrameQueue<T extends CloseableFrame> {
	private readonly frames: T[] = [];

	constructor(private readonly maxFrames = 3) {}

	push(frame: T): void {
		// `> 0` guards against a non-positive maxFrames turning this into an infinite
		// loop (`0 >= 0` is true even when the queue is empty).
		while (this.frames.length > 0 && this.frames.length >= this.maxFrames) {
			this.frames.shift()?.close();
		}
		this.frames.push(frame);
	}

	clear(): void {
		for (const frame of this.frames.splice(0)) frame.close();
	}

	get size(): number {
		return this.frames.length;
	}
}

export async function bitmapFromFrame<
	TFrame extends CloseableFrame,
	TBitmap extends CloseableBitmap
>(
	frame: TFrame,
	createBitmap: (
		frame: TFrame,
		resize: { resizeWidth: number; resizeHeight: number }
	) => Promise<TBitmap>,
	sourceWidth: number,
	sourceHeight: number
): Promise<TBitmap> {
	const size = fitWithin720p(sourceWidth, sourceHeight);
	// try/catch (not .catch) so a synchronous throw from createBitmap still closes
	// the frame — every VideoFrame must be released exactly once on every path.
	let bitmap: TBitmap;
	try {
		bitmap = await createBitmap(frame, { resizeWidth: size.width, resizeHeight: size.height });
	} catch (e) {
		frame.close();
		throw e;
	}
	frame.close();
	return bitmap;
}

export function drawLayers(
	target: DrawTarget,
	layers: readonly CanvasLayer[],
	width: number,
	height: number
): void {
	try {
		target.clearRect(0, 0, width, height);
		for (const layer of layers) {
			target.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
			target.drawImage(layer.bitmap, layer.x, layer.y, layer.width, layer.height);
		}
	} finally {
		// Close every layer's bitmap even if an earlier drawImage threw — otherwise a
		// single failed layer would leak the remaining (already-decoded) bitmaps.
		for (const layer of layers) {
			try {
				layer.bitmap.close();
			} catch {
				// ignore double-close / cleanup errors
			}
		}
		target.globalAlpha = 1;
	}
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function drawTransformedImage(
	ctx: OffscreenCanvasRenderingContext2D,
	image: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	outputWidth: number,
	outputHeight: number,
	transform: TransformParams
): void {
	// Mirror packTransformUniform: for odd quarter-turn rotations (90°/270°) the
	// layer's bounding box in output axes is the source rectangle transposed, so
	// the fit rect must be computed on the rotated aspect. The drawn extents
	// (drawWidth, drawHeight) are in the layer's local (pre-rotation) coordinate
	// frame, which canvas's rotate() maps to output axes — so for a quarter-turn,
	// the layer-x extent must be sized against the output's *height* and the
	// layer-y extent against the output's *width*.
	const quarterTurns = transform.rotation / 90;
	const nearestQuarter = Math.round(quarterTurns);
	const isQuarterTurn = Math.abs(quarterTurns - nearestQuarter) < 1e-3;
	const swap = isQuarterTurn && ((nearestQuarter % 2) + 2) % 2 === 1;
	const fitSourceWidth = swap ? sourceHeight : sourceWidth;
	const fitSourceHeight = swap ? sourceWidth : sourceHeight;
	const rect = computeFitRect(
		fitSourceWidth,
		fitSourceHeight,
		outputWidth,
		outputHeight,
		transform.fit
	);
	const drawWidth =
		(swap ? outputHeight * rect.height : outputWidth * rect.width) * transform.scale;
	const drawHeight =
		(swap ? outputWidth * rect.width : outputHeight * rect.height) * transform.scale;
	const cardWidth = (swap ? outputHeight : outputWidth) * transform.scale;
	const cardHeight = (swap ? outputWidth : outputHeight) * transform.scale;
	const centerX = outputWidth * (0.5 + transform.x);
	const centerY = outputHeight * (0.5 + transform.y);

	ctx.save();
	try {
		ctx.globalAlpha = clamp01(transform.opacity);
		ctx.translate(centerX, centerY);
		ctx.rotate((transform.rotation * Math.PI) / 180);
		ctx.translate(-drawWidth * transform.anchorX, -drawHeight * transform.anchorY);
		if (transform.fit === 'letterbox') {
			ctx.fillStyle = '#000';
			ctx.fillRect(
				drawWidth * transform.anchorX - cardWidth / 2,
				drawHeight * transform.anchorY - cardHeight / 2,
				cardWidth,
				cardHeight
			);
		}
		ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
	} finally {
		ctx.restore();
	}
}

/**
 * Reduced worker-owned Canvas2D preview/export backend for `limited-webcodecs`.
 *
 * This compositor deliberately avoids `getImageData` and consumes VideoFrames
 * synchronously inside playback's render callback. The playback controller closes
 * frames after this call returns, preserving the existing close-once ownership
 * model.
 */
export class CanvasCompatibilityRenderer {
	private readonly ctx: OffscreenCanvasRenderingContext2D;
	private readonly titleCanvas = new OffscreenCanvas(TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);
	private readonly titleCtx: OffscreenCanvasRenderingContext2D;
	private width = 0;
	private height = 0;

	constructor(private readonly canvas: OffscreenCanvas) {
		const ctx = canvas.getContext('2d', { alpha: false });
		if (!ctx) throw new Error('Could not acquire a Canvas2D context for compatibility preview.');
		const titleCtx = this.titleCanvas.getContext('2d');
		if (!titleCtx) throw new Error('Could not acquire a Canvas2D context for title rasterization.');
		this.ctx = ctx;
		this.titleCtx = titleCtx;
	}

	get size(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}

	setPreviewSize(width: number, height: number): void {
		const nextWidth = Math.max(2, Math.round(width / 2) * 2);
		const nextHeight = Math.max(2, Math.round(height / 2) * 2);
		if (nextWidth === this.width && nextHeight === this.height) return;
		this.width = nextWidth;
		this.height = nextHeight;
		this.canvas.width = nextWidth;
		this.canvas.height = nextHeight;
	}

	present(layers: readonly CanvasCompatibilityLayer[]): void {
		if (this.width <= 0 || this.height <= 0) return;
		this.ctx.save();
		try {
			this.ctx.globalAlpha = 1;
			this.ctx.setTransform(1, 0, 0, 1, 0, 0);
			this.ctx.fillStyle = '#000';
			this.ctx.fillRect(0, 0, this.width, this.height);
			for (const layer of layers) {
				if (layer.kind === 'frame') {
					drawTransformedImage(
						this.ctx,
						layer.frame as unknown as CanvasImageSource,
						layer.frame.displayWidth || layer.frame.codedWidth || this.width,
						layer.frame.displayHeight || layer.frame.codedHeight || this.height,
						this.width,
						this.height,
						layer.transform
					);
				} else {
					this.titleCtx.clearRect(0, 0, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);
					rasterizeTitleToCanvas(
						this.titleCtx,
						TITLE_RASTER_WIDTH,
						TITLE_RASTER_HEIGHT,
						layer.content
					);
					drawTransformedImage(
						this.ctx,
						this.titleCanvas,
						TITLE_RASTER_WIDTH,
						TITLE_RASTER_HEIGHT,
						this.width,
						this.height,
						layer.transform
					);
				}
			}
		} finally {
			this.ctx.restore();
		}
	}

	async renderLayeredForExport(
		layers: readonly CanvasCompatibilityLayer[],
		timestamp: number,
		duration: number
	): Promise<VideoFrame> {
		this.present(layers);
		return this.captureCanvasFrame(timestamp, duration);
	}

	async renderBlackForExport(timestamp: number, duration: number): Promise<VideoFrame> {
		this.present([]);
		return this.captureCanvasFrame(timestamp, duration);
	}

	destroy(): void {
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, this.width, this.height);
		this.titleCtx.setTransform(1, 0, 0, 1, 0, 0);
		this.titleCtx.clearRect(0, 0, TITLE_RASTER_WIDTH, TITLE_RASTER_HEIGHT);
		this.canvas.width = 0;
		this.canvas.height = 0;
		this.titleCanvas.width = TITLE_RASTER_WIDTH;
		this.titleCanvas.height = TITLE_RASTER_HEIGHT;
		this.width = 0;
		this.height = 0;
	}

	private captureCanvasFrame(timestamp: number, duration: number): VideoFrame {
		if (this.width <= 0 || this.height <= 0) {
			throw new Error('Compatibility export renderer has not been sized.');
		}
		return new VideoFrame(this.canvas, {
			timestamp: Math.round(timestamp * 1_000_000),
			duration: Math.max(1, Math.round(duration * 1_000_000))
		});
	}
}
