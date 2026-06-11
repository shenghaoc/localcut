import { describe, expect, it } from 'vitest';
import {
	createRingBuffer,
	MAX_RING_DURATION_S,
	type RingBuffer,
	type RingBufferEntry
} from './ring-buffer';
import { DEFAULT_RING_BUFFER_CONFIG } from '../../protocol';

function makeRing(overrides: Partial<typeof DEFAULT_RING_BUFFER_CONFIG> = {}): RingBuffer {
	return createRingBuffer({ ...DEFAULT_RING_BUFFER_CONFIG, ...overrides });
}

function bytes(size: number, fill = 0xab): Uint8Array {
	return new Uint8Array(size).fill(fill);
}

/** Pushes `gops` GOPs of `gopFrames` frames each at `fps`, 1KB per frame. */
function pushGops(ring: RingBuffer, gops: number, gopFrames: number, fps = 30, startTs = 0): number {
	const dt = 1 / fps;
	let ts = startTs;
	for (let g = 0; g < gops; g++) {
		for (let f = 0; f < gopFrames; f++) {
			ring.pushVideo(ts, dt, bytes(1024), f === 0);
			ts += dt;
		}
	}
	return ts;
}

describe('replay ring buffer', () => {
	it('tracks duration, memory, and keyframes from pushed chunks', () => {
		const ring = makeRing();
		pushGops(ring, 2, 30);
		const stats = ring.getStats();
		expect(stats.keyframeCount).toBe(2);
		expect(stats.memoryBytes).toBe(60 * 1024);
		expect(stats.totalDurationS).toBeCloseTo(2, 1);
		expect(stats.oldestTimestamp).toBe(0);
	});

	it('evicts whole GOPs once the duration limit is exceeded', () => {
		const ring = makeRing({ maxDurationS: 2 });
		pushGops(ring, 4, 30); // 4 s of 1 s GOPs
		const stats = ring.getStats();
		expect(stats.totalDurationS).toBeLessThanOrEqual(2.01);
		// The buffer must still start on a keyframe.
		const snapshot = ring.getSnapshot(stats.oldestTimestamp ?? 0, stats.newestTimestamp ?? 0);
		expect(snapshot.entries[0]?.isKeyframe).toBe(true);
	});

	it('evicts the oldest GOP even when no keyframe window fits the limit (fallback path)', () => {
		// Two 2 s GOPs buffered under a generous limit, then the limit shrinks
		// to 1 s: no suffix window fits, so the fallback must drop the whole
		// oldest GOP. The pre-fix scan started at index 0, matched the first
		// keyframe immediately, and never evicted anything.
		const ring = makeRing({ maxDurationS: 10 });
		pushGops(ring, 2, 60);
		ring.updateConfig({ maxDurationS: 1 });
		const stats = ring.getStats();
		expect(stats.oldestTimestamp).toBeCloseTo(2, 3);
		expect(stats.droppedFrameCount).toBeGreaterThan(0);
	});

	it('returns an empty snapshot instead of crashing on an empty buffer', () => {
		const ring = makeRing();
		const snapshot = ring.getSnapshot(0, 10);
		expect(snapshot.entries).toEqual([]);
		expect(snapshot.startTimestamp).toBe(0);
		expect(snapshot.endTimestamp).toBe(10);
	});

	it('aligns snapshots to the nearest keyframe at or before the requested start', () => {
		const ring = makeRing();
		pushGops(ring, 3, 30); // keyframes at 0, 1, 2
		const snapshot = ring.getSnapshot(1.5, 3);
		expect(snapshot.startTimestamp).toBeCloseTo(1, 3);
		expect(snapshot.entries[0].isKeyframe).toBe(true);
	});

	it('snapshot does not mutate the ring (snapshot semantics)', () => {
		const ring = makeRing();
		pushGops(ring, 2, 30);
		const before = ring.getStats();
		ring.getSnapshot(0, 2);
		expect(ring.getStats()).toEqual(before);
	});

	it('preserves chunk bytes through push and snapshot', () => {
		const ring = makeRing();
		const payload = new Uint8Array([1, 2, 3, 4, 5]);
		ring.pushVideo(0, 1 / 30, payload, true);
		const entry = ring.getSnapshot(0, 1).entries[0];
		expect([...entry.data]).toEqual([1, 2, 3, 4, 5]);
		expect(entry.byteSize).toBe(5);
	});

	it('counts dropped frames reported by the capture loop', () => {
		const ring = makeRing();
		ring.noteDroppedFrame();
		ring.noteDroppedFrame();
		expect(ring.getStats().droppedFrameCount).toBe(2);
	});

	it('clamps duration config to the supported ceiling and floors', () => {
		const ring = makeRing();
		ring.updateConfig({ maxDurationS: 100000 });
		expect(ring.getConfig().maxDurationS).toBe(MAX_RING_DURATION_S);
		ring.updateConfig({ maxDurationS: 0 });
		expect(ring.getConfig().maxDurationS).toBe(1);
		ring.updateConfig({ maxDurationS: 30, saveDurationS: 600 });
		expect(ring.getConfig().saveDurationS).toBe(30);
	});

	it('re-evicts immediately when the duration limit shrinks', () => {
		const ring = makeRing();
		pushGops(ring, 10, 30); // 10 s buffered
		ring.updateConfig({ maxDurationS: 3 });
		expect(ring.getStats().totalDurationS).toBeLessThanOrEqual(3.01);
	});

	describe('spillOldest', () => {
		it('splices oldest entries up to the next keyframe so RAM keeps a GOP start', () => {
			const ring = makeRing();
			pushGops(ring, 3, 30);
			const result = ring.spillOldest(10 * 1024); // ~10 frames → extends to frame 30
			expect(result).not.toBeNull();
			expect(result!.entries).toHaveLength(30);
			expect(result!.range.hasKeyframe).toBe(true);
			const stats = ring.getStats();
			expect(stats.oldestTimestamp).toBeCloseTo(1, 3);
			const snapshot = ring.getSnapshot(stats.oldestTimestamp ?? 0, 3);
			expect(snapshot.entries[0].isKeyframe).toBe(true);
			expect(ring.getSpilledRanges()).toHaveLength(1);
		});

		it('declines to spill when it would split the only GOP', () => {
			const ring = makeRing();
			pushGops(ring, 1, 60);
			expect(ring.spillOldest(1024)).toBeNull();
			expect(ring.getStats().memoryBytes).toBe(60 * 1024);
		});

		it('declines on empty buffers and non-positive targets', () => {
			const ring = makeRing();
			expect(ring.spillOldest(1024)).toBeNull();
			pushGops(ring, 2, 30);
			expect(ring.spillOldest(0)).toBeNull();
		});

		it('preserves spilled entry payloads', () => {
			const ring = makeRing();
			ring.pushVideo(0, 0.5, new Uint8Array([9, 9, 9]), true);
			ring.pushVideo(0.5, 0.5, new Uint8Array([7]), false);
			ring.pushVideo(1, 0.5, new Uint8Array([5, 5]), true);
			const result = ring.spillOldest(1);
			expect(result!.entries.map((e: RingBufferEntry) => [...e.data])).toEqual([[9, 9, 9], [7]]);
		});
	});

	it('evictSpilledBefore returns expired ranges for file deletion', () => {
		const ring = makeRing();
		pushGops(ring, 4, 30);
		const spill = ring.spillOldest(1024);
		expect(spill).not.toBeNull();
		expect(ring.evictSpilledBefore(0.5)).toHaveLength(0); // still overlaps
		const evicted = ring.evictSpilledBefore(spill!.range.endTimestamp + 0.001);
		expect(evicted).toHaveLength(1);
		expect(evicted[0].opfsFileName).toBe(spill!.range.opfsFileName);
		expect(ring.getSpilledRanges()).toHaveLength(0);
	});

	it('removeSpilledRange drops tracking after a failed spill write', () => {
		const ring = makeRing();
		pushGops(ring, 4, 30);
		const spill = ring.spillOldest(1024)!;
		ring.removeSpilledRange(spill.range.opfsFileName);
		expect(ring.getSpilledRanges()).toHaveLength(0);
	});

	it('keeps incremental stats counters consistent across push/evict/spill/reset', () => {
		const ring = makeRing({ maxDurationS: 3 });
		// Mixed workload: pushes that trigger duration eviction, then a spill.
		for (let g = 0; g < 6; g++) {
			for (let f = 0; f < 30; f++) {
				ring.pushVideo(g + f / 30, 1 / 30, bytes(512), f === 0);
				if (f % 3 === 0) ring.pushAudio(g + f / 30 + 0.001, 0.02, bytes(64));
			}
		}
		ring.spillOldest(2048);
		const stats = ring.getStats();
		const snapshot = ring.getSnapshot(-Infinity, Infinity).entries;
		expect(stats.memoryBytes).toBe(snapshot.reduce((sum, e) => sum + e.byteSize, 0));
		expect(stats.keyframeCount).toBe(snapshot.filter((e) => e.isKeyframe).length);
		ring.reset();
		expect(ring.getStats().memoryBytes).toBe(0);
		expect(ring.getStats().keyframeCount).toBe(0);
	});

	it('evicts audio-only buffers by timestamp (no GOP constraint)', () => {
		const ring = makeRing({ maxDurationS: 2 });
		for (let i = 0; i < 300; i++) {
			ring.pushAudio(i * 0.02, 0.02, bytes(64)); // 6 s of audio
		}
		const stats = ring.getStats();
		expect(stats.totalDurationS).toBeLessThanOrEqual(2.01);
		expect(stats.oldestTimestamp).toBeGreaterThan(3.9);
	});

	it('spills audio-only buffers without requiring a keyframe boundary', () => {
		const ring = makeRing();
		for (let i = 0; i < 100; i++) {
			ring.pushAudio(i * 0.02, 0.02, bytes(64));
		}
		const result = ring.spillOldest(64 * 10);
		expect(result).not.toBeNull();
		expect(result!.entries.length).toBeGreaterThanOrEqual(10);
		// The newest entry stays resident even under an oversized byte target.
		const all = ring.spillOldest(Number.MAX_SAFE_INTEGER);
		expect(ring.getStats().memoryBytes).toBeGreaterThan(0);
		expect(all === null || all.entries.length < 100).toBe(true);
	});

	it('reset clears entries, spill ranges, and counters', () => {
		const ring = makeRing();
		pushGops(ring, 4, 30);
		ring.spillOldest(1024);
		ring.noteDroppedFrame();
		ring.reset();
		const stats = ring.getStats();
		expect(stats.memoryBytes).toBe(0);
		expect(stats.droppedFrameCount).toBe(0);
		expect(ring.getSpilledRanges()).toHaveLength(0);
	});
});
