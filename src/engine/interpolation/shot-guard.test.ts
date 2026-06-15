import { describe, it, expect } from 'vite-plus/test';
import {
	filterPairsByBoundaries,
	instantCrossesBoundary,
	type SourcePair,
	type ShotBoundary
} from './shot-guard';

function pair(index0: number, index1: number, time0: number, time1: number): SourcePair {
	return { index0, index1, time0, time1 };
}

function boundary(time: number): ShotBoundary {
	return { time };
}

describe('filterPairsByBoundaries', () => {
	it('allows all pairs when there are no boundaries', () => {
		const pairs = [pair(0, 1, 0, 1), pair(1, 2, 1, 2)];
		const results = filterPairsByBoundaries(pairs, []);
		expect(results.every((r) => r.synthesisable)).toBe(true);
	});

	it('refuses a pair that straddles a boundary', () => {
		const pairs = [pair(0, 1, 0, 1)];
		const results = filterPairsByBoundaries(pairs, [boundary(0.5)]);
		expect(results[0].synthesisable).toBe(false);
		expect(results[0].refusingBoundary).toEqual(boundary(0.5));
	});

	it('refuses when boundary is exactly at t1 (start of next shot)', () => {
		const pairs = [pair(0, 1, 0, 1)];
		const results = filterPairsByBoundaries(pairs, [boundary(1)]);
		expect(results[0].synthesisable).toBe(false);
	});

	it('allows when boundary is exactly at t0 (start of current shot)', () => {
		const pairs = [pair(0, 1, 0, 1)];
		const results = filterPairsByBoundaries(pairs, [boundary(0)]);
		expect(results[0].synthesisable).toBe(true);
	});

	it('allows pairs that do not cross any boundary', () => {
		const pairs = [pair(0, 1, 0, 1), pair(1, 2, 1, 2), pair(2, 3, 2, 3)];
		// Boundary at 2.5 only affects pair (2,3)
		const results = filterPairsByBoundaries(pairs, [boundary(2.5)]);
		expect(results[0].synthesisable).toBe(true);
		expect(results[1].synthesisable).toBe(true);
		expect(results[2].synthesisable).toBe(false);
	});

	it('handles multiple boundaries', () => {
		const pairs = [pair(0, 1, 0, 1), pair(1, 2, 1, 2), pair(2, 3, 2, 3)];
		const results = filterPairsByBoundaries(pairs, [boundary(0.5), boundary(2.5)]);
		expect(results[0].synthesisable).toBe(false);
		expect(results[1].synthesisable).toBe(true);
		expect(results[2].synthesisable).toBe(false);
	});

	it('handles unsorted boundaries', () => {
		const pairs = [pair(0, 1, 0, 1)];
		const results = filterPairsByBoundaries(pairs, [boundary(0.8), boundary(0.2)]);
		expect(results[0].synthesisable).toBe(false);
	});

	it('handles empty pairs', () => {
		expect(filterPairsByBoundaries([], [boundary(0.5)])).toHaveLength(0);
	});

	it('refuses when multiple boundaries fall in the same pair', () => {
		const pairs = [pair(0, 1, 0, 1)];
		const results = filterPairsByBoundaries(pairs, [boundary(0.3), boundary(0.7)]);
		expect(results[0].synthesisable).toBe(false);
		// Should report the first boundary found (0.3 after sorting)
		expect(results[0].refusingBoundary).toEqual(boundary(0.3));
	});
});

describe('instantCrossesBoundary', () => {
	it('returns false when no boundaries', () => {
		expect(instantCrossesBoundary(0.5, 1, [])).toBe(false);
	});

	it('returns true when boundary is inside the interval', () => {
		expect(instantCrossesBoundary(0, 1, [boundary(0.5)])).toBe(true);
	});

	it('returns true when boundary is at the end of the interval', () => {
		expect(instantCrossesBoundary(0, 1, [boundary(1)])).toBe(true);
	});

	it('returns false when boundary is at the start of the interval', () => {
		expect(instantCrossesBoundary(0, 1, [boundary(0)])).toBe(false);
	});

	it('returns false when boundary is outside the interval', () => {
		expect(instantCrossesBoundary(0, 1, [boundary(1.5)])).toBe(false);
		expect(instantCrossesBoundary(0, 1, [boundary(-0.5)])).toBe(false);
	});
});
