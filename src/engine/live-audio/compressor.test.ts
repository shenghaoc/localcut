import { describe, expect, it } from 'vite-plus/test';
import { createCompressorState, processCompressor, type CompressorState } from './compressor';
import type { CompressorParams } from '../../protocol';

const SR = 48_000;

function params(overrides: Partial<CompressorParams> = {}): CompressorParams {
	return {
		bypass: false,
		thresholdDb: -20,
		ratio: 4,
		attackMs: 0.5,
		releaseMs: 5,
		kneeDb: 0,
		makeupGainDb: 0,
		...overrides
	};
}

function processInBlocks(
	input: Float32Array,
	p: CompressorParams,
	state: CompressorState,
	blockSize: number
): Float32Array {
	const out = new Float32Array(input.length);
	for (let offset = 0; offset < input.length; offset += blockSize) {
		const block = input.subarray(offset, Math.min(offset + blockSize, input.length));
		out.set(processCompressor(block, p, state, SR), offset);
	}
	return out;
}

describe('compressor', () => {
	it('bypass is a sample-exact identity', () => {
		const input = new Float32Array([0.9, -0.4, 0.1]);
		const out = processCompressor(input, params({ bypass: true }), createCompressorState(), SR);
		expect([...out]).toEqual([...input]);
	});

	it('starts at unity gain: sub-threshold audio passes unattenuated from sample 0', () => {
		// Regression: an envelope initialised to 0 mutes the first release-time
		// worth of audio.
		const input = new Float32Array(64).fill(0.05); // -26 dB, below -20 dB threshold
		const out = processCompressor(input, params(), createCompressorState(), SR);
		expect(Math.abs(out[0])).toBeGreaterThan(0.049);
	});

	it('applies the ratio-derived gain reduction above threshold (hard knee)', () => {
		// 0.5 ≈ -6.02 dB; expected output level = T + (in − T)/R = -16.5 dB.
		const input = new Float32Array(SR).fill(0.5);
		const out = processCompressor(input, params(), createCompressorState(), SR);
		const expected = Math.pow(10, (-20 + (20 * Math.log10(0.5) + 20) / 4) / 20);
		expect(Math.abs(out[SR - 1])).toBeCloseTo(expected, 3);
	});

	it('attenuates (never amplifies) inside the soft knee', () => {
		// Regression: the original knee formula had a sign error that boosted
		// the signal instead of reducing it.
		const p = params({ kneeDb: 12 });
		const level = Math.pow(10, -20 / 20); // exactly at threshold, mid-knee
		const input = new Float32Array(4800).fill(level);
		const out = processCompressor(input, p, createCompressorState(), SR);
		const settled = Math.abs(out[4799]);
		expect(settled).toBeLessThan(level);
		// Expected knee reduction: ((knee/2)^2 / (2·knee)) · (1 − 1/R) = 1.125 dB.
		const expected = level * Math.pow(10, -1.125 / 20);
		expect(settled).toBeCloseTo(expected, 3);
	});

	it('applies makeup gain after the gain computer', () => {
		const quiet = new Float32Array(64).fill(0.05);
		const out = processCompressor(quiet, params({ makeupGainDb: 6 }), createCompressorState(), SR);
		expect(Math.abs(out[0])).toBeCloseTo(0.05 * Math.pow(10, 6 / 20), 4);
	});

	it('clamps hostile params (negative timing, sub-unity ratio, negative knee) to finite output', () => {
		const hostile = params({ attackMs: -1, releaseMs: -10, ratio: -4, kneeDb: -6 });
		const input = new Float32Array(2048).fill(0.8);
		const out = processCompressor(input, hostile, createCompressorState(), SR);
		for (let i = 0; i < out.length; i++) {
			expect(Number.isFinite(out[i])).toBe(true);
		}
		// ratio clamped to 1 → no compression; output stays at input level.
		expect(Math.abs(out[2047])).toBeCloseTo(0.8, 3);
	});

	it('produces identical output regardless of block size', () => {
		const input = new Float32Array(4096);
		for (let i = 0; i < input.length; i++) {
			input[i] = Math.sin((i / SR) * 2 * Math.PI * 440) * (i % 1000 < 500 ? 0.8 : 0.05);
		}
		const whole = processCompressor(input, params(), createCompressorState(), SR);
		const blocks = processInBlocks(input, params(), createCompressorState(), 128);
		for (let i = 0; i < input.length; i++) {
			expect(blocks[i]).toBeCloseTo(whole[i], 6);
		}
	});
});
