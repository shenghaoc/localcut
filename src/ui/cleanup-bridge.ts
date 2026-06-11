/**
 * Lazy bridge to the Audio Cleanup worker (Phase 27). The worker module is
 * loaded via dynamic import only when the user opens the panel or starts a
 * cleanup action, so nothing WebNN/model-related ever enters the startup
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
	const { default: CleanupWorker } =
		await import('../engine/audio-cleanup/cleanup-worker.ts?worker');
	const worker: Worker = new CleanupWorker();
	const handler = (event: MessageEvent<CleanupWorkerState>) => {
		onState(event.data);
	};
	worker.addEventListener('message', handler);
	worker.addEventListener('error', (event) => {
		onCrash(event.message || 'Audio cleanup worker crashed.');
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
