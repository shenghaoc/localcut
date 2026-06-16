/** Phase 32b: Cadence scheduler tests. */

import { describe, expect, it } from 'vite-plus/test';
import {
	deriveSolveInterval,
	adaptCadence,
	createCadenceState,
	advanceCadence,
	updateCadence,
	DEFAULT_CADENCE_CONFIG
} from './cadence';

describe('deriveSolveInterval', () => {
	it('returns 1 for 30 fps at 30 Hz', () => {
		expect(deriveSolveInterval(30, 30)).toBe(1);
	});

	it('returns 3 for 30 fps at 10 Hz', () => {
		expect(deriveSolveInterval(30, 10)).toBe(3);
	});

	it('returns 6 for 60 fps at 10 Hz', () => {
		expect(deriveSolveInterval(60, 10)).toBe(6);
	});

	it('uses ceiling so fractional frame rates do not exceed the max Hz', () => {
		const interval = deriveSolveInterval(29.97, 10);
		expect(interval).toBe(3);
		expect(29.97 / interval).toBeLessThanOrEqual(10);
	});

	it('returns 1 for invalid inputs', () => {
		expect(deriveSolveInterval(0, 10)).toBe(1);
		expect(deriveSolveInterval(30, 0)).toBe(1);
	});
});

describe('adaptCadence', () => {
	it('uses base interval when no measurement', () => {
		const result = adaptCadence(DEFAULT_CADENCE_CONFIG);
		expect(result.solveInterval).toBe(3);
		expect(result.cadenceHz).toBeCloseTo(10);
	});

	it('increases interval under load', () => {
		const result = adaptCadence({
			...DEFAULT_CADENCE_CONFIG,
			measuredP95S: 0.1 // 100ms exceeds 50% of 33ms frame budget
		});
		expect(result.solveInterval).toBeGreaterThan(3);
	});

	it('keeps base interval when within budget', () => {
		const result = adaptCadence({
			...DEFAULT_CADENCE_CONFIG,
			measuredP95S: 0.01 // 10ms within budget
		});
		expect(result.solveInterval).toBe(3);
	});
});

describe('createCadenceState', () => {
	it('creates initial state with shouldSolve=true', () => {
		const state = createCadenceState(DEFAULT_CADENCE_CONFIG);
		expect(state.shouldSolve).toBe(true);
		expect(state.frameCounter).toBe(0);
		expect(state.solveInterval).toBe(3);
	});
});

describe('advanceCadence', () => {
	it('solves at interval boundaries', () => {
		const state = createCadenceState(DEFAULT_CADENCE_CONFIG);
		// Frame 0 was already set to shouldSolve=true
		expect(advanceCadence(state)).toBe(false); // frame 1
		expect(advanceCadence(state)).toBe(false); // frame 2
		expect(advanceCadence(state)).toBe(true); // frame 3
		expect(advanceCadence(state)).toBe(false); // frame 4
	});

	it('resets counter after solve', () => {
		const state = createCadenceState(DEFAULT_CADENCE_CONFIG);
		advanceCadence(state); // 1
		advanceCadence(state); // 2
		advanceCadence(state); // 3 - solve
		expect(state.frameCounter).toBe(0);
	});
});

describe('updateCadence', () => {
	it('updates solve interval', () => {
		const state = createCadenceState(DEFAULT_CADENCE_CONFIG);
		expect(state.solveInterval).toBe(3);

		updateCadence(state, {
			...DEFAULT_CADENCE_CONFIG,
			projectFps: 60,
			maxHz: 10
		});
		expect(state.solveInterval).toBe(6);
	});
});
