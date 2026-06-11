import type { RingBufferConfig, RingBufferStats, SpillRange } from '../../protocol';

export interface RingBufferEntry {
	type: 'video' | 'audio';
	/** Presentation timestamp in seconds (capture clock domain). */
	timestamp: number;
	/** Duration in seconds. */
	duration: number;
	byteSize: number;
	isKeyframe: boolean;
	/** Encoded chunk bytes (copied out of the WebCodecs chunk). */
	data: Uint8Array;
}

export interface RingBufferSnapshot {
	entries: RingBufferEntry[];
	startTimestamp: number;
	endTimestamp: number;
}

/** R0.5: user-configurable duration bound, clamped to this ceiling. */
export const MAX_RING_DURATION_S = 300;
export const MIN_RING_DURATION_S = 1;

export interface RingBuffer {
	pushVideo(timestamp: number, duration: number, data: Uint8Array, isKeyframe: boolean): void;
	pushAudio(timestamp: number, duration: number, data: Uint8Array): void;
	/** Record a frame dropped before encoding (encoder backpressure). */
	noteDroppedFrame(): void;
	getSnapshot(startTimestamp: number, endTimestamp: number): RingBufferSnapshot;
	getStats(): RingBufferStats;
	getConfig(): RingBufferConfig;
	updateConfig(config: Partial<RingBufferConfig>): void;
	/**
	 * Splice the oldest entries (at least `targetByteReduction` bytes, extended
	 * to the next video keyframe so RAM keeps starting on a GOP boundary) for
	 * OPFS spill. Audio-only buffers have no GOP constraint and split anywhere.
	 * Returns null when the buffer can't spill without splitting the only GOP.
	 */
	spillOldest(targetByteReduction: number): { entries: RingBufferEntry[]; range: SpillRange } | null;
	getSpilledRanges(): SpillRange[];
	removeSpilledRange(opfsFileName: string): void;
	evictSpilledBefore(timestamp: number): SpillRange[];
	reset(): void;
}

export function createRingBuffer(config: RingBufferConfig): RingBuffer {
	let entries: RingBufferEntry[] = [];
	let spilledRanges: SpillRange[] = [];
	let cfg = { ...config };
	let droppedFrameCount = 0;
	let spillSeq = 0;
	// Running counters so getStats() — called from the per-chunk capture hot
	// path — never re-reduces the whole entry list.
	let memoryBytesCount = 0;
	let keyframeCount = 0;
	let videoEntryCount = 0;

	function totalDuration(): number {
		if (entries.length === 0) return 0;
		const newest = entries[entries.length - 1].timestamp + entries[entries.length - 1].duration;
		const oldest = entries[0].timestamp;
		return newest - oldest;
	}

	function trackPush(entry: RingBufferEntry): void {
		memoryBytesCount += entry.byteSize;
		if (entry.isKeyframe) keyframeCount++;
		if (entry.type === 'video') videoEntryCount++;
	}

	/** Removes entries[0..count) keeping the running counters consistent. */
	function dropPrefix(count: number): RingBufferEntry[] {
		const removed = entries.slice(0, count);
		for (const entry of removed) {
			memoryBytesCount -= entry.byteSize;
			if (entry.isKeyframe) keyframeCount--;
			if (entry.type === 'video') videoEntryCount--;
		}
		entries = entries.slice(count);
		return removed;
	}

	function evictToFitDuration(): void {
		const maxDur = cfg.maxDurationS;
		if (entries.length === 0) return;
		// The list is timestamp-ordered, so each candidate's retained span is an
		// O(1) subtraction from the newest end — no per-candidate slicing.
		const last = entries[entries.length - 1];
		const newestEnd = last.timestamp + last.duration;
		let cutoffIdx = -1;
		if (videoEntryCount === 0) {
			// Audio-only buffer: no GOP constraint, evict purely by timestamp.
			for (let i = 0; i < entries.length; i++) {
				if (newestEnd - entries[i].timestamp <= maxDur) { cutoffIdx = i; break; }
			}
		} else {
			for (let i = 0; i < entries.length; i++) {
				const e = entries[i];
				if (e.type === 'video' && e.isKeyframe && newestEnd - e.timestamp <= maxDur) {
					cutoffIdx = i;
					break;
				}
			}
			if (cutoffIdx === -1) {
				// No keyframe yields a window within budget (a single GOP longer than
				// the limit). Drop the oldest whole GOP: search from index 1 so the
				// guaranteed-first keyframe doesn't satisfy the scan immediately.
				for (let i = 1; i < entries.length; i++) {
					if (entries[i].type === 'video' && entries[i].isKeyframe) {
						cutoffIdx = i; droppedFrameCount++; break;
					}
				}
			}
		}
		// Spilled ranges are NOT dropped here: their OPFS files must be deleted
		// by the owner, which collects expired ranges via evictSpilledBefore().
		if (cutoffIdx > 0) {
			dropPrefix(cutoffIdx);
		}
	}

	return {
		pushVideo(timestamp: number, duration: number, data: Uint8Array, isKeyframe: boolean): void {
			const entry: RingBufferEntry = {
				type: 'video', timestamp, duration, byteSize: data.byteLength, isKeyframe, data
			};
			entries.push(entry);
			trackPush(entry);
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},

		pushAudio(timestamp: number, duration: number, data: Uint8Array): void {
			const entry: RingBufferEntry = {
				type: 'audio', timestamp, duration, byteSize: data.byteLength, isKeyframe: false, data
			};
			entries.push(entry);
			trackPush(entry);
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},

		noteDroppedFrame(): void {
			droppedFrameCount++;
		},

		getSnapshot(startTimestamp: number, endTimestamp: number): RingBufferSnapshot {
			if (entries.length === 0) {
				return { entries: [], startTimestamp, endTimestamp };
			}
			let startIdx = 0;
			for (let i = 0; i < entries.length; i++) {
				if (entries[i].type === 'video' && entries[i].isKeyframe && entries[i].timestamp <= startTimestamp) {
					startIdx = i;
				}
				if (entries[i].timestamp > startTimestamp) break;
			}
			const snapshotEntries = entries.filter(
				(e) => e.timestamp >= entries[startIdx].timestamp && e.timestamp <= endTimestamp,
			);
			return {
				entries: snapshotEntries,
				startTimestamp: snapshotEntries.length > 0 ? snapshotEntries[0].timestamp : startTimestamp,
				endTimestamp: snapshotEntries.length > 0
					? snapshotEntries[snapshotEntries.length - 1].timestamp + snapshotEntries[snapshotEntries.length - 1].duration
					: endTimestamp,
			};
		},

		getStats(): RingBufferStats {
			return {
				totalDurationS: totalDuration(),
				memoryBytes: memoryBytesCount,
				spilledBytes: spilledRanges.reduce((sum, r) => sum + r.byteCount, 0),
				oldestTimestamp: entries.length > 0 ? entries[0].timestamp : null,
				newestTimestamp: entries.length > 0
					? entries[entries.length - 1].timestamp + entries[entries.length - 1].duration : null,
				keyframeCount,
				droppedFrameCount,
			};
		},

		getConfig(): RingBufferConfig { return { ...cfg }; },

		updateConfig(partial: Partial<RingBufferConfig>): void {
			cfg = { ...cfg, ...partial };
			cfg.maxDurationS = Math.min(MAX_RING_DURATION_S, Math.max(MIN_RING_DURATION_S, cfg.maxDurationS));
			cfg.saveDurationS = Math.min(cfg.maxDurationS, Math.max(MIN_RING_DURATION_S, cfg.saveDurationS));
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},

		spillOldest(targetByteReduction: number): { entries: RingBufferEntry[]; range: SpillRange } | null {
			if (entries.length === 0 || targetByteReduction <= 0) return null;
			let bytesToSpill = 0;
			let spillCount = 0;
			for (const e of entries) {
				bytesToSpill += e.byteSize; spillCount++;
				if (bytesToSpill >= targetByteReduction) break;
			}
			if (videoEntryCount > 0) {
				// Extend to the next video keyframe so the remaining RAM window still
				// starts on a GOP boundary; without one we'd split the only GOP, so
				// decline and let duration eviction handle it.
				let aligned = -1;
				for (let i = spillCount; i < entries.length; i++) {
					if (entries[i].type === 'video' && entries[i].isKeyframe) { aligned = i; break; }
				}
				if (aligned === -1) return null;
				for (let i = spillCount; i < aligned; i++) bytesToSpill += entries[i].byteSize;
				spillCount = aligned;
			} else if (spillCount >= entries.length) {
				// Audio-only: keep at least the newest entry resident.
				spillCount = entries.length - 1;
				if (spillCount === 0) return null;
				bytesToSpill = 0;
				for (let i = 0; i < spillCount; i++) bytesToSpill += entries[i].byteSize;
			}
			const spilled = dropPrefix(spillCount);
			const startTs = spilled[0].timestamp;
			const endTs = spilled[spilled.length - 1].timestamp + spilled[spilled.length - 1].duration;
			const seq = spillSeq++;
			const range: SpillRange = {
				startTimestamp: startTs,
				endTimestamp: endTs,
				opfsFileName: `replay-spill-${seq}-${startTs.toFixed(3)}.bin`,
				byteCount: bytesToSpill,
				entryCount: spillCount,
				hasKeyframe: spilled.some((e) => e.isKeyframe),
			};
			spilledRanges.push(range);
			return { entries: spilled, range };
		},

		getSpilledRanges(): SpillRange[] { return [...spilledRanges]; },

		removeSpilledRange(opfsFileName: string): void {
			spilledRanges = spilledRanges.filter((r) => r.opfsFileName !== opfsFileName);
		},

		evictSpilledBefore(timestamp: number): SpillRange[] {
			const evicted: SpillRange[] = [];
			spilledRanges = spilledRanges.filter((r) => {
				if (r.endTimestamp <= timestamp) { evicted.push(r); return false; }
				return true;
			});
			return evicted;
		},

		reset(): void {
			entries = [];
			spilledRanges = [];
			droppedFrameCount = 0;
			spillSeq = 0;
			memoryBytesCount = 0;
			keyframeCount = 0;
			videoEntryCount = 0;
		},
	};
}
