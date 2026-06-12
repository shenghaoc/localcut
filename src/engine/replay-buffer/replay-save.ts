import type { RingBuffer, RingBufferEntry, RingBufferSnapshot } from './ring-buffer';

export interface ReplaySaveRange {
	startTimestamp: number;
	endTimestamp: number;
	/** The snapshot used to derive the range, so callers don't re-snapshot. */
	snapshot: RingBufferSnapshot;
}

export interface ReplaySaveResult {
	entries: RingBufferEntry[];
	startTimestamp: number;
	endTimestamp: number;
	totalDurationS: number;
}

export function computeSaveRange(ringBuffer: RingBuffer, nSeconds: number): ReplaySaveRange | null {
	const stats = ringBuffer.getStats();
	if (stats.newestTimestamp === null) return null;

	const endTimestamp = stats.newestTimestamp;
	const rawStart = endTimestamp - nSeconds;

	// getSnapshot aligns the start to the nearest keyframe at or before rawStart.
	const snapshot = ringBuffer.getSnapshot(rawStart, endTimestamp);
	if (snapshot.entries.length === 0) return null;

	return {
		startTimestamp: snapshot.startTimestamp,
		endTimestamp: snapshot.endTimestamp,
		snapshot
	};
}

export function saveLastN(ringBuffer: RingBuffer, nSeconds: number): ReplaySaveResult | null {
	const range = computeSaveRange(ringBuffer, nSeconds);
	if (!range) return null;

	const { snapshot } = range;
	return {
		entries: snapshot.entries,
		startTimestamp: snapshot.startTimestamp,
		endTimestamp: snapshot.endTimestamp,
		totalDurationS: snapshot.endTimestamp - snapshot.startTimestamp
	};
}

/**
 * Selects the entries to mux for a save window over a combined entry list
 * (OPFS spill read-back + RAM snapshot, sorted by timestamp).
 *
 * The saved range must start on a video keyframe so the clip decodes from its
 * first frame: prefer the latest keyframe at or before `rawStart`; if the
 * window opens mid-GOP with no earlier keyframe available, fall back to the
 * first keyframe inside the window. Audio-only captures have no keyframe
 * constraint and clip to the raw window.
 */
export function assembleSaveEntries(
	combined: readonly RingBufferEntry[],
	rawStart: number,
	endTimestamp: number
): RingBufferEntry[] {
	const hasVideo = combined.some((e) => e.type === 'video');
	if (!hasVideo) {
		return combined.filter((e) => e.timestamp >= rawStart && e.timestamp <= endTimestamp);
	}

	let startIdx = -1;
	for (let i = 0; i < combined.length; i++) {
		const e = combined[i];
		if (e.timestamp > rawStart) break;
		if (e.type === 'video' && e.isKeyframe) startIdx = i;
	}
	if (startIdx === -1) {
		startIdx = combined.findIndex(
			(e) => e.type === 'video' && e.isKeyframe && e.timestamp <= endTimestamp
		);
	}
	if (startIdx === -1) return [];

	const startTs = combined[startIdx].timestamp;
	return combined.filter((e) => e.timestamp >= startTs && e.timestamp <= endTimestamp);
}
