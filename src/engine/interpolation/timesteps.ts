/**
 * Frame interpolation timestep math (Phase 37). Pure, GPU-free functions that
 * compute output instants from a slowdown factor or target fps, bracket each
 * instant to its source pair + fractional tau, and enforce the ≤4× per-source-
 * pair density cap with clamp-and-report.
 *
 * All functions are deterministic and side-effect-free; they operate on plain
 * numbers/arrays and never touch VideoFrame, GPU, or model resources.
 */

/**
 * Maximum density multiplier per source interval in v1 (R3.3).
 * A 4× factor means at most 3 synthesised frames inside any one source interval
 * (the 2 source frames + 3 intermediates = 4 total frames per interval).
 */
export const MAX_FACTOR_PER_PAIR = 4;

/** A single output instant to synthesise. */
export interface OutputInstant {
	/** Index of the preceding source frame (F0). */
	sourceIndex: number;
	/** Fractional position between F0 (0) and F1 (1). tau ∈ (0, 1). */
	tau: number;
	/** Wall-clock time of this instant in seconds (for diagnostics/shot-guard). */
	time: number;
}

/** Result of computing output instants, with optional clamp warning. */
export interface TimestepResult {
	instants: readonly OutputInstant[];
	/** If the requested factor exceeded the cap, this is set with the reason. */
	clamped?: { requested: number; effective: number; reason: string };
}

/**
 * Compute output instants for a slow-motion segment.
 *
 * Given `sourceCount` source frames at `sourceFps` and a slowdown `factor`
 * (e.g. 2 means each source interval produces 2 output frames → 50% speed),
 * returns the intermediate instants that must be synthesised. Source frames
 * themselves are not included — only the in-between positions.
 *
 * The factor is capped at MAX_FACTOR_PER_PAIR; requests beyond the cap are
 * clamped with a warning (R3.3, R7.2).
 */
export function computeSlowmoInstants(sourceCount: number, factor: number): TimestepResult {
	if (sourceCount < 2 || factor < 1) {
		return { instants: [] };
	}

	let effectiveFactor = Math.floor(factor);
	const clamped: TimestepResult['clamped'] =
		effectiveFactor > MAX_FACTOR_PER_PAIR
			? {
					requested: factor,
					effective: MAX_FACTOR_PER_PAIR,
					reason: `Factor ${factor}× exceeds the ${MAX_FACTOR_PER_PAIR}× per-source-pair cap; clamped to ${MAX_FACTOR_PER_PAIR}×.`
				}
			: undefined;

	if (effectiveFactor > MAX_FACTOR_PER_PAIR) {
		effectiveFactor = MAX_FACTOR_PER_PAIR;
	}

	// For each source interval [i, i+1], synthesise (effectiveFactor - 1) intermediate
	// frames at evenly-spaced tau positions: 1/effectiveFactor, 2/effectiveFactor, ...
	// e.g. 2× → 1 intermediate at tau=0.5; 4× → 3 intermediates at tau=0.25,0.5,0.75
	const instants: OutputInstant[] = [];
	const intervalCount = sourceCount - 1;
	const intermediateCount = effectiveFactor - 1;

	for (let interval = 0; interval < intervalCount; interval++) {
		for (let k = 1; k <= intermediateCount; k++) {
			const tau = k / effectiveFactor;
			// time is expressed as a fractional frame index for shot-guard matching
			instants.push({
				sourceIndex: interval,
				tau,
				time: interval + tau
			});
		}
	}

	return { instants, clamped };
}

/**
 * Compute output instants for fps upconversion at export (R8).
 *
 * Given a source at `sourceFps` and a target export fps `targetFps`, computes
 * the output frame schedule and brackets each frame to its source pair + tau.
 * Returns both the synthesised instants and the total output frame count
 * (including unmodified source frames).
 *
 * The per-interval density is capped at MAX_FACTOR_PER_PAIR; output instants
 * that would exceed the cap are clamped with a warning.
 */
export function computeFpsUpconvertInstants(
	sourceFrameCount: number,
	sourceFps: number,
	targetFps: number
): TimestepResult & { totalOutputFrames: number } {
	if (sourceFrameCount < 2 || targetFps <= sourceFps) {
		return { instants: [], totalOutputFrames: sourceFrameCount };
	}

	const ratio = targetFps / sourceFps;

	// Total output frames = ceil(sourceFrameCount * ratio) but at least sourceFrameCount
	const totalOutputFrames = Math.max(sourceFrameCount, Math.ceil(sourceFrameCount * ratio));

	// Generate output timeline: each output frame has a time in source-frame units
	const instants: OutputInstant[] = [];
	// O(1) per-interval density counter (avoids O(n²) filter scan)
	const intervalCounts = new Map<number, number>();
	let clamped: TimestepResult['clamped'] | undefined;

	// Map each output frame to its source pair
	// outputTime[i] = i / ratio  (in source-frame units)
	for (let outIdx = 0; outIdx < totalOutputFrames; outIdx++) {
		const sourceTime = outIdx / ratio;
		const sourceIndex = Math.floor(sourceTime);

		// Skip if this lands exactly on a source frame (no synthesis needed)
		const tau = sourceTime - sourceIndex;
		if (tau < 1e-9 || sourceIndex >= sourceFrameCount - 1) {
			continue;
		}

		// Check per-interval density cap
		const existingInInterval = intervalCounts.get(sourceIndex) ?? 0;
		if (existingInInterval >= MAX_FACTOR_PER_PAIR - 1) {
			if (!clamped) {
				clamped = {
					requested: ratio,
					effective: MAX_FACTOR_PER_PAIR,
					reason: `fps upconversion ratio ${ratio.toFixed(2)}× produces more than ${MAX_FACTOR_PER_PAIR} synthesised frames per source interval in some intervals; excess instants dropped.`
				};
			}
			continue;
		}

		intervalCounts.set(sourceIndex, existingInInterval + 1);
		instants.push({
			sourceIndex,
			tau,
			time: sourceTime
		});
	}

	return { instants, clamped, totalOutputFrames };
}

/**
 * Bracket an arbitrary output time to its source pair + tau.
 *
 * Given a continuous output time in source-frame units, returns the source
 * pair index and fractional position. Used by the synthesis pipeline to
 * resolve which decoded frames to read and what tau to pass to the model.
 */
export function bracketInstant(
	outputTime: number,
	sourceFrameCount: number
): { sourceIndex: number; tau: number } | null {
	if (outputTime < 0 || sourceFrameCount < 2) return null;

	const sourceIndex = Math.floor(outputTime);
	if (sourceIndex >= sourceFrameCount - 1) return null;

	const tau = outputTime - sourceIndex;
	// Clamp tau to (0, 1) exclusive — exact 0 or 1 means it's a source frame
	if (tau < 1e-9 || tau > 1 - 1e-9) return null;

	return { sourceIndex, tau };
}
