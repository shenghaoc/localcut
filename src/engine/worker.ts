/// <reference lib="webworker" />
import {
  assertCrossOriginIsolated,
  type WorkerCommand,
  type WorkerStateMessage,
} from '../protocol';
import { openMediaFile, type MediaInputHandle } from './media-io';
import { initGpu, type PreviewRenderer } from './gpu';
import {
  AdaptiveResolution,
  buildPreviewLadder,
  PlaybackController,
  type DecodedFrame,
} from './playback';
import { probeEncodeThroughput } from './hardware-probe';

let clockView: Float64Array | null = null;
let renderer: PreviewRenderer | null = null;
let mediaHandle: MediaInputHandle | null = null;
let playback: PlaybackController | null = null;
let adaptive: AdaptiveResolution | null = null;
let probeDone = false;

function post(msg: WorkerStateMessage) {
  self.postMessage(msg);
}

// Clock SAB layout: [0] currentTime, [1] duration, [2] playState (0/1).
// The worker is the sole writer. Each writer below mutates only the field(s) it
// owns so a play/pause never has to round-trip currentTime or duration.
function writeClockFull(currentTime: number, duration: number, playing: boolean) {
  if (!clockView) return;
  clockView[0] = currentTime;
  clockView[1] = duration;
  clockView[2] = playing ? 1 : 0;
}

/** Playback's per-frame writer: owns currentTime and playState, leaves duration. */
function writeTransport(currentTime: number, playing: boolean) {
  if (!clockView) return;
  clockView[0] = currentTime;
  clockView[2] = playing ? 1 : 0;
}

async function handleInit(canvas: OffscreenCanvas, sab: SharedArrayBuffer) {
  assertCrossOriginIsolated('Pipeline worker');
  clockView = new Float64Array(sab);
  writeClockFull(0, 0, false);

  const gpu = await initGpu(canvas);
  renderer = gpu.renderer;
  post({
    type: 'ready',
    webgpu: renderer !== null,
    features: gpu.features,
    gpuUnavailableReason: gpu.unavailableReason,
  });
}

function teardownMedia() {
  playback?.dispose();
  playback = null;
  adaptive = null;
  mediaHandle?.dispose();
  mediaHandle = null;
}

async function handleImport(file: File) {
  post({ type: 'import-progress', stage: 'reading' });
  teardownMedia();

  post({ type: 'import-progress', stage: 'metadata' });
  try {
    const handle = await openMediaFile(file);
    mediaHandle = handle;
    writeClockFull(0, handle.metadata.duration, false);
    post({ type: 'import-complete', metadata: handle.metadata });

    setupPlayback(handle);
    void runProbeOnce(handle);
  } catch (e) {
    // Tear down any partially-initialized media so a failed import never leaks.
    teardownMedia();
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'import-error', message });
  }
}

function setupPlayback(handle: MediaInputHandle) {
  const ladder = buildPreviewLadder(handle.displayWidth, handle.displayHeight);
  adaptive = new AdaptiveResolution(ladder);
  const initial = adaptive.current();
  if (renderer && handle.videoSink) {
    renderer.setPreviewSize(initial.width, initial.height);
    post({ type: 'preview-resolution', resolution: initial });
  }

  const getFrame = async (timestamp: number): Promise<DecodedFrame | null> => {
    if (!handle.videoSink) return null;
    return handle.videoSink.getSample(timestamp);
  };

  playback = new PlaybackController({
    duration: handle.duration,
    frameRate: handle.frameRate,
    getFrame,
    renderFrame: (frame) => renderer?.present(frame),
    writeClock: writeTransport,
    onFrameTime: handleFrameTime,
    onPlaybackError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      post({ type: 'error', message: `Playback error: ${message}` });
    },
  });

  // Render the first frame so the preview isn't blank before the user hits play.
  if (handle.videoSink) playback.refresh();
}

/** Adaptive resolution: downgrade the preview when frames blow the budget. */
function handleFrameTime(frameMs: number) {
  if (!adaptive || !renderer) return;
  const next = adaptive.record(frameMs);
  if (next) {
    renderer.setPreviewSize(next.width, next.height);
    post({ type: 'preview-resolution', resolution: next });
  }
}

async function runProbeOnce(handle: MediaInputHandle) {
  // The probe measures video-encode throughput; skip audio-only imports and defer
  // until a video file arrives so the estimate reflects a real encode workload.
  if (probeDone || !handle.videoSink) return;
  probeDone = true;
  const probe = await probeEncodeThroughput(handle.displayWidth, handle.displayHeight);
  if (probe) post({ type: 'probe-result', probe });
}

function handleDispose() {
  teardownMedia();
  renderer?.destroy();
  renderer = null;
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
      playback?.play();
      break;
    case 'pause':
      playback?.pause();
      break;
    case 'seek':
      playback?.seek(cmd.time);
      break;
    case 'step':
      playback?.step(cmd.direction);
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
