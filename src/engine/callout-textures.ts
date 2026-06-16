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

	/**
	 * Returns a cached GPUTextureView for arrow/box/step callouts.
	 * Never called for spotlight/blur (those are WGSL passes).
	 */
	get(
		clipId: string,
		payload: CalloutPayload,
		_outputWidth: number,
		_outputHeight: number
	): GPUTextureView {
		const hash = calloutContentHash(payload);
		const cached = this.cache.get(clipId);
		if (cached && cached.hash === hash) {
			return cached.view;
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
		this.cache.set(clipId, { texture, view, hash });
		return view;
	}

	/** Invalidate a specific clip's cached texture. */
	invalidate(clipId: string): void {
		const cached = this.cache.get(clipId);
		if (cached) {
			cached.texture.destroy();
			this.cache.delete(clipId);
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
