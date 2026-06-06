// Scope diagnostics — Phase 21.
//
// WebGPU compute-based histogram, luma waveform, RGB parade, and vectorscope.
// Results are written to a SharedArrayBuffer ring-buffer for the main thread to
// consume and render via Canvas2D (display only). No getImageData ever.

// ─── Types ─────────────────────────────────────────────────────────────

export type ScopeType = 'histogram' | 'waveform-luma' | 'parade-rgb' | 'vectorscope';

export interface ScopeFeatures {
  subgroups: boolean;
  timestampQuery: boolean;
  useF16: boolean;
}

export interface ScopeFrameInput {
  /** Composited frame texture (linear working space, before output-conversion). */
  texture: GPUTexture;
  width: number;
  height: number;
  /** Reduced resolution for scope computation. */
  scopeResX: number;
  scopeResY: number;  // width and height params for scopes
  features: ScopeFeatures;
}

/** The magic constant for detecting torn SAB writes. */
const SCOPE_MAGIC_READY = 0x5C0E01;
const SCOPE_MAGIC_WRITING = 0;

// ─── SAB ring-buffer layout ────────────────────────────────────────────

/**
 * Four scope slots in a shared ring-buffer:
 *   slot 0: histogram  — 4 × 256 floats (R/G/B/Y bins) + header
 *   slot 1: waveform   — 2 × scopeResX floats (min/max per column) + header
 *   slot 2: parade     — 6 × scopeResX floats (Rmin/Rmax, Gmin/Gmax, Bmin/Bmax) + header
 *   slot 3: vectorscope — N × N u32 hit counts + header
 *
 * Each slot: [magic:f32, timestamp:f32, clipCount:u32, ...data]
 * Header = 3 floats (12 bytes). Writer writes magic=0 first, then data, then magic=SCOPE_MAGIC_READY.
 * Reader checks magic≠0 and re-checks after reading — if magic unchanged, data is valid.
 */

const SLOT_HEADER_FLOATS = 3;

export const SCOPE_HISTOGRAM_BINS = 256;
export const SCOPE_HISTOGRAM_CHANNELS = 4; // R, G, B, Y
export const SCOPE_HISTOGRAM_DATA_FLOATS = SCOPE_HISTOGRAM_BINS * SCOPE_HISTOGRAM_CHANNELS;
export const SCOPE_HISTOGRAM_SLOT_FLOATS = SLOT_HEADER_FLOATS + SCOPE_HISTOGRAM_DATA_FLOATS;

export const SCOPE_VECTORSCOPE_SIZE = 128;

export function scopeWaveformDataFloats(scopeResX: number): number {
  return 2 * scopeResX; // min/max per column
}

export function scopeParadeDataFloats(scopeResX: number): number {
  return 6 * scopeResX; // Rmin/Rmax, Gmin/Gmax, Bmin/Bmax per column
}

export function scopeVectorscopeDataFloats(): number {
  return SCOPE_VECTORSCOPE_SIZE * SCOPE_VECTORSCOPE_SIZE;
}

export function scopeTotalBufferFloats(scopeResX: number): number {
  return (
    SCOPE_HISTOGRAM_SLOT_FLOATS +
    SLOT_HEADER_FLOATS + scopeWaveformDataFloats(scopeResX) +
    SLOT_HEADER_FLOATS + scopeParadeDataFloats(scopeResX) +
    SLOT_HEADER_FLOATS + scopeVectorscopeDataFloats()
  );
}

export function scopeTotalBufferBytes(scopeResX: number): number {
  return scopeTotalBufferFloats(scopeResX) * Float32Array.BYTES_PER_ELEMENT;
}

// ─── Slot offsets ──────────────────────────────────────────────────────

export function histogramSlotOffset(): number {
  return 0;
}

export function waveformSlotOffset(_scopeResX: number): number {
  return SCOPE_HISTOGRAM_SLOT_FLOATS;
}

export function paradeSlotOffset(scopeResX: number): number {
  return waveformSlotOffset(scopeResX) + SLOT_HEADER_FLOATS + scopeWaveformDataFloats(scopeResX);
}

export function vectorscopeSlotOffset(scopeResX: number): number {
  return paradeSlotOffset(scopeResX) + SLOT_HEADER_FLOATS + scopeParadeDataFloats(scopeResX);
}

// ─── Scope result types ────────────────────────────────────────────────

export interface ScopeResult {
  type: ScopeType;
  timestamp: number;
  clipCount: number; // pixels clipped in working space (0–1 range exceeded)
  data: Float32Array;
}

// ─── Ring-buffer read (main thread) ────────────────────────────────────

export function readScopeResult(
  buffer: Float32Array,
  slotOffset: number,
  dataFloats: number,
): ScopeResult | null {
  // Read magic
  const magic = buffer[slotOffset];
  if (magic === SCOPE_MAGIC_WRITING) return null;

  // Read timestamp
  const timestamp = buffer[slotOffset + 1];
  const clipCount = buffer[slotOffset + 2];

  // Read data
  const data = buffer.slice(slotOffset + SLOT_HEADER_FLOATS, slotOffset + SLOT_HEADER_FLOATS + dataFloats);

  // Re-read magic to detect torn writes
  if (buffer[slotOffset] !== magic) return null;

  return {
    type: 'histogram', // caller overrides
    timestamp,
    clipCount: Math.round(clipCount),
    data: data as Float32Array,
  };
}

// ─── Ring-buffer write helpers (worker thread) ─────────────────────────

/** Begin writing a scope slot: set magic to 0 (writing). */
export function beginScopeWrite(buffer: Float32Array, slotOffset: number): void {
  buffer[slotOffset] = SCOPE_MAGIC_WRITING;
}

/** Complete a scope write: set magic to SCOPE_MAGIC_READY. */
export function endScopeWrite(buffer: Float32Array, slotOffset: number): void {
  buffer[slotOffset] = SCOPE_MAGIC_READY;
}

/** Write header fields (timestamp, clipCount) to the slot. */
export function writeScopeHeader(
  buffer: Float32Array,
  slotOffset: number,
  timestamp: number,
  clipCount: number,
): void {
  buffer[slotOffset + 1] = timestamp;
  buffer[slotOffset + 2] = clipCount;
}

/** Write scope data at the data offset within the slot. */
export function writeScopeData(
  buffer: Float32Array,
  slotOffset: number,
  data: Float32Array,
): void {
  buffer.set(data, slotOffset + SLOT_HEADER_FLOATS);
}
