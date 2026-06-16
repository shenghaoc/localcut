/** Phase 32b: One-Euro filter tests. */

import { describe, expect, it } from 'vite-plus/test';
import { createOneEuroState, resetOneEuroState, applyOneEuro, DEFAULT_ONE_EURO } from './one-euro';
import { LANDMARK_FLOATS } from './beauty-params';

describe('createOneEuroState', () => {
	it('creates state with correct buffer sizes', () => {
		const state = createOneEuroState();
		expect(state.prev.length).toBe(LANDMARK_FLOATS);
		expect(state.prevDeriv.length).toBe(LANDMARK_FLOATS);
		expect(state.initialized).toBe(false);
	});
});

describe('resetOneEuroState', () => {
	it('resets all state', () => {
		const state = createOneEuroState();
		state.prev[0] = 0.5;
		state.prevDeriv[0] = 0.1;
		(state as { initialized: boolean }).initialized = true;

		resetOneEuroState(state);

		expect(state.prev[0]).toBe(0);
		expect(state.prevDeriv[0]).toBe(0);
		expect(state.initialized).toBe(false);
	});
});

describe('applyOneEuro', () => {
	it('initializes on first sample (copies raw values)', () => {
		const state = createOneEuroState();
		const raw = new Float32Array(LANDMARK_FLOATS);
		raw[0] = 0.5;
		raw[1] = 0.3;
		raw[2] = 0.1;

		const out = new Float32Array(LANDMARK_FLOATS);
		applyOneEuro(state, raw, 0.033, DEFAULT_ONE_EURO, out);

		expect(out[0]).toBeCloseTo(0.5);
		expect(out[1]).toBeCloseTo(0.3);
		expect(out[2]).toBeCloseTo(0.1);
		expect(state.initialized).toBe(true);
	});

	it('smooths jittery input', () => {
		const state = createOneEuroState();
		const out = new Float32Array(LANDMARK_FLOATS);

		// First sample
		const raw1 = new Float32Array(LANDMARK_FLOATS);
		raw1[0] = 0.5;
		applyOneEuro(state, raw1, 0.033, DEFAULT_ONE_EURO, out);

		// Second sample with jitter
		const raw2 = new Float32Array(LANDMARK_FLOATS);
		raw2[0] = 0.52; // small jump
		applyOneEuro(state, raw2, 0.033, DEFAULT_ONE_EURO, out);

		// Output should be between old and new (smoothed)
		expect(out[0]).toBeGreaterThan(0.5);
		expect(out[0]).toBeLessThan(0.52);
	});

	it('follows fast motion with higher beta', () => {
		const state = createOneEuroState();
		const out = new Float32Array(LANDMARK_FLOATS);
		const fastConfig = { ...DEFAULT_ONE_EURO, beta: 0.5 };

		// First sample
		const raw1 = new Float32Array(LANDMARK_FLOATS);
		raw1[0] = 0.5;
		applyOneEuro(state, raw1, 0.033, fastConfig, out);

		// Large movement
		const raw2 = new Float32Array(LANDMARK_FLOATS);
		raw2[0] = 0.8;
		applyOneEuro(state, raw2, 0.033, fastConfig, out);

		// With high beta, should follow fast motion more closely than default
		const stateSlow = createOneEuroState();
		const outSlow = new Float32Array(LANDMARK_FLOATS);
		applyOneEuro(stateSlow, raw1, 0.033, DEFAULT_ONE_EURO, outSlow);
		applyOneEuro(stateSlow, raw2, 0.033, DEFAULT_ONE_EURO, outSlow);

		expect(out[0]).toBeGreaterThan(outSlow[0]!);
	});

	it('returns raw values when dt is 0', () => {
		const state = createOneEuroState();
		const raw = new Float32Array(LANDMARK_FLOATS);
		raw[0] = 0.5;

		const out = new Float32Array(LANDMARK_FLOATS);
		applyOneEuro(state, raw, 0, DEFAULT_ONE_EURO, out);

		expect(out[0]).toBe(0.5);
	});

	it('handles negative dt by copying raw', () => {
		const state = createOneEuroState();
		const raw = new Float32Array(LANDMARK_FLOATS);
		raw[0] = 0.5;

		const out = new Float32Array(LANDMARK_FLOATS);
		applyOneEuro(state, raw, -0.01, DEFAULT_ONE_EURO, out);

		expect(out[0]).toBe(0.5);
	});
});
