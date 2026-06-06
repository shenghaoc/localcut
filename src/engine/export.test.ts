import { describe, expect, it, vi } from 'vitest';
import type { ExportSettings, ThroughputProbe } from '../protocol';
import {
  buildExportPlan,
  defaultExportSettings,
  deriveExportSize,
  estimateEtaSeconds,
  exportFrameBounds,
  filterSupportedCodecs,
  mixAudioWindow,
  probeExportCodecs,
  rebaseOutputTimestamp,
  resolveExportRange,
  timelineTimeAt,
  videoBitrateForPreset,
} from './export';
import { defaultClipEffects, type Timeline } from './timeline';
import type { MediaInputHandle } from './media-io';

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
      gain: 1,
      muted: false,
      solo: false,
      clips: [
        {
          id: 'clip-v',
          sourceId: 'video',
          start: 0,
          duration: 5,
          inPoint: 0,
          effects: defaultClipEffects(),
        },
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
        gain: 1,
        muted: false,
        solo: false,
        clips: [
          {
            id: 'clip-v',
            sourceId: 'video',
            start: 0,
            duration: 20,
            inPoint: 0,
            effects: defaultClipEffects(),
          },
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
      {
        id: 'a-track',
        type: 'audio',
        gain: 1,
        muted: false,
        solo: false,
        clips: [{ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
      {
        id: 'b-track',
        type: 'audio',
        gain: 1,
        muted: false,
        solo: false,
        clips: [{ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
    ];

    expect(() => buildExportPlan(edit, sources, qualitySettings(), null)).toThrow(
      'Audio source "b" has sample rate 44100 Hz but export target is 48000 Hz. Resampling is not supported.',
    );
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
    expect(
      filterSupportedCodecs(
        [
          { codec: 'h264', container: 'mp4' },
          { codec: 'vp9', container: 'webm' },
          { codec: 'av1', container: 'webm' },
        ],
        new Set(['h264:mp4', 'av1:webm']),
      ),
    ).toEqual([
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
      {
        id: 'a-track',
        type: 'audio',
        gain: 0.5,
        muted: false,
        solo: false,
        clips: [{ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
      {
        id: 'b-track',
        type: 'audio',
        gain: 2,
        muted: false,
        solo: true,
        clips: [{ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
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
      {
        id: 'muted-track',
        type: 'audio',
        gain: 1,
        muted: true,
        solo: false,
        clips: [{ id: 'muted', sourceId: 'muted', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
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
      {
        id: 'a-track',
        type: 'audio',
        gain: 2,
        muted: false,
        solo: false,
        clips: [{ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
      {
        id: 'b-track',
        type: 'audio',
        gain: 0.5,
        muted: false,
        solo: false,
        clips: [{ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
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
      {
        id: 'a-track',
        type: 'audio',
        gain: 1,
        muted: false,
        solo: false,
        clips: [{ id: 'a', sourceId: 'a', start: 0.5, duration: 0.5, inPoint: 0, effects: defaultClipEffects() }],
      },
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
      {
        id: 'a-track',
        type: 'audio',
        gain: 1,
        muted: false,
        solo: false,
        clips: [{ id: 'a', sourceId: 'a', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
      {
        id: 'b-track',
        type: 'audio',
        gain: 1,
        muted: false,
        solo: false,
        clips: [{ id: 'b', sourceId: 'b', start: 0, duration: 1, inPoint: 0, effects: defaultClipEffects() }],
      },
    ];

    const mixed = await mixAudioWindow(edit, sources, 0, 2, 4, 1);

    expect([...mixed]).toEqual([1, 1]);
  });
});
