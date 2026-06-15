/**
 * Time estimate for frame interpolation (Phase 37, R5). Pure, GPU-free
 * functions that compute a probe-derived synthesis time estimate before
 * every run.
 *
 * ms-per-tile comes from a one-time calibration micro-benchmark that runs
 * the loaded model on a single synthetic tile at the planned tile size,
 * cached per hardware/accelerator profile (R5.2). The estimate math is
 * unit-tested against recorded profile fixtures (R5.3).
 */

import type { TilePlan } from './tiling';

/** Accelerator used for interpolation (subset relevant to Phase 37). */
export type InterpolationAccelerator = 'webgpu' | 'webnn';

/**
 * Calibration profile: one-time measurement of per-tile inference latency.
 * Cached per {accelerator, hardware} combination (R5.2).
 */
export interface CalibrationProfile {
	accelerator: InterpolationAccelerator;
	/** Measured milliseconds per tile (single model run on one tile). */
	msPerTile: number;
	/** Tile pixel count the measurement was taken at. */
	tilePixels: number;
	/** Fixed overhead per synthesis call (session setup, memory alloc, etc.). */
	overheadMs: number;
}

/**
 * Estimate synthesis time in milliseconds for a given number of output frames.
 *
 * @param frames - Number of synthesised frames (not including source frames).
 * @param plan - The tile plan (provides tile count and dimensions).
 * @param profile - Calibration profile with measured latency.
 * @param cachedFraction - Fraction of frames already in the render cache (0–1).
 *   Cache hits are excluded from the estimate (R5.4).
 * @returns Estimated wall time in milliseconds.
 */
export function estimateSynthesisMs(
	frames: number,
	plan: TilePlan,
	profile: CalibrationProfile,
	cachedFraction: number = 0
): number {
	if (frames <= 0) return 0;

	const tileCount = plan.tiles.length;
	const clampedCached = Math.max(0, Math.min(1, cachedFraction));
	const uncachedFrames = Math.max(0, Math.round(frames * (1 - clampedCached)));

	if (uncachedFrames === 0) return 0;

	// Scale msPerTile if the plan tiles differ from the calibration tile size
	const planTilePixels = plan.modelInputWidth * plan.modelInputHeight;
	const scaleFactor = profile.tilePixels > 0 ? planTilePixels / profile.tilePixels : 1;

	const scaledMsPerTile = profile.msPerTile * scaleFactor;
	const perFrameMs = tileCount * scaledMsPerTile;
	const totalMs = uncachedFrames * perFrameMs + profile.overheadMs;

	return Math.round(totalMs);
}

/**
 * Estimate synthesis time with human-readable breakdown.
 */
export function estimateSynthesisDetailed(
	frames: number,
	plan: TilePlan,
	profile: CalibrationProfile,
	cachedFraction: number = 0
): {
	totalMs: number;
	frames: number;
	tilesPerFrame: number;
	msPerTile: number;
	cachedFraction: number;
	accelerator: InterpolationAccelerator;
} {
	const tileCount = plan.tiles.length;
	const planTilePixels = plan.modelInputWidth * plan.modelInputHeight;
	const scaleFactor = profile.tilePixels > 0 ? planTilePixels / profile.tilePixels : 1;
	const scaledMsPerTile = profile.msPerTile * scaleFactor;
	const clampedCached = Math.max(0, Math.min(1, cachedFraction));

	return {
		totalMs: estimateSynthesisMs(frames, plan, profile, cachedFraction),
		frames,
		tilesPerFrame: tileCount,
		msPerTile: Math.round(scaledMsPerTile),
		cachedFraction: clampedCached,
		accelerator: profile.accelerator
	};
}

/**
 * Format an estimate in milliseconds to a human-readable duration string.
 */
export function formatEstimate(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}
