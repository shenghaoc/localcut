/// <reference lib="webworker" />
import {
  assertCrossOriginIsolated,
  type WorkerCommand,
  type WorkerStateMessage,
} from '../protocol';
import { openMediaFile, type MediaInputHandle } from './media-io';
import { destroyGpu, initGpu, type GpuContext } from './gpu';

let clockView: Float64Array | null = null;
let gpu: GpuContext | null = null;
let mediaHandle: MediaInputHandle | null = null;

function post(msg: WorkerStateMessage) {
  self.postMessage(msg);
}

// Clock SAB layout: [0] currentTime, [1] duration, [2] playState (0/1).
// Each writer below mutates only the field(s) it owns so intent is explicit
// and a play/pause never has to round-trip currentTime or duration.
function writeClock(currentTime: number, duration: number, playing: boolean) {
  if (!clockView) return;
  clockView[0] = currentTime;
  clockView[1] = duration;
  clockView[2] = playing ? 1 : 0;
}

function setCurrentTime(seconds: number) {
  if (clockView) clockView[0] = seconds;
}

function setPlaying(playing: boolean) {
  if (clockView) clockView[2] = playing ? 1 : 0;
}

async function handleInit(canvas: OffscreenCanvas, sab: SharedArrayBuffer) {
  assertCrossOriginIsolated('Pipeline worker');
  clockView = new Float64Array(sab);
  writeClock(0, 0, false);

  gpu = await initGpu(canvas);
  post({
    type: 'ready',
    webgpu: gpu.device !== null,
    features: gpu.features,
    gpuUnavailableReason: gpu.unavailableReason,
  });
}

async function handleImport(file: File) {
  post({ type: 'import-progress', stage: 'reading' });
  mediaHandle?.dispose();
  mediaHandle = null;

  post({ type: 'import-progress', stage: 'metadata' });
  try {
    mediaHandle = await openMediaFile(file);
    writeClock(0, mediaHandle.metadata.duration, false);
    post({ type: 'import-complete', metadata: mediaHandle.metadata });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'import-error', message });
  }
}

function handlePlay() {
  setPlaying(true);
}

function handlePause() {
  setPlaying(false);
}

function handleSeek(time: number) {
  const duration = clockView?.[1] ?? 0;
  const clamped = Math.max(0, duration > 0 ? Math.min(time, duration) : time);
  setCurrentTime(clamped);
}

function handleDispose() {
  mediaHandle?.dispose();
  mediaHandle = null;
  destroyGpu(gpu);
  gpu = null;
  clockView = null;
}

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'init':
      void handleInit(cmd.canvas, cmd.sab);
      break;
    case 'import':
      void handleImport(cmd.file);
      break;
    case 'play':
      handlePlay();
      break;
    case 'pause':
      handlePause();
      break;
    case 'seek':
      handleSeek(cmd.time);
      break;
    case 'dispose':
      handleDispose();
      break;
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
});
