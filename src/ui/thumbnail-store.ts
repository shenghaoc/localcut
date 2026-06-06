/**
 * UI-side thumbnail store (Phase 11).
 *
 * Transferred `ImageBitmap`s have exactly one owner: this store. It is an LRU
 * keyed `(sourceId, tBucket)` whose eviction/replacement/clear paths each call
 * `ImageBitmap.close()` — the same discipline as `VideoFrame.close()` — so GPU
 * pixels are freed deterministically. The worker keeps only request bookkeeping
 * and regenerates on demand.
 */

export interface ThumbnailEntry {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** Buckets a timestamp to the millisecond so lookups match worker-side buckets. */
export function thumbnailKey(sourceId: string, timestamp: number): string {
  return `${sourceId}:${Math.round(Math.max(0, timestamp) * 1000) / 1000}`;
}

export class ThumbnailStore {
  private readonly entries = new Map<string, ThumbnailEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 512) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Distinct source ids that currently have at least one cached bitmap. */
  sourceIds(): Set<string> {
    const ids = new Set<string>();
    for (const key of this.entries.keys()) {
      const sep = key.lastIndexOf(':');
      if (sep > 0) ids.add(key.slice(0, sep));
    }
    return ids;
  }

  get(sourceId: string, timestamp: number): ThumbnailEntry | null {
    const key = thumbnailKey(sourceId, timestamp);
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Touch for LRU recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  has(sourceId: string, timestamp: number): boolean {
    return this.entries.has(thumbnailKey(sourceId, timestamp));
  }

  set(sourceId: string, timestamp: number, entry: ThumbnailEntry): void {
    const key = thumbnailKey(sourceId, timestamp);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      if (existing.bitmap !== entry.bitmap) existing.bitmap.close();
    }
    this.entries.set(key, entry);
    this.evictIfNeeded();
  }

  /** Closes and drops every bitmap for a source (asset removed / re-keyed). */
  clearSource(sourceId: string): void {
    const prefix = `${sourceId}:`;
    for (const [key, entry] of [...this.entries]) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      entry.bitmap.close();
    }
  }

  /** Closes and drops every bitmap (unmount / new project). */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.bitmap.close();
    }
    this.entries.clear();
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      entry.bitmap.close();
    }
  }
}
