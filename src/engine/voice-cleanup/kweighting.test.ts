import { describe, expect, it } from 'vite-plus/test';
import { createKWeightState, kWeightBlock } from './kweighting';

function generateSine(
	freq: number,
	sampleRate: number,
	durationS: number,
	amplitude = 1
): Float32Array {
	const samples = Math.round(sampleRate * durationS);
	const buf = new Float32Array(samples);
	for (let i = 0; i < samples; i++) {
		buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
	}
	return buf;
}

function rms(buf: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
	return Math.sqrt(sum / buf.length);
}

describe('kweighting', () => {
	it('K-weighting a 1 kHz sine produces a gain within ±1 dB of unity', () => {
		const state = createKWeightState();
		// Use 2 seconds to let transients settle
		const input = generateSine(1000, 48000, 2);
		// Measure RMS of the second half only (after transient)
		const half = input.length / 2;
		const inputRms = rms(input.subarray(half));
		const output = kWeightBlock(input, state);
		const outputRms = rms(output.subarray(half));
		const gainDb = 20 * Math.log10(outputRms / inputRms);
		// BS.1770-4 K-weighting at 1 kHz is approximately +0.7 dB
		expect(gainDb).toBeGreaterThan(-0.5);
		expect(gainDb).toBeLessThan(1.5);
	});

	it('K-weighting a 100 Hz sine attenuates relative to 1 kHz (RLB high-pass)', () => {
		const state1k = createKWeightState();
		const state100 = createKWeightState();
		const sine1k = generateSine(1000, 48000, 1);
		const sine100 = generateSine(100, 48000, 1);
		const rms1kIn = rms(sine1k);
		const rms100In = rms(sine100);
		const weighted1k = kWeightBlock(sine1k, state1k);
		const weighted100 = kWeightBlock(sine100, state100);
		const gain1k = rms(weighted1k) / rms1kIn;
		const gain100 = rms(weighted100) / rms100In;
		// 100 Hz should be attenuated relative to 1 kHz
		expect(gain100).toBeLessThan(gain1k);
	});

	it('state carries across two successive block calls (split vs single)', () => {
		const fullState = createKWeightState();
		const splitState = createKWeightState();

		const full = generateSine(1000, 48000, 0.5);
		const half1 = full.slice(0, Math.floor(full.length / 2));
		const half2 = full.slice(Math.floor(full.length / 2));

		// Single block
		const fullWeighted = kWeightBlock(full, fullState);

		// Two successive blocks
		const h1 = new Float32Array(half1);
		const h2 = new Float32Array(half2);
		const h1Weighted = kWeightBlock(h1, splitState);
		const h2Weighted = kWeightBlock(h2, splitState);

		// Compare outputs — should be identical
		for (let i = 0; i < fullWeighted.length; i++) {
			if (i < h1Weighted.length) {
				expect(fullWeighted[i]).toBeCloseTo(h1Weighted[i], 10);
			} else {
				expect(fullWeighted[i]).toBeCloseTo(h2Weighted[i - h1Weighted.length], 10);
			}
		}
	});

	it('returns a new buffer without mutating the input', () => {
		const state = createKWeightState();
		const input = generateSine(1000, 48000, 0.1);
		const original = new Float32Array(input);
		const output = kWeightBlock(input, state);

		expect(output).not.toBe(input);
		expect(input).toEqual(original);
	});
});
