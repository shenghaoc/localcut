/** Chapter export unit tests — Phase 44 T9.2. */

import { describe, it, expect } from 'vite-plus/test';
import {
	generateChapterText,
	generateChaptersJson,
	formatChapterTimestamp,
	type ChapterEntry
} from './chapters';

describe('formatChapterTimestamp', () => {
	it('formats 0 seconds as 00:00:00', () => {
		expect(formatChapterTimestamp(0)).toBe('00:00:00');
	});

	it('formats 59 seconds as 00:00:59', () => {
		expect(formatChapterTimestamp(59)).toBe('00:00:59');
	});

	it('formats 60 seconds as 00:01:00', () => {
		expect(formatChapterTimestamp(60)).toBe('00:01:00');
	});

	it('formats 3661 seconds as 01:01:01', () => {
		expect(formatChapterTimestamp(3661)).toBe('01:01:01');
	});

	it('formats 7261 seconds as 02:01:01', () => {
		expect(formatChapterTimestamp(7261)).toBe('02:01:01');
	});

	it('floors fractional seconds', () => {
		expect(formatChapterTimestamp(65.9)).toBe('00:01:05');
	});

	it('handles negative values by clamping to 0', () => {
		expect(formatChapterTimestamp(-5)).toBe('00:00:00');
	});
});

describe('generateChapterText', () => {
	it('auto-inserts Intro at 00:00:00 when no marker at time 0', () => {
		const markers = [
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.entries).toHaveLength(3);
			expect(result.entries[0]!.time).toBe(0);
			expect(result.entries[0]!.label).toBe('Intro');
			expect(result.text).toContain('00:00:00 Intro');
		}
	});

	it('does not duplicate Intro when marker at time 0 exists', () => {
		const markers = [
			{ time: 0, label: 'Start' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.entries).toHaveLength(3);
			expect(result.entries[0]!.label).toBe('Start');
		}
	});

	it('rejects fewer than 3 chapters', () => {
		const markers = [{ time: 0, label: 'Intro' }];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toContain('at least 3');
		}
	});

	it('rejects chapters too close together (< 10 s)', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 5, label: 'Too Close' },
			{ time: 30, label: 'Part 1' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toContain('Too Close');
			expect(result.reason).toContain('10 seconds');
		}
	});

	it('accepts valid 3-chapter list with proper spacing', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.text).toBe('00:00:00 Intro\n00:00:30 Part 1\n00:01:00 Part 2');
		}
	});

	it('filters out markers with empty labels', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 15, label: '' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.entries).toHaveLength(3);
		}
	});

	it('sorts markers by time', () => {
		const markers = [
			{ time: 60, label: 'Part 2' },
			{ time: 30, label: 'Part 1' },
			{ time: 0, label: 'Intro' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.entries[0]!.time).toBe(0);
			expect(result.entries[1]!.time).toBe(30);
			expect(result.entries[2]!.time).toBe(60);
		}
	});

	it('handles timestamps over 1 hour', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 3600, label: 'Hour 2' },
			{ time: 7200, label: 'Hour 3' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.text).toContain('01:00:00 Hour 2');
			expect(result.text).toContain('02:00:00 Hour 3');
		}
	});

	it('drops markers past the program end when totalDurationS is given', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' },
			{ time: 9999, label: 'Past End' }
		];
		const result = generateChapterText(markers, 80);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.entries.map((e) => e.label)).not.toContain('Past End');
		}
	});

	it('rejects when the final chapter is within 10 s of the program end', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 90, label: 'Final' }
		];
		const result = generateChapterText(markers, 95);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toContain('Final');
			expect(result.reason).toContain('10 seconds before');
		}
	});

	it('accepts a valid list with a duration that leaves headroom', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers, 120);
		expect(result.valid).toBe(true);
	});

	it('skips the final-headroom check when totalDurationS is omitted', () => {
		const markers = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const result = generateChapterText(markers);
		expect(result.valid).toBe(true);
	});
});

describe('generateChaptersJson', () => {
	it('produces valid JSON array with correct fields', () => {
		const entries: ChapterEntry[] = [
			{ time: 0, label: 'Intro' },
			{ time: 30, label: 'Part 1' },
			{ time: 60, label: 'Part 2' }
		];
		const json = generateChaptersJson(entries);
		const parsed = JSON.parse(json);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toEqual({ time: 0, label: 'Intro' });
		expect(parsed[1]).toEqual({ time: 30, label: 'Part 1' });
		expect(parsed[2]).toEqual({ time: 60, label: 'Part 2' });
	});
});
