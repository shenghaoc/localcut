/** Phase 43: GPU texture cache for Canvas2D-rasterised callout clips.
 *
 *  Follows the exact same pattern as TitleTextureCache in titles.ts:
 *  (clipId, calloutContentHash) → GPUTexture. On a miss, rasterises via
 *  OffscreenCanvas + copyExternalImageToTexture. On style change the worker
 *  calls invalidate(clipId) and re-rasterises.
 */

import { calloutContentHash, rasterizeCallout, type CalloutPayload } from './callout';

interface CachedCallout {
	texture: GPUTexture;
	view: GPUTextureView;
	hash: string;
	width: number;
	height: number;
}

export interface CalloutTexture {
	texture: GPUTexture;
	view: GPUTextureView;
	width: number;
	height: number;
}

export class CalloutTextureCache {
	private readonly cache = new Map<string, CachedCallout>();
	private readonly canvas: OffscreenCanvas;
	private readonly ctx: OffscreenCanvasRenderingContext2D;

	constructor(private readonly device: GPUDevice) {
		// Rasterise at 1920×1080 (same as title clips).
		this.canvas = new OffscreenCanvas(1920, 1080);
		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('Failed to get 2D context for callout rasterisation');
		this.ctx = ctx;
	}

	/** Edit-time raster/upload; no-ops when the visual hash is unchanged. */
	rasterize(
		clipId: string,
		payload: CalloutPayload,
		_outputWidth: number,
		_outputHeight: number
	): CalloutTexture {
		const hash = calloutContentHash(payload);
		const cached = this.cache.get(clipId);
		if (cached && cached.hash === hash) {
			return {
				texture: cached.texture,
				view: cached.view,
				width: cached.width,
				height: cached.height
			};
		}

		// Invalidate old texture
		if (cached) {
			cached.texture.destroy();
			this.cache.delete(clipId);
		}

		// Rasterise
		rasterizeCallout(this.ctx, 1920, 1080, payload);

		// Upload to GPU
		const texture = this.device.createTexture({
			label: `callout-${clipId}`,
			size: { width: 1920, height: 1080, depthOrArrayLayers: 1 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		this.device.queue.copyExternalImageToTexture(
			{ source: this.canvas },
			{ texture },
			{ width: 1920, height: 1080 }
		);

		const view = texture.createView();
		this.cache.set(clipId, { texture, view, hash, width: 1920, height: 1080 });
		return { texture, view, width: 1920, height: 1080 };
	}

	/** Cold-path guarantee that a current callout texture exists. */
	ensure(
		clipId: string,
		payload: CalloutPayload,
		outputWidth: number,
		outputHeight: number
	): CalloutTexture {
		return this.rasterize(clipId, payload, outputWidth, outputHeight);
	}

	/** Per-frame read. Never rasterizes or uploads. */
	get(clipId: string): CalloutTexture | null {
		const cached = this.cache.get(clipId);
		return cached
			? { texture: cached.texture, view: cached.view, width: cached.width, height: cached.height }
			: null;
	}

	/** Invalidate a specific clip's cached texture. */
	invalidate(clipId: string): void {
		const cached = this.cache.get(clipId);
		if (cached) {
			cached.texture.destroy();
			this.cache.delete(clipId);
		}
	}

	/** Drops textures for callouts no longer on the timeline. */
	retain(activeClipIds: ReadonlySet<string>): void {
		for (const clipId of [...this.cache.keys()]) {
			if (!activeClipIds.has(clipId)) this.invalidate(clipId);
		}
	}

	/** Destroy all cached textures. */
	dispose(): void {
		for (const cached of this.cache.values()) {
			cached.texture.destroy();
		}
		this.cache.clear();
	}
}
