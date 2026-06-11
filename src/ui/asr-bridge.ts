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
	const { default: AsrWorker } = await import('../engine/asr/asr-worker.ts?worker');
	const worker: Worker = new AsrWorker();
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
