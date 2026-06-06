import { describe, expect, it } from 'vitest';
import {
  generateSourceHealthWarnings,
  reportFromWarnings,
  sourceHealthReportFromError,
} from './source-health';
import type { SourceConformance, SourceInspection } from './types';

function inspection(overrides: Partial<SourceInspection> = {}): SourceInspection {
  return {
    sourceId: 'source-1',
    adapterId: 'mediabunny',
    fileName: 'clip.mp4',
    byteSize: 42_000,
    mimeType: 'video/mp4',
    container: 'mp4',
    durationS: 10,
    tracks: [
      {
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
      },
      {
        kind: 'audio',
        trackId: 'audio-1',
        codec: 'mp4a.40.2',
        canDecode: true,
        startS: 0,
        durationS: 10,
        sampleRate: 48_000,
        channels: 2,
      },
    ],
    ...overrides,
  };
}

function conformance(overrides: Partial<SourceConformance> = {}): SourceConformance {
  return {
    sourceId: 'source-1',
    adapterId: 'mediabunny',
    kind: 'video',
    primaryVideoTrackId: 'video-1',
    primaryAudioTrackId: 'audio-1',
    durationS: 10,
    timing: {
      normalizedStartS: 0,
      durationS: 10,
      video: { trackId: 'video-1', firstTimestampS: 0, lastTimestampS: 10, durationS: 10 },
      audio: { trackId: 'audio-1', firstTimestampS: 0, lastTimestampS: 10, durationS: 10 },
      avOffsetS: 0,
      frameRateMode: 'constant',
    },
    health: 'ok',
    ...overrides,
  };
}

describe('source health warning generation', () => {
  it('emits specific non-blocking warnings for VFR, starts, offset, and rotation', () => {
    const source = inspection({
      tracks: [
        {
          kind: 'video',
          trackId: 'video-1',
          codec: 'avc1.640028',
          canDecode: true,
          startS: 0.42,
          durationS: 10,
          codedWidth: 1080,
          codedHeight: 1920,
          displayWidth: 1920,
          displayHeight: 1080,
          frameRate: 29.97,
          frameRateMode: 'variable',
          rotationDeg: 90,
          color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
        },
        {
          kind: 'audio',
          trackId: 'audio-1',
          codec: 'mp4a.40.2',
          canDecode: true,
          startS: 0,
          durationS: 10,
          sampleRate: 48_000,
          channels: 2,
        },
      ],
    });
    const warnings = generateSourceHealthWarnings(
      source,
      conformance({
        timing: {
          normalizedStartS: 0,
          durationS: 10.42,
          video: { trackId: 'video-1', firstTimestampS: 0.42, lastTimestampS: 10.42, durationS: 10 },
          audio: { trackId: 'audio-1', firstTimestampS: 0, lastTimestampS: 10, durationS: 10 },
          avOffsetS: -0.42,
          frameRateMode: 'variable',
        },
      }),
    );

    expect(warnings.map((warning) => warning.code)).toEqual([
      'variable-frame-rate',
      'non-zero-track-start',
      'rotation-metadata',
      'audio-video-offset',
    ]);
    expect(warnings.some((warning) => warning.blocking)).toBe(false);
  });

  it('emits blocking warnings when no track is decodable', () => {
    const warnings = generateSourceHealthWarnings(
      inspection({
        tracks: [
          {
            kind: 'video',
            trackId: 'video-1',
            codec: 'mystery',
            canDecode: false,
            startS: 0,
            durationS: 10,
            codedWidth: 1920,
            codedHeight: 1080,
            displayWidth: 1920,
            displayHeight: 1080,
            frameRate: null,
            frameRateMode: 'unknown',
            rotationDeg: 0,
            color: { primaries: null, transfer: null, matrix: null, fullRange: null },
          },
        ],
      }),
      conformance({ health: 'blocked' }),
    );

    expect(warnings.map((warning) => warning.code)).toContain('unsupported-video-codec');
    expect(warnings.map((warning) => warning.code)).toContain('undecodable-track');
    expect(reportFromWarnings('source-1', 'clip.mp4', warnings).status).toBe('blocked');
  });

  it('keeps codec warnings non-blocking when another stream remains usable', () => {
    const warnings = generateSourceHealthWarnings(
      inspection({
        tracks: [
          {
            kind: 'video',
            trackId: 'video-1',
            codec: 'mystery-video',
            canDecode: false,
            startS: 0,
            durationS: 10,
            codedWidth: 1920,
            codedHeight: 1080,
            displayWidth: 1920,
            displayHeight: 1080,
            frameRate: null,
            frameRateMode: 'unknown',
            rotationDeg: 0,
            color: { primaries: null, transfer: null, matrix: null, fullRange: null },
          },
          {
            kind: 'audio',
            trackId: 'audio-1',
            codec: 'mp4a.40.2',
            canDecode: true,
            startS: 0,
            durationS: 10,
            sampleRate: 48_000,
            channels: 2,
          },
        ],
      }),
      conformance({ kind: 'audio', primaryVideoTrackId: 'video-1', primaryAudioTrackId: 'audio-1' }),
    );

    const codecWarning = warnings.find((warning) => warning.code === 'unsupported-video-codec');
    expect(codecWarning?.blocking).toBe(false);
    expect(reportFromWarnings('source-1', 'clip.mp4', warnings).status).toBe('warnings');
  });

  it('reports missing duration and unsupported audio with distinct codes', () => {
    const warnings = generateSourceHealthWarnings(
      inspection({
        durationS: null,
        tracks: [
          {
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
          },
          {
            kind: 'audio',
            trackId: 'audio-1',
            codec: 'mystery-audio',
            canDecode: false,
            startS: 0,
            durationS: null,
            sampleRate: 48_000,
            channels: 2,
          },
        ],
      }),
      conformance({
        health: 'ok',
        timing: {
          normalizedStartS: 0,
          durationS: 10,
          video: { trackId: 'video-1', firstTimestampS: 0, lastTimestampS: 10, durationS: 10 },
          audio: { trackId: 'audio-1', firstTimestampS: 0, lastTimestampS: null, durationS: null },
          avOffsetS: 0,
          frameRateMode: 'constant',
        },
      }),
    );

    expect(warnings.find((warning) => warning.code === 'missing-duration')).toMatchObject({ blocking: false });
    expect(warnings.find((warning) => warning.code === 'unsupported-audio-codec')).toMatchObject({ blocking: false });
  });

  it('reports mixed sample rates and corrupt import failures with stable codes', () => {
    const warnings = generateSourceHealthWarnings(
      inspection({
        tracks: [
          {
            kind: 'audio',
            trackId: 'audio-1',
            codec: 'mp4a.40.2',
            canDecode: true,
            startS: 0,
            durationS: 5,
            sampleRate: 48_000,
            channels: 2,
          },
          {
            kind: 'audio',
            trackId: 'audio-2',
            codec: 'mp4a.40.2',
            canDecode: true,
            startS: 0,
            durationS: 5,
            sampleRate: 44_100,
            channels: 2,
          },
        ],
      }),
      conformance({ kind: 'audio', primaryVideoTrackId: undefined, primaryAudioTrackId: 'audio-1' }),
    );
    expect(warnings.map((warning) => warning.code)).toContain('mixed-audio-sample-rates');

    const report = sourceHealthReportFromError('source-2', 'broken.mp4', 'Unexpected end of file');
    expect(report.status).toBe('blocked');
    expect(report.warnings[0]?.code).toBe('corrupt-or-truncated-file');
  });
});
