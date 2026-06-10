import { describe, expect, it } from 'vitest';
import { serializeTimelineToEdl, validateCmx3600Document } from './edl';
import { buildMissingSourceFixtureDoc, buildMultiTrackFixtureDoc } from './fixture-docs';

const OPTIONS = { displayName: 'Fixture Project' };

describe('serializeTimelineToEdl', () => {
	it('emits a valid cuts-only CMX3600 list for the first video track', () => {
		const { text, warnings } = serializeTimelineToEdl(buildMultiTrackFixtureDoc(), OPTIONS);
		expect(validateCmx3600Document(text, 30)).toEqual([]);
		const lines = text.trimEnd().split('\n');
		expect(lines[0]).toBe('TITLE: FIXTURE PROJECT');
		expect(lines[1]).toBe('FCM: NON-DROP FRAME');
		// clip-1: src 1s..5s, record 1h..1h+4s.
		expect(lines[2]).toBe(
			'001  BEACH    V     C        00:00:01:00 00:00:05:00 01:00:00:00 01:00:04:00'
		);
		expect(lines[3]).toBe('* FROM CLIP NAME: beach.mp4');
		expect(lines[4]).toBe(
			'002  DUNES    V     C        00:00:00:15 00:00:03:15 01:00:04:00 01:00:07:00'
		);
		// Other populated tracks and the V1 dissolve are reported, not silent.
		expect(warnings.some((warning) => warning.includes('single-track'))).toBe(true);
		expect(warnings.some((warning) => warning.includes('cuts-only'))).toBe(true);
	});

	it('exports an explicit video track by id', () => {
		const { text } = serializeTimelineToEdl(buildMultiTrackFixtureDoc(), {
			...OPTIONS,
			trackId: 'track-v2'
		});
		expect(validateCmx3600Document(text, 30)).toEqual([]);
		expect(text).toContain('AX       V');
		expect(text).toContain('* FROM CLIP NAME: Title: Opening');
		// The gap before the title advances record TC without an event.
		expect(text).toContain('01:00:02:00 01:00:05:00');
	});

	it('refuses non-video tracks with a warning', () => {
		const { text, warnings } = serializeTimelineToEdl(buildMultiTrackFixtureDoc(), {
			...OPTIONS,
			trackId: 'track-a1'
		});
		expect(warnings.some((warning) => warning.includes('not a video track'))).toBe(true);
		expect(text).not.toMatch(/^\d{3} {2}/m);
	});

	it('notes fractional-rate rounding and stays valid at the rounded rate', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.exportSettings = {
			preset: 'quality',
			codec: 'h264',
			container: 'mp4',
			width: 1920,
			height: 1080,
			fps: 29.97,
			videoBitrate: 8_000_000
		};
		const { text } = serializeTimelineToEdl(doc, OPTIONS);
		expect(text).toContain('* LOCALCUT: RATE 29.97 ROUNDED TO 30 NDF');
		expect(validateCmx3600Document(text, 30)).toEqual([]);
	});

	it('skips zero-frame clips with a warning', () => {
		const { text, warnings } = serializeTimelineToEdl(buildMissingSourceFixtureDoc(), OPTIONS);
		expect(validateCmx3600Document(text, 30)).toEqual([]);
		expect(warnings.some((warning) => warning.includes('zero frames'))).toBe(true);
		// clip-tiny is skipped: events 001 and 002 only.
		expect(text).not.toContain('003  ');
	});
});

describe('reel naming', () => {
	it('deduplicates colliding stems within the 8-character limit', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.sources[0]!.fileName = 'beachholiday_a.mp4';
		doc.sources[1]!.fileName = 'beachholiday_b.mp4';
		const { text } = serializeTimelineToEdl(doc, OPTIONS);
		expect(text).toContain('001  BEACHHOL V');
		expect(text).toContain('002  BEACHHO2 V');
		expect(validateCmx3600Document(text, 30)).toEqual([]);
	});

	it('falls back to REEL for non-alphanumeric file names', () => {
		const doc = buildMultiTrackFixtureDoc();
		doc.sources[0]!.fileName = '视频.mp4';
		const { text } = serializeTimelineToEdl(doc, OPTIONS);
		expect(text).toContain('001  REEL     V');
		expect(text).toContain('* FROM CLIP NAME: 视频.mp4');
		expect(validateCmx3600Document(text, 30)).toEqual([]);
	});

	it('reuses the same reel for repeated clips from one source', () => {
		const doc = buildMultiTrackFixtureDoc();
		const track = doc.timeline[0]!;
		track.clips = [
			{ ...track.clips[0]!, id: 'clip-x', start: 0, duration: 2 },
			{ ...track.clips[0]!, id: 'clip-y', start: 2, duration: 2 }
		];
		const { text } = serializeTimelineToEdl(doc, OPTIONS);
		const reels = [...text.matchAll(/^\d{3} {2}(\S+)/gm)].map((match) => match[1]);
		expect(reels).toEqual(['BEACH', 'BEACH']);
	});
});

describe('validateCmx3600Document', () => {
	it('rejects malformed event lines', () => {
		const text = 'TITLE: X\nFCM: NON-DROP FRAME\n001 BAD LINE\n';
		expect(validateCmx3600Document(text, 30)).not.toEqual([]);
	});

	it('rejects out-of-sequence event numbers', () => {
		const good = serializeTimelineToEdl(buildMultiTrackFixtureDoc(), OPTIONS).text;
		const broken = good.replace('002  ', '004  ');
		expect(
			validateCmx3600Document(broken, 30).some((issue) => issue.includes('out of sequence'))
		).toBe(true);
	});

	it('rejects frame fields at or above fps', () => {
		const text = [
			'TITLE: X',
			'FCM: NON-DROP FRAME',
			'001  REEL     V     C        00:00:00:29 00:00:01:29 01:00:00:00 01:00:01:00',
			''
		].join('\n');
		expect(validateCmx3600Document(text, 24).some((issue) => issue.includes('exceeds'))).toBe(true);
	});

	it('rejects mismatched source and record durations', () => {
		const text = [
			'TITLE: X',
			'FCM: NON-DROP FRAME',
			'001  REEL     V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:01:00',
			''
		].join('\n');
		expect(
			validateCmx3600Document(text, 30).some((issue) => issue.includes('durations differ'))
		).toBe(true);
	});
});
