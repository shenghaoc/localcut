/** Phase 32b: Beauty effect parameters, SUBTLE preset, clamping, and uniform packing.
 *
 *  The beauty effect is a clip-level sidecar (like skinMask), not part of the
 *  scalar colour-grade effect chain. This module defines defaults, presets,
 *  clamping, effective-strength calculation, and WGSL uniform/storage packing.
 */

import type { BeautyEffectSnapshot, BeautyPreset } from '../../protocol';
import { DEFAULT_BEAUTY_EFFECT } from '../../protocol';

// ─── Constants ──────────────────────────────────────────────────────────

/** Landmark topology: 478 landmarks × 3 coordinates (x, y, z). */
export const LANDMARK_COUNT = 478;
export const LANDMARK_COORDS = 3;
export const LANDMARK_FLOATS = LANDMARK_COUNT * LANDMARK_COORDS;

/** Maximum number of landmark samples in the bounded ring buffer. */
export const LANDMARK_RING_CAPACITY = 4;

// ─── Clamp ranges ───────────────────────────────────────────────────────

export interface BeautyClampRange {
	min: number;
	max: number;
}

export const BEAUTY_CLAMP_RANGES: Record<
	keyof Omit<BeautyEffectSnapshot, 'enabled' | 'modelId' | 'modelVersion' | 'preset'>,
	BeautyClampRange
> = {
	masterStrength: { min: 0, max: 1 },
	jawSlim: { min: 0, max: 1 },
	eyeEnlarge: { min: 0, max: 1 },
	noseWidth: { min: 0, max: 1 },
	mouth: { min: 0, max: 1 }
};

// ─── SUBTLE preset ──────────────────────────────────────────────────────

export const SUBTLE_PRESET: Omit<
	BeautyEffectSnapshot,
	'enabled' | 'modelId' | 'modelVersion' | 'preset'
> = {
	masterStrength: 0.5,
	jawSlim: 0.3,
	eyeEnlarge: 0.15,
	noseWidth: 0.1,
	mouth: 0.1
};

export const PRESETS: Record<BeautyPreset, typeof SUBTLE_PRESET> = {
	subtle: SUBTLE_PRESET,
	custom: SUBTLE_PRESET // custom starts from subtle; user overrides individual values
};

// ─── Helpers ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function clampFinite(v: number | undefined, key: keyof typeof BEAUTY_CLAMP_RANGES): number {
	const range = BEAUTY_CLAMP_RANGES[key];
	if (v === undefined || v === null || !Number.isFinite(v)) {
		return DEFAULT_BEAUTY_EFFECT[key];
	}
	return clamp(v, range.min, range.max);
}

// ─── Normalize ──────────────────────────────────────────────────────────

/** Clamp/validate beauty parameters to conservative ranges. */
export function normalizeBeautyEffect(
	partial: Partial<BeautyEffectSnapshot> | undefined
): BeautyEffectSnapshot {
	const raw = partial ?? {};
	return {
		enabled: raw.enabled ?? DEFAULT_BEAUTY_EFFECT.enabled,
		modelId:
			typeof raw.modelId === 'string' && raw.modelId.length > 0
				? raw.modelId
				: DEFAULT_BEAUTY_EFFECT.modelId,
		modelVersion: raw.modelVersion ?? DEFAULT_BEAUTY_EFFECT.modelVersion,
		preset: raw.preset ?? DEFAULT_BEAUTY_EFFECT.preset,
		masterStrength: clampFinite(raw.masterStrength, 'masterStrength'),
		jawSlim: clampFinite(raw.jawSlim, 'jawSlim'),
		eyeEnlarge: clampFinite(raw.eyeEnlarge, 'eyeEnlarge'),
		noseWidth: clampFinite(raw.noseWidth, 'noseWidth'),
		mouth: clampFinite(raw.mouth, 'mouth')
	};
}

// ─── Effective strength ─────────────────────────────────────────────────

/** Returns true when the beauty effect should run (any parameter non-zero). */
export function isBeautyActive(beauty: BeautyEffectSnapshot | undefined): boolean {
	if (!beauty || !beauty.enabled) return false;
	return effectiveStrength(beauty) > 0;
}

/** Combined effective strength: masterStrength × max of all sub-params. */
export function effectiveStrength(beauty: BeautyEffectSnapshot): number {
	const maxSub = Math.max(beauty.jawSlim, beauty.eyeEnlarge, beauty.noseWidth, beauty.mouth);
	return beauty.masterStrength * maxSub;
}

// ─── Uniform packing ────────────────────────────────────────────────────

/**
 * Pack beauty warp uniforms into a Float32Array for the WGSL compute pass.
 *
 * Layout (16 floats = 64 bytes):
 *   [0]  masterStrength
 *   [1]  jawSlim
 *   [2]  eyeEnlarge
 *   [3]  noseWidth
 *   [4]  mouth
 *   [5]  topologyVersion (reserved, 0 for v1)
 *   [6]  featherFalloff
 *   [7]  pad
 *   [8-15] reserved
 */
export function packBeautyUniform(beauty: BeautyEffectSnapshot): Float32Array {
	const buf = new Float32Array(16);
	buf[0] = beauty.masterStrength;
	buf[1] = beauty.jawSlim;
	buf[2] = beauty.eyeEnlarge;
	buf[3] = beauty.noseWidth;
	buf[4] = beauty.mouth;
	buf[5] = 0; // topologyVersion
	buf[6] = 0.15; // featherFalloff (normalized)
	buf[7] = 0; // pad
	return buf;
}

/**
 * Pack landmark data into a storage buffer for WGSL consumption.
 * Input: Float32Array of 478×3 normalized clip-local coordinates.
 * Output: the same buffer (already Float32, no conversion needed).
 */
export function packLandmarkBuffer(landmarks: Float32Array): Float32Array {
	if (landmarks.length < LANDMARK_FLOATS) {
		const padded = new Float32Array(LANDMARK_FLOATS);
		padded.set(landmarks);
		return padded;
	}
	if (landmarks.length > LANDMARK_FLOATS) {
		return landmarks.slice(0, LANDMARK_FLOATS);
	}
	return landmarks;
}
