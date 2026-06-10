import type { RingBuffer } from './ring-buffer';

export interface ReplaySaveResult {
	entries: number;
	startTimestamp: number;
	endTimestamp: number;
	totalDurationS: number;
}

export function computeSaveRange(
	ringBuffer: RingBuffer,
	nSeconds: number,
): { startTimestamp: number; endTimestamp: number } | null {
	const stats = ringBuffer.getStats();
	if (stats.newestTimestamp === null) return null;

	const endTimestamp = stats.newestTimestamp;
	const rawStart = Math.max(0, endTimestamp - nSeconds);

	// Find the nearest keyframe at or before rawStart
	const snapshot = ringBuffer.getSnapshot(rawStart, endTimestamp);
	if (snapshot.entries.length === 0) return null;

	return {
		startTimestamp: snapshot.startTimestamp,
		endTimestamp: snapshot.endTimestamp,
	};
}

export function saveLastN(
	ringBuffer: RingBuffer,
	nSeconds: number,
): ReplaySaveResult | null {
	const range = computeSaveRange(ringBuffer, nSeconds);
	if (!range) return null;

	const snapshot = ringBuffer.getSnapshot(range.startTimestamp, range.endTimestamp);
	return {
		entries: snapshot.entries.length,
		startTimestamp: snapshot.startTimestamp,
		endTimestamp: snapshot.endTimestamp,
		totalDurationS: snapshot.endTimestamp - snapshot.startTimestamp,
	};
}
