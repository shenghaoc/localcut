import { describe, expect, it } from 'vite-plus/test';
import { mlRuntimeSummary } from './diagnostic-snapshot';
import type { MlRuntimeDiagnosticSummary } from '../diagnostics/types';

describe('mlRuntimeSummary', () => {
	const workerOrt: MlRuntimeDiagnosticSummary = { mlRuntime: 'ort', ortEp: 'webgpu' };

	it('reports ORT + the WASM EP when the active ASR engine is ort-whisper', () => {
		expect(mlRuntimeSummary({ engine: 'ort-whisper', accelerator: 'wasm' }, workerOrt)).toEqual({
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

	it('falls back to the worker summary or ORT-WASM when no ASR model is loaded', () => {
		expect(mlRuntimeSummary({ engine: null, accelerator: null }, workerOrt)).toEqual(workerOrt);
		expect(mlRuntimeSummary(undefined, undefined)).toEqual({
			mlRuntime: 'ort',
			ortEp: 'wasm',
			tensorLocation: 'cpu'
		});
	});
});
