/**
 * Temporal-stability contract for portrait matte (Phase 31).
 *
 * The ORT matte engine smooths a single-frame model's raw alpha over time with an
 * exponential moving average (EMA) and resets that history on discontinuities.
 * Centralising the constant and reset predicate here keeps the GPU
 * `matte-resolve.wgsl` pass and unit tests on one source of truth.
 */

/**
 * EMA history weight `k` in [0, 1): `alpha_t = (1 - k) * raw + k * alpha_{t-1}`.
 * Fixed (also in test mode) so matte output is deterministic across runs (R8).
 */
export const MATTE_TEMPORAL_SMOOTHING = 0.5;

/**
 * Source-time step assumed by the discontinuity policy when a clip's real frame
 * step is unknown (0 or negative): 30 fps.
 */
const FALLBACK_FRAME_STEP_S = 1 / 30;

/**
 * The R4.2 discontinuity policy that resets a clip's EMA history (raw alpha
 * passes through and the history restarts): always on the first frame
 * (`lastSourceTimeS === null`), and on any source-time jump larger than 1.5 frame
 * steps — which covers seeks, reverse playback, and skips. Toggle / mode-change /
 * model-swap resets are driven separately by clearing `lastSourceTimeS`.
 */
export function shouldResetMatteHistory(
	lastSourceTimeS: number | null,
	sourceTimeS: number,
	frameStepS: number
): boolean {
	if (lastSourceTimeS === null) return true;
	const step = frameStepS > 0 ? frameStepS : FALLBACK_FRAME_STEP_S;
	return Math.abs(sourceTimeS - lastSourceTimeS) > 1.5 * step;
}

/**
 * Pure reference for the resolve pass's EMA blend, mirroring `matte-resolve.wgsl`
 * exactly: `raw` is clamped to [0, 1], `k` is clamped to [0, 0.95] and forced to 0
 * on a reset frame, and the result is `mix(raw, prev, k)` (== `raw*(1-k) + prev*k`).
 * The WGSL shader is the GPU mirror of this function; tests assert against it so a
 * change to one without the other is caught.
 */
export function emaBlend(raw: number, prev: number, k: number, reset: boolean): number {
	const rawClamped = Math.min(Math.max(raw, 0), 1);
	const kEffective = reset ? 0 : Math.min(Math.max(k, 0), 0.95);
	return rawClamped * (1 - kEffective) + prev * kEffective;
}
