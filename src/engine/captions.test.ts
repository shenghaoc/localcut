import { describe, expect, it } from 'vite-plus/test';
import { exportCaptionSidecars } from './captions/export';
import {
	buildCaptionSnapTargets,
	deleteCaptionTrack,
	deleteCaptionTracks,
	makeCaptionSegmentId,
	mergeCaptionSegments,
	setCaptionSegmentStyle,
	setCaptionSegmentTiming,
	setCaptionTrackProps,
	snapCaptionTime,
	splitCaptionSegment
} from './captions/model';
import { parseSrt, serializeSrt } from './captions/srt';
import { parseWebVtt, serializeWebVtt } from './captions/webvtt';
import {
	DEFAULT_CAPTION_STYLE,
	captionAnchorTransform,
	createCaptionTrack
} from './captions/types';

describe('caption SRT parse/serialize', () => {
	it('round-trips multiline cues', () => {
		const input = `1\n00:00:01,000 --> 00:00:03,000\nHello world\nSecond line\n\n2\n00:00:04,000 --> 00:00:05,500\nBye`;
		const parsed = parseSrt(input);
		expect(parsed.segments).toHaveLength(2);
		expect(parsed.segments[0]!.text).toBe('Hello world\nSecond line');
		expect(serializeSrt(parsed.segments)).toContain('00:00:01,000 --> 00:00:03,000');
	});

	it('recovers malformed cues', () => {
		const input = `bad\n00:00:01,000 --> 00:00:03,000\nok\n\n2\n00:00:04,000 --> bad\nbroken`;
		const parsed = parseSrt(input);
		expect(parsed.segments).toHaveLength(1);
		expect(parsed.diagnostics.length).toBeGreaterThan(0);
	});

	it('trims overlapping cues to the requested export range', () => {
		const track = createCaptionTrack({
			id: 'captions-1',
			segments: [{ id: 'a', start: 1, duration: 3, text: 'Hello' }]
		});
		const files = exportCaptionSidecars(track, {
			trackId: 'captions-1',
			formats: ['srt'],
			range: { mode: 'timeline-range', startS: 2, endS: 3.5 },
			fileStem: 'trimmed'
		});
		expect(files[0]!.content).toContain('00:00:00,000 --> 00:00:01,500');
	});
});

describe('caption WebVTT parse/serialize', () => {
	it('round-trips cues', () => {
		const input = `WEBVTT\n\nintro\n00:00:01.000 --> 00:00:03.000 align:center\nHello\n\n00:00:04.000 --> 00:00:05.500\nBye`;
		const parsed = parseWebVtt(input);
		expect(parsed.segments).toHaveLength(2);
		expect(parsed.diagnostics.some((item) => item.code === 'unsupported-setting')).toBe(true);
		expect(serializeWebVtt(parsed.segments)).toContain('WEBVTT');
	});

	it('skips NOTE and STYLE blocks', () => {
		const input = `WEBVTT\n\nNOTE this is metadata\nignore me\n\nSTYLE\n::cue { color: red; }\n\n00:00:01.000 --> 00:00:02.000\nHello`;
		const parsed = parseWebVtt(input);
		expect(parsed.segments).toHaveLength(1);
		expect(parsed.segments[0]!.text).toBe('Hello');
		expect(parsed.diagnostics.some((item) => item.code === 'invalid-timecode')).toBe(false);
	});
});

describe('caption editing and export', () => {
	it('places default subtitle rasters inside the preview frame', () => {
		const transform = captionAnchorTransform(DEFAULT_CAPTION_STYLE);

		expect(transform.anchorX).toBe(0.5);
		expect(transform.anchorY).toBe(0.5);
		expect(transform.fit).toBe('fit');
		expect(0.5 + transform.x).toBeCloseTo(0.5);
		expect(0.5 + transform.y).toBeCloseTo(1 - 56 / 540);
	});

	it('places top captions using transform offsets instead of screen coordinates', () => {
		const transform = captionAnchorTransform({
			...DEFAULT_CAPTION_STYLE,
			anchor: 'top-center'
		});

		expect(transform.anchorX).toBe(0.5);
		expect(transform.anchorY).toBe(0.5);
		expect(0.5 + transform.y).toBeCloseTo(56 / 540);
	});

	it('deletes caption tracks without mutating the original list', () => {
		const tracks = [
			createCaptionTrack({ id: 'captions-1', name: 'Older ASR' }),
			createCaptionTrack({ id: 'captions-2', name: 'Latest ASR' })
		];

		const next = deleteCaptionTrack(tracks, 'captions-1');

		expect(next.map((track) => track.id)).toEqual(['captions-2']);
		expect(tracks).toHaveLength(2);
	});

	it('deletes multiple caption tracks in one mutation', () => {
		const tracks = [
			createCaptionTrack({ id: 'captions-1', name: 'Older ASR' }),
			createCaptionTrack({ id: 'captions-2', name: 'Also older ASR' }),
			createCaptionTrack({ id: 'captions-3', name: 'Latest ASR' })
		];

		const next = deleteCaptionTracks(tracks, ['captions-1', 'captions-2']);

		expect(next.map((track) => track.id)).toEqual(['captions-3']);
		expect(tracks).toHaveLength(3);
	});

	it('splits, retimes, snaps, merges, and exports sidecars', () => {
		const firstId = makeCaptionSegmentId();
		const secondId = makeCaptionSegmentId();
		let tracks = [
			createCaptionTrack({
				id: 'captions-1',
				segments: [
					{ id: firstId, start: 1, duration: 3, text: 'Hello there general kenobi' },
					{ id: secondId, start: 5, duration: 2, text: 'Bye now' }
				],
				burnedIn: true
			})
		];

		tracks = splitCaptionSegment(tracks, 'captions-1', firstId, 2.5);
		expect(tracks[0]!.segments).toHaveLength(3);

		const middle = tracks[0]!.segments[1]!;
		tracks = setCaptionSegmentTiming(tracks, 'captions-1', middle.id, 4.02, 5.2);
		const targets = buildCaptionSnapTargets(
			[
				{
					id: 'video-1',
					type: 'video',
					clips: [
						{
							id: 'clip-1',
							sourceId: 's',
							start: 4,
							duration: 2,
							inPoint: 0,
							effects: {
								brightness: 0,
								contrast: 1,
								saturation: 1,
								temperature: 6500,
								temperatureStrength: 0,
								lutStrength: 0
							},
							transform: {
								x: 0,
								y: 0,
								scale: 1,
								rotation: 0,
								opacity: 1,
								anchorX: 0,
								anchorY: 0,
								fit: 'fill'
							},
							audioFadeIn: 0,
							audioFadeOut: 0
						}
					],
					gain: 1,
					pan: 0,
					muted: false,
					solo: false,
					locked: false,
					visible: true,
					syncLocked: false,
					editTarget: true
				}
			],
			[{ id: 'm1', time: 6, label: 'M1' }],
			tracks,
			4,
			'captions-1',
			[middle.id]
		);
		expect(snapCaptionTime(4.05, targets, 0.1)).toBe(4);

		const segmentIds = tracks[0]!.segments.slice(0, 2).map((segment) => segment.id);
		tracks = mergeCaptionSegments(tracks, 'captions-1', segmentIds);
		expect(tracks[0]!.segments.length).toBe(2);

		const files = exportCaptionSidecars(tracks[0]!, {
			trackId: 'captions-1',
			formats: ['srt', 'webvtt'],
			range: { mode: 'timeline-range', startS: 1, endS: 7 },
			fileStem: 'demo'
		});
		expect(files.map((file) => file.fileName)).toEqual(['demo.srt', 'demo.vtt']);
		expect(files[0]!.content).toContain('00:00:00,000');
	});

	it('does not duplicate single-word captions on split', () => {
		const id = makeCaptionSegmentId();
		const tracks = [
			createCaptionTrack({
				id: 'captions-1',
				segments: [{ id, start: 1, duration: 2, text: 'Hello' }]
			})
		];
		const split = splitCaptionSegment(tracks, 'captions-1', id, 2);
		expect(split[0]!.segments[0]!.text).toBe('Hello');
		expect(split[0]!.segments[1]!.text).toBe('');
	});

	it('preserves existing segment overrides across separate style edits', () => {
		const id = makeCaptionSegmentId();
		let tracks = [
			createCaptionTrack({
				id: 'captions-1',
				segments: [{ id, start: 0, duration: 2, text: 'Hello' }]
			})
		];

		tracks = setCaptionSegmentStyle(tracks, 'captions-1', id, { overrides: { color: '#ff0000' } });
		tracks = setCaptionSegmentStyle(tracks, 'captions-1', id, {
			overrides: { backgroundColor: '#000000' }
		});

		expect(tracks[0]!.segments[0]!.style?.overrides).toMatchObject({
			color: '#ff0000',
			backgroundColor: '#000000'
		});
	});

	it('applies preset layout defaults, preserves language on unrelated edits, and allows clearing language', () => {
		let tracks = [
			createCaptionTrack({
				id: 'captions-1',
				language: 'en',
				defaultStyle: {
					presetId: 'subtitle',
					anchor: 'custom',
					maxWidthPercent: 90,
					lineWrap: 'balanced'
				}
			})
		];

		tracks = setCaptionTrackProps(tracks, 'captions-1', {
			defaultStyle: { presetId: 'lower-third' }
		});

		expect(tracks[0]!.language).toBe('en');
		expect(tracks[0]!.defaultStyle.anchor).toBe('bottom-left');
		expect(tracks[0]!.defaultStyle.maxWidthPercent).toBe(48);
		expect(tracks[0]!.defaultStyle.lineWrap).toBe('greedy');

		tracks = setCaptionTrackProps(tracks, 'captions-1', {
			language: null
		});

		expect(tracks[0]!.language).toBeNull();
	});

	it('keeps segment color overrides inheriting later track preset layout changes', () => {
		const id = makeCaptionSegmentId();
		let tracks = [
			createCaptionTrack({
				id: 'captions-1',
				defaultStyle: { presetId: 'subtitle' },
				segments: [{ id, start: 0, duration: 2, text: 'Hello' }]
			})
		];

		tracks = setCaptionSegmentStyle(tracks, 'captions-1', id, { overrides: { color: '#00ff00' } });
		tracks = setCaptionTrackProps(tracks, 'captions-1', {
			defaultStyle: { presetId: 'lower-third' }
		});

		expect(tracks[0]!.segments[0]!.style?.anchor).toBeUndefined();
		expect(tracks[0]!.defaultStyle.anchor).toBe('bottom-left');
	});
});
