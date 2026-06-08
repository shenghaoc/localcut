/** LRU decoded VideoFrame cache — Phase 3. */
export interface FrameCacheOptions {
	maxBytes: number;
	estimateBytes?: (frame: VideoFrame) => number;
}

export interface CachedFrameRef {
	frame: VideoFrame;
	bytes: number;
}

const defaultEstimateBytes = (frame: VideoFrame): number =>
	frame.codedWidth * frame.codedHeight * 4;

export interface FrameCacheKey {
	sourceId: string;
	timestamp: number;
}

function normalizeTimestamp(timestamp: number): number {
	return Math.round(timestamp * 1000) / 1000;
}

export function makeFrameCacheKey(sourceId: string, timestamp: number): string {
	return `${sourceId}:${normalizeTimestamp(timestamp)}`;
}

export class FrameCache {
	private readonly maxBytes: number;
	private readonly estimateBytes: (frame: VideoFrame) => number;
	private readonly frames = new Map<string, CachedFrameRef>();
	private usedBytes = 0;

	constructor(options: FrameCacheOptions) {
		this.maxBytes = Math.max(0, options.maxBytes);
		this.estimateBytes = options.estimateBytes ?? defaultEstimateBytes;
	}

	get(key: string): VideoFrame | null {
		const entry = this.frames.get(key);
		if (!entry) return null;
		this.frames.delete(key);
		this.frames.set(key, entry);
		return entry.frame.clone();
	}

	set(key: string, frame: VideoFrame): void {
		if (this.maxBytes <= 0) {
			frame.close();
			return;
		}

		const existing = this.frames.get(key);
		if (existing) {
			this.frames.delete(key);
			this.usedBytes -= existing.bytes;
			existing.frame.close();
		}

		const bytes = this.estimateBytes(frame);
		this.frames.set(key, { frame, bytes });
		this.usedBytes += bytes;
		this.evictIfNeeded();
	}

	clear(): void {
		for (const entry of this.frames.values()) {
			entry.frame.close();
		}
		this.frames.clear();
		this.usedBytes = 0;
	}

	get size(): number {
		return this.frames.size;
	}

	get bytesInUse(): number {
		return this.usedBytes;
	}

	private evictIfNeeded(): void {
		if (this.maxBytes <= 0) return;
		for (const [key, entry] of this.frames) {
			if (this.usedBytes <= this.maxBytes) break;
			this.frames.delete(key);
			this.usedBytes -= entry.bytes;
			entry.frame.close();
		}
	}
}
