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
	// `messageerror` (a message that fails structured-clone on receipt) is a
	// distinct event from `error`; treat it as a crash so the UI can recover.
	const messageErrorHandler = () => {
		onCrash('Media converter worker sent an unreadable message.');
	};
	worker.addEventListener('message', handler);
	worker.addEventListener('error', errorHandler);
	worker.addEventListener('messageerror', messageErrorHandler);
	return {
		send(command, transfer) {
			if (transfer?.length) worker.postMessage(command, transfer);
			else worker.postMessage(command);
		},
		terminate() {
			worker.removeEventListener('message', handler);
			worker.removeEventListener('error', errorHandler);
			worker.removeEventListener('messageerror', messageErrorHandler);
			worker.terminate();
		}
	};
}
