import { describe, expect, it } from 'vite-plus/test';

import { clamp, clamp01, finiteOr, isFiniteNumber } from './math';

describe('clamp', () => {
	it('returns the value when inside the range', () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});

	it('clamps below the minimum and above the maximum', () => {
		expect(clamp(-3, 0, 10)).toBe(0);
		expect(clamp(42, 0, 10)).toBe(10);
	});

	it('returns the bounds at the edges', () => {
		expect(clamp(0, 0, 10)).toBe(0);
		expect(clamp(10, 0, 10)).toBe(10);
	});
});

describe('clamp01', () => {
	it('clamps into [0, 1]', () => {
		expect(clamp01(-1)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(2)).toBe(1);
	});

	it('propagates NaN (matching the previous Math.min/Math.max behaviour)', () => {
		expect(Number.isNaN(clamp01(Number.NaN))).toBe(true);
	});
});

describe('isFiniteNumber', () => {
	it('accepts finite numbers including zero and negatives', () => {
		expect(isFiniteNumber(0)).toBe(true);
		expect(isFiniteNumber(-3.5)).toBe(true);
		expect(isFiniteNumber(1e9)).toBe(true);
	});

	it('rejects NaN, infinities, and non-numbers', () => {
		expect(isFiniteNumber(Number.NaN)).toBe(false);
		expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
		expect(isFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(false);
		expect(isFiniteNumber('5')).toBe(false);
		expect(isFiniteNumber(null)).toBe(false);
		expect(isFiniteNumber(undefined)).toBe(false);
	});
});

describe('finiteOr', () => {
	it('returns finite numbers unchanged', () => {
		expect(finiteOr(3.14, 0)).toBe(3.14);
		expect(finiteOr(0, 99)).toBe(0);
		expect(finiteOr(-7, 99)).toBe(-7);
	});

	it('falls back for non-finite or non-number input', () => {
		expect(finiteOr(Number.NaN, 1)).toBe(1);
		expect(finiteOr(Number.POSITIVE_INFINITY, 1)).toBe(1);
		expect(finiteOr(undefined, 2)).toBe(2);
		expect(finiteOr(null, 3)).toBe(3);
		expect(finiteOr('5', 4)).toBe(4);
	});
});
