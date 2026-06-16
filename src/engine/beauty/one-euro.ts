/** Phase 32b: One-Euro filter for landmark smoothing.
 *
 *  Implements the One-Euro filter (Casiez et al., 2012) for 478×3 landmark
 *  coordinates using contiguous Float32Array buffers to avoid per-frame GC
 *  pressure. All state (previous values, derivatives, smoothing factors) lives
 *  in flat arrays updated in a single loop.
 *
 *  Reference: https://cristal.univ-lille.fr/~casiez/1euro/
 */

import { LANDMARK_FLOATS } from './beauty-params';

// ─── Types ──────────────────────────────────────────────────────────────

export interface OneEuroConfig {
	/** Minimum cutoff frequency (Hz). Lower values = more smoothing. */
	minCutoff: number;
	/** Speed coefficient. Higher values = less lag during fast motion. */
	beta: number;
	/** Derivative cutoff frequency (Hz). Usually 1.0. */
	dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = {
	minCutoff: 1.0,
	beta: 0.007,
	dCutoff: 1.0
};

// ─── Smoothing factor ───────────────────────────────────────────────────

/** Compute the smoothing factor alpha from cutoff frequency and dt. */
function smoothingFactor(dt: number, cutoff: number): number {
	const tau = 1.0 / (2.0 * Math.PI * cutoff);
	return 1.0 / (1.0 + tau / dt);
}

// ─── Filter state ───────────────────────────────────────────────────────

/**
 * Contiguous filter state for LANDMARK_FLOATS coordinates.
 * Three Float32Arrays: previous filtered values, previous derivatives,
 * and per-sample smoothing factors (recomputed each frame from speed).
 */
export interface OneEuroState {
	/** Previous filtered values [LANDMARK_FLOATS]. */
	prev: Float32Array;
	/** Previous derivatives [LANDMARK_FLOATS]. */
	prevDeriv: Float32Array;
	/** Whether the filter has been initialized (first sample). */
	initialized: boolean;
}

/** Allocate fresh filter state. */
export function createOneEuroState(): OneEuroState {
	return {
		prev: new Float32Array(LANDMARK_FLOATS),
		prevDeriv: new Float32Array(LANDMARK_FLOATS),
		initialized: false
	};
}

/** Reset filter state (on scene cut, confidence loss, or face handoff). */
export function resetOneEuroState(state: OneEuroState): void {
	state.prev.fill(0);
	state.prevDeriv.fill(0);
	state.initialized = false;
}

// ─── Filter application ─────────────────────────────────────────────────

/**
 * Apply One-Euro filter to landmark coordinates in-place.
 *
 * @param state - Mutable filter state (updated in-place).
 * @param raw - Raw landmark values [LANDMARK_FLOATS] (not mutated).
 * @param dt - Time delta in seconds since last sample.
 * @param config - Filter configuration.
 * @param out - Output buffer [LANDMARK_FLOATS] (may alias raw).
 */
export function applyOneEuro(
	state: OneEuroState,
	raw: Float32Array,
	dt: number,
	config: OneEuroConfig,
	out: Float32Array
): void {
	if (dt <= 0) {
		out.set(raw.subarray(0, LANDMARK_FLOATS));
		return;
	}

	const { minCutoff, beta, dCutoff } = config;
	const alphaDeriv = smoothingFactor(dt, dCutoff);

	if (!state.initialized) {
		// First sample: copy raw values, zero derivatives
		for (let i = 0; i < LANDMARK_FLOATS; i++) {
			state.prev[i] = raw[i]!;
			state.prevDeriv[i] = 0;
			out[i] = raw[i]!;
		}
		state.initialized = true;
		return;
	}

	// Single loop over all coordinates
	for (let i = 0; i < LANDMARK_FLOATS; i++) {
		const rawVal = raw[i]!;
		const prevVal = state.prev[i]!;

		// Derivative estimate (exponential smoothing)
		const rawDeriv = (rawVal - prevVal) / dt;
		const deriv = alphaDeriv * rawDeriv + (1 - alphaDeriv) * state.prevDeriv[i]!;

		// Adaptive cutoff: higher when moving fast to reduce lag
		const speed = Math.abs(deriv);
		const cutoff = minCutoff + beta * speed;
		const alpha = smoothingFactor(dt, cutoff);

		// Filtered value
		const filtered = alpha * rawVal + (1 - alpha) * prevVal;

		state.prev[i] = filtered;
		state.prevDeriv[i] = deriv;
		out[i] = filtered;
	}
}
