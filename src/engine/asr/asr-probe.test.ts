import { describe, expect, it } from 'vite-plus/test';
import { asrAvailable, probeAsr } from './asr-probe';

describe('probeAsr', () => {
	it('recommends ort-whisper when WebAssembly is available', () => {
		const result = probeAsr();

		// The test runtime (Node) always has WebAssembly.
		expect(result.wasm).toBe('supported');
		expect(result.recommended).toBe('ort-whisper');
		expect(asrAvailable(result)).toBe(true);
	});

	it('reports accelerated backends and cross-origin isolation as informational only', () => {
		const result = probeAsr();

		expect(['supported', 'unsupported', 'unknown']).toContain(result.webgpu);
		expect(['supported', 'unsupported', 'unknown']).toContain(result.webnn);
		expect(typeof result.crossOriginIsolated).toBe('boolean');
		// These flags never gate availability — only `wasm` does.
		expect(asrAvailable(result)).toBe(result.wasm === 'supported');
	});

	it('carries no Browser SpeechRecognition signal', () => {
		// The removed Chrome Speech fallback must leave no surface behind.
		const result = probeAsr();

		expect(Object.keys(result)).not.toContain('speechRecognition');
	});
});
