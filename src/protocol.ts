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

export type WorkerCommand =
  | { type: 'init'; canvas: OffscreenCanvas; sab: SharedArrayBuffer }
  | { type: 'import'; file: File }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'dispose' };

export type WorkerStateMessage =
  | { type: 'ready'; webgpu: boolean; features: string[]; gpuUnavailableReason: string | null }
  | { type: 'import-progress'; stage: 'reading' | 'metadata' }
  | { type: 'import-complete'; metadata: MediaMetadata }
  | { type: 'import-error'; message: string }
  | { type: 'error'; message: string };

export function assertCrossOriginIsolated(context: string): void {
  if (!globalThis.crossOriginIsolated) {
    throw new Error(
      `${context}: crossOriginIsolated is false. ` +
        'SharedArrayBuffer requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).',
    );
  }
}
