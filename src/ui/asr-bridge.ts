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
	// Spawn as a module worker: the ONNX Runtime Web backend lazy-loads Vite-built
	// ESM chunks that import helper bindings from the ASR worker entry.
	const worker = new Worker(new URL('../engine/asr/asr-worker.ts', import.meta.url), {
		type: 'module'
	});
	const handler = (event: MessageEvent<AsrWorkerState>) => {
		onState(event.data);
	};
	const errorHandler = (event: ErrorEvent) => {
		onCrash(event.message || 'ASR worker crashed.');
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
