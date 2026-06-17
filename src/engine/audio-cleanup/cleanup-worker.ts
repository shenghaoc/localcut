/**
 * Audio Cleanup worker (Phase 28) — **LiteRT DTLN** backend entry point.
 *
 * A thin shell over {@link file://./cleanup-worker-core.ts}: it supplies the
 * LiteRT runtime + TFLite manifest validator, and the core drives the rest
 * (download, caching, the chunked job lifecycle). Lazily spawned by
 * `src/ui/cleanup-bridge.ts` only on the first cleanup action; entirely separate
 * from the pipeline worker, which it never imports.
 *
 * Spawned as a **classic** worker (not ES module) because LiteRT.js loads its
 * WASM via `importScripts`. (The ONNX backend uses an ES-module worker —
 * {@link file://./cleanup-ort-worker.ts}.)
 */

import { startCleanupWorker, type CleanupBackend } from './cleanup-worker-core';
import { DtlnRuntime } from './dtln-runtime';
import { validateManifest } from './model-manifest';

const backend: CleanupBackend = {
	opfsDir: 'cleanup-models',
	parseManifest(raw, cmd) {
		const manifest = validateManifest(raw);
		return {
			version: manifest.version,
			sizeBytes: manifest.sizeBytes,
			model1: manifest.model1,
			model2: manifest.model2,
			createRuntime: (model1Bytes, model2Bytes) =>
				DtlnRuntime.create({
					wasmPath: cmd.wasmPath,
					accelerator: cmd.preferredAccelerator,
					model1Bytes,
					model2Bytes,
					stateShape: manifest.stateShape
				})
		};
	}
};

startCleanupWorker(backend);
