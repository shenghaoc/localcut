import { describe, expect, it } from 'vitest';
import { createGateState, processGate, type GateState } from './gate';
import type { GateParams } from '../../protocol';

const SR = 48_000;

function params(overrides: Partial<GateParams> = {}): GateParams {
	return {
		bypass: false,
		thresholdDb: -20,
		rangeDb: -80,
		attackMs: 0.1,
		holdMs: 50,
		releaseMs: 10,
		...overrides
	};
}

function processInBlocks(
	input: Float32Array,
	p: GateParams,
	state: GateState,
	blockSize: number
): Float32Array {
	const out = new Float32Array(input.length);
	for (let offset = 0; offset < input.length; offset += blockSize) {
		const block = input.subarray(offset, Math.min(offset + blockSize, input.length));
		out.set(processGate(block, p, state, SR), offset);
	}
	return out;
}

describe('gate', () => {
	it('bypass is a sample-exact identity', () => {
		const input = new Float32Array([0.5, -0.2, 0.05, 0]);
		const out = processGate(input, params({ bypass: true }), createGateState(), SR);
		expect([...out]).toEqual([...input]);
	});

	it('opens above the threshold and passes the signal at unity', () => {
		const input = new Float32Array(2000).fill(0.5); // -6 dB, threshold -20 dB
		const out = processGate(input, params(), createGateState(), SR);
		expect(Math.abs(out[1999])).toBeGreaterThan(0.49);
	});

	it('attenuates sub-threshold signal toward the configured range', () => {
		const rangeLinear = Math.pow(10, -80 / 20);
		const input = new Float32Array(SR).fill(0.01); // -40 dB, below threshold
		const out = processGate(input, params({ holdMs: 0 }), createGateState(), SR);
		// After hold (none) + release, gain approaches rangeLinear.
		const tail = Math.abs(out[SR - 1]) / 0.01;
		expect(tail).toBeLessThan(rangeLinear * 10);
	});

	it('holds the gate open for holdMs across block boundaries before releasing', () => {
		const p = params({ holdMs: 50, releaseMs: 5 });
		const holdSamples = Math.round((50 / 1000) * SR); // 2400 samples
		const loud = 1000;
		const total = loud + holdSamples + 4 * Math.round((5 / 1000) * SR) + 2000;
		const input = new Float32Array(total).fill(0.001);
		input.fill(0.5, 0, loud);
		const state = createGateState();
		const out = processInBlocks(input, p, state, 128);

		// Mid-hold (well past several 128-sample blocks): still open near unity.
		const midHold = loud + Math.floor(holdSamples / 2);
		expect(Math.abs(out[midHold]) / 0.001).toBeGreaterThan(0.9);

		// Long after hold + several release constants: the gate must have closed.
		// (The pre-fix bug reset the hold counter every block, so it never released.)
		const wellAfter = loud + holdSamples + 4 * Math.round((5 / 1000) * SR) + 1500;
		expect(Math.abs(out[wellAfter]) / 0.001).toBeLessThan(0.05);
	});

	it('produces identical output regardless of block size', () => {
		const input = new Float32Array(6000);
		for (let i = 0; i < input.length; i++) {
			input[i] = i % 700 < 350 ? 0.5 : 0.001;
		}
		const whole = processGate(input, params(), createGateState(), SR);
		const blocks = processInBlocks(input, params(), createGateState(), 128);
		for (let i = 0; i < input.length; i++) {
			expect(blocks[i]).toBeCloseTo(whole[i], 6);
		}
	});

	it('clamps non-positive timing params instead of diverging to NaN/Infinity', () => {
		const hostile = params({ attackMs: -5, releaseMs: 0, holdMs: -100 });
		const input = new Float32Array(2048);
		for (let i = 0; i < input.length; i++) input[i] = i % 100 < 50 ? 0.5 : 0.001;
		const out = processGate(input, hostile, createGateState(), SR);
		for (let i = 0; i < out.length; i++) {
			expect(Number.isFinite(out[i])).toBe(true);
			expect(Math.abs(out[i])).toBeLessThanOrEqual(1);
		}
	});

	it('re-arms the hold when the signal re-opens the gate', () => {
		const state = createGateState();
		const p = params({ holdMs: 10 });
		processGate(new Float32Array(480).fill(0.5), p, state, SR);
		processGate(new Float32Array(200).fill(0.001), p, state, SR); // partial hold
		processGate(new Float32Array(480).fill(0.5), p, state, SR); // re-open
		expect(state.holdCounter).toBe(0);
	});
});
