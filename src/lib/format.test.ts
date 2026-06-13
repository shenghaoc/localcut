import { describe, expect, it } from 'vite-plus/test';

import { formatBytes, formatClock } from './format';

describe('formatBytes', () => {
	it('renders null as Unknown', () => {
		expect(formatBytes(null)).toBe('Unknown');
	});

	it('keeps whole bytes without decimals', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(512)).toBe('512 B');
	});

	it('scales by 1024 with one decimal past bytes', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
		expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB');
	});

	it('caps at the largest unit', () => {
		expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
		expect(formatBytes(2000 * 1024 ** 4)).toBe('2000.0 TB');
	});
});

describe('formatClock', () => {
	it('renders non-finite or non-positive input as 0:00', () => {
		expect(formatClock(Number.NaN)).toBe('0:00');
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(-5)).toBe('0:00');
	});

	it('uses m:ss under an hour', () => {
		expect(formatClock(5)).toBe('0:05');
		expect(formatClock(65)).toBe('1:05');
		expect(formatClock(342)).toBe('5:42');
		expect(formatClock(3599)).toBe('59:59');
	});

	it('switches to h:mm:ss at and past an hour', () => {
		expect(formatClock(3600)).toBe('1:00:00');
		expect(formatClock(3930)).toBe('1:05:30');
		expect(formatClock(36000)).toBe('10:00:00');
	});
});
