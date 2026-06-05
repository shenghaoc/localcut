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

  // initGpu() resolves with an unavailableReason for expected failures, but shader
  // module / pipeline compilation can still throw; catch so the worker always posts
  // `ready` (the UI would otherwise hang in a loading state).
  try {
    const gpu = await initGpu(canvas);
    renderer = gpu.renderer;
    post({
      type: 'ready',
      webgpu: renderer !== null,
      features: gpu.features,
      gpuUnavailableReason: gpu.unavailableReason,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({
      type: 'ready',
      webgpu: false,
      features: [],
      gpuUnavailableReason: `WebGPU initialization failed: ${message}`,
    });
  }

  // An import can arrive after `init` is sent but before `initGpu()` resolves
  // (the UI gates imports on `initSent`, not on `ready`). In that case the media
  // was set up with no renderer; wire up its preview now that the GPU is ready.
  ensurePreview();
}

/**
 * Sizes the preview to the current adaptive tier and renders the current frame.
 * Safe to call repeatedly and before the renderer or media exist (no-op until both
 * are ready), so it reconciles whichever of GPU-init / import completes last.
 */
function ensurePreview() {
  if (!renderer || !adaptive || !mediaHandle?.frameSource) return;
  const tier = adaptive.current();
  renderer.setPreviewSize(tier.width, tier.height);
  post({ type: 'preview-resolution', resolution: tier });
  playback?.refresh();
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
  // Budget the adaptive downgrade to the source frame period (e.g. ~16.6ms at
  // 60fps, ~41.6ms at 24fps), falling back to 33ms (~30fps) for unknown rates.
  const budgetMs = handle.frameRate > 0 ? 1000 / handle.frameRate : 33;
  adaptive = new AdaptiveResolution(ladder, budgetMs);

  const getFrame = (timestamp: number): Promise<DecodedFrame | null> =>
    handle.frameSource ? handle.frameSource.frameAt(timestamp) : Promise.resolve(null);

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

  // Size the preview and render the first frame so it isn't blank before play.
  // No-op until the renderer is ready; handleInit re-runs this when GPU init lands.
  ensurePreview();
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
  if (probeDone || !handle.frameSource) return;
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
