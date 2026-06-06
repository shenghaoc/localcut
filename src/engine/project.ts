import type {
  ExportSettings,
  NormalizedSourceTimingSnapshot,
  SourceColorHintsSnapshot,
  SourceDescriptorSnapshot,
  SourceFrameRateModeSnapshot,
  SourceHealthReportSnapshot,
  SourceHealthWarningSnapshot,
  SourceTrackTimingSnapshot,
} from '../protocol';
import {
  DEFAULT_CLIP_AUDIO_FADES,
  DEFAULT_MASTER_GAIN,
  DEFAULT_TRACK_MIX,
  normalizeTitleContent,
  normalizeTransitionKind,
  normalizeTransitionParams,
  normalizeClipEffects,
  normalizeTransform,
  sortMarkers,
  type Timeline,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
  type TimelineTransition,
  type TitleContent,
} from './timeline';
import { cloneClipKeyframes, parseClipKeyframes } from './keyframes';
import { cloneClipLut, parsePersistedClipLut } from './lut';

export const PROJECT_SCHEMA_VERSION = 7;
const DURATION_MATCH_TOLERANCE_S = 0.25;
const TIMING_MATCH_TOLERANCE_S = 0.05;

export type SourceDescriptor = SourceDescriptorSnapshot;

export interface ProjectDoc {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  savedAt: string;
  timeline: Timeline;
  transitions: TimelineTransition[];
  markers: TimelineMarker[];
  sources: SourceDescriptor[];
  masterGain: number;
  exportSettings?: ExportSettings;
}

export interface SerializeProjectOptions {
  projectId: string;
  timeline: Timeline;
  transitions?: readonly TimelineTransition[];
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
  video?: SourceDescriptor['video'];
  audio?: SourceDescriptor['audio'];
  timing?: SourceDescriptor['timing'];
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
  const cloned: TimelineClip = {
    id: clip.id,
    sourceId: clip.sourceId,
    start: clip.start,
    duration: clip.duration,
    inPoint: clip.inPoint,
    effects: normalizeClipEffects(clip.effects),
    transform: normalizeTransform(clip.transform),
    audioFadeIn: clip.audioFadeIn,
    audioFadeOut: clip.audioFadeOut,
  };
  if (clip.kind === 'title') {
    cloned.kind = 'title';
    cloned.title = normalizeTitleContent(clip.title);
  }
  const keyframes = cloneClipKeyframes(clip.keyframes);
  if (keyframes) cloned.keyframes = keyframes;
  const lut = cloneClipLut(clip.lut);
  if (lut) cloned.lut = lut;
  return cloned;
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

export function cloneTransitionsSnapshot(transitions: readonly TimelineTransition[]): TimelineTransition[] {
  return transitions.map((transition) => ({
    id: transition.id,
    trackId: transition.trackId,
    fromClipId: transition.fromClipId,
    toClipId: transition.toClipId,
    durationS: transition.durationS,
    kind: normalizeTransitionKind(transition.kind),
    params: normalizeTransitionParams(transition.params),
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
    adapterId: source.adapterId,
    timing: source.timing ? cloneTiming(source.timing) : undefined,
    health: source.health ? cloneHealthReport(source.health) : undefined,
    video: source.video
      ? {
          width: source.video.width,
          height: source.video.height,
          codedWidth: source.video.codedWidth,
          codedHeight: source.video.codedHeight,
          frameRate: source.video.frameRate,
          frameRateMode: source.video.frameRateMode,
          rotationDeg: source.video.rotationDeg,
          color: source.video.color ? cloneColor(source.video.color) : undefined,
          trackStartS: source.video.trackStartS,
          trackDurationS: source.video.trackDurationS,
          codec: source.video.codec,
          canDecode: source.video.canDecode,
        }
      : undefined,
    audio: source.audio
      ? {
          channels: source.audio.channels,
          sampleRate: source.audio.sampleRate,
          trackStartS: source.audio.trackStartS,
          trackDurationS: source.audio.trackDurationS,
          codec: source.audio.codec,
          canDecode: source.audio.canDecode,
        }
      : undefined,
  };
}

function cloneColor(color: SourceColorHintsSnapshot): SourceColorHintsSnapshot {
  return {
    primaries: color.primaries,
    transfer: color.transfer,
    matrix: color.matrix,
    fullRange: color.fullRange,
  };
}

function cloneTrackTiming(timing: SourceTrackTimingSnapshot): SourceTrackTimingSnapshot {
  return {
    trackId: timing.trackId,
    firstTimestampS: timing.firstTimestampS,
    lastTimestampS: timing.lastTimestampS,
    durationS: timing.durationS,
  };
}

function cloneTiming(timing: NormalizedSourceTimingSnapshot): NormalizedSourceTimingSnapshot {
  return {
    normalizedStartS: timing.normalizedStartS,
    durationS: timing.durationS,
    video: timing.video ? cloneTrackTiming(timing.video) : undefined,
    audio: timing.audio ? cloneTrackTiming(timing.audio) : undefined,
    avOffsetS: timing.avOffsetS,
    frameRateMode: timing.frameRateMode,
  };
}

function cloneHealthWarning(warning: SourceHealthWarningSnapshot): SourceHealthWarningSnapshot {
  return {
    code: warning.code,
    severity: warning.severity,
    blocking: warning.blocking,
    sourceId: warning.sourceId,
    trackId: warning.trackId,
    message: warning.message,
    details: { ...warning.details },
  };
}

function cloneHealthReport(report: SourceHealthReportSnapshot): SourceHealthReportSnapshot {
  return {
    sourceId: report.sourceId,
    fileName: report.fileName,
    status: report.status,
    warnings: report.warnings.map(cloneHealthWarning),
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
    transitions: cloneTransitionsSnapshot(options.transitions ?? []),
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
  const start = finiteNumber(value.start);
  const duration = finiteNumber(value.duration);
  // Title clips are source-less, carry no in-point, and decode no media (Phase
  // 14); regular clips still require a sourceId and a non-negative in-point.
  const isTitle = value.kind === 'title';
  const sourceId = isTitle ? '' : requiredString(value.sourceId);
  const inPoint = isTitle ? 0 : finiteNumber(value.inPoint);
  if (!id || start === null || duration === null || inPoint === null) {
    return null;
  }
  if (!isTitle && sourceId === null) return null;
  if (duration <= 0 || start < 0 || inPoint < 0) return null;
  if (isTitle && !isRecord(value.title)) return null;

  const rawEffects = isRecord(value.effects) ? value.effects : {};
  const rawTransform = isRecord(value.transform) ? value.transform : {};
  const keyframes = parseClipKeyframes(value.keyframes, duration);
  if (keyframes === null) return null;
  const lut = parsePersistedClipLut(value.lut);
  if (lut === null) return null;
  const fit =
    rawTransform.fit === 'fit' || rawTransform.fit === 'letterbox' || rawTransform.fit === 'fill'
      ? rawTransform.fit
      : undefined;
  const audioFadeIn = finiteNumber(value.audioFadeIn) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeIn;
  const audioFadeOut = finiteNumber(value.audioFadeOut) ?? DEFAULT_CLIP_AUDIO_FADES.audioFadeOut;

  const clip: TimelineClip = {
    id,
    ...(isTitle
      ? { kind: 'title' as const, title: normalizeTitleContent(value.title as Partial<TitleContent>) }
      : {}),
    sourceId: sourceId ?? '',
    start,
    duration,
    inPoint,
    effects: normalizeClipEffects({
      brightness: finiteNumber(rawEffects.brightness) ?? undefined,
      contrast: finiteNumber(rawEffects.contrast) ?? undefined,
      saturation: finiteNumber(rawEffects.saturation) ?? undefined,
      temperature: finiteNumber(rawEffects.temperature) ?? undefined,
      temperatureStrength: finiteNumber(rawEffects.temperatureStrength) ?? undefined,
      lutStrength: finiteNumber(rawEffects.lutStrength) ?? undefined,
    }),
    // Older docs (schema ≤ 3) carry no transform; normalizeTransform fills identity.
    transform: normalizeTransform({
      x: finiteNumber(rawTransform.x) ?? undefined,
      y: finiteNumber(rawTransform.y) ?? undefined,
      scale: finiteNumber(rawTransform.scale) ?? undefined,
      rotation: finiteNumber(rawTransform.rotation) ?? undefined,
      opacity: finiteNumber(rawTransform.opacity) ?? undefined,
      anchorX: finiteNumber(rawTransform.anchorX) ?? undefined,
      anchorY: finiteNumber(rawTransform.anchorY) ?? undefined,
      fit,
    }),
    audioFadeIn: Math.max(0, audioFadeIn),
    audioFadeOut: Math.max(0, audioFadeOut),
  };
  if (keyframes) clip.keyframes = keyframes;
  if (lut) clip.lut = lut;
  return clip;
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

function parseTransitionKind(value: unknown): TimelineTransition['kind'] | null {
  return value === 'cross-dissolve' || value === 'dip-to-black' || value === 'wipe' || value === 'slide'
    ? value
    : null;
}

function parseTransitionParams(value: unknown): TimelineTransition['params'] | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  if (value.direction === undefined || value.direction === null) return {};
  if (value.direction === 'left' || value.direction === 'right' || value.direction === 'up' || value.direction === 'down') {
    return { direction: value.direction };
  }
  return null;
}

function parseTransition(value: unknown): TimelineTransition | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const trackId = requiredString(value.trackId);
  const fromClipId = requiredString(value.fromClipId);
  const toClipId = requiredString(value.toClipId);
  const durationS = finiteNumber(value.durationS);
  const kind = parseTransitionKind(value.kind);
  const params = parseTransitionParams(value.params);
  if (!id || !trackId || !fromClipId || !toClipId || durationS === null || durationS <= 0 || !kind || !params) {
    return null;
  }
  return {
    id,
    trackId,
    fromClipId,
    toClipId,
    durationS,
    kind,
    params,
  };
}

function parseTransitions(value: unknown): TimelineTransition[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const transitions: TimelineTransition[] = [];
  for (const transition of value) {
    const parsed = parseTransition(transition);
    if (!parsed) return null;
    transitions.push(parsed);
  }
  return cloneTransitionsSnapshot(transitions);
}

function parseMarker(value: unknown): TimelineMarker | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const time = finiteNumber(value.time);
  const label = typeof value.label === 'string' ? value.label : null;
  if (!id || time === null || time < 0 || label === null) return null;
  return { id, time, label };
}

function parseFrameRateMode(value: unknown): SourceFrameRateModeSnapshot | undefined {
  return value === 'constant' || value === 'variable' || value === 'unknown'
    ? value
    : undefined;
}

function parseColor(value: unknown): SourceColorHintsSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const primaries = optionalString(value.primaries);
  const transfer = optionalString(value.transfer);
  const matrix = optionalString(value.matrix);
  const fullRange = value.fullRange === null || typeof value.fullRange === 'boolean' ? value.fullRange : undefined;
  if (primaries === undefined || transfer === undefined || matrix === undefined || fullRange === undefined) {
    return undefined;
  }
  return {
    primaries: primaries ?? null,
    transfer: transfer ?? null,
    matrix: matrix ?? null,
    fullRange,
  };
}

function parseTrackTiming(value: unknown): SourceTrackTimingSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const trackId = requiredString(value.trackId);
  const firstTimestampS = finiteNumber(value.firstTimestampS);
  const lastTimestampS = value.lastTimestampS === null ? null : finiteNumber(value.lastTimestampS);
  const durationS = value.durationS === null ? null : finiteNumber(value.durationS);
  if (!trackId || firstTimestampS === null || lastTimestampS === undefined || durationS === undefined) {
    return undefined;
  }
  return {
    trackId,
    firstTimestampS,
    lastTimestampS,
    durationS,
  };
}

function parseTiming(
  value: unknown,
): NormalizedSourceTimingSnapshot | undefined {
  if (isRecord(value)) {
    const normalizedStartS = finiteNumber(value.normalizedStartS);
    const duration = finiteNumber(value.durationS);
    const avOffsetS = finiteNumber(value.avOffsetS);
    const frameRateMode = parseFrameRateMode(value.frameRateMode);
    if (normalizedStartS !== null && duration !== null && avOffsetS !== null && frameRateMode) {
      return {
        normalizedStartS,
        durationS: duration,
        video: value.video === undefined ? undefined : parseTrackTiming(value.video),
        audio: value.audio === undefined ? undefined : parseTrackTiming(value.audio),
        avOffsetS,
        frameRateMode,
      };
    }
  }
  return undefined;
}

function parseWarningCode(value: unknown): SourceHealthWarningSnapshot['code'] | null {
  return value === 'variable-frame-rate' ||
    value === 'non-zero-track-start' ||
    value === 'audio-video-offset' ||
    value === 'rotation-metadata' ||
    value === 'mixed-audio-sample-rates' ||
    value === 'unsupported-video-codec' ||
    value === 'unsupported-audio-codec' ||
    value === 'corrupt-or-truncated-file' ||
    value === 'missing-duration' ||
    value === 'undecodable-track'
    ? value
    : null;
}

function parseWarningDetails(value: unknown): SourceHealthWarningSnapshot['details'] {
  if (!isRecord(value)) return {};
  const details: SourceHealthWarningSnapshot['details'] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      details[key] = entry;
    }
  }
  return details;
}

function parseHealthWarning(value: unknown): SourceHealthWarningSnapshot | null {
  if (!isRecord(value)) return null;
  const code = parseWarningCode(value.code);
  const severity = value.severity === 'info' || value.severity === 'warning' || value.severity === 'error'
    ? value.severity
    : null;
  const sourceId = requiredString(value.sourceId);
  const trackId = optionalString(value.trackId);
  const message = requiredString(value.message);
  if (!code || !severity || !sourceId || trackId === undefined || !message || typeof value.blocking !== 'boolean') {
    return null;
  }
  return {
    code,
    severity,
    blocking: value.blocking,
    sourceId,
    trackId: trackId ?? undefined,
    message,
    details: parseWarningDetails(value.details),
  };
}

function parseHealthReport(value: unknown, sourceId: string, fileName: string): SourceHealthReportSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const status = value.status === 'ok' || value.status === 'warnings' || value.status === 'blocked'
    ? value.status
    : null;
  if (!status || !Array.isArray(value.warnings)) return undefined;
  const warnings: SourceHealthWarningSnapshot[] = [];
  for (const warning of value.warnings) {
    const parsed = parseHealthWarning(warning);
    if (parsed) warnings.push(parsed);
  }
  return {
    sourceId,
    fileName,
    status,
    warnings,
  };
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
    const codedWidth = finiteNumber(value.video.codedWidth) ?? undefined;
    const codedHeight = finiteNumber(value.video.codedHeight) ?? undefined;
    const frameRateMode = parseFrameRateMode(value.video.frameRateMode);
    const rotationDeg = finiteNumber(value.video.rotationDeg) ?? undefined;
    const color = parseColor(value.video.color);
    const trackStartS = finiteNumber(value.video.trackStartS) ?? undefined;
    const trackDurationS =
      value.video.trackDurationS === null ? null : finiteNumber(value.video.trackDurationS) ?? undefined;
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
      codedWidth,
      codedHeight,
      frameRate,
      frameRateMode,
      rotationDeg,
      color,
      trackStartS,
      trackDurationS,
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
    const trackStartS = finiteNumber(value.audio.trackStartS) ?? undefined;
    const trackDurationS =
      value.audio.trackDurationS === null ? null : finiteNumber(value.audio.trackDurationS) ?? undefined;
    if (channels === null || sampleRate === null || codec === undefined || typeof value.audio.canDecode !== 'boolean') {
      return null;
    }
    audio = {
      channels,
      sampleRate,
      trackStartS,
      trackDurationS,
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
  const adapterId =
    value.adapterId === 'mediabunny' || value.adapterId === 'web-demuxer-diagnostics'
      ? value.adapterId
      : undefined;
  const timing = parseTiming(value.timing);
  const health = parseHealthReport(value.health, sourceId, fileName);

  return {
    sourceId,
    fileName,
    kind,
    byteSize,
    durationS,
    mimeType,
    adapterId,
    timing,
    health,
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
      transitions: [],
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

function deserializeV5(value: Record<string, unknown>): DeserializeProjectResult {
  const result = deserializeV2(value);
  if (!result.ok) return result;
  const transitions = parseTransitions(value.transitions);
  if (!transitions) return { ok: false, reason: 'Project transitions are invalid.' };
  return {
    ok: true,
    doc: {
      ...result.doc,
      transitions,
    },
  };
}

function deserializeV6(value: Record<string, unknown>): DeserializeProjectResult {
  // v6+ additions are parsed by the shared clip/source parsers; no separate
  // migration step is needed beyond the v5 transition path.
  return deserializeV5(value);
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
    case 4:
      // v3 adds `kind` to source descriptors; v4 adds per-clip transforms.
      // parseSourceDescriptor infers `kind` and parseClip fills an identity
      // transform for older docs, so the v2 parse path handles all three.
      return deserializeV2(value);
    case 5:
    case 6:
    case 7:
      // v6 adds title/keyframe/LUT clip sidecars; v7 adds Phase 18 source
      // conformance fields. Shared parsers handle both while v5 keeps
      // transition parsing.
      return deserializeV6(value);
    default:
      return { ok: false, reason: `Unsupported project schemaVersion ${schemaVersion}.` };
  }
}

export function sourceDescriptorMatchesCandidate(
  descriptor: SourceDescriptor,
  candidate: SourceMatchCandidate,
): boolean {
  return sourceDescriptorMismatchReasons(descriptor, candidate).length === 0;
}

function closeEnough(a: number | null | undefined, b: number | null | undefined, tolerance: number): boolean {
  if (a === undefined || b === undefined) return true;
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= tolerance;
}

function timingMatches(
  descriptor: SourceDescriptor,
  candidate: SourceMatchCandidate,
): boolean {
  if (!descriptor.timing || !candidate.timing) return true;
  return (
    closeEnough(descriptor.timing.normalizedStartS, candidate.timing.normalizedStartS, TIMING_MATCH_TOLERANCE_S) &&
    closeEnough(descriptor.timing.video?.firstTimestampS, candidate.timing.video?.firstTimestampS, TIMING_MATCH_TOLERANCE_S) &&
    closeEnough(descriptor.timing.audio?.firstTimestampS, candidate.timing.audio?.firstTimestampS, TIMING_MATCH_TOLERANCE_S) &&
    closeEnough(descriptor.timing.avOffsetS, candidate.timing.avOffsetS, TIMING_MATCH_TOLERANCE_S)
  );
}

export function sourceDescriptorMismatchReasons(
  descriptor: SourceDescriptor,
  candidate: SourceMatchCandidate,
): string[] {
  const reasons: string[] = [];
  if (descriptor.fileName !== candidate.fileName) reasons.push('name');
  if (descriptor.byteSize !== candidate.byteSize) reasons.push('size');
  if (Math.abs(descriptor.durationS - candidate.durationS) > DURATION_MATCH_TOLERANCE_S) reasons.push('duration');
  if (!timingMatches(descriptor, candidate)) reasons.push('track timing');
  if (descriptor.video?.rotationDeg !== undefined && candidate.video?.rotationDeg !== undefined) {
    if (descriptor.video.rotationDeg !== candidate.video.rotationDeg) reasons.push('rotation');
  }
  if (descriptor.audio && candidate.audio) {
    if (descriptor.audio.sampleRate !== candidate.audio.sampleRate) reasons.push('audio sample rate');
    if (descriptor.audio.channels !== candidate.audio.channels) reasons.push('audio channel count');
  }
  return reasons;
}
