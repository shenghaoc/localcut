import { describe, it, expect } from 'vite-plus/test';
import {
	computeSlowmoInstants,
	computeFpsUpconvertInstants,
	bracketInstant,
	MAX_FACTOR_PER_PAIR
} from './timesteps';

describe('computeSlowmoInstants', () => {
	it('returns empty for fewer than 2 source frames', () => {
		expect(computeSlowmoInstants(0, 2).instants).toHaveLength(0);
		expect(computeSlowmoInstants(1, 2).instants).toHaveLength(0);
	});

	it('returns empty for factor < 1', () => {
		expect(computeSlowmoInstants(10, 0).instants).toHaveLength(0);
		expect(computeSlowmoInstants(10, -1).instants).toHaveLength(0);
	});

	it('computes 2× slowmo (1 intermediate per interval)', () => {
		const result = computeSlowmoInstants(3, 2);
		// 2 intervals, 1 instant each → 2 instants
		expect(result.instants).toHaveLength(2);
		expect(result.clamped).toBeUndefined();

		// First interval: tau = 0.5
		expect(result.instants[0]).toMatchObject({
			sourceIndex: 0,
			tau: 0.5
		});
		// Second interval: tau = 0.5
		expect(result.instants[1]).toMatchObject({
			sourceIndex: 1,
			tau: 0.5
		});
	});

	it('computes 3× slowmo (2 intermediates per interval)', () => {
		const result = computeSlowmoInstants(2, 3);
		// 1 interval, 2 instants
		expect(result.instants).toHaveLength(2);
		expect(result.instants[0].tau).toBeCloseTo(1 / 3);
		expect(result.instants[1].tau).toBeCloseTo(2 / 3);
	});

	it('computes 4× slowmo (3 intermediates per interval)', () => {
		const result = computeSlowmoInstants(2, 4);
		// 1 interval, 3 instants
		expect(result.instants).toHaveLength(3);
		expect(result.instants[0].tau).toBeCloseTo(1 / 4);
		expect(result.instants[1].tau).toBeCloseTo(2 / 4);
		expect(result.instants[2].tau).toBeCloseTo(3 / 4);
	});

	it('clamps factor above 4× with warning', () => {
		const result = computeSlowmoInstants(2, 8);
		// Should be clamped to 4× → 3 intermediates (1 interval × 3)
		expect(result.instants).toHaveLength(3);
		expect(result.clamped).toBeDefined();
		expect(result.clamped!.requested).toBe(8);
		expect(result.clamped!.effective).toBe(MAX_FACTOR_PER_PAIR);
	});

	it('does not exceed cap across all intervals', () => {
		const result = computeSlowmoInstants(5, 10);
		// 4 intervals × 3 intermediates each = 12
		expect(result.instants).toHaveLength(12);
		// Verify no interval has more than MAX_FACTOR_PER_PAIR instants
		const counts = new Map<number, number>();
		for (const inst of result.instants) {
			counts.set(inst.sourceIndex, (counts.get(inst.sourceIndex) ?? 0) + 1);
		}
		for (const count of counts.values()) {
			expect(count).toBeLessThanOrEqual(MAX_FACTOR_PER_PAIR);
		}
	});

	it('all tau values are in (0, 1)', () => {
		const result = computeSlowmoInstants(10, 4);
		for (const inst of result.instants) {
			expect(inst.tau).toBeGreaterThan(0);
			expect(inst.tau).toBeLessThan(1);
		}
	});

	it('time values are fractional frame indices', () => {
		const result = computeSlowmoInstants(3, 2);
		expect(result.instants[0].time).toBeCloseTo(0.5);
		expect(result.instants[1].time).toBeCloseTo(1.5);
	});
});

describe('computeFpsUpconvertInstants', () => {
	it('returns empty when source has fewer than 2 frames', () => {
		expect(computeFpsUpconvertInstants(1, 24, 60).instants).toHaveLength(0);
	});

	it('returns empty when target fps ≤ source fps', () => {
		expect(computeFpsUpconvertInstants(10, 60, 24).instants).toHaveLength(0);
		expect(computeFpsUpconvertInstants(10, 24, 24).instants).toHaveLength(0);
	});

	it('computes 24→60 fps upconversion (2.5× ratio)', () => {
		const result = computeFpsUpconvertInstants(10, 24, 60);
		// Each source interval should have ~2-3 synthesised frames
		expect(result.instants.length).toBeGreaterThan(0);
		expect(result.clamped).toBeUndefined();

		// All instants should have tau in (0, 1)
		for (const inst of result.instants) {
			expect(inst.tau).toBeGreaterThan(0);
			expect(inst.tau).toBeLessThan(1);
		}
	});

	it('respects per-interval cap for high ratios', () => {
		const result = computeFpsUpconvertInstants(5, 24, 240);
		// 10× ratio, but capped at 4× per interval
		expect(result.clamped).toBeDefined();

		// Verify no interval exceeds the cap
		const counts = new Map<number, number>();
		for (const inst of result.instants) {
			counts.set(inst.sourceIndex, (counts.get(inst.sourceIndex) ?? 0) + 1);
		}
		for (const count of counts.values()) {
			expect(count).toBeLessThanOrEqual(MAX_FACTOR_PER_PAIR);
		}
	});

	it('totalOutputFrames accounts for all output frames', () => {
		const result = computeFpsUpconvertInstants(10, 24, 60);
		// 10 frames at 24fps → at 60fps = ceil(10 * 60/24) = 25
		expect(result.totalOutputFrames).toBe(25);
	});

	it('totalOutputFrames is at least sourceFrameCount', () => {
		const result = computeFpsUpconvertInstants(10, 24, 30);
		expect(result.totalOutputFrames).toBeGreaterThanOrEqual(10);
	});
});

describe('bracketInstant', () => {
	it('returns null for negative time', () => {
		expect(bracketInstant(-1, 10)).toBeNull();
	});

	it('returns null for fewer than 2 source frames', () => {
		expect(bracketInstant(0.5, 1)).toBeNull();
	});

	it('returns null when time lands on or past the last source frame', () => {
		expect(bracketInstant(9, 10)).toBeNull();
		expect(bracketInstant(10, 10)).toBeNull();
	});

	it('returns null when tau is effectively 0 (on a source frame)', () => {
		expect(bracketInstant(0, 10)).toBeNull();
		expect(bracketInstant(5, 10)).toBeNull();
	});

	it('brackets a mid-interval instant correctly', () => {
		const result = bracketInstant(0.5, 10);
		expect(result).toEqual({ sourceIndex: 0, tau: 0.5 });
	});

	it('brackets a fractional instant near an interval boundary', () => {
		const result = bracketInstant(2.25, 10);
		expect(result).toEqual({ sourceIndex: 2, tau: 0.25 });
	});

	it('rejects tau very close to 1', () => {
		expect(bracketInstant(0.9999999999, 10)).toBeNull();
	});
});
