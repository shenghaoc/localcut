/**
 * Frame synthesis orchestration (Phase 37, T3.2). Coordinates the full
 * pipeline: bracketing pair → tau → per-tile preprocess → device-resident
 * session.run → postprocess → stitch → F_t.
 *
 * For models that support arbitrary fractional tau (like FILM), single-step
 * synthesis at the target tau is preferred over recursive subdivision.
 * For models restricted to half-interval interpolation, recursive subdivision
 * is bounded by the ≤4× cap.
 *
 * **Stub:** the actual GPU pipeline depends on T0 spikes (device-resident
 * tensors) and T3.1 (preprocess/postprocess shaders). This module defines
 * the orchestration logic and types; the real implementation fills in once
 * the prerequisites pass.
 */

import type { TilePlan } from './tiling';
import type { InterpolationEngine } from './interpolation-engine';
import type { ShotBoundary } from './shot-guard';
import { filterPairsByBoundaries, type SourcePair } from './shot-guard';
import { computeSlowmoInstants } from './timesteps';

/** A synthesised intermediate frame. */
export interface SynthesisedFrame {
	/** The synthesised output frame as a GPU texture (caller owns/destroys). */
	frame: GPUTexture;
	/** Time of this frame in source-frame units. */
	time: number;
	/** Source pair index. */
	sourceIndex: number;
	/** Fractional tau used. */
	tau: number;
}

/** Result of a synthesis operation. */
export interface SynthesisResult {
	/** Successfully synthesised frames. */
	frames: readonly SynthesisedFrame[];
	/** Pairs that were refused due to shot boundaries. */
	refusals: { sourceIndex: number; boundary: ShotBoundary }[];
	/** Total synthesis time in milliseconds. */
	elapsedMs: number;
}

/** Configuration for frame synthesis. */
export interface SynthesisConfig {
	/** The tile plan for the current resolution (required — must match source dimensions). */
	tilePlan: TilePlan;
	/** Maximum factor per source pair (default 4). */
	maxFactorPerPair: number;
	/** Whether to use single-step synthesis (preferred for FILM). */
	singleStepPreferred: boolean;
}

/**
 * Synthesise intermediate frames for a set of output instants.
 *
 * For each instant (sourceIndex, tau), this function:
 * 1. Checks the shot-guard (refuses pairs crossing boundaries)
 * 2. Plans tiles for the current resolution
 * 3. Per tile: preprocess → session.run → postprocess
 * 4. Stitches tiles into the output frame
 * 5. Closes source frames exactly once
 *
 * **Stub:** the actual GPU pipeline depends on T0/T3.1.
 */
export async function synthesiseFrames(
	engine: InterpolationEngine,
	sourceFrames: readonly VideoFrame[],
	outputInstants: readonly { sourceIndex: number; tau: number; time: number }[],
	boundaries: readonly ShotBoundary[],
	config: SynthesisConfig
): Promise<SynthesisResult> {
	const cfg = {
		...config,
		maxFactorPerPair: config.maxFactorPerPair ?? 4,
		singleStepPreferred: config.singleStepPreferred ?? true
	};
	const startTime = performance.now();
	const frames: SynthesisedFrame[] = [];
	const refusals: SynthesisResult['refusals'] = [];

	// Build source pairs from instants
	const pairs: SourcePair[] = [];
	const seenPairs = new Set<string>();
	for (const instant of outputInstants) {
		const key = `${instant.sourceIndex}`;
		if (!seenPairs.has(key)) {
			seenPairs.add(key);
			pairs.push({
				index0: instant.sourceIndex,
				index1: instant.sourceIndex + 1,
				time0: instant.sourceIndex,
				time1: instant.sourceIndex + 1
			});
		}
	}

	// Filter through shot-guard
	const guardResults = filterPairsByBoundaries(pairs, boundaries);
	const refusedPairs = new Set<number>();
	for (const result of guardResults) {
		if (!result.synthesisable && result.refusingBoundary) {
			refusedPairs.add(result.pair.index0);
			refusals.push({
				sourceIndex: result.pair.index0,
				boundary: result.refusingBoundary
			});
		}
	}

	// Synthesise each instant on the ORT WebGPU engine. The engine borrows the
	// frame pair (it does not close them); the caller owns `sourceFrames`. Errors
	// propagate to the caller — no silent swallowing.
	for (const instant of outputInstants) {
		if (refusedPairs.has(instant.sourceIndex)) continue;
		const f0 = sourceFrames[instant.sourceIndex];
		const f1 = sourceFrames[instant.sourceIndex + 1];
		if (!f0 || !f1) continue;
		const frame = await engine.synthesise(
			f0,
			f1,
			instant.tau,
			f0.displayWidth,
			f0.displayHeight,
			cfg.tilePlan
		);
		frames.push({ frame, time: instant.time, sourceIndex: instant.sourceIndex, tau: instant.tau });
	}

	return {
		frames,
		refusals,
		elapsedMs: performance.now() - startTime
	};
}

/**
 * Compute output instants for a slow-motion segment with synthesis.
 *
 * Thin adapter over the canonical {@link computeSlowmoInstants} (`timesteps.ts`),
 * which is the single source of truth for the ≤4× per-source-pair cap and the
 * clamp-and-report policy. Prefer `computeSlowmoInstants` directly in new code;
 * this wrapper preserves the boolean-`clamped` shape used by existing callers.
 */
export function computeSynthesisInstants(
	sourceCount: number,
	factor: number
): { instants: readonly { sourceIndex: number; tau: number; time: number }[]; clamped: boolean } {
	const result = computeSlowmoInstants(sourceCount, factor);
	return { instants: result.instants, clamped: result.clamped !== undefined };
}
