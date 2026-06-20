/**
 * Lazy bridge to the media-converter worker. The worker module is loaded via
 * `new Worker(new URL(...))` only when the Convert view mounts, so nothing
 * Mediabunny/encoder-related enters the startup module graph or spawns eagerly.
 */

import type { ConvertWorkerCommand, ConvertWorkerState } from '../protocol';

export interface ConvertWorkerPort {
	send(command: ConvertWorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export function spawnConvertWorker(
	onState: (msg: ConvertWorkerState) => void,
	onCrash: (message: string) => void
): ConvertWorkerPort {
	const worker = new Worker(new URL('../engine/convert/convert-worker.ts', import.meta.url), {
		type: 'module'
	});
	const handler = (event: MessageEvent<ConvertWorkerState>) => {
		onState(event.data);
	};
	const errorHandler = (event: ErrorEvent) => {
		onCrash(event.message || 'Media converter worker crashed.');
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
