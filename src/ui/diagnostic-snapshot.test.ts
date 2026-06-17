import { describe, expect, it } from 'vite-plus/test';
import { mlRuntimeSummary } from './diagnostic-snapshot';
import type { MlRuntimeDiagnosticSummary } from '../diagnostics/types';

describe('mlRuntimeSummary', () => {
	const workerLitert: MlRuntimeDiagnosticSummary = { mlRuntime: 'litert' };

	it('reports ORT + the WASM EP when the active ASR engine is ort-whisper', () => {
		expect(mlRuntimeSummary({ engine: 'ort-whisper', accelerator: 'wasm' }, workerLitert)).toEqual({
			mlRuntime: 'ort',
			ortEp: 'wasm',
			tensorLocation: 'cpu'
		});
	});

	it('defaults the ORT EP to wasm when the accelerator is not yet known', () => {
		expect(mlRuntimeSummary({ engine: 'ort-whisper', accelerator: null }, undefined).ortEp).toBe(
			'wasm'
		);
	});

	it('falls back to the worker summary for the LiteRT engine', () => {
		expect(
			mlRuntimeSummary({ engine: 'litert-whisper', accelerator: 'webgpu' }, workerLitert)
		).toEqual(workerLitert);
	});

	it('falls back to the worker summary (or litert) when no ASR model is loaded', () => {
		expect(mlRuntimeSummary({ engine: null, accelerator: null }, workerLitert)).toEqual(
			workerLitert
		);
		expect(mlRuntimeSummary(undefined, undefined)).toEqual({ mlRuntime: 'litert' });
	});
});
