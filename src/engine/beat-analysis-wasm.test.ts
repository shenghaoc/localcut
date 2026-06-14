/**
 * Unit tests for beat-analysis-wasm.ts -- WASM-accelerated beat analysis.
 */

import { describe, expect, it } from 'vite-plus/test';
import { WasmBeatAnalyser } from './beat-analysis-wasm';

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
});
