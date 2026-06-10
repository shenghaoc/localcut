import type { RingBufferConfig, RingBufferStats, SpillRange } from '../../protocol';

export interface RingBufferEntry {
	type: 'video' | 'audio';
	timestamp: number;
	duration: number;
	byteSize: number;
	isKeyframe: boolean;
}

export interface RingBufferSnapshot {
	entries: RingBufferEntry[];
	startTimestamp: number;
	endTimestamp: number;
}

export interface RingBuffer {
	pushVideo(timestamp: number, duration: number, byteSize: number, isKeyframe: boolean): void;
	pushAudio(timestamp: number, duration: number, byteSize: number): void;
	getSnapshot(startTimestamp: number, endTimestamp: number): RingBufferSnapshot;
	getStats(): RingBufferStats;
	getConfig(): RingBufferConfig;
	updateConfig(config: Partial<RingBufferConfig>): void;
	spillOldest(targetByteReduction: number): { entries: RingBufferEntry[]; range: SpillRange };
	registerSpill(range: SpillRange): void;
	evictSpilledBefore(timestamp: number): SpillRange[];
	reset(): void;
}

export function createRingBuffer(config: RingBufferConfig): RingBuffer {
	let entries: RingBufferEntry[] = [];
	let spilledRanges: SpillRange[] = [];
	let cfg = { ...config };
	let droppedFrameCount = 0;
	let spillSeq = 0;

	function totalDuration(): number {
		if (entries.length === 0) return 0;
		const newest = entries[entries.length - 1].timestamp + entries[entries.length - 1].duration;
		const oldest = entries[0].timestamp;
		return newest - oldest;
	}

	function memoryBytes(): number {
		return entries.reduce((sum, e) => sum + e.byteSize, 0);
	}

	function evictToFitDuration(): void {
		const maxDur = cfg.maxDurationS;
		let cutoffIdx = -1;
		for (let i = 0; i < entries.length; i++) {
			if (entries[i].type === 'video' && entries[i].isKeyframe) {
				const after = entries.slice(i);
				const span = after.length > 0
					? after[after.length - 1].timestamp + after[after.length - 1].duration - after[0].timestamp
					: 0;
				if (span <= maxDur) { cutoffIdx = i; break; }
			}
		}
		if (cutoffIdx === -1) {
			for (let i = 1; i < entries.length; i++) {
				if (entries[i].type === 'video' && entries[i].isKeyframe) {
					cutoffIdx = i; droppedFrameCount++; break;
				}
			}
		}
		if (cutoffIdx > 0) {
			const evictedTs = entries[cutoffIdx].timestamp;
			entries = entries.slice(cutoffIdx);
			spilledRanges = spilledRanges.filter((r) => r.endTimestamp > evictedTs);
		}
	}

	return {
		pushVideo(timestamp: number, duration: number, byteSize: number, isKeyframe: boolean): void {
			entries.push({ type: 'video', timestamp, duration, byteSize, isKeyframe });
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},

		pushAudio(timestamp: number, duration: number, byteSize: number): void {
			entries.push({ type: 'audio', timestamp, duration, byteSize, isKeyframe: false });
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
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
				memoryBytes: memoryBytes(),
				spilledBytes: spilledRanges.reduce((sum, r) => sum + r.byteCount, 0),
				oldestTimestamp: entries.length > 0 ? entries[0].timestamp : null,
				newestTimestamp: entries.length > 0
					? entries[entries.length - 1].timestamp + entries[entries.length - 1].duration : null,
				keyframeCount: entries.filter((e) => e.isKeyframe).length,
				droppedFrameCount,
			};
		},

		getConfig(): RingBufferConfig { return { ...cfg }; },

		updateConfig(partial: Partial<RingBufferConfig>): void {
			cfg = { ...cfg, ...partial };
		},

		spillOldest(targetByteReduction: number): { entries: RingBufferEntry[]; range: SpillRange } {
			let bytesToSpill = 0;
			let spillCount = 0;
			for (const e of entries) {
				bytesToSpill += e.byteSize; spillCount++;
				if (bytesToSpill >= targetByteReduction) break;
			}
			const spilled = entries.splice(0, spillCount);
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

		registerSpill(range: SpillRange): void { spilledRanges.push(range); },

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
		},
	};
}
