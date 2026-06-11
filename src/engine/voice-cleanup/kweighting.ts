/**
 * BS.1770-4 K-weighting biquad chain for one channel.
 *
 * Two cascaded biquad filters (Direct Form I):
 *   Stage 1 — Pre-filter (high-shelf)
 *   Stage 2 — RLB high-pass
 *
 * Coefficients are for 48 kHz. The implementation does not resample;
 * callers at other sample rates should resample to 48 kHz before feeding.
 */

/** Mutable biquad state for one channel's K-weighting chain. */
export interface KWeightState {
	// Stage 1 (pre-filter) state
	x1: number;
	x2: number;
	y1: number;
	y2: number;
	// Stage 2 (RLB high-pass) state
	x1b: number;
	x2b: number;
	y1b: number;
	y2b: number;
}

/** Create a zeroed K-weighting state. */
export function createKWeightState(): KWeightState {
	return { x1: 0, x2: 0, y1: 0, y2: 0, x1b: 0, x2b: 0, y1b: 0, y2b: 0 };
}

// Stage 1 — Pre-filter (high-shelf) coefficients at 48 kHz
const S1_B0 = 1.53512485958697;
const S1_B1 = -2.69169618940638;
const S1_B2 = 1.19839281085285;
const S1_A1 = -1.69065929318241;
const S1_A2 = 0.73248077421585;

// Stage 2 — RLB high-pass coefficients at 48 kHz
const S2_B0 = 1.0;
const S2_B1 = -2.0;
const S2_B2 = 1.0;
const S2_A1 = -1.99004745483398;
const S2_A2 = 0.99007225036616;

/**
 * Apply K-weighting to a mono block in place. State carries across calls
 * (never reset between windows). Returns the same buffer for chaining.
 */
export function kWeightBlock(
	input: Float32Array,
	state: KWeightState,
): Float32Array {
	let { x1, x2, y1, y2, x1b, x2b, y1b, y2b } = state;

	for (let i = 0; i < input.length; i++) {
		const x0 = input[i];

		// Stage 1: pre-filter (high-shelf)
		const y0 = S1_B0 * x0 + S1_B1 * x1 + S1_B2 * x2 - S1_A1 * y1 - S1_A2 * y2;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;

		// Stage 2: RLB high-pass
		const y0b = S2_B0 * y0 + S2_B1 * x1b + S2_B2 * x2b - S2_A1 * y1b - S2_A2 * y2b;
		x2b = x1b;
		x1b = y0;
		y2b = y1b;
		y1b = y0b;

		input[i] = y0b;
	}

	// Write back mutated state
	state.x1 = x1;
	state.x2 = x2;
	state.y1 = y1;
	state.y2 = y2;
	state.x1b = x1b;
	state.x2b = x2b;
	state.y1b = y1b;
	state.y2b = y2b;

	return input;
}
