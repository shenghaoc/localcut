import type { ExportSettings, SourceDescriptorSnapshot } from '../protocol';
import {
  DEFAULT_CLIP_AUDIO_FADES,
  DEFAULT_MASTER_GAIN,
  DEFAULT_TRACK_MIX,
  normalizeClipEffects,
  sortMarkers,
  type Timeline,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
} from './timeline';

export const PROJECT_SCHEMA_VERSION = 3;
const DURATION_MATCH_TOLERANCE_S = 0.25;

export type SourceDescriptor = SourceDescriptorSnapshot;

export interface ProjectDoc {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  savedAt: string;
  timeline: Timeline;
  markers: TimelineMarker[];
  sources: SourceDescriptor[];
  masterGain: number;
  exportSettings?: ExportSettings;
}

export interface SerializeProjectOptions {
  projectId: string;
  timeline: Timeline;
  markers?: readonly TimelineMarker[];
  sources: readonly SourceDescriptor[];
  masterGain?: number;
  savedAt?: Date;
  exportSettings?: ExportSettings;
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

function parseExportSettings(value: unknown): ExportSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return undefined;
  const preset = value.preset === 'quality' || value.preset === 'fast' ? value.preset : null;
  const codec = value.codec === 'h264' || value.codec === 'vp9' || value.codec === 'av1' ? value.codec : null;
  const container = value.container === 'mp4' || value.container === 'webm' ? value.container : null;
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  const fps = finiteNumber(value.fps);
  const videoBitrate = finiteNumber(value.videoBitrate);
  if (!preset || !codec || !container || width === null || height === null || fps === null || videoBitrate === null) {
    return undefined;
  }
  if (width <= 0 || height <= 0 || fps <= 0 || videoBitrate <= 0) return undefined;

  let range: ExportSettings['range'];
  if (value.range !== undefined) {
    if (isRecord(value.range)) {
      const startS = finiteNumber(value.range.startS);
      const endS = finiteNumber(value.range.endS);
      if (startS !== null && endS !== null && endS > startS) {
        range = { startS, endS };
      }
    }
  }

  return {
    preset,
    codec,
    container,
    width,
    height,
    fps,
    videoBitrate,
    range,
  };
}

function cloneExportSettings(settings: ExportSettings): ExportSettings {
  return {
    preset: settings.preset,
    codec: settings.codec,
    container: settings.container,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    videoBitrate: settings.videoBitrate,
    range: settings.range ? { ...settings.range } : undefined,
  };
}

function cloneClip(clip: TimelineClip): TimelineClip {
  return {
    id: clip.id,
    sourceId: clip.sourceId,
    start: clip.start,
    duration: clip.duration,
    inPoint: clip.inPoint,
    effects: normalizeClipEffects(clip.effects),
    audioFadeIn: clip.audioFadeIn,
    audioFadeOut: clip.audioFadeOut,
  };
}

export function cloneTimelineSnapshot(timeline: Timeline): Timeline {
  return timeline.map((track) => ({
    id: track.id,
    type: track.type,
    gain: track.gain,
    pan: track.pan,
    muted: track.muted,
    solo: track.solo,
    clips: track.clips.map(cloneClip),
  }));
}

export function cloneMarkersSnapshot(markers: readonly TimelineMarker[]): TimelineMarker[] {
  return sortMarkers(
    markers.map((marker) => ({
      id: marker.id,
      time: marker.time,
      label: marker.label,
    })),
  );
}

function cloneSourceDescriptor(source: SourceDescriptor): SourceDescriptor {
  return {
    sourceId: source.sourceId,
    fileName: source.fileName,
    kind: source.kind,
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
  const masterGain =
    options.masterGain !== undefined && Number.isFinite(options.masterGain)
      ? Math.max(0, options.masterGain)
      : DEFAULT_MASTER_GAIN;
  const doc: ProjectDoc = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: options.projectId,
    savedAt: (options.savedAt ?? new Date()).toISOString(),
    timeline: cloneTimelineSnapshot(options.timeline),
    markers: cloneMarkersSnapshot(options.markers ?? []),
    sources: options.sources.map(cloneSourceDescriptor),
    masterGain,
  };
  if (options.exportSettings) {
    doc.exportSettings = cloneExportSettings(options.exportSettings);
  }
  return doc;
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
  const audioFadeIn = finiteNumber(value.audioFadeIn) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeIn;
  const audioFadeOut = finiteNumber(value.audioFadeOut) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeOut;

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
    audioFadeIn: Math.max(0, audioFadeIn),
    audioFadeOut: Math.max(0, audioFadeOut),
  };
}

function parseTrack(value: unknown): TimelineTrack | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const type = value.type === 'video' || value.type === 'audio' ? value.type : null;
  const gain = finiteNumber(value.gain);
  const pan = finiteNumber(value.pan) ?? DEFAULT_TRACK_MIX.pan;
  if (
    !id ||
    !type ||
    gain === null ||
    gain < 0 ||
    pan < -1 ||
    pan > 1 ||
    typeof value.muted !== 'boolean' ||
    typeof value.solo !== 'boolean'
  ) {
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
    pan,
    muted: value.muted,
    solo: value.solo,
  };
}

function parseMarker(value: unknown): TimelineMarker | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const time = finiteNumber(value.time);
  const label = typeof value.label === 'string' ? value.label : null;
  if (!id || time === null || time < 0 || label === null) return null;
  return { id, time, label };
}

function parseMarkers(value: unknown): TimelineMarker[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const markers: TimelineMarker[] = [];
  for (const marker of value) {
    const parsed = parseMarker(marker);
    if (!parsed) return null;
    markers.push(parsed);
  }
  return cloneMarkersSnapshot(markers);
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

  const hasVideoBlock = value.video !== undefined && value.video !== null;
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

  const kind =
    value.kind === 'video' || value.kind === 'image' || value.kind === 'audio'
      ? value.kind
      : hasVideoBlock
        ? 'video'
        : 'audio';

  return {
    sourceId,
    fileName,
    kind,
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

  const exportSettings = parseExportSettings(value.exportSettings);
  const masterGain = finiteNumber(value.masterGain) ?? DEFAULT_MASTER_GAIN;

  return {
    ok: true,
    doc: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId,
      savedAt,
      timeline,
      markers: [],
      sources,
      masterGain: Math.max(0, masterGain),
      ...(exportSettings ? { exportSettings } : {}),
    },
  };
}

function deserializeV2(value: Record<string, unknown>): DeserializeProjectResult {
  const result = deserializeV1(value);
  if (!result.ok) return result;
  const markers = parseMarkers(value.markers);
  if (!markers) return { ok: false, reason: 'Project markers are invalid.' };
  return {
    ok: true,
    doc: {
      ...result.doc,
      markers,
    },
  };
}

export function deserializeProject(value: unknown): DeserializeProjectResult {
  if (!isRecord(value)) return { ok: false, reason: 'Project document is not an object.' };
  const schemaVersion = finiteNumber(value.schemaVersion);
  if (schemaVersion === null) return { ok: false, reason: 'Project document is missing schemaVersion.' };

  switch (schemaVersion) {
    case 1:
      return deserializeV1(value);
    case 2:
    case 3:
      // v3 adds `kind` to source descriptors; parseSourceDescriptor infers it for
      // older docs, so the v2 parse path handles both.
      return deserializeV2(value);
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
