/** Shared types for main ↔ pipeline worker messages. */

export const CLOCK_BUFFER_BYTES = 3 * Float64Array.BYTES_PER_ELEMENT;

export type PlayState = 'paused' | 'playing';

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
}

export interface TimelineTrackSnapshot {
  id: string;
  type: 'video' | 'audio';
  clips: TimelineClipSnapshot[];
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

export type WorkerCommand =
  | { type: 'init'; canvas: OffscreenCanvas; sab: SharedArrayBuffer }
  | { type: 'import'; file: File }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'step'; direction: 1 | -1 }
  | SplitTimelineCommand
  | DeleteTimelineClipCommand
  | MoveTimelineClipCommand
  | TrimTimelineClipCommand
  | SetEffectParamCommand
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

export type WorkerStateMessage =
  | { type: 'ready'; webgpu: boolean; features: string[]; gpuUnavailableReason: string | null }
  | { type: 'import-progress'; stage: 'reading' | 'metadata' }
  | { type: 'import-complete'; metadata: MediaMetadata }
  | { type: 'import-error'; message: string }
  | { type: 'preview-resolution'; resolution: PreviewResolution }
  | { type: 'probe-result'; probe: ThroughputProbe }
  | { type: 'timeline-state'; timeline: TimelineTrackSnapshot[] }
  | { type: 'error'; message: string };

export function assertCrossOriginIsolated(context: string): void {
  if (!globalThis.crossOriginIsolated) {
    throw new Error(
      `${context}: crossOriginIsolated is false. ` +
        'SharedArrayBuffer requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).',
    );
  }
}
