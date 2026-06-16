import { describe, expect, it } from 'vite-plus/test';

import { MATTE_TEMPORAL_SMOOTHING, emaBlend, shouldResetMatteHistory } from './matte-temporal';

/**
 * The temporal-stability contract shared by both matte backends (LiteRT default
 * and the ORT/ONNX spike). These assertions are what make the spike's "EMA
 * smoothing and recurrent-state reset are unchanged" claim verifiable without a
 * GPU — both engines import these exact functions, and `matte-resolve.wgsl`
 * mirrors `emaBlend`.
 */
describe('matte temporal smoothing (EMA)', () => {
	it('uses a fixed, deterministic history weight', () => {
		expect(MATTE_TEMPORAL_SMOOTHING).toBe(0.5);
	});

	it('blends raw and previous alpha as mix(raw, prev, k)', () => {
		// k = 0.5 → exact average of raw and prev.
		expect(emaBlend(1, 0, 0.5, false)).toBeCloseTo(0.5, 6);
		expect(emaBlend(0.8, 0.4, 0.5, false)).toBeCloseTo(0.6, 6);
		// k = 0 → no smoothing, raw passes through.
		expect(emaBlend(0.73, 0.1, 0, false)).toBeCloseTo(0.73, 6);
	});

	it('passes raw alpha straight through on a reset frame (history ignored)', () => {
		// reset forces k = 0 regardless of the configured smoothing.
		expect(emaBlend(0.9, 0.2, MATTE_TEMPORAL_SMOOTHING, true)).toBeCloseTo(0.9, 6);
		expect(emaBlend(0.0, 0.7, MATTE_TEMPORAL_SMOOTHING, true)).toBeCloseTo(0.0, 6);
	});

	it('clamps raw alpha into [0,1] and the weight into [0,0.95]', () => {
		// raw clamped before blending.
		expect(emaBlend(1.5, 0, 0, false)).toBeCloseTo(1, 6);
		expect(emaBlend(-0.5, 1, 0, false)).toBeCloseTo(0, 6);
		// k clamped to 0.95 (never fully freezes on the previous frame).
		expect(emaBlend(1, 0, 1, false)).toBeCloseTo(0.05, 6);
	});

	it('converges toward a steady raw value over repeated frames', () => {
		let prev = 0;
		for (let i = 0; i < 20; i++) prev = emaBlend(1, prev, MATTE_TEMPORAL_SMOOTHING, false);
		// EMA toward 1 with k=0.5 is monotonically increasing and approaches 1.
		expect(prev).toBeGreaterThan(0.99);
		expect(prev).toBeLessThanOrEqual(1);
	});
});

describe('matte recurrent-state reset policy', () => {
	const STEP = 1 / 30; // 30 fps source step.

	it('resets on the first frame (no previous source time)', () => {
		expect(shouldResetMatteHistory(null, 0, STEP)).toBe(true);
		expect(shouldResetMatteHistory(null, 12.34, STEP)).toBe(true);
	});

	it('does not reset on a normal forward step', () => {
		expect(shouldResetMatteHistory(1.0, 1.0 + STEP, STEP)).toBe(false);
		// A small amount of jitter under the 1.5-step threshold stays continuous.
		expect(shouldResetMatteHistory(1.0, 1.0 + 1.4 * STEP, STEP)).toBe(false);
	});

	it('resets on a seek / large source-time jump (> 1.5 frame steps)', () => {
		expect(shouldResetMatteHistory(1.0, 1.0 + 2 * STEP, STEP)).toBe(true);
		expect(shouldResetMatteHistory(5.0, 0.0, STEP)).toBe(true);
	});

	it('resets on reverse playback beyond the threshold', () => {
		expect(shouldResetMatteHistory(2.0, 2.0 - 2 * STEP, STEP)).toBe(true);
	});

	it('falls back to a 30 fps step when frameStepS is unknown (0 or negative)', () => {
		const fallback = 1 / 30;
		// A jump just over 1.5 * (1/30) resets under the fallback.
		expect(shouldResetMatteHistory(1.0, 1.0 + 1.6 * fallback, 0)).toBe(true);
		expect(shouldResetMatteHistory(1.0, 1.0 + fallback, -1)).toBe(false);
	});
});
