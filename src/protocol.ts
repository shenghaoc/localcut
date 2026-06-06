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
export type ExportPreset = 'quality' | 'fast';

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

export interface TimelineClipSnapshot {
  id: string;
  sourceId: string;
  start: number;
  duration: number;
  inPoint: number;
  effects: ClipEffectParamsSnapshot;
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

/** Min/max peak pairs (2 floats per bucket) for waveform rendering. */
export type WaveformPeaks = Float32Array;

export interface SourceDescriptorSnapshot {
  sourceId: string;
  fileName: string;
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

interface MoveTimelineClipCommand {
  type: 'move-clip';
  fromTrackId: string;
  toTrackId: string;
  clipId: string;
  toIndex: number;
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

export type WorkerCommand =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      sab: SharedArrayBuffer;
      audioSab?: SharedArrayBuffer | null;
      meterSab?: SharedArrayBuffer | null;
    }
  | { type: 'import'; file: File; fileHandle?: FileSystemFileHandle | null }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'step'; direction: 1 | -1 }
  | { type: 'export-start'; preset: ExportPreset; output: FileSystemFileHandle }
  | { type: 'export-cancel' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'restore-project' }
  | { type: 'new-project' }
  | { type: 'relink-source'; sourceId: string; file: File; fileHandle?: FileSystemFileHandle | null }
  | SplitTimelineCommand
  | DeleteTimelineClipCommand
  | MoveTimelineClipCommand
  | TrimTimelineClipCommand
  | SetEffectParamCommand
  | SetTrackGainCommand
  | SetTrackMuteCommand
  | SetTrackSoloCommand
  | SetTrackPanCommand
  | SetMasterGainCommand
  | SetClipFadeCommand
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
  | { type: 'timeline-state'; timeline: TimelineTrackSnapshot[]; masterGain: number }
  | { type: 'waveform-peaks'; trackId: string; clipId: string; peaks: WaveformPeaks }
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
