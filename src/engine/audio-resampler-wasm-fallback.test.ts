import { describe, expect, it } from 'vitest';
import { WasmAudioResampler } from './audio-resampler-wasm';

/**
 * Isolated test suite that verifies the JS fallback path works when WASM is
 * not pre-initialized.  This file intentionally does NOT call
 * WasmAudioResampler.init() so that the resampler uses its JS fallback,
 * regardless of whether SIMD WASM is available in the runtime.
 */
describe('WasmAudioResampler JS fallback', () => {
	it('falls back to JS path when WASM is not initialized', () => {
		const resampler = new WasmAudioResampler({
			inputRate: 48000,
			outputRate: 24000,
			channels: 1,
		});
		const input = new Float32Array(480).fill(0.5);
		const output = resampler.process(input, 480);
		expect(output.length).toBeGreaterThan(0);
	});
});
