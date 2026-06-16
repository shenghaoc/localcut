/**
 * Audio Cleanup worker (Phase 28) — **ONNX Runtime (ORT) DTLN** backend entry.
 *
 * A thin shell over {@link file://./cleanup-worker-core.ts}: it supplies the ORT
 * runtime + ONNX manifest validator, and the core drives the rest (download,
 * caching, the chunked job lifecycle) exactly as the LiteRT entry does. Lazily
 * spawned by `src/ui/cleanup-bridge.ts` only when the ONNX engine is selected;
 * never imported by the app shell or the pipeline worker.
 *
 * Spawned as an **ES-module** worker (unlike the classic LiteRT entry) so that
 * `onnxruntime-web` resolves through the foundation's dynamic `import()` and
 * stays out of the startup bundle. ORT loads its own WASM from `/_ort/`, so the
 * `wasmPath` in the load command (the LiteRT runtime dir) is unused here.
 */

import { startCleanupWorker, type CleanupBackend } from './cleanup-worker-core';
import { DtlnOrtRuntime } from './dtln-ort-runtime';
import { validateOnnxCleanupManifest } from './onnx-model-manifest';

const backend: CleanupBackend = {
	opfsDir: 'cleanup-models-onnx',
	parseManifest(raw) {
		const manifest = validateOnnxCleanupManifest(raw);
		return {
			version: manifest.version,
			sizeBytes: manifest.sizeBytes,
			model1: manifest.model1,
			model2: manifest.model2,
			createRuntime: (model1Bytes, model2Bytes) =>
				DtlnOrtRuntime.create({
					model1Bytes,
					model2Bytes,
					stateShape: manifest.stateShape,
					io: manifest.io,
					executionProviders: manifest.executionProviders
				})
		};
	}
};

startCleanupWorker(backend);
