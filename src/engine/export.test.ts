import { describe, expect, it, vi } from 'vitest';
import type { ThroughputProbe } from '../protocol';
import {
  buildExportPlan,
  deriveExportSize,
  estimateEtaSeconds,
  mixAudioWindow,
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

describe('export planning', () => {
  it('caps export size at 1080p and keeps even dimensions', () => {
    expect(deriveExportSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(deriveExportSize(1919, 1079)).toEqual({ width: 1920, height: 1080 });
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
});

describe('mixAudioWindow', () => {
  it('mixes only soloed audio tracks and applies gain', async () => {
    const a = {
      pcmWindowAt: vi.fn(async (_time: number, frames: number, channels: number) =>
        new Float32Array(frames * channels).fill(1),
      ),
    };
    const b = {
      pcmWindowAt: vi.fn(async (_time: number, frames: number, channels: number) =>
        new Float32Array(frames * channels).fill(0.25),
      ),
    };
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
});
