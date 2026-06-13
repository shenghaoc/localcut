/**
 * Matte frame cache — Phase 31.
 *
 * LRU cache of GPUTexture objects holding alpha matte data, keyed by
 * `clipId:sourceTime`. Structurally similar to FrameCache but stores
 * matte textures instead of decoded video frames.
 */

export interface MatteCacheOptions {
	maxBytes: number;
}

export interface CachedMatteRef {
	view: GPUTextureView;
	width: number;
	height: number;
	bytes: number;
}

/** Estimate bytes for an r8unorm texture at the given dimensions. */
function estimateBytes(width: number, height: number): number {
	return width * height;
}

export function makeMatteCacheKey(clipId: string, sourceTime: number): string {
	return `${clipId}:${Math.round(sourceTime * 1000) / 1000}`;
}

export class MatteCache {
	private readonly maxBytes: number;
	private readonly entries = new Map<string, CachedMatteRef>();
	private readonly textures = new Map<string, GPUTexture>();
	private usedBytes = 0;

	constructor(options: MatteCacheOptions) {
		this.maxBytes = Math.max(0, options.maxBytes);
	}

	/** Returns the matte texture view for the given key, or null on miss. */
	get(key: string): GPUTextureView | null {
		const entry = this.entries.get(key);
		if (!entry) return null;
		// Move to end (most-recently-used).
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.view;
	}

	/** Inserts a matte texture into the cache. The texture is owned by the cache. */
	set(key: string, texture: GPUTexture, width: number, height: number): void {
		if (this.maxBytes <= 0) {
			texture.destroy();
			return;
		}
		this.delete(key);
		const bytes = estimateBytes(width, height);
		const view = texture.createView();
		this.entries.set(key, { view, width, height, bytes });
		this.textures.set(key, texture);
		this.usedBytes += bytes;
		this.evictIfNeeded();
	}

	/** Removes a specific entry and destroys its texture. */
	delete(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		this.usedBytes -= entry.bytes;
		const texture = this.textures.get(key);
		if (texture) {
			texture.destroy();
			this.textures.delete(key);
		}
	}

	/** Removes all entries for a given clip. */
	deleteByClip(clipId: string): void {
		const prefix = `${clipId}:`;
		for (const key of Array.from(this.entries.keys())) {
			if (key.startsWith(prefix)) {
				this.delete(key);
			}
		}
	}

	clear(): void {
		for (const texture of this.textures.values()) {
			texture.destroy();
		}
		this.entries.clear();
		this.textures.clear();
		this.usedBytes = 0;
	}

	get size(): number {
		return this.entries.size;
	}

	get bytesInUse(): number {
		return this.usedBytes;
	}

	private evictIfNeeded(): void {
		if (this.maxBytes <= 0) return;
		for (const [key] of this.entries) {
			if (this.usedBytes <= this.maxBytes) break;
			this.delete(key);
		}
	}
}
