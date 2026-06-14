/**
 * Lazy bridge to the Smart Reframe worker (Phase 33). The worker is constructed
 * only when the user triggers analysis, so nothing model/runtime-related enters
 * the startup module graph or spawns eagerly (R0.3). It is spawned as a
 * **classic** worker because LiteRT.js's WASM loader uses `importScripts`, which
 * only works in non-module workers (same constraint as the ASR/cleanup workers).
 */
import type { SmartReframeWorkerCommand, SmartReframeWorkerState } from '../protocol';

export interface SmartReframeWorkerPort {
	send(command: SmartReframeWorkerCommand, transfer?: Transferable[]): void;
	terminate(): void;
}

export async function spawnSmartReframeWorker(
	onState: (msg: SmartReframeWorkerState) => void,
	onCrash: (message: string) => void
): Promise<SmartReframeWorkerPort> {
	const worker = new Worker(new URL('../engine/reframe/reframe-analyzer.ts', import.meta.url), {
		type: 'classic'
	});
	const handler = (event: MessageEvent<SmartReframeWorkerState>) => {
		onState(event.data);
	};
	const errorHandler = (event: ErrorEvent) => {
		onCrash(event.message || 'Smart Reframe worker crashed.');
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
