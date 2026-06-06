import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIP_AUDIO_FADES,
  DEFAULT_TRACK_MIX,
  defaultClipEffects,
  defaultClipTransform,
  type Timeline,
} from './timeline';
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
          transform: { ...defaultClipTransform(), scale: 0.5, x: 0.1, fit: 'fit' },
          ...DEFAULT_CLIP_AUDIO_FADES,
        },
      ],
    },
  ];
}

function sourceFixture(): SourceDescriptor {
  return {
    sourceId: 'source-1',
    fileName: 'cutaway.mp4',
    kind: 'video',
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
  it('drops a malformed export range but keeps the other settings', () => {
    const result = deserializeProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: 'project-1',
      savedAt: '2026-06-06T00:00:00.000Z',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
      exportSettings: {
        preset: 'quality',
        codec: 'h264',
        container: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        videoBitrate: 8_000_000,
        range: { startS: 4, endS: 4 },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.exportSettings).toEqual({
      preset: 'quality',
      codec: 'h264',
      container: 'mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      videoBitrate: 8_000_000,
    });
  });

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

  it('round-trips transition lists and rejects malformed entries', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      transitions: [
        {
          id: 'transition-1',
          trackId: 'track-video-source-1',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          durationS: 1.25,
          kind: 'slide',
          params: { direction: 'left' },
        },
      ],
      sources: [sourceFixture()],
    });

    const result = deserializeProject(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.transitions).toEqual(doc.transitions);

    const invalid = deserializeProject({
      ...doc,
      transitions: [{ ...doc.transitions[0], durationS: 0 }],
    });
    expect(invalid.ok).toBe(false);
  });

  it('round-trips a versioned project document', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      markers: [{ id: 'marker-1', time: 4.5, label: 'Pull quote' }],
      sources: [sourceFixture()],
      masterGain: 0.85,
      savedAt: new Date('2026-06-06T00:00:00.000Z'),
    });

    expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const result = deserializeProject(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toEqual(doc);
  });

  it('round-trips per-clip transforms and fills identity for older docs', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
    });
    expect(doc.timeline[0]!.clips[0]!.transform).toMatchObject({ scale: 0.5, x: 0.1, fit: 'fit' });

    // A schema-3 clip carries no transform; deserialization must fill identity.
    const legacyClip = { ...doc.timeline[0]!.clips[0] } as Record<string, unknown>;
    delete legacyClip.transform;
    const result = deserializeProject({
      ...doc,
      schemaVersion: 3,
      timeline: [{ ...doc.timeline[0], clips: [legacyClip] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.timeline[0]!.clips[0]!.transform).toMatchObject({
      x: 0,
      scale: 1,
      opacity: 1,
      fit: 'fill',
    });
  });

  it('upgrades v1 documents with absolute clip starts and empty markers', () => {
    const timeline = timelineFixture();
    timeline[0]!.clips[0]!.start = 7;
    const result = deserializeProject({
      schemaVersion: 1,
      projectId: 'project-legacy',
      savedAt: '2026-06-06T00:00:00.000Z',
      timeline,
      sources: [sourceFixture()],
      masterGain: 0.75,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(result.doc.markers).toEqual([]);
    expect(result.doc.timeline[0]!.clips[0]!.start).toBe(7);
  });

  it('rejects malformed marker records', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
    });
    const result = deserializeProject({
      ...doc,
      markers: [{ id: 'marker-1', time: -1, label: 'Bad' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('markers');
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

  it('rejects tracks with negative gain on load', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
    });
    const raw = {
      ...doc,
      timeline: [{ ...doc.timeline[0]!, gain: -0.5 }],
    };
    const result = deserializeProject(raw);
    expect(result.ok).toBe(false);
  });

  it('defaults master gain when older project documents omit it', () => {
    const doc = serializeProject({
      projectId: 'project-1',
      timeline: timelineFixture(),
      sources: [sourceFixture()],
    });
    const { masterGain: _ignored, ...legacy } = doc;
    const result = deserializeProject(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.masterGain).toBe(1);
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
