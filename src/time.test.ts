import { describe, expect, it } from 'vite-plus/test';
import { formatIsoForDisplay, isoFromEpochMs, isIsoTimestamp } from './time';

describe('time utilities', () => {
	it('formats epoch milliseconds as UTC ISO strings without runtime calendar APIs', () => {
		expect(isoFromEpochMs(0)).toBe('1970-01-01T00:00:00.000Z');
		expect(isoFromEpochMs(86_400_000)).toBe('1970-01-02T00:00:00.000Z');
		expect(isoFromEpochMs(1_704_067_199_999)).toBe('2023-12-31T23:59:59.999Z');
	});

	it('handles leap years and rejects impossible ISO calendar values', () => {
		expect(isIsoTimestamp('2024-02-29T12:00:00.000Z')).toBe(true);
		expect(isIsoTimestamp('2023-02-29T12:00:00.000Z')).toBe(false);
		expect(isIsoTimestamp('2024-13-01T00:00:00.000Z')).toBe(false);
		expect(isIsoTimestamp('2024-01-01T24:00:00.000Z')).toBe(false);
	});

	it('formats valid generated labels and keeps invalid labels hidden', () => {
		expect(formatIsoForDisplay('2026-06-27T04:05:06.000Z')).toBe('Generated Jun 27, 04:05 UTC');
		expect(formatIsoForDisplay('not an iso value')).toBe('Generated');
	});
});
