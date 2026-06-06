import type { SourceDescriptorSnapshot } from '../protocol';
import { normalizeClipEffects, type Timeline, type TimelineClip, type TimelineTrack } from './timeline';

export const PROJECT_SCHEMA_VERSION = 1;
const DURATION_MATCH_TOLERANCE_S = 0.25;

export type SourceDescriptor = SourceDescriptorSnapshot;

export interface ProjectDoc {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  savedAt: string;
  timeline: Timeline;
  sources: SourceDescriptor[];
}

export interface SerializeProjectOptions {
  projectId: string;
  timeline: Timeline;
  sources: readonly SourceDescriptor[];
  savedAt?: Date;
}

export type DeserializeProjectResult =
  | { ok: true; doc: ProjectDoc }
  | { ok: false; reason: string };

export interface SourceMatchCandidate {
  fileName: string;
  byteSize: number;
  durationS: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalString(value: unknown): string | null | undefined {
  return value === undefined || value === null || typeof value === 'string' ? value : undefined;
}

function cloneClip(clip: TimelineClip): TimelineClip {
  return {
    id: clip.id,
    sourceId: clip.sourceId,
    start: clip.start,
    duration: clip.duration,
    inPoint: clip.inPoint,
    effects: normalizeClipEffects(clip.effects),
  };
}

export function cloneTimelineSnapshot(timeline: Timeline): Timeline {
  return timeline.map((track) => ({
    id: track.id,
    type: track.type,
    gain: track.gain,
    muted: track.muted,
    solo: track.solo,
    clips: track.clips.map(cloneClip),
  }));
}

function cloneSourceDescriptor(source: SourceDescriptor): SourceDescriptor {
  return {
    sourceId: source.sourceId,
    fileName: source.fileName,
    byteSize: source.byteSize,
    durationS: source.durationS,
    mimeType: source.mimeType,
    video: source.video
      ? {
          width: source.video.width,
          height: source.video.height,
          frameRate: source.video.frameRate,
          codec: source.video.codec,
          canDecode: source.video.canDecode,
        }
      : undefined,
    audio: source.audio
      ? {
          channels: source.audio.channels,
          sampleRate: source.audio.sampleRate,
          codec: source.audio.codec,
          canDecode: source.audio.canDecode,
        }
      : undefined,
  };
}

export function serializeProject(options: SerializeProjectOptions): ProjectDoc {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: options.projectId,
    savedAt: (options.savedAt ?? new Date()).toISOString(),
    timeline: cloneTimelineSnapshot(options.timeline),
    sources: options.sources.map(cloneSourceDescriptor),
  };
}

function parseClip(value: unknown): TimelineClip | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const sourceId = requiredString(value.sourceId);
  const start = finiteNumber(value.start);
  const duration = finiteNumber(value.duration);
  const inPoint = finiteNumber(value.inPoint);
  if (!id || !sourceId || start === null || duration === null || inPoint === null) {
    return null;
  }
  if (duration <= 0 || start < 0 || inPoint < 0) return null;

  const rawEffects = isRecord(value.effects) ? value.effects : {};
  return {
    id,
    sourceId,
    start,
    duration,
    inPoint,
    effects: normalizeClipEffects({
      brightness: finiteNumber(rawEffects.brightness) ?? undefined,
      contrast: finiteNumber(rawEffects.contrast) ?? undefined,
      saturation: finiteNumber(rawEffects.saturation) ?? undefined,
      temperature: finiteNumber(rawEffects.temperature) ?? undefined,
      temperatureStrength: finiteNumber(rawEffects.temperatureStrength) ?? undefined,
    }),
  };
}

function parseTrack(value: unknown): TimelineTrack | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const type = value.type === 'video' || value.type === 'audio' ? value.type : null;
  const gain = finiteNumber(value.gain);
  if (!id || !type || gain === null || typeof value.muted !== 'boolean' || typeof value.solo !== 'boolean') {
    return null;
  }
  if (!Array.isArray(value.clips)) return null;

  const clips: TimelineClip[] = [];
  for (const clip of value.clips) {
    const parsed = parseClip(clip);
    if (!parsed) return null;
    clips.push(parsed);
  }

  return {
    id,
    type,
    clips,
    gain,
    muted: value.muted,
    solo: value.solo,
  };
}

export function parseSourceDescriptor(value: unknown): SourceDescriptor | null {
  if (!isRecord(value)) return null;
  const sourceId = requiredString(value.sourceId);
  const fileName = requiredString(value.fileName);
  const byteSize = finiteNumber(value.byteSize);
  const durationS = finiteNumber(value.durationS);
  const mimeType = optionalString(value.mimeType);
  if (!sourceId || !fileName || byteSize === null || durationS === null || mimeType === undefined) {
    return null;
  }
  if (byteSize < 0 || durationS < 0) return null;

  let video: SourceDescriptor['video'];
  if (value.video !== undefined) {
    if (!isRecord(value.video)) return null;
    const width = finiteNumber(value.video.width);
    const height = finiteNumber(value.video.height);
    const frameRate = value.video.frameRate === null ? null : finiteNumber(value.video.frameRate);
    const codec = optionalString(value.video.codec);
    if (
      width === null ||
      height === null ||
      frameRate === undefined ||
      codec === undefined ||
      typeof value.video.canDecode !== 'boolean'
    ) {
      return null;
    }
    video = {
      width,
      height,
      frameRate,
      codec,
      canDecode: value.video.canDecode,
    };
  }

  let audio: SourceDescriptor['audio'];
  if (value.audio !== undefined) {
    if (!isRecord(value.audio)) return null;
    const channels = finiteNumber(value.audio.channels);
    const sampleRate = finiteNumber(value.audio.sampleRate);
    const codec = optionalString(value.audio.codec);
    if (channels === null || sampleRate === null || codec === undefined || typeof value.audio.canDecode !== 'boolean') {
      return null;
    }
    audio = {
      channels,
      sampleRate,
      codec,
      canDecode: value.audio.canDecode,
    };
  }

  return {
    sourceId,
    fileName,
    byteSize,
    durationS,
    mimeType,
    video,
    audio,
  };
}

function deserializeV1(value: Record<string, unknown>): DeserializeProjectResult {
  const projectId = requiredString(value.projectId);
  const savedAt = requiredString(value.savedAt);
  if (!projectId || !savedAt) {
    return { ok: false, reason: 'Project is missing projectId or savedAt.' };
  }
  if (!Array.isArray(value.timeline)) {
    return { ok: false, reason: 'Project timeline is not an array.' };
  }
  if (!Array.isArray(value.sources)) {
    return { ok: false, reason: 'Project sources are not an array.' };
  }

  const timeline: Timeline = [];
  for (const track of value.timeline) {
    const parsed = parseTrack(track);
    if (!parsed) return { ok: false, reason: 'Project timeline contains an invalid track or clip.' };
    timeline.push(parsed);
  }

  const sources: SourceDescriptor[] = [];
  for (const source of value.sources) {
    const parsed = parseSourceDescriptor(source);
    if (!parsed) return { ok: false, reason: 'Project sources contain an invalid descriptor.' };
    sources.push(parsed);
  }

  return {
    ok: true,
    doc: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId,
      savedAt,
      timeline,
      sources,
    },
  };
}

export function deserializeProject(value: unknown): DeserializeProjectResult {
  if (!isRecord(value)) return { ok: false, reason: 'Project document is not an object.' };
  const schemaVersion = finiteNumber(value.schemaVersion);
  if (schemaVersion === null) return { ok: false, reason: 'Project document is missing schemaVersion.' };

  switch (schemaVersion) {
    case PROJECT_SCHEMA_VERSION:
      return deserializeV1(value);
    default:
      return { ok: false, reason: `Unsupported project schemaVersion ${schemaVersion}.` };
  }
}

export function sourceDescriptorMatchesCandidate(
  descriptor: SourceDescriptor,
  candidate: SourceMatchCandidate,
): boolean {
  return (
    descriptor.fileName === candidate.fileName &&
    descriptor.byteSize === candidate.byteSize &&
    Math.abs(descriptor.durationS - candidate.durationS) <= DURATION_MATCH_TOLERANCE_S
  );
}
