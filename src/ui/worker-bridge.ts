import type { WorkerCommand, WorkerStateMessage } from '../protocol';

export type StateHandler = (msg: WorkerStateMessage) => void;

export function createWorkerBridge(worker: Worker, onState: StateHandler) {
	const handler = (event: MessageEvent<WorkerStateMessage>) => {
		onState(event.data);
	};
	worker.addEventListener('message', handler);

	return {
		send(command: WorkerCommand, transfer?: Transferable[]) {
			if (transfer?.length) {
				worker.postMessage(command, transfer);
			} else {
				worker.postMessage(command);
			}
		},
		dispose() {
			worker.removeEventListener('message', handler);
		}
	};
}
