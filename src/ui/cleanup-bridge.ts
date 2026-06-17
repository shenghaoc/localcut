/**
 * Lazy bridge to the Audio Cleanup worker (Phase 28). The worker module is
 * loaded via dynamic import only when the user opens the panel or starts a
 * cleanup action, so nothing LiteRT/ORT/model-related ever enters the startup
 * module graph or spawns eagerly.
 *
 * Two backends, two worker entry points:
 * - `litert` → `cleanup-worker.ts`, a **classic** worker (LiteRT.js loads its
 *   WASM via `importScripts`, which ES-module workers forbid).
 * - `ort` → `cleanup-ort-worker.ts`, an **ES-module** worker (so
 *   `onnxruntime-web` resolves through its dynamic-import boundary).
 */

import type { CleanupBackendKind, CleanupWorkerCommand, CleanupWorkerState } from '../protocol';

export interface CleanupWorkerPort {
	send(command: CleanupWorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export async function spawnCleanupWorker(
	backend: CleanupBackendKind,
	onState: (msg: CleanupWorkerState) => void,
	onCrash: (message: string) => void
): Promise<CleanupWorkerPort> {
	const worker =
		backend === 'ort'
			? new Worker(new URL('../engine/audio-cleanup/cleanup-ort-worker.ts', import.meta.url), {
					type: 'module'
				})
			: new Worker(new URL('../engine/audio-cleanup/cleanup-worker.ts', import.meta.url), {
					type: 'classic'
				});
	const handler = (event: MessageEvent<CleanupWorkerState>) => {
		onState(event.data);
	};
	const errorHandler = (event: ErrorEvent) => {
		onCrash(event.message || 'Audio cleanup worker crashed.');
	};
	worker.addEventListener('message', handler);
	worker.addEventListener('error', errorHandler);
	return {
		send(command, transfer) {
			if (transfer?.length) worker.postMessage(command, transfer);
			else worker.postMessage(command);
		},
		terminate() {
			worker.removeEventListener('message', handler);
			worker.removeEventListener('error', errorHandler);
			worker.terminate();
		}
	};
}
