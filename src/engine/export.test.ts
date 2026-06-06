import { describe, expect, it, vi } from 'vitest';
import type { ThroughputProbe } from '../protocol';
import {
  buildExportPlan,
  deriveExportSize,
  estimateEtaSeconds,
  mixAudioWindow,
  videoBitrateForPreset,
} from './export';
import { DEFAULT_TRACK_MIX, defaultTimelineClip, type Timeline, type TimelineTrack } from './timeline';
import type { MediaInputHandle } from './media-io';

function audioTrack(
  partial: Partial<Omit<TimelineTrack, 'type' | 'clips'>> & {
    id: string;
    clips: TimelineTrack['clips'];
  },
): TimelineTrack {
  return { type: 'audio', ...DEFAULT_TRACK_MIX, ...partial };
}

function mediaHandle(partial: Partial<MediaInputHandle>): MediaInputHandle {
  return {
    sourceId: 'src',
    metadata: {
      fileName: 'clip.mp4',
      duration: 10,
      mimeType: 'video/mp4',
      video: null,
      audio: null,
      trackCount: 1,
    },
    frameSource: null,
    audioSource: null,
    audioChannels: 2,
    audioSampleRate: 48_000,
    displayWidth: 1920,
    displayHeight: 1080,
    frameRate: 30,
    duration: 10,
    dispose: vi.fn(),
    ...partial,
  };
}

function timeline(): Timeline {
  return [
    {
      id: 'v1',
      type: 'video',
      ...DEFAULT_TRACK_MIX,
      clips: [
        defaultTimelineClip({
          id: 'clip-v',
          sourceId: 'video',
          start: 0,
          duration: 5,
          inPoint: 0,
        }),
      ],
    },
  ];
}

describe('export planning', () => {
  it('caps export size at 1080p and keeps even dimensions', () => {
    expect(deriveExportSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(deriveExportSize(1919, 1079)).toEqual({ width: 1918, height: 1078 });
  });

  it('builds a preset-aware plan from the first decodable video source', () => {
    const sources = new Map<string, MediaInputHandle>([
      [
        'video',
        mediaHandle({
          sourceId: 'video',
          frameSource: {} as MediaInputHandle['frameSource'],
          displayWidth: 3840,
          displayHeight: 2160,
          frameRate: 24,
        }),
      ],
    ]);

    const probe: ThroughputProbe = { codec: 'avc1.42001f', encodeFps: 60, width: 1280, height: 720 };
    const plan = buildExportPlan(timeline(), sources, 'quality', probe);

    expect(plan).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 24,
      totalFrames: 120,
      hasAudio: false,
      subRealtime: false,
    });
    expect(plan.videoBitrate).toBe(videoBitrateForPreset('quality', 1920, 1080));
  });

  it('derives ETA from the throughput probe and preset factor', () => {
    const probe: ThroughputProbe = { codec: 'avc1.42001f', encodeFps: 50, width: 1280, height: 720 };

    expect(estimateEtaSeconds(100, 20, probe, 'quality')).toBeCloseTo(2);
    expect(estimateEtaSeconds(100, 20, probe, 'fast')).toBeCloseTo(1.28);
    expect(estimateEtaSeconds(100, 20, null, 'quality')).toBeNull();
  });

  it('rejects mixed audible audio sample rates before encoding starts', () => {
    const sources = new Map<string, MediaInputHandle>([
      [
        'video',
        mediaHandle({ sourceId: 'video', frameSource: {} as MediaInputHandle['frameSource'] }),
      ],
      [
        'a',
        mediaHandle({
          sourceId: 'a',
          audioSource: {} as MediaInputHandle['audioSource'],
          audioSampleRate: 48_000,
        }),
      ],
      [
        'b',
        mediaHandle({
          sourceId: 'b',
          audioSource: {} as MediaInputHandle['audioSource'],
          audioSampleRate: 44_100,
        }),
      ],
    ]);
    const edit: Timeline = [
      ...timeline(),
      audioTrack({
        id: 'a-track',
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0 })],
      }),
      audioTrack({
        id: 'b-track',
        clips: [defaultTimelineClip({ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    expect(() => buildExportPlan(edit, sources, 'quality', null)).toThrow(
      'Audio source "b" has sample rate 44100 Hz but export target is 48000 Hz. Resampling is not supported.',
    );
  });
});

describe('mixAudioWindow', () => {
  function sourceWith(value: number) {
    return {
      pcmWindowAt: vi.fn(async (_time: number, frames: number, channels: number) =>
        new Float32Array(frames * channels).fill(value),
      ),
    };
  }

  it('mixes only soloed audio tracks and applies gain', async () => {
    const a = sourceWith(1);
    const b = sourceWith(0.25);
    const sources = new Map<string, MediaInputHandle>([
      ['a', mediaHandle({ sourceId: 'a', audioSource: a as unknown as MediaInputHandle['audioSource'] })],
      ['b', mediaHandle({ sourceId: 'b', audioSource: b as unknown as MediaInputHandle['audioSource'] })],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        gain: 0.5,
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0 })],
      }),
      audioTrack({
        id: 'b-track',
        gain: 2,
        solo: true,
        clips: [defaultTimelineClip({ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 4, 4, 1);

    expect([...mixed]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(a.pcmWindowAt).not.toHaveBeenCalled();
    expect(b.pcmWindowAt).toHaveBeenCalledWith(0, 4, 1);
  });

  it('skips muted tracks', async () => {
    const muted = sourceWith(1);
    const sources = new Map<string, MediaInputHandle>([
      ['muted', mediaHandle({ sourceId: 'muted', audioSource: muted as unknown as MediaInputHandle['audioSource'] })],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'muted-track',
        muted: true,
        clips: [defaultTimelineClip({ id: 'muted', sourceId: 'muted', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 4, 4, 1);

    expect([...mixed]).toEqual([0, 0, 0, 0]);
    expect(muted.pcmWindowAt).not.toHaveBeenCalled();
  });

  it('sums non-soloed tracks with gain', async () => {
    const a = sourceWith(0.25);
    const b = sourceWith(0.5);
    const sources = new Map<string, MediaInputHandle>([
      ['a', mediaHandle({ sourceId: 'a', audioSource: a as unknown as MediaInputHandle['audioSource'] })],
      ['b', mediaHandle({ sourceId: 'b', audioSource: b as unknown as MediaInputHandle['audioSource'] })],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        gain: 2,
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0 })],
      }),
      audioTrack({
        id: 'b-track',
        gain: 0.5,
        clips: [defaultTimelineClip({ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 2, 4, 1);

    expect([...mixed]).toEqual([0.75, 0.75]);
  });

  it('leaves timeline gaps silent', async () => {
    const source = sourceWith(0.5);
    const sources = new Map<string, MediaInputHandle>([
      ['a', mediaHandle({ sourceId: 'a', audioSource: source as unknown as MediaInputHandle['audioSource'] })],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0.5, duration: 0.5, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 4, 4, 1);

    expect([...mixed]).toEqual([0, 0, 0.5, 0.5]);
    expect(source.pcmWindowAt).toHaveBeenCalledWith(0, 2, 1);
  });

  it('clamps mixed audio to the valid sample range', async () => {
    const a = sourceWith(0.8);
    const b = sourceWith(0.8);
    const sources = new Map<string, MediaInputHandle>([
      ['a', mediaHandle({ sourceId: 'a', audioSource: a as unknown as MediaInputHandle['audioSource'] })],
      ['b', mediaHandle({ sourceId: 'b', audioSource: b as unknown as MediaInputHandle['audioSource'] })],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0 })],
      }),
      audioTrack({
        id: 'b-track',
        clips: [defaultTimelineClip({ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 2, 4, 1);

    expect([...mixed]).toEqual([1, 1]);
  });
});
