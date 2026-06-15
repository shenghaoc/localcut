/**
 * Unit tests for beat-analysis-wasm.ts -- WASM-accelerated beat analysis.
 */

import { describe, expect, it } from 'vite-plus/test';
import { WasmBeatAnalyser } from './beat-analysis-wasm';
import { hannWindow } from './beat-analysis';

// Pure JS reference 1024-point DIT radix-2 FFT magnitude computation,
// mirroring fftInPlace() in beat-analysis.ts. Used as the WASM oracle
// so the two paths must agree on the same input.
function jsHannFftMagnitudes(samples: Float32Array): Float32Array {
	const N = 1024;
	const hann = hannWindow(N);
	const re = new Float32Array(N);
	const im = new Float32Array(N);
	for (let i = 0; i < N; i++) re[i] = samples[i] * hann[i];

	const log2N = Math.log2(N);
	for (let i = 1, j = 0; i < N; i++) {
		let bit = N >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}

	for (let stage = 0; stage < log2N; stage++) {
		const halfSize = 1 << stage;
		const stride = halfSize << 1;
		const angleStep = -Math.PI / halfSize;
		const cosStep = Math.cos(angleStep);
		const sinStep = Math.sin(angleStep);
		for (let k = 0; k < N; k += stride) {
			let twRe = 1;
			let twIm = 0;
			for (let j2 = 0; j2 < halfSize; j2++) {
				const i1 = k + j2;
				const i2 = k + j2 + halfSize;
				const tR = re[i2] * twRe - im[i2] * twIm;
				const tI = re[i2] * twIm + im[i2] * twRe;
				re[i2] = re[i1] - tR;
				im[i2] = im[i1] - tI;
				re[i1] = re[i1] + tR;
				im[i1] = im[i1] + tI;
				const ntwRe = twRe * cosStep - twIm * sinStep;
				twIm = twRe * sinStep + twIm * cosStep;
				twRe = ntwRe;
			}
		}
	}

	const mags = new Float32Array(513);
	for (let k = 0; k < 513; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
	return mags;
}

describe('WasmBeatAnalyser', () => {
	it('produces finite non-NaN magnitudes on a synthetic sine frame', async () => {
		await WasmBeatAnalyser.init();
		const analyser = new WasmBeatAnalyser();

		// Generate a 1024-sample 440 Hz sine wave at 48 kHz
		const samples = new Float32Array(1024);
		for (let i = 0; i < 1024; i++) {
			samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
		}

		const magnitudes = analyser.processFrame(samples);
		if (analyser.usedWasm && magnitudes) {
			expect(magnitudes.length).toBe(513);
			for (let i = 0; i < magnitudes.length; i++) {
				expect(magnitudes[i]).not.toBeNaN();
				expect(Number.isFinite(magnitudes[i])).toBe(true);
			}
		}
	});

	it('reports usedWasm correctly', async () => {
		await WasmBeatAnalyser.init();
		const analyser = new WasmBeatAnalyser();
		// In a browser with SIMD support, usedWasm should be true
		// In a test environment without WASM SIMD, it should be false
		expect(typeof analyser.usedWasm).toBe('boolean');
	});

	it('peaks at bin 9 for a 440 Hz sine at 48 kHz (matches JS reference)', async () => {
		await WasmBeatAnalyser.init();
		const analyser = new WasmBeatAnalyser();

		const samples = new Float32Array(1024);
		for (let i = 0; i < 1024; i++) {
			samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
		}

		const wasmMags = analyser.processFrame(samples);
		const jsMags = jsHannFftMagnitudes(samples);

		// JS reference peak: 440 * 1024 / 48000 ≈ 9.4, so bin 9 wins.
		let jsPeak = 0;
		for (let k = 1; k < jsMags.length; k++) {
			if (jsMags[k] > jsMags[jsPeak]) jsPeak = k;
		}
		expect(jsPeak).toBe(9);

		// WASM path must agree with JS reference -- this guards against
		// the prior SIMD twiddle bug (peaked at bin 65 on a 440 Hz sine).
		if (analyser.usedWasm && wasmMags) {
			let wasmPeak = 0;
			for (let k = 1; k < wasmMags.length; k++) {
				if (wasmMags[k] > wasmMags[wasmPeak]) wasmPeak = k;
			}
			expect(wasmPeak).toBe(jsPeak);

			// Magnitudes should match to within float32 round-off.
			for (let k = 0; k < 513; k++) {
				const tol = Math.max(1e-3, jsMags[k] * 1e-3);
				expect(Math.abs(wasmMags[k] - jsMags[k])).toBeLessThan(tol);
			}
		}
	});
});
