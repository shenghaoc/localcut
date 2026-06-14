/**
 * Lazy bridge to the ASR worker (Phase 29). The worker module is loaded
 * via dynamic import only when the user opens the Auto Captions panel or
 * starts a transcription, so nothing ASR/model-related ever enters the
 * startup module graph or spawns eagerly.
 */
import type { AsrWorkerCommand, AsrWorkerState } from '../protocol';

export interface AsrWorkerPort {
	send(command: AsrWorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export async function spawnAsrWorker(
	onState: (msg: AsrWorkerState) => void,
	onCrash: (message: string) => void
): Promise<AsrWorkerPort> {
	// Spawn as a **classic** worker: LiteRT.js loads its WASM via `importScripts`,
	// which ES module workers forbid. Keep this on the `new URL()` entry path:
	// Vite emits a classic-loadable chunk for this build target, while the rest of
	// the app can keep `worker.format = 'es'` for `?worker` imports elsewhere. The
	// URL is statically analysable, so the ASR bundle still code-splits lazily.
	const worker = new Worker(new URL('../engine/asr/asr-worker.ts', import.meta.url), {
		type: 'classic'
	});
	const handler = (event: MessageEvent<AsrWorkerState>) => {
		onState(event.data);
	};
	worker.addEventListener('message', handler);
	worker.addEventListener('error', (event) => {
		onCrash(event.message || 'ASR worker crashed.');
	});
	return {
		send(command, transfer) {
			if (transfer?.length) worker.postMessage(command, transfer);
			else worker.postMessage(command);
		},
		terminate() {
			worker.removeEventListener('message', handler);
			worker.terminate();
		}
	};
}
