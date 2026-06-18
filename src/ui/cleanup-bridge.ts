/**
 * Lazy bridge to the Audio Cleanup worker (Phase 28). The worker module is
 * loaded via dynamic import only when the user opens the panel or starts a
 * cleanup action, so nothing ORT/model-related ever enters the startup
 * module graph or spawns eagerly.
 */

import type { CleanupWorkerCommand, CleanupWorkerState } from '../protocol';

export interface CleanupWorkerPort {
	send(command: CleanupWorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export async function spawnCleanupWorker(
	onState: (msg: CleanupWorkerState) => void,
	onCrash: (message: string) => void
): Promise<CleanupWorkerPort> {
	const worker = new Worker(
		new URL('../engine/audio-cleanup/cleanup-ort-worker.ts', import.meta.url),
		{
			type: 'module'
		}
	);
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
