import { describe, expect, it } from 'vitest';
import { exportCaptionSidecars } from './captions/export';
import {
  buildCaptionSnapTargets,
  makeCaptionSegmentId,
  mergeCaptionSegments,
  setCaptionSegmentTiming,
  snapCaptionTime,
  splitCaptionSegment,
} from './captions/model';
import { parseSrt, serializeSrt } from './captions/srt';
import { parseWebVtt, serializeWebVtt } from './captions/webvtt';
import { createCaptionTrack } from './captions/types';

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
      segments: [{ id: 'a', start: 1, duration: 3, text: 'Hello' }],
    });
    const files = exportCaptionSidecars(track, {
      trackId: 'captions-1',
      formats: ['srt'],
      range: { mode: 'timeline-range', startS: 2, endS: 3.5 },
      fileStem: 'trimmed',
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
  it('splits, retimes, snaps, merges, and exports sidecars', () => {
    const firstId = makeCaptionSegmentId();
    const secondId = makeCaptionSegmentId();
    let tracks = [
      createCaptionTrack({
        id: 'captions-1',
        segments: [
          { id: firstId, start: 1, duration: 3, text: 'Hello there general kenobi' },
          { id: secondId, start: 5, duration: 2, text: 'Bye now' },
        ],
        burnedIn: true,
      }),
    ];

    tracks = splitCaptionSegment(tracks, 'captions-1', firstId, 2.5);
    expect(tracks[0]!.segments).toHaveLength(3);

    const middle = tracks[0]!.segments[1]!;
    tracks = setCaptionSegmentTiming(tracks, 'captions-1', middle.id, 4.02, 5.2);
    const targets = buildCaptionSnapTargets(
      [{ id: 'video-1', type: 'video', clips: [{ id: 'clip-1', sourceId: 's', start: 4, duration: 2, inPoint: 0, effects: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, temperatureStrength: 0, lutStrength: 0 }, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, fit: 'fill' }, audioFadeIn: 0, audioFadeOut: 0 }], gain: 1, pan: 0, muted: false, solo: false, locked: false, visible: true, syncLocked: false, editTarget: true }],
      [{ id: 'm1', time: 6, label: 'M1' }],
      tracks,
      4,
      'captions-1',
      [middle.id],
    );
    expect(snapCaptionTime(4.05, targets, 0.1)).toBe(4);

    const segmentIds = tracks[0]!.segments.slice(0, 2).map((segment) => segment.id);
    tracks = mergeCaptionSegments(tracks, 'captions-1', segmentIds);
    expect(tracks[0]!.segments.length).toBe(2);

    const files = exportCaptionSidecars(tracks[0]!, {
      trackId: 'captions-1',
      formats: ['srt', 'webvtt'],
      range: { mode: 'timeline-range', startS: 1, endS: 7 },
      fileStem: 'demo',
    });
    expect(files.map((file) => file.fileName)).toEqual(['demo.srt', 'demo.vtt']);
    expect(files[0]!.content).toContain('00:00:00,000');
  });

  it('does not duplicate single-word captions on split', () => {
    const id = makeCaptionSegmentId();
    const tracks = [
      createCaptionTrack({
        id: 'captions-1',
        segments: [{ id, start: 1, duration: 2, text: 'Hello' }],
      }),
    ];
    const split = splitCaptionSegment(tracks, 'captions-1', id, 2);
    expect(split[0]!.segments[0]!.text).toBe('Hello');
    expect(split[0]!.segments[1]!.text).toBe('');
  });
});
