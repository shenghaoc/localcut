import { describe, expect, it } from 'vite-plus/test';
import { buildMultiTrackFixtureDoc } from './fixture-docs';
import { formatTimecode, interchangeRate, snapToFrames, snappedDurationFrames } from './time';

describe('interchangeRate', () => {
	it('prefers export settings fps', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.exportSettings = {
			preset: 'quality',
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 24,
			videoBitrate: 8_000_000
		};
		expect(interchangeRate(doc)).toBe(24);
	});

	it('falls back to the most common source video frame rate', () => {
		const doc = buildMultiTrackFixtureDoc();
		expect(interchangeRate(doc)).toBe(30);
	});

	it('breaks frame-rate ties toward the higher rate', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.sources[1]!.video!.frameRate = 60;
		expect(interchangeRate(doc)).toBe(60);
	});

	it('falls back to 30 with no video sources', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.sources = [];
		expect(interchangeRate(doc)).toBe(30);
	});
});

describe('snapToFrames adjacency invariant', () => {
	it.each([23.976, 29.97, 30, 60])(
		'keeps clips adjacent in seconds adjacent in frames at %s fps',
		(rate) => {
			// Awkward float boundaries: each clip ends exactly where the next starts.
			const boundaries = [0, 1.2345, 3.000001, 4.999999, 7.7];
			for (let i = 1; i < boundaries.length; i += 1) {
				const prevEnd = snapToFrames(boundaries[i]!, rate);
				const nextStart = snapToFrames(boundaries[i]!, rate);
				expect(nextStart).toBe(prevEnd);
				expect(snappedDurationFrames(boundaries[i - 1]!, boundaries[i]!, rate)).toBe(
					snapToFrames(boundaries[i]!, rate) - snapToFrames(boundaries[i - 1]!, rate)
				);
			}
		}
	);

	it('never produces negative durations', () => {
		expect(snappedDurationFrames(1.0001, 1.0002, 30)).toBe(0);
		expect(snappedDurationFrames(5, 5, 30)).toBe(0);
	});

	it('detects zero-frame collapse for sub-frame clips', () => {
		expect(snappedDurationFrames(2, 2.005, 30)).toBe(0);
	});
});

describe('formatTimecode', () => {
	it('formats frame zero', () => {
		expect(formatTimecode(0, 30)).toBe('00:00:00:00');
	});

	it('formats sub-minute times', () => {
		expect(formatTimecode(30 * 59 + 29, 30)).toBe('00:00:59:29');
	});

	it('rolls over the hour', () => {
		expect(formatTimecode(30 * 3600, 30)).toBe('01:00:00:00');
		expect(formatTimecode(30 * 3600 - 1, 30)).toBe('00:59:59:29');
	});

	it('rejects non-integer frame rates', () => {
		expect(() => formatTimecode(0, 29.97)).toThrow(/integer frame rate/);
	});

	it('rejects non-finite frame counts instead of emitting NaN timecodes', () => {
		expect(() => formatTimecode(Number.NaN, 30)).toThrow(/finite frame count/);
		expect(() => formatTimecode(Number.POSITIVE_INFINITY, 30)).toThrow(/finite frame count/);
	});
});
