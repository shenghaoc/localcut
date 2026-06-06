import { describe, expect, it, vi } from 'vitest';
import type { ExportSettings, ThroughputProbe } from '../protocol';
import {
  buildExportPlan,
  defaultExportSettings,
  deriveExportSize,
  estimateEtaSeconds,
  exportFrameBounds,
  mixAudioWindow,
  normalizeExportSettings,
  probeExportCodecs,
  rebaseOutputTimestamp,
  resolveExportRange,
  timelineTimeAt,
  videoBitrateForPreset,
} from './export';
import {
  DEFAULT_TRACK_MIX,
  defaultTimelineClip,
  defaultTitleClip,
  type Timeline,
  type TimelineTrack,
} from './timeline';
import type { MediaInputHandle } from './media-io';
import { defaultNormalizedSourceTiming } from './media-adapters/source-timing';

function audioTrack(
  partial: Partial<Omit<TimelineTrack, 'type' | 'clips'>> & {
    id: string;
    clips: TimelineTrack['clips'];
  },
): TimelineTrack {
  return { type: 'audio', ...DEFAULT_TRACK_MIX, ...partial };
}

function mediaHandle(partial: Partial<MediaInputHandle>): MediaInputHandle {
  const duration = partial.duration ?? 10;
  const timing = partial.timing ?? defaultNormalizedSourceTiming(duration, partial.audioSource ? 'audio' : 'video');
  const base: MediaInputHandle = {
    sourceId: 'src',
    kind: 'video',
    adapterId: 'mediabunny',
    metadata: {
      fileName: 'clip.mp4',
      duration,
      mimeType: 'video/mp4',
      video: null,
      audio: null,
      trackCount: 1,
    },
    inspection: {
      sourceId: 'src',
      adapterId: 'mediabunny',
      fileName: 'clip.mp4',
      byteSize: 1,
      mimeType: 'video/mp4',
      container: 'mp4',
      durationS: duration,
      tracks: [],
    },
    conformance: {
      sourceId: 'src',
      adapterId: 'mediabunny',
      kind: 'video',
      durationS: duration,
      timing,
      health: 'ok',
    },
    timing,
    warnings: [],
    frameSource: null,
    audioSource: null,
    audioChannels: 2,
    audioSampleRate: 48_000,
    displayWidth: 1920,
    displayHeight: 1080,
    frameRate: 30,
    duration,
    thumbnailAt: vi.fn(async () => null),
    dispose: vi.fn(),
  };
  return {
    ...base,
    ...partial,
    adapterId: partial.adapterId ?? base.adapterId,
    inspection: partial.inspection ?? base.inspection,
    conformance: partial.conformance ?? base.conformance,
    timing: partial.timing ?? base.timing,
    warnings: partial.warnings ?? base.warnings,
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

function qualitySettings(overrides: Partial<ExportSettings> = {}): ExportSettings {
  return {
    ...defaultExportSettings('quality', 1920, 1080, 30, 5),
    ...overrides,
  };
}

describe('export planning', () => {
  it('caps export size at 1080p and keeps even dimensions', () => {
    expect(deriveExportSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(deriveExportSize(1919, 1079)).toEqual({ width: 1918, height: 1078 });
  });

  it('honours explicit width and height overrides', () => {
    expect(deriveExportSize(3840, 2160, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('builds a settings-aware plan from the first decodable video source', () => {
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
    const plan = buildExportPlan(timeline(), sources, qualitySettings({ fps: 24 }), probe);

    expect(plan).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 24,
      totalFrames: 120,
      hasAudio: false,
      subRealtime: false,
      codec: 'h264',
      container: 'mp4',
    });
    expect(plan.videoBitrate).toBe(videoBitrateForPreset('quality', 1920, 1080));
  });

  it('keeps original-source export mode implicit when normalizing settings', () => {
    expect(
      normalizeExportSettings(
        qualitySettings({ sourceMode: 'original' }),
        1920,
        1080,
        30,
        5,
      ).sourceMode,
    ).toBeUndefined();
    expect(
      normalizeExportSettings(
        qualitySettings({ sourceMode: 'proxy' }),
        1920,
        1080,
        30,
        5,
      ).sourceMode,
    ).toBe('proxy');
  });

  it('rejects proxy export until proxy source routing is implemented', () => {
    const sources = new Map<string, MediaInputHandle>([
      [
        'video',
        mediaHandle({
          sourceId: 'video',
          frameSource: {} as MediaInputHandle['frameSource'],
        }),
      ],
    ]);

    expect(() => buildExportPlan(timeline(), sources, qualitySettings({ sourceMode: 'proxy' }), null)).toThrow(
      'Proxy export is not available until proxy source routing is implemented.',
    );
  });

  it('plans a title-only export (no decodable video) over the default canvas', () => {
    const titleTimeline: Timeline = [
      {
        id: 'v1',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [defaultTitleClip({ id: 'clip-title-1', start: 0, duration: 4 })],
      },
    ];
    const plan = buildExportPlan(titleTimeline, new Map(), qualitySettings(), null);
    expect(plan).toMatchObject({ width: 1920, height: 1080, frameRate: 30, hasAudio: false });
  });

  it('clamps range export and re-bases output timestamps', () => {
    const sources = new Map<string, MediaInputHandle>([
      [
        'video',
        mediaHandle({
          sourceId: 'video',
          frameSource: {} as MediaInputHandle['frameSource'],
          frameRate: 30,
        }),
      ],
    ]);
    const edit: Timeline = [
      {
        id: 'v1',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          defaultTimelineClip({
            id: 'clip-v',
            sourceId: 'video',
            start: 0,
            duration: 20,
            inPoint: 0,
          }),
        ],
      },
    ];

    const plan = buildExportPlan(
      edit,
      sources,
      qualitySettings({ range: { startS: 5, endS: 10 } }),
      null,
    );

    expect(resolveExportRange(20, { startS: 5, endS: 10 })).toEqual({
      rangeStartS: 5,
      exportDuration: 5,
    });
    expect(exportFrameBounds(plan.exportDuration, plan.frameRate)).toEqual({
      totalFrames: 150,
      startFrame: 0,
      endFrame: 150,
    });
    expect(rebaseOutputTimestamp(0, plan.frameRate)).toBe(0);
    expect(timelineTimeAt(plan, rebaseOutputTimestamp(30, plan.frameRate))).toBe(6);
  });

  it('derives ETA from the throughput probe, preset factor, and codec factor', () => {
    const probe: ThroughputProbe = { codec: 'avc1.42001f', encodeFps: 50, width: 1280, height: 720 };

    expect(estimateEtaSeconds(100, 20, probe, 'quality', 'h264')).toBeCloseTo(2);
    expect(estimateEtaSeconds(100, 20, probe, 'fast', 'h264')).toBeCloseTo(1.28);
    expect(estimateEtaSeconds(100, 20, probe, 'quality', 'vp9')).toBeCloseTo(2 / 0.72);
    expect(estimateEtaSeconds(100, 20, null, 'quality', 'h264')).toBeNull();
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

    expect(() => buildExportPlan(edit, sources, qualitySettings(), null)).toThrow(
      'Audio source "b" has sample rate 44100 Hz but export target is 48000 Hz. Resampling is not supported.',
    );
  });

  it('ignores out-of-range audio when validating sample rates for a sub-range export', () => {
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
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 2, inPoint: 0 })],
      }),
      audioTrack({
        id: 'b-track',
        clips: [defaultTimelineClip({ id: 'b', sourceId: 'b', start: 3, duration: 2, inPoint: 0 })],
      }),
    ];

    const plan = buildExportPlan(
      edit,
      sources,
      qualitySettings({ range: { startS: 0, endS: 2 } }),
      null,
    );

    expect(plan.hasAudio).toBe(true);
    expect(plan.audioSampleRate).toBe(48_000);
    expect(plan.totalFrames).toBe(60);
  });
});

describe('codec probing', () => {
  it('filters supported codec/container pairs from mocked probe results', async () => {
    const supported = await probeExportCodecs(1280, 720, 30, 5_000_000, async (config) => ({
      supported: config.codec === 'avc1.640028' || config.codec === 'vp09.00.10.08',
      config,
    }));

    expect(supported).toEqual([
      { codec: 'h264', container: 'mp4' },
      { codec: 'vp9', container: 'webm' },
    ]);
    const candidates = [
      { codec: 'h264' as const, container: 'mp4' as const },
      { codec: 'vp9' as const, container: 'webm' as const },
      { codec: 'av1' as const, container: 'webm' as const },
    ];
    const probed = new Set(['h264:mp4', 'av1:webm']);
    expect(candidates.filter((entry) => probed.has(`${entry.codec}:${entry.container}`))).toEqual([
      { codec: 'h264', container: 'mp4' },
      { codec: 'av1', container: 'webm' },
    ]);
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

  it('leaves audio silent until a non-zero source track start becomes available', async () => {
    const source = sourceWith(0.5);
    const timing = {
      normalizedStartS: 0,
      durationS: 1,
      video: { trackId: 'video-1', firstTimestampS: 0, lastTimestampS: 1, durationS: 1 },
      audio: { trackId: 'audio-1', firstTimestampS: 0.5, lastTimestampS: 1, durationS: 0.5 },
      avOffsetS: 0.5,
      frameRateMode: 'constant' as const,
    };
    const sources = new Map<string, MediaInputHandle>([
      [
        'a',
        mediaHandle({
          sourceId: 'a',
          audioSource: source as unknown as MediaInputHandle['audioSource'],
          timing,
        }),
      ],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        clips: [defaultTimelineClip({ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0 })],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 4, 4, 1);

    expect([...mixed]).toEqual([0, 0, 0.5, 0.5]);
    expect(source.pcmWindowAt).toHaveBeenCalledWith(0.5, 2, 1);
  });

  it('splits transition audio when an incoming track becomes available mid-window', async () => {
    const outgoing = sourceWith(0);
    const incoming = sourceWith(1);
    const incomingTiming = {
      normalizedStartS: 0,
      durationS: 1,
      audio: { trackId: 'audio-1', firstTimestampS: 0.25, lastTimestampS: 1, durationS: 0.75 },
      avOffsetS: 0,
      frameRateMode: 'constant' as const,
    };
    const sources = new Map<string, MediaInputHandle>([
      ['out', mediaHandle({ sourceId: 'out', audioSource: outgoing as unknown as MediaInputHandle['audioSource'] })],
      [
        'in',
        mediaHandle({
          sourceId: 'in',
          audioSource: incoming as unknown as MediaInputHandle['audioSource'],
          timing: incomingTiming,
        }),
      ],
    ]);
    const edit: Timeline = [
      audioTrack({
        id: 'a-track',
        clips: [
          defaultTimelineClip({ id: 'out', sourceId: 'out', start: 0, duration: 1, inPoint: 0 }),
          defaultTimelineClip({ id: 'in', sourceId: 'in', start: 1, duration: 1, inPoint: 0.5 }),
        ],
      }),
    ];

    const mixed = await mixAudioWindow(edit, sources, 0.5, 4, 4, 1, {
      transitions: [{ trackId: 'a-track', fromClipId: 'out', toClipId: 'in', durationS: 1 }],
    });

    expect(mixed[0]).toBe(0);
    expect(mixed[1]!).toBeGreaterThan(0);
    expect(mixed[2]!).toBeGreaterThan(mixed[1]!);
    expect(mixed[3]!).toBeGreaterThan(mixed[2]!);
    expect(incoming.pcmWindowAt).toHaveBeenCalledWith(0.25, 3, 1);
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
