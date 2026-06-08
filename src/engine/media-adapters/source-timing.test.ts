import { describe, expect, it } from 'vitest';
import { defaultTimelineClip } from '../timeline';
import {
  audioAvailabilityWindowFrames,
  buildNormalizedSourceTiming,
  resolveNormalizedSourceTimestamp,
  resolveSourceTimestamp,
  unavailableAudioSilenceFrames,
} from './source-timing';
import type { SourceAudioTrackInspection, SourceVideoTrackInspection } from './types';

const videoTrack: SourceVideoTrackInspection = {
  kind: 'video',
  trackId: 'video-1',
  codec: 'avc1.640028',
  canDecode: true,
  startS: 0,
  durationS: 10,
  codedWidth: 1920,
  codedHeight: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  frameRate: 30,
  frameRateMode: 'constant',
  rotationDeg: 0,
  color: { primaries: null, transfer: null, matrix: null, fullRange: null },
};

const audioTrack: SourceAudioTrackInspection = {
  kind: 'audio',
  trackId: 'audio-1',
  codec: 'mp4a.40.2',
  canDecode: true,
  startS: 0,
  durationS: 10,
  sampleRate: 48_000,
  channels: 2,
};

describe('source timestamp normalization', () => {
  it('maps zero-start media without changing existing source timestamps', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 10,
      video: videoTrack,
      audio: audioTrack,
      frameRateMode: 'constant',
    });
    const clip = defaultTimelineClip({ id: 'clip', sourceId: 'src', start: 5, duration: 4, inPoint: 2 });

    expect(resolveSourceTimestamp({ clip, timelineTime: 6.5, trackKind: 'video', timing })).toMatchObject({
      normalizedSourceS: 3.5,
      adapterTimestampS: 3.5,
      available: true,
      fill: 'none',
    });
  });

  it('rebases media whose tracks both start at a non-zero timestamp', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 12,
      video: { ...videoTrack, startS: 10, durationS: 5 },
      audio: { ...audioTrack, startS: 10, durationS: 5 },
      frameRateMode: 'constant',
    });

    expect(resolveNormalizedSourceTimestamp(timing, 'video', 0)).toMatchObject({
      adapterTimestampS: 10,
      available: true,
    });
    expect(timing.durationS).toBe(5);
  });

  it('reports a before-track-start fill for audio/video offsets', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 8,
      video: { ...videoTrack, startS: 0.42, durationS: 7 },
      audio: { ...audioTrack, startS: 0, durationS: 8 },
      frameRateMode: 'constant',
    });

    expect(resolveNormalizedSourceTimestamp(timing, 'video', 0.1)).toMatchObject({
      adapterTimestampS: 0.1,
      available: false,
      fill: 'before-track-start',
    });
    expect(resolveNormalizedSourceTimestamp(timing, 'audio', 0.1)).toMatchObject({
      adapterTimestampS: 0.1,
      available: true,
      fill: 'none',
    });
    expect(timing.avOffsetS).toBeCloseTo(-0.42);
  });

  it('marks source-range misses independently of adapter track start', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 3,
      video: { ...videoTrack, startS: 2, durationS: 3 },
      frameRateMode: 'variable',
    });

    expect(resolveNormalizedSourceTimestamp(timing, 'video', -0.1).fill).toBe('outside-source');
    expect(resolveNormalizedSourceTimestamp(timing, 'video', 3.2).fill).toBe('outside-source');
    expect(timing.frameRateMode).toBe('variable');
  });

  it('limits unavailable audio silence to the next non-zero track start', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 1,
      video: { ...videoTrack, startS: 0, durationS: 1 },
      audio: { ...audioTrack, startS: 0.5, durationS: 0.5 },
      frameRateMode: 'constant',
    });
    const clip = defaultTimelineClip({ id: 'clip', sourceId: 'src', start: 0, duration: 1, inPoint: 0 });
    const resolution = resolveSourceTimestamp({ clip, timelineTime: 0, trackKind: 'audio', timing });

    expect(resolution).toMatchObject({ available: false, fill: 'before-track-start' });
    expect(
      unavailableAudioSilenceFrames({
        resolution,
        timing,
        clip,
        timelineTime: 0,
        sampleRate: 4,
        maxFrames: 1024,
      }),
    ).toBe(2);
  });

  it('returns the full silence budget when unavailable audio cannot resume inside the block', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 1,
      audio: { ...audioTrack, startS: 0, durationS: 1 },
      frameRateMode: 'constant',
    });
    const clip = defaultTimelineClip({ id: 'clip', sourceId: 'src', start: 0, duration: 1, inPoint: 0 });
    const resolution = resolveSourceTimestamp({ clip, timelineTime: 1.25, trackKind: 'audio', timing });

    expect(resolution).toMatchObject({ available: false, fill: 'outside-source' });
    expect(
      unavailableAudioSilenceFrames({
        resolution,
        timing,
        clip,
        timelineTime: 1.25,
        sampleRate: 4,
        maxFrames: 16,
      }),
    ).toBe(16);
  });

  it('handles audio that starts before video (negative firstTimestampS)', () => {
    // Phone MOV: audio-1 starts at -0.044s, video at 0. Normalized start stays
    // at 0 (no negative rebasing). The avOffsetS is -0.044 and audio is
    // available at normalized time 0 (adapter timestamp 0 >= -0.044).
    const timing = buildNormalizedSourceTiming({
      durationS: 12,
      video: { ...videoTrack, startS: 0, durationS: 12 },
      audio: { ...audioTrack, startS: -0.044, durationS: 12.044 },
      frameRateMode: 'variable',
    });

    expect(timing.normalizedStartS).toBe(0);
    expect(timing.durationS).toBeCloseTo(12);
    expect(timing.avOffsetS).toBeCloseTo(-0.044);

    expect(resolveNormalizedSourceTimestamp(timing, 'audio', 0)).toMatchObject({
      adapterTimestampS: 0,
      available: true,
      fill: 'none',
    });
    expect(resolveNormalizedSourceTimestamp(timing, 'video', 0)).toMatchObject({
      adapterTimestampS: 0,
      available: true,
      fill: 'none',
    });
  });

  it('limits available audio windows to the next track end', () => {
    const timing = buildNormalizedSourceTiming({
      durationS: 1,
      audio: { ...audioTrack, startS: 0, durationS: 0.5 },
      frameRateMode: 'constant',
    });
    const clip = defaultTimelineClip({ id: 'clip', sourceId: 'src', start: 0, duration: 1, inPoint: 0 });
    const resolution = resolveSourceTimestamp({ clip, timelineTime: 0.25, trackKind: 'audio', timing });

    expect(resolution).toMatchObject({ available: true, fill: 'none' });
    expect(
      audioAvailabilityWindowFrames({
        resolution,
        timing,
        clip,
        timelineTime: 0.25,
        sampleRate: 4,
        maxFrames: 16,
      }),
    ).toBe(1);
  });
});
