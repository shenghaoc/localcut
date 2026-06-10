import { describe, expect, it } from 'vitest';
import { createLimiterState, processLimiter, type LimiterState } from './limiter';
import type { LimiterParams } from '../../protocol';

const SR = 48_000;

function params(overrides: Partial<LimiterParams> = {}): LimiterParams {
	return { bypass: false, ceilingDb: -6, attackUs: 50, releaseMs: 50, ...overrides };
}

function processInBlocks(
	input: Float32Array,
	p: LimiterParams,
	state: LimiterState,
	blockSize: number
): Float32Array {
	const out = new Float32Array(input.length);
	for (let offset = 0; offset < input.length; offset += blockSize) {
		const block = input.subarray(offset, Math.min(offset + blockSize, input.length));
		out.set(processLimiter(block, p, state, SR), offset);
	}
	return out;
}

/** Reference implementation: O(N×M) full delay-line scan per sample. */
function referenceLimiter(
	input: Float32Array,
	p: LimiterParams,
	lookahead: number
): Float32Array {
	const output = new Float32Array(input.length);
	const ceilingLinear = Math.pow(10, p.ceilingDb / 20);
	const attackCoef = Math.exp(-1 / ((p.attackUs / 1_000_000) * SR));
	const releaseCoef = Math.exp(-1 / ((p.releaseMs / 1000) * SR));
	const delayLine = new Float32Array(lookahead);
	let writePos = 0;
	let envelope = 1;
	for (let i = 0; i < input.length; i++) {
		delayLine[writePos] = input[i];
		let peak = 0;
		for (let j = 0; j < lookahead; j++) {
			const v = Math.abs(delayLine[j]);
			if (v > peak) peak = v;
		}
		const targetGain = peak > ceilingLinear ? ceilingLinear / peak : 1;
		envelope =
			targetGain < envelope
				? attackCoef * envelope + (1 - attackCoef) * targetGain
				: releaseCoef * envelope + (1 - releaseCoef) * targetGain;
		const readPos = (writePos + 1) % lookahead;
		output[i] = delayLine[readPos] * envelope;
		writePos = readPos;
	}
	return output;
}

function randomSignal(length: number, seed = 1234): Float32Array {
	// Deterministic LCG so failures reproduce.
	const out = new Float32Array(length);
	let x = seed;
	for (let i = 0; i < length; i++) {
		x = (x * 1664525 + 1013904223) >>> 0;
		out[i] = (x / 0xffffffff) * 2 - 1;
	}
	return out;
}

describe('limiter', () => {
	it('bypass is a sample-exact identity with zero latency', () => {
		const input = randomSignal(512);
		const out = processLimiter(input, params({ bypass: true }), createLimiterState(240), SR);
		expect([...out]).toEqual([...input]);
	});

	it('starts at unity gain and applies pure lookahead delay to quiet signals', () => {
		const state = createLimiterState(240);
		expect(state.envelope).toBe(1);
		const input = new Float32Array(1024);
		input[100] = 0.25; // well below the ceiling — no gain reduction
		const out = processLimiter(input, params({ ceilingDb: 0 }), state, SR);
		expect(out[100 + 239]).toBeCloseTo(0.25, 6);
		expect(out[100]).toBe(0);
	});

	it('holds steady-state output at or below the ceiling (brickwall)', () => {
		const ceilingLinear = Math.pow(10, -6 / 20);
		const input = new Float32Array(SR).fill(1);
		const out = processLimiter(input, params(), createLimiterState(240), SR);
		for (let i = 1000; i < out.length; i++) {
			expect(Math.abs(out[i])).toBeLessThanOrEqual(ceilingLinear * 1.02);
		}
	});

	it('matches the brute-force reference limiter sample-exactly (deque correctness)', () => {
		const input = randomSignal(4096);
		const boosted = input.map((v) => v * 1.5);
		const expected = referenceLimiter(boosted, params(), 240);
		const actual = processLimiter(boosted, params(), createLimiterState(240), SR);
		for (let i = 0; i < expected.length; i++) {
			expect(actual[i]).toBeCloseTo(expected[i], 6);
		}
	});

	it('produces identical output regardless of block size (cross-block lookahead)', () => {
		const input = randomSignal(4096).map((v) => v * 1.5);
		const whole = processLimiter(input, params(), createLimiterState(240), SR);
		const blocks128 = processInBlocks(input, params(), createLimiterState(240), 128);
		const blocks97 = processInBlocks(input, params(), createLimiterState(240), 97);
		for (let i = 0; i < input.length; i++) {
			expect(blocks128[i]).toBeCloseTo(whole[i], 6);
			expect(blocks97[i]).toBeCloseTo(whole[i], 6);
		}
	});

	it('catches a peak that arrives in a later block than its lookahead window', () => {
		// Quiet first block, loud spike early in the second block: the limiter
		// must already be attenuating when the pre-spike samples leave the delay
		// line, which only works if lookahead crosses the block boundary.
		const p = params({ ceilingDb: -12, attackUs: 10 });
		const state = createLimiterState(240);
		const block1 = new Float32Array(128).fill(0.1);
		const block2 = new Float32Array(128).fill(0.1);
		block2[10] = 1.0;
		processLimiter(block1, p, state, SR);
		// The spike enters the window at sample 138 (absolute); by then the
		// envelope must have started attacking below unity.
		processLimiter(block2, p, state, SR);
		expect(state.envelope).toBeLessThan(0.5);
	});
});
