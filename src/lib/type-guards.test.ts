import { describe, expect, it } from 'vite-plus/test';
import { isNonEmptyString, isPositiveNumber, isRecord, isString } from './type-guards';

describe('isRecord', () => {
	it('returns true for plain objects', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
		expect(isRecord({ nested: { deep: true } })).toBe(true);
	});

	it('returns false for null', () => {
		expect(isRecord(null)).toBe(false);
	});

	it('returns false for arrays', () => {
		expect(isRecord([])).toBe(false);
		expect(isRecord([1, 2, 3])).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isRecord(42)).toBe(false);
		expect(isRecord('hello')).toBe(false);
		expect(isRecord(true)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
	});

	it('returns true for exotic object types (Date, Map, etc.)', () => {
		// isRecord accepts all non-null, non-array objects — documented caveat
		expect(isRecord(new Date())).toBe(true);
		expect(isRecord(new Map())).toBe(true);
		expect(isRecord(new Set())).toBe(true);
	});
});

describe('isString', () => {
	it('returns true for strings', () => {
		expect(isString('hello')).toBe(true);
		expect(isString('')).toBe(true);
	});

	it('returns false for non-strings', () => {
		expect(isString(42)).toBe(false);
		expect(isString(null)).toBe(false);
		expect(isString(undefined)).toBe(false);
	});
});

describe('isNonEmptyString', () => {
	it('returns true for non-empty strings', () => {
		expect(isNonEmptyString('hello')).toBe(true);
	});

	it('returns false for empty strings', () => {
		expect(isNonEmptyString('')).toBe(false);
	});

	it('returns false for non-strings', () => {
		expect(isNonEmptyString(42)).toBe(false);
		expect(isNonEmptyString(null)).toBe(false);
	});
});

describe('isPositiveNumber', () => {
	it('returns true for positive finite numbers', () => {
		expect(isPositiveNumber(1)).toBe(true);
		expect(isPositiveNumber(0.5)).toBe(true);
		expect(isPositiveNumber(1000)).toBe(true);
	});

	it('returns false for zero and negative numbers', () => {
		expect(isPositiveNumber(0)).toBe(false);
		expect(isPositiveNumber(-1)).toBe(false);
	});

	it('returns false for non-finite numbers', () => {
		expect(isPositiveNumber(Infinity)).toBe(false);
		expect(isPositiveNumber(NaN)).toBe(false);
	});

	it('returns false for non-numbers', () => {
		expect(isPositiveNumber('42')).toBe(false);
		expect(isPositiveNumber(null)).toBe(false);
		expect(isPositiveNumber(undefined)).toBe(false);
	});
});
