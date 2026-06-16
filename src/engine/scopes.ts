// Scope diagnostics — Phase 21.
//
// WebGPU compute-based histogram, luma waveform, RGB parade, and vectorscope.
// Results are written to a SharedArrayBuffer ring-buffer for the main thread to
// consume and render via Canvas2D (display only). No getImageData ever.

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * Phase 21 scopes feature flag (B7).
 *
 * The full scope UI/worker/SAB/throttling pipeline is unfinished: `dispatchScopes`
 * is a placeholder and no scope panel is wired into the app. Until the pipeline
 * is complete, scopes must be impossible to enable so no scope pass ever runs by
 * default. Flip this to `true` only when the end-to-end path lands.
 */
export const SCOPES_FEATURE_ENABLED = false;

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
	scopeResY: number; // width and height params for scopes
	features: ScopeFeatures;
}

// ─── SAB ring-buffer layout ────────────────────────────────────────────

/**
 * Each scope slot in the SAB ring-buffer:
 *   [0] sequence: f32 (incrementing counter, odd = writing, even = stable)
 *   [1] timestamp: f32 (frame time)
 *   [2] clipCount: u32 (pixels clipped this frame)
 *   [3..N] data: f32[] (scope-specific layout)
 *
 * Writer protocol:
 *   1. Increment sequence to an odd value (marks "writing").
 *   2. Write timestamp, clipCount, and data.
 *   3. Increment sequence to the next even value (marks "ready").
 *
 * Reader protocol:
 *   1. Read sequence → s1.
 *   2. If s1 is odd, skip (writer is active).
 *   3. Read timestamp + data.
 *   4. Read sequence → s2.
 *   5. If s1 !== s2, torn write detected — discard and retry.
 *
 * An incrementing counter is stronger than a binary magic because a rapid
 * double-write cannot produce a false match.
 */

const SLOT_HEADER_FLOATS = 3; // [sequence, timestamp, clipCount]

/** Sequence counter for the writer — increments by 2 each write (odd=during write, even=ready). */
let _scopeWriteSeq = 0;

export const SCOPE_HISTOGRAM_BINS = 256;
export const SCOPE_HISTOGRAM_CHANNELS = 4; // R, G, B, Y
export const SCOPE_HISTOGRAM_DATA_FLOATS = SCOPE_HISTOGRAM_BINS * SCOPE_HISTOGRAM_CHANNELS;
export const SCOPE_HISTOGRAM_SLOT_FLOATS = SLOT_HEADER_FLOATS + SCOPE_HISTOGRAM_DATA_FLOATS;

export const SCOPE_VECTORSCOPE_SIZE = 128;

/**
 * Horizontal column count for waveform + parade scopes. Producer (worker
 * compositor) and consumer (UI ScopePanel) share this constant so the SAB
 * layout, GPU storage sizing, and Canvas2D paint loop stay in lock-step.
 */
export const SCOPE_RES_X = 256;

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
		SLOT_HEADER_FLOATS +
		scopeWaveformDataFloats(scopeResX) +
		SLOT_HEADER_FLOATS +
		scopeParadeDataFloats(scopeResX) +
		SLOT_HEADER_FLOATS +
		scopeVectorscopeDataFloats()
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
	dataFloats: number
): ScopeResult | null {
	// Read sequence — odd means writer is active
	const s1 = buffer[slotOffset];
	if (Math.round(s1) % 2 !== 0) return null;

	// Read timestamp and clipCount
	const timestamp = buffer[slotOffset + 1];
	const clipCount = buffer[slotOffset + 2];

	// Read data
	const dataStart = slotOffset + SLOT_HEADER_FLOATS;
	const data = buffer.slice(dataStart, dataStart + dataFloats);

	// Re-read sequence — if changed, torn write
	const s2 = buffer[slotOffset];
	if (s1 !== s2) return null;

	return {
		type: 'histogram', // caller overrides
		timestamp,
		clipCount: Math.round(clipCount),
		data: data as Float32Array
	};
}

// ─── Ring-buffer write helpers (worker thread) ─────────────────────────

/**
 * Zero a scope slot's header + data region before accumulation. Scope passes
 * accumulate (histogram bins, waveform min/max) into the SAB slot, so the slot
 * must be reset before each dispatch or stale values from the previous frame leak
 * into the new result. Returns the number of floats cleared.
 */
export function resetScopeSlot(
	buffer: Float32Array,
	slotOffset: number,
	dataFloats: number
): number {
	// Preserve the sequence counter at `slotOffset` (the seqlock guard): zeroing it
	// would briefly publish an even value over a half-cleared slot, letting a
	// concurrent main-thread reader treat it as stable and read garbage. Only the
	// timestamp/clipCount header fields and the data region are cleared; the writer
	// owns the sequence via beginScopeWrite/endScopeWrite.
	const start = slotOffset + 1;
	const count = SLOT_HEADER_FLOATS - 1 + dataFloats;
	buffer.fill(0, start, start + count);
	return count + 1;
}

/** Begin writing a scope slot: set sequence to odd value (writer is active). */
export function beginScopeWrite(buffer: Float32Array, slotOffset: number): number {
	_scopeWriteSeq += 1; // odd number
	buffer[slotOffset] = _scopeWriteSeq;
	return _scopeWriteSeq;
}

/** Complete a scope write: set sequence to the next even value (data ready). */
export function endScopeWrite(buffer: Float32Array, slotOffset: number): void {
	_scopeWriteSeq += 1; // even number
	buffer[slotOffset] = _scopeWriteSeq;
}

/** Write header fields (timestamp, clipCount) to the slot. */
export function writeScopeHeader(
	buffer: Float32Array,
	slotOffset: number,
	timestamp: number,
	clipCount: number
): void {
	buffer[slotOffset + 1] = timestamp;
	buffer[slotOffset + 2] = clipCount;
}

/** Write scope data at the data offset within the slot. */
export function writeScopeData(buffer: Float32Array, slotOffset: number, data: Float32Array): void {
	buffer.set(data, slotOffset + SLOT_HEADER_FLOATS);
}
