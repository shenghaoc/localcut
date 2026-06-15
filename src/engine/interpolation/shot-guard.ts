/**
 * Shot-boundary guard for frame interpolation (Phase 37, R10). Pure,
 * GPU-free functions that filter source frame pairs against Phase 33
 * detected shot/scene boundaries so that synthesis never bridges two
 * unrelated shots.
 *
 * A shot boundary at time B means frames at t < B and t > B belong to
 * different scenes. Any source pair (F0 @ t0, F1 @ t1) where t0 < B ≤ t1
 * is refused; the interval falls back to frame hold/duplication.
 */

/** A detected shot boundary (from Phase 33). */
export interface ShotBoundary {
	/** Time of the boundary in seconds (or frame-index units, consistent with the timeline). */
	time: number;
}

/** A source frame pair that may or may not be synthesisable. */
export interface SourcePair {
	/** Index of the preceding frame (F0). */
	index0: number;
	/** Index of the following frame (F1). */
	index1: number;
	/** Time of F0. */
	time0: number;
	/** Time of F1. */
	time1: number;
}

/** Result of the shot-guard filter for one pair. */
export interface PairGuardResult {
	pair: SourcePair;
	/** True if this pair is safe to synthesise (no boundary in between). */
	synthesisable: boolean;
	/** If not synthesisable, the boundary that caused the refusal. */
	refusingBoundary?: ShotBoundary;
}

/**
 * Determine which source pairs may be synthesised and which must hold.
 *
 * A pair (t0, t1) is refused if any boundary B satisfies t0 < B ≤ t1.
 * A boundary exactly at t0 is allowed (it marks the start of the new shot,
 * so F0 is already in the new shot). A boundary exactly at t1 is refused
 * (F1 is the first frame of the next shot).
 *
 * Boundaries are assumed sorted by time for efficiency, but correctness
 * does not depend on sorting.
 */
export function filterPairsByBoundaries(
	pairs: readonly SourcePair[],
	boundaries: readonly ShotBoundary[]
): PairGuardResult[] {
	if (boundaries.length === 0) {
		return pairs.map((pair) => ({ pair, synthesisable: true }));
	}

	// Sort boundaries once for binary search
	const sorted = [...boundaries].sort((a, b) => a.time - b.time);

	return pairs.map((pair) => {
		for (const boundary of sorted) {
			if (pair.time0 < boundary.time && boundary.time <= pair.time1) {
				return {
					pair,
					synthesisable: false,
					refusingBoundary: boundary
				};
			}
		}
		return { pair, synthesisable: true };
	});
}

/**
 * Convenience: check a single instant against boundaries.
 *
 * Returns true if the instant's bracketing pair would cross a boundary,
 * i.e. if any boundary lies in (sourceTime, sourceTime + intervalDuration].
 */
export function instantCrossesBoundary(
	sourceTime: number,
	intervalDuration: number,
	boundaries: readonly ShotBoundary[]
): boolean {
	const t0 = sourceTime;
	const t1 = sourceTime + intervalDuration;
	return boundaries.some((b) => t0 < b.time && b.time <= t1);
}
