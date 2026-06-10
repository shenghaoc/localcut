import { describe, expect, it } from 'vitest';
import { createRingBuffer, type RingBufferEntry } from './ring-buffer';
import { assembleSaveEntries, computeSaveRange, saveLastN } from './replay-save';
import { DEFAULT_RING_BUFFER_CONFIG } from '../../protocol';

function video(timestamp: number, isKeyframe: boolean, duration = 1 / 30): RingBufferEntry {
	return { type: 'video', timestamp, duration, byteSize: 4, isKeyframe, data: new Uint8Array(4) };
}

function audio(timestamp: number, duration = 0.02): RingBufferEntry {
	return { type: 'audio', timestamp, duration, byteSize: 2, isKeyframe: false, data: new Uint8Array(2) };
}

function populatedRing(seconds: number, fps = 30, gopS = 1) {
	const ring = createRingBuffer({ ...DEFAULT_RING_BUFFER_CONFIG, maxDurationS: seconds + 10 });
	const dt = 1 / fps;
	const gopFrames = Math.round(gopS * fps);
	for (let i = 0; i < seconds * fps; i++) {
		ring.pushVideo(i * dt, dt, new Uint8Array(4), i % gopFrames === 0);
	}
	return ring;
}

describe('computeSaveRange / saveLastN', () => {
	it('returns null for an empty buffer', () => {
		const ring = createRingBuffer({ ...DEFAULT_RING_BUFFER_CONFIG });
		expect(computeSaveRange(ring, 30)).toBeNull();
		expect(saveLastN(ring, 30)).toBeNull();
	});

	it('starts the range on the keyframe at or before newest - N', () => {
		const ring = populatedRing(10);
		const range = computeSaveRange(ring, 4.5)!;
		// newest ≈ 10 s; raw start ≈ 5.5 → aligned back to the 5 s keyframe.
		expect(range.startTimestamp).toBeCloseTo(5, 3);
		expect(range.endTimestamp).toBeCloseTo(10, 2);
		expect(range.snapshot.entries[0].isKeyframe).toBe(true);
	});

	it('saveLastN reuses the snapshot computed for the range (no second snapshot)', () => {
		const ring = populatedRing(10);
		const result = saveLastN(ring, 4.5)!;
		const range = computeSaveRange(ring, 4.5)!;
		expect(result.entries).toEqual(range.snapshot.entries);
		expect(result.totalDurationS).toBeCloseTo(
			range.endTimestamp - range.startTimestamp,
			6
		);
	});

	it('saves whatever is available when N exceeds the buffered duration', () => {
		const ring = populatedRing(3);
		const result = saveLastN(ring, 300)!;
		expect(result.startTimestamp).toBeCloseTo(0, 3);
		expect(result.entries.length).toBe(90);
	});

	it('does not mutate the ring while saving (concurrent-write safety)', () => {
		const ring = populatedRing(5);
		const before = ring.getStats();
		const result = saveLastN(ring, 2)!;
		// New chunks arriving after the snapshot belong to the ring, not the save.
		ring.pushVideo(5, 1 / 30, new Uint8Array(4), true);
		expect(result.entries.some((e) => e.timestamp >= 5)).toBe(false);
		expect(ring.getStats().memoryBytes).toBe(before.memoryBytes + 4);
	});
});

describe('assembleSaveEntries', () => {
	it('prefers the latest keyframe at or before the raw start', () => {
		const entries = [video(0, true), video(1, false), video(2, true), video(3, false), video(4, true)];
		const saved = assembleSaveEntries(entries, 2.5, 4.5);
		expect(saved[0].timestamp).toBe(2);
		expect(saved.at(-1)?.timestamp).toBe(4);
	});

	it('falls back to the first keyframe inside the window when none precedes it', () => {
		const entries = [video(0, false), video(1, false), video(2, true), video(3, false)];
		const saved = assembleSaveEntries(entries, 0.5, 3.5);
		expect(saved[0].timestamp).toBe(2);
		expect(saved[0].isKeyframe).toBe(true);
	});

	it('returns nothing when video exists but no keyframe is reachable', () => {
		const entries = [video(0, false), video(1, false)];
		expect(assembleSaveEntries(entries, 0, 2)).toEqual([]);
	});

	it('clips audio-only captures to the raw window without keyframe constraints', () => {
		const entries = [audio(0), audio(1), audio(2), audio(3)];
		const saved = assembleSaveEntries(entries, 0.5, 2.5);
		expect(saved.map((e) => e.timestamp)).toEqual([1, 2]);
	});

	it('spans spill read-back and RAM entries across the boundary', () => {
		// Spilled GOP at 0..1 (keyframe at 0), RAM from 1.. (keyframe at 1).
		const spilled = [video(0, true), video(0.5, false)];
		const ram = [video(1, true), video(1.5, false), video(2, true)];
		const combined = [...spilled, ...ram];
		const saved = assembleSaveEntries(combined, 0.25, 2.1);
		expect(saved[0].timestamp).toBe(0);
		expect(saved).toHaveLength(5);
	});

	it('includes interleaved audio from the aligned keyframe onward', () => {
		const combined = [
			video(0, true),
			audio(0.01),
			video(1, true),
			audio(1.01),
			video(2, false),
			audio(2.01)
		].sort((a, b) => a.timestamp - b.timestamp);
		const saved = assembleSaveEntries(combined, 1, 2.5);
		expect(saved.map((e) => e.timestamp)).toEqual([1, 1.01, 2, 2.01]);
	});
});
