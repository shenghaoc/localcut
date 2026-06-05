import type { WorkerCommand, WorkerStateMessage } from '../protocol';

export type StateHandler = (msg: WorkerStateMessage) => void;

export function createWorkerBridge(worker: Worker, onState: StateHandler) {
  worker.addEventListener('message', (event: MessageEvent<WorkerStateMessage>) => {
    onState(event.data);
  });

  return {
    send(command: WorkerCommand, transfer?: Transferable[]) {
      if (transfer?.length) {
        worker.postMessage(command, transfer);
      } else {
        worker.postMessage(command);
      }
    },
  };
}
