/** Phase 32b: Inference cadence scheduler.
 *
 *  Derives a detection cadence from the project frame rate and measured
 *  runtime cost, defaulting to ≤10 Hz for 30 fps footage. Cadence can
 *  drop under load but must be reported in diagnostics.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface CadenceConfig {
	/** Project frames per second. */
	projectFps: number;
	/** Target maximum inference frequency (Hz). Default: 10. */
	maxHz: number;
	/** Measured inference p95 in seconds (0 = no measurement yet). */
	measuredP95S: number;
	/** Realtime budget fraction: inference must not exceed this × frame duration. */
	realtimeBudgetFraction: number;
}

export interface CadenceState {
	/** Solve every N frames (≥ 1). */
	solveInterval: number;
	/** Actual cadence in Hz. */
	cadenceHz: number;
	/** Frame counter since last solve. */
	frameCounter: number;
	/** Whether the next frame should trigger a solve. */
	shouldSolve: boolean;
}

export const DEFAULT_CADENCE_CONFIG: CadenceConfig = {
	projectFps: 30,
	maxHz: 10,
	measuredP95S: 0,
	realtimeBudgetFraction: 0.5
};

// ─── Cadence calculation ────────────────────────────────────────────────

/** Derive solve interval from project fps and max Hz. */
export function deriveSolveInterval(projectFps: number, maxHz: number): number {
	if (projectFps <= 0 || maxHz <= 0) return 1;
	return Math.max(1, Math.ceil(projectFps / maxHz));
}

/**
 * Adapt cadence under load: if measured inference p95 exceeds the realtime
 * budget, increase the interval until preview stays realtime.
 */
export function adaptCadence(config: CadenceConfig): { solveInterval: number; cadenceHz: number } {
	const baseInterval = deriveSolveInterval(config.projectFps, config.maxHz);
	const frameDuration = 1.0 / config.projectFps;
	const budget = frameDuration * config.realtimeBudgetFraction;

	if (config.measuredP95S <= 0 || config.measuredP95S <= budget) {
		return {
			solveInterval: baseInterval,
			cadenceHz: config.projectFps / baseInterval
		};
	}

	// Inference exceeds budget; increase interval
	const neededInterval = Math.ceil(config.measuredP95S / budget);
	const solveInterval = Math.max(baseInterval, neededInterval);
	return {
		solveInterval,
		cadenceHz: config.projectFps / solveInterval
	};
}

// ─── State machine ──────────────────────────────────────────────────────

/** Create initial cadence state. The first frame always triggers a solve. */
export function createCadenceState(config: CadenceConfig): CadenceState {
	const { solveInterval, cadenceHz } = adaptCadence(config);
	return {
		solveInterval,
		cadenceHz,
		frameCounter: 0,
		shouldSolve: true // first frame always solves
	};
}

/**
 * Advance cadence by one frame. Returns whether inference should run.
 *
 * **API contract:** Check `state.shouldSolve` *before* calling `advanceCadence`
 * to decide whether to run inference on the current frame. Then call
 * `advanceCadence` to advance the counter for the next frame.
 *
 * Example:
 * ```
 * if (state.shouldSolve) { runInference(); }
 * advanceCadence(state);
 * ```
 */
export function advanceCadence(state: CadenceState): boolean {
	state.frameCounter++;
	if (state.frameCounter >= state.solveInterval) {
		state.frameCounter = 0;
		state.shouldSolve = true;
	} else {
		state.shouldSolve = false;
	}
	return state.shouldSolve;
}

/** Update cadence config (e.g. when measured p95 changes). */
export function updateCadence(state: CadenceState, config: CadenceConfig): void {
	const { solveInterval, cadenceHz } = adaptCadence(config);
	state.solveInterval = solveInterval;
	state.cadenceHz = cadenceHz;
}
