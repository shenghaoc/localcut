import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_MIX, defaultClipEffects, type Timeline } from './timeline';
import {
  PROJECT_SCHEMA_VERSION,
  deserializeProject,
  serializeProject,
  sourceDescriptorMatchesCandidate,
  type SourceDescriptor,
} from './project';

function timelineFixture(): Timeline {
  return [
    {
      id: 'track-video-source-1',
      type: 'video',
      ...DEFAULT_TRACK_MIX,
      clips: [
        {
          id: 'clip-source-1',
          sourceId: 'source-1',
          start: 0,
          duration: 12,
          inPoint: 1.5,
          effects: { ...defaultClipEffects(), saturation: 1.2 },
        },
      ],
    },
  ];
}

function sourceFixture(): SourceDescriptor {
  return {
    sourceId: 'source-1',
    fileName: 'cutaway.mp4',
    byteSize: 42_000,
    durationS: 12.04,
    mimeType: 'video/mp4',
    video: {
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      codec: 'avc1.640028',
      canDecode: true,
    },
    audio: {
      channels: 2,
      sampleRate: 48_000,
      codec: 'mp4a.40.2',
      canDecode: true,
    },
  };
}

describe('project serialization', () => {
  it('round-trips export settings when present', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
      exportSettings: {
        preset: 'fast',
        codec: 'vp9',
        container: 'webm',
        width: 1280,
        height: 720,
        fps: 24,
        videoBitrate: 4_000_000,
        range: { startS: 1, endS: 8 },
      },
    });

    const result = deserializeProject(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.exportSettings).toEqual(doc.exportSettings);
  });

  it('round-trips a versioned project document', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
      savedAt: new Date('2026-06-06T00:00:00.000Z'),
    });

    expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const result = deserializeProject(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toEqual(doc);
  });

  it('rejects unknown schema versions without throwing', () => {
    const result = deserializeProject({
      ...serializeProject({
        projectId: 'project-1',
        timeline: timelineFixture(),
        sources: [sourceFixture()],
      }),
      schemaVersion: 99,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Unsupported project schemaVersion');
  });

  it('normalizes missing effect fields when reading older-compatible v1 clips', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
    });
    const raw = {
      ...doc,
      timeline: [
        {
          ...doc.timeline[0],
          clips: [{ ...doc.timeline[0]!.clips[0], effects: { brightness: 0.4 } }],
        },
      ],
    };

    const result = deserializeProject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.timeline[0]!.clips[0]!.effects).toMatchObject({
      brightness: 0.4,
      contrast: 1,
      saturation: 1,
      temperature: 6500,
      temperatureStrength: 1,
    });
  });
});

describe('source descriptor matching', () => {
  it('matches by name, size, and duration tolerance', () => {
    const source = sourceFixture();
    expect(
      sourceDescriptorMatchesCandidate(source, {
        fileName: 'cutaway.mp4',
        byteSize: 42_000,
        durationS: 12.2,
      }),
    ).toBe(true);
  });

  it('rejects relink candidates with mismatched identity metadata', () => {
    const source = sourceFixture();
    expect(
      sourceDescriptorMatchesCandidate(source, {
        fileName: 'cutaway-copy.mp4',
        byteSize: 42_000,
        durationS: 12.04,
      }),
    ).toBe(false);
    expect(
      sourceDescriptorMatchesCandidate(source, {
        fileName: 'cutaway.mp4',
        byteSize: 41_999,
        durationS: 12.04,
      }),
    ).toBe(false);
    expect(
      sourceDescriptorMatchesCandidate(source, {
        fileName: 'cutaway.mp4',
        byteSize: 42_000,
        durationS: 13,
      }),
    ).toBe(false);
  });
});
