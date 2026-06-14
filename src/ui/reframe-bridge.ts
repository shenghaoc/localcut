/**
 * Lazy bridge to the Smart Reframe worker (Phase 33). The worker is constructed
 * only when the user triggers analysis, so nothing model/runtime-related enters
 * the startup module graph or spawns eagerly (R0.3).
 *
 * It is a **module** worker (matching `vite.config` `worker.format: 'es'`). The
 * shipped saliency path needs no `importScripts`; when a face-detection model is
 * bundled (task T15) the LiteRT WASM loader's `importScripts` requirement is
 * handled then, as the ASR/cleanup workers do.
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
		type: 'module'
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
