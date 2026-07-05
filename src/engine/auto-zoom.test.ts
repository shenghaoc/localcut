import { describe, it, expect } from 'vite-plus/test';
import { applyProposal, clusterEvents, DEFAULT_AUTO_ZOOM_PARAMS } from './auto-zoom';
import type { DomEventLogEntry } from './dom-event-log';

type Entry = DomEventLogEntry;

function makeEntry(t: number, x: number, y: number): Entry {
	return { t, kind: 'click', x, y };
}

describe('clusterEvents', () => {
	it('returns empty array for zero events', () => {
		const result = clusterEvents([], DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(result).toEqual([]);
	});

	it('produces one proposal for a single event', () => {
		const entries = [makeEntry(5_000_000, 0.5, 0.5)];
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(result).toHaveLength(1);
		const p = result[0]!;
		expect(p.centroidX).toBeCloseTo(0.5, 4);
		expect(p.centroidY).toBeCloseTo(0.5, 4);
		expect(p.cluster.eventCount).toBe(1);
		expect(p.status).toBe('pending');
	});

	it('clusters two events inside 2s and 15% threshold', () => {
		const entries = [makeEntry(1_000_000, 0.5, 0.5), makeEntry(1_500_000, 0.52, 0.51)];
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(result).toHaveLength(1);
		expect(result[0]!.cluster.eventCount).toBe(2);
	});

	it('splits two events >2s apart into two clusters', () => {
		const entries = [makeEntry(1_000_000, 0.5, 0.5), makeEntry(3_000_001, 0.5, 0.5)];
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(result).toHaveLength(2);
	});

	it('splits two events >15% distance into two clusters', () => {
		// Use events far enough apart in time that proposals don't overlap after merge
		const entries = [
			makeEntry(1_000_000, 0.2, 0.2),
			makeEntry(5_000_000, 0.5, 0.5) // >2s apart AND distance > 0.15
		];
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(result).toHaveLength(2);
	});

	it('merges overlapping proposals', () => {
		// Two clusters close enough that zoomOut of A > zoomIn of B by < 50ms
		const entries = [
			makeEntry(1_000_000, 0.2, 0.3),
			makeEntry(2_500_000, 0.8, 0.7) // >2s apart and distant → two clusters, then merged by overlap window
		];
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		// With default params, zoomOut of first = cluster.endUs + 1500ms = 1_000_000 + 1_500_000 = 2_500_000
		// zoomIn of second = 2_500_000 - 200_000 = 2_300_000
		// overlap = 2_500_000 - 2_300_000 = 200_000 µs > 50_000 threshold → merged
		expect(result).toHaveLength(1);
		expect(result[0]!.cluster.eventCount).toBe(2);
		expect(result[0]!.centroidX).toBeCloseTo(0.5, 4);
		expect(result[0]!.centroidY).toBeCloseTo(0.5, 4);
	});

	it('is deterministic — same input produces same output', () => {
		const entries = Array.from({ length: 100 }, (_, i) =>
			makeEntry(i * 100_000, Math.sin(i) * 0.3 + 0.5, Math.cos(i) * 0.3 + 0.5)
		);
		const r1 = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		const r2 = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		expect(r1).toEqual(r2);
	});

	it('completes under 100ms for 216,000 entries', () => {
		const entries: Entry[] = Array.from({ length: 216_000 }, (_, i) => ({
			t: i * (3_600_000_000 / 216_000), // spread over 1 hour in µs
			kind: 'click' as const,
			x: Math.sin(i * 0.01) * 0.3 + 0.5,
			y: Math.cos(i * 0.01) * 0.3 + 0.5
		}));
		const start = performance.now();
		const result = clusterEvents(entries, DEFAULT_AUTO_ZOOM_PARAMS, 0);
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(100);
		expect(result.length).toBeGreaterThan(0);
	});
});

describe('applyProposal', () => {
	it('converts proposal times to clip-local keyframe seconds', () => {
		const proposal = clusterEvents(
			[makeEntry(5_000_000, 0.5, 0.5)],
			DEFAULT_AUTO_ZOOM_PARAMS,
			4_000_000
		)[0]!;

		const keyframes = applyProposal(proposal, DEFAULT_AUTO_ZOOM_PARAMS, 4_000_000);

		expect(keyframes.scale?.[0]?.t).toBeCloseTo(0.8, 6);
		expect(keyframes.scale?.[2]?.t).toBeCloseTo(2.5, 6);
	});
});
