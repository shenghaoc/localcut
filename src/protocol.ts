/** Shared types for main ↔ pipeline worker messages. */

/** Clock SAB layout: [0] currentTime, [1] duration, [2] playState, [3] audioClock. */
export const CLOCK_FIELD_COUNT = 4;
export const CLOCK_BUFFER_BYTES = CLOCK_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;

export const ClockIndex = {
  CURRENT_TIME: 0,
  DURATION: 1,
  PLAY_STATE: 2,
  AUDIO_CLOCK: 3,
} as const;

/** Meter SAB layout: peak/RMS pairs written by the AudioWorklet (single writer). */
export const METER_FIELD_COUNT = 4;
export const METER_BUFFER_BYTES = METER_FIELD_COUNT * Float32Array.BYTES_PER_ELEMENT;

export const MeterIndex = {
  PEAK_L: 0,
  PEAK_R: 1,
  RMS_L: 2,
  RMS_R: 3,
} as const;

export type PlayState = 'paused' | 'playing';
/** Source media kind. Images are stills serving one decoded frame for any timestamp. */
export type MediaKind = 'video' | 'image' | 'audio';
export type ExportPreset = 'quality' | 'fast';
export type ExportVideoCodec = 'h264' | 'vp9' | 'av1';
export type ExportContainer = 'mp4' | 'webm';

export interface ExportRange {
  startS: number;
  endS: number;
}

export interface ExportSettings {
  preset: ExportPreset;
  codec: ExportVideoCodec;
  container: ExportContainer;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  range?: ExportRange;
}

export interface ExportCodecSupport {
  codec: ExportVideoCodec;
  container: ExportContainer;
}

export interface MediaMetadata {
  fileName: string;
  duration: number;
  mimeType: string | null;
  video: {
    codec: string | null;
    width: number;
    height: number;
    frameRate: number | null;
    canDecode: boolean;
  } | null;
  audio: {
    codec: string | null;
    channels: number;
    sampleRate: number;
    canDecode: boolean;
  } | null;
  trackCount: number;
}

export interface ClipEffectParamsSnapshot {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  temperatureStrength: number;
}

export type FitModeSnapshot = 'fill' | 'fit' | 'letterbox';

export interface TransformParamsSnapshot {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  fit: FitModeSnapshot;
}

export interface TimelineClipSnapshot {
  id: string;
  sourceId: string;
  start: number;
  duration: number;
  inPoint: number;
  effects: ClipEffectParamsSnapshot;
  transform: TransformParamsSnapshot;
  audioFadeIn: number;
  audioFadeOut: number;
  offline?: boolean;
}

export interface TimelineTrackSnapshot {
  id: string;
  type: 'video' | 'audio';
  clips: TimelineClipSnapshot[];
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface TimelineMarkerSnapshot {
  id: string;
  time: number;
  label: string;
}

export interface TimelineClipReference {
  trackId: string;
  clipId: string;
}

export interface TimelineClipMove extends TimelineClipReference {
  toTrackId: string;
  toStart: number;
}

export interface TimelineClipboardClip {
  trackId: string;
  clip: TimelineClipSnapshot;
}

/** Min/max peak pairs (2 floats per bucket) for waveform rendering. */
export type WaveformPeaks = Float32Array;

export interface SourceDescriptorSnapshot {
  sourceId: string;
  fileName: string;
  kind: MediaKind;
  byteSize: number;
  durationS: number;
  mimeType: string | null;
  video?: {
    width: number;
    height: number;
    frameRate: number | null;
    codec: string | null;
    canDecode: boolean;
  };
  audio?: {
    channels: number;
    sampleRate: number;
    codec: string | null;
    canDecode: boolean;
  };
}

/** A media-bin asset: an imported source that is not (yet) placed on the timeline. */
export interface MediaAssetSnapshot {
  sourceId: string;
  fileName: string;
  kind: MediaKind;
  /** Intrinsic duration in seconds; stills report their default placement duration. */
  durationS: number;
  byteSize: number;
  mimeType: string | null;
  video?: {
    width: number;
    height: number;
    frameRate: number | null;
  };
  audio?: {
    channels: number;
    sampleRate: number;
  };
}

interface SplitTimelineCommand {
  type: 'split';
  trackId: string;
  time: number;
}

interface DeleteTimelineClipCommand {
  type: 'delete-clip';
  trackId: string;
  clipId: string;
}

interface DeleteTimelineClipsCommand {
  type: 'delete-clips';
  clips: TimelineClipReference[];
}

interface MoveTimelineClipCommand {
  type: 'move-clip';
  fromTrackId: string;
  toTrackId: string;
  clipId: string;
  toStart: number;
}

interface MoveTimelineClipsCommand {
  type: 'move-clips';
  moves: TimelineClipMove[];
}

interface DuplicateTimelineClipCommand {
  type: 'duplicate-clip';
  clips: TimelineClipReference[];
  atTime?: number;
}

interface PasteTimelineClipsCommand {
  type: 'paste-clips';
  clips: TimelineClipboardClip[];
  atTime: number;
}

interface AddTimelineMarkerCommand {
  type: 'add-marker';
  time: number;
  label?: string;
}

interface DeleteTimelineMarkerCommand {
  type: 'delete-marker';
  markerId: string;
}

interface CloseTimelineGapsCommand {
  type: 'close-gaps';
  trackId?: string;
}

interface TrimTimelineClipCommand {
  type: 'trim-clip';
  trackId: string;
  clipId: string;
  edge: 'in' | 'out';
  time: number;
}

interface SetEffectParamCommand {
  type: 'set-effect-param';
  trackId: string;
  clipId: string;
  key: keyof ClipEffectParamsSnapshot;
  value: number;
}

interface SetTransformCommand {
  type: 'set-transform';
  trackId: string;
  clipId: string;
  transform: Partial<TransformParamsSnapshot>;
}

interface SetTrackGainCommand {
  type: 'set-track-gain';
  trackId: string;
  gain: number;
}

interface SetTrackMuteCommand {
  type: 'set-track-mute';
  trackId: string;
  muted: boolean;
}

interface SetTrackSoloCommand {
  type: 'set-track-solo';
  trackId: string;
  solo: boolean;
}

interface SetTrackPanCommand {
  type: 'set-track-pan';
  trackId: string;
  pan: number;
}

interface SetMasterGainCommand {
  type: 'set-master-gain';
  gain: number;
}

interface SetClipFadeCommand {
  type: 'set-clip-fade';
  trackId: string;
  clipId: string;
  edge: 'in' | 'out';
  durationS: number;
}

/** Places a bin asset on the timeline. When `trackId` is omitted the worker finds
 *  or creates a track matching the asset's kind; when `start` is omitted the clip
 *  appends past the track's last clip. */
interface PlaceClipCommand {
  type: 'place-clip';
  sourceId: string;
  trackId?: string;
  start?: number;
}

interface SetStillDurationCommand {
  type: 'set-still-duration';
  trackId: string;
  clipId: string;
  durationS: number;
}

interface AddTrackCommand {
  type: 'add-track';
  trackType: 'video' | 'audio';
}

interface RemoveTrackCommand {
  type: 'remove-track';
  trackId: string;
}

interface ReorderTrackCommand {
  type: 'reorder-track';
  trackId: string;
  toIndex: number;
}

interface RemoveAssetCommand {
  type: 'remove-asset';
  sourceId: string;
}

interface RequestThumbnailsCommand {
  type: 'request-thumbnails';
  sourceId: string;
  timestamps: number[];
}

export type WorkerCommand =
  | { type: 'init'; canvas: OffscreenCanvas; sab: SharedArrayBuffer; audioSab?: SharedArrayBuffer | null }
  | { type: 'import'; file: File; fileHandle?: FileSystemFileHandle | null }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'step'; direction: 1 | -1 }
  | { type: 'export-probe' }
  | { type: 'export-start'; settings: ExportSettings; output: FileSystemFileHandle }
  | { type: 'export-cancel' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'restore-project' }
  | { type: 'new-project' }
  | { type: 'relink-source'; sourceId: string; file: File; fileHandle?: FileSystemFileHandle | null }
  | SplitTimelineCommand
  | DeleteTimelineClipCommand
  | DeleteTimelineClipsCommand
  | MoveTimelineClipCommand
  | MoveTimelineClipsCommand
  | DuplicateTimelineClipCommand
  | PasteTimelineClipsCommand
  | AddTimelineMarkerCommand
  | DeleteTimelineMarkerCommand
  | CloseTimelineGapsCommand
  | TrimTimelineClipCommand
  | SetEffectParamCommand
  | SetTransformCommand
  | SetTrackGainCommand
  | SetTrackMuteCommand
  | SetTrackSoloCommand
  | SetTrackPanCommand
  | SetMasterGainCommand
  | SetClipFadeCommand
  | PlaceClipCommand
  | SetStillDurationCommand
  | AddTrackCommand
  | RemoveTrackCommand
  | ReorderTrackCommand
  | RemoveAssetCommand
  | RequestThumbnailsCommand
  | { type: 'dispose' };

/** A measured preview resolution tier (adaptive downscale of the decode path). */
export interface PreviewResolution {
  width: number;
  height: number;
  /** Human label, e.g. "1080p". */
  label: string;
}

/** Result of the one-shot startup encode-throughput probe (session ETA hint). */
export interface ThroughputProbe {
  encodeFps: number;
  codec: string;
  width: number;
  height: number;
}

export interface ExportProgress {
  preset: ExportPreset;
  codec: ExportVideoCodec;
  container: ExportContainer;
  phase: 'video' | 'audio' | 'finalizing';
  doneFrames: number;
  totalFrames: number;
  percent: number;
  etaSeconds: number | null;
  elapsedSeconds: number;
  subRealtime: boolean;
}

export type WorkerStateMessage =
  | { type: 'ready'; webgpu: boolean; features: string[]; gpuUnavailableReason: string | null }
  | { type: 'import-progress'; stage: 'reading' | 'metadata' }
  | { type: 'import-complete'; metadata: MediaMetadata }
  | { type: 'import-error'; message: string }
  | { type: 'project-warning'; message: string }
  | { type: 'history-state'; canUndo: boolean; canRedo: boolean }
  | { type: 'restore-available'; projectId: string; savedAt: string; sources: SourceDescriptorSnapshot[] }
  | {
      type: 'restore-result';
      projectId: string;
      restored: boolean;
      savedAt: string | null;
      metadata: MediaMetadata | null;
      unresolvedSources: SourceDescriptorSnapshot[];
      message: string;
    }
  | {
      type: 'relink-result';
      sourceId: string;
      ok: boolean;
      descriptor: SourceDescriptorSnapshot | null;
      metadata: MediaMetadata | null;
      unresolvedSources: SourceDescriptorSnapshot[];
      message: string;
    }
  | { type: 'preview-resolution'; resolution: PreviewResolution }
  | { type: 'probe-result'; probe: ThroughputProbe }
  | { type: 'timeline-state'; timeline: TimelineTrackSnapshot[]; markers: TimelineMarkerSnapshot[]; masterGain: number }
  | { type: 'media-assets'; assets: MediaAssetSnapshot[] }
  | { type: 'thumbnail'; sourceId: string; timestamp: number; bitmap: ImageBitmap; width: number; height: number }
  | { type: 'waveform-peaks'; trackId: string; clipId: string; peaks: WaveformPeaks }
  | { type: 'export-codecs'; supported: ExportCodecSupport[]; settings: ExportSettings }
  | { type: 'export-progress'; progress: ExportProgress }
  | { type: 'export-complete'; fileName: string; mimeType: string }
  | { type: 'export-canceled' }
  | { type: 'export-error'; message: string }
  | { type: 'dispose-complete' }
  | { type: 'error'; message: string };

export function assertCrossOriginIsolated(context: string): void {
  if (!globalThis.crossOriginIsolated) {
    throw new Error(
      `${context}: crossOriginIsolated is false. ` +
        'SharedArrayBuffer requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).',
    );
  }
}
