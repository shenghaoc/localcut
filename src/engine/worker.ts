/// <reference lib="webworker" />
import {
  assertCrossOriginIsolated,
  ClockIndex,
  type ThroughputProbe,
  type TimelineTrackSnapshot,
  type WorkerCommand,
  type WorkerStateMessage,
} from '../protocol';
import {
  createEmptyTimeline,
  DEFAULT_TRACK_MIX,
  getTimelineDuration,
  reorderClip,
  removeClip,
  resolveAt,
  resolveAudioAt,
  splitClipAt,
  trimClip,
  setClipEffectParam,
  setTrackGain,
  setTrackMute,
  setTrackSolo,
  defaultClipEffects,
  type Timeline,
} from './timeline';
import {
  mapAudioRing,
  ringFreeSamples,
  writeRingPcm,
  RingHeader,
  RingState,
  bumpRingGeneration,
  resetRingPointers,
  type AudioRingViews,
} from './audio-ring';
import { openMediaFile, type MediaInputHandle } from './media-io';
import { initGpu, type PreviewRenderer } from './gpu';
import {
  AdaptiveResolution,
  buildPreviewLadder,
  PlaybackController,
  type DecodedFrame,
} from './playback';
import { probeEncodeThroughput } from './hardware-probe';
import { FrameCache, makeFrameCacheKey } from './frame-cache';
import { ExportCancelledError, exportTimelineToMp4 } from './export';

let clockView: Float64Array | null = null;
let renderer: PreviewRenderer | null = null;
let primaryHandle: MediaInputHandle | null = null;
let playback: PlaybackController | null = null;
let adaptive: AdaptiveResolution | null = null;
let probeDone = false;
let timeline: Timeline = createEmptyTimeline();
let nextSourceId = 1;
const sourceInputs = new Map<string, MediaInputHandle>();
let frameCache: FrameCache | null = null;
let currentProbe: ThroughputProbe | null = null;
let exportAbort: AbortController | null = null;
const FRAME_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
let audioRing: AudioRingViews | null = null;
let audioWriteAnchor = 0;
let audioWriteFrames = 0;
let pcmRemainder: Float32Array | null = null;
let audioPumpGen = 0;

function makeSourceId(): string {
  return `source-${nextSourceId++}`;
}

function post(msg: WorkerStateMessage) {
  self.postMessage(msg);
}

function postTimelineState() {
  const snapshot: TimelineTrackSnapshot[] = timeline.map((track) => ({
    id: track.id,
    type: track.type,
    gain: track.gain,
    muted: track.muted,
    solo: track.solo,
    clips: track.clips.map((clip) => ({
      id: clip.id,
      sourceId: clip.sourceId,
      start: clip.start,
      duration: clip.duration,
      inPoint: clip.inPoint,
      effects: { ...clip.effects },
    })),
  }));
  post({ type: 'timeline-state', timeline: snapshot });
}

function publishClockFromTimeline() {
  if (!clockView) return;
  const duration = getTimelineDuration(timeline);
  const wasPlaying = clockView[2] === 1;
  const clampedTime = Math.min(clockView[0] ?? 0, duration);
  clockView[0] = clampedTime;
  clockView[1] = duration;
  if (!wasPlaying) {
    clockView[2] = 0;
  }
}

function getPlaybackSource(): MediaInputHandle | null {
  if (primaryHandle?.frameSource) return primaryHandle;
  for (const handle of sourceInputs.values()) {
    if (handle.frameSource) return handle;
  }
  return null;
}

function appendTrackForSource(handle: MediaInputHandle, start?: number) {
  if (!handle.frameSource || !handle.metadata.video) return;
  const trackId = `track-video-${handle.sourceId}`;
  if (timeline.some((track) => track.id === trackId)) return;

  const clipStart = start ?? getTimelineDuration(timeline);
  const nextTrack = {
    id: trackId,
    type: 'video' as const,
    ...DEFAULT_TRACK_MIX,
    clips: [
      {
        id: `clip-${handle.sourceId}`,
        sourceId: handle.sourceId,
        start: clipStart,
        duration: handle.duration,
        inPoint: 0,
        effects: defaultClipEffects(),
      },
    ],
  };

  timeline = [...timeline, nextTrack];
}

function appendAudioTrackForSource(handle: MediaInputHandle, start?: number) {
  if (!handle.audioSource || !handle.metadata.audio) return;
  const trackId = `track-audio-${handle.sourceId}`;
  if (timeline.some((track) => track.id === trackId)) return;

  const clipStart = start ?? getTimelineDuration(timeline);
  const clipId = `clip-audio-${handle.sourceId}`;
  const nextTrack = {
    id: trackId,
    type: 'audio' as const,
    ...DEFAULT_TRACK_MIX,
    clips: [
      {
        id: clipId,
        sourceId: handle.sourceId,
        start: clipStart,
        duration: handle.duration,
        inPoint: 0,
        effects: defaultClipEffects(),
      },
    ],
  };
  timeline = [...timeline, nextTrack];
  void computeAndPostWaveform(handle, trackId, clipId);
}

async function computeAndPostWaveform(
  handle: MediaInputHandle,
  trackId: string,
  clipId: string,
) {
  if (!handle.audioSource) return;
  const peaks = await handle.audioSource.collectPeaks(30, 256);
  post({ type: 'waveform-peaks', trackId, clipId, peaks });
}

function hasAudioTimeline(): boolean {
  return timeline.some((track) => track.type === 'audio' && track.clips.length > 0);
}

function getMasterTime(): number | null {
  if (!clockView || !audioRing || !hasAudioTimeline()) return null;
  if ((clockView[ClockIndex.PLAY_STATE] ?? 0) !== 1) return null;
  const t = clockView[ClockIndex.AUDIO_CLOCK];
  return Number.isFinite(t) ? t : null;
}

function trackAudible(trackId: string): number {
  const track = timeline.find((t) => t.id === trackId);
  if (!track || track.muted) return 0;
  const anySolo = timeline.some((t) => t.solo);
  if (anySolo && !track.solo) return 0;
  return track.gain;
}

async function pumpAudioOnce(): Promise<void> {
  if (!audioRing || !clockView) return;
  if (Atomics.load(audioRing.header, RingHeader.STATE) !== RingState.PLAYING) return;
  const freeFrames = ringFreeSamples(audioRing);
  if (freeFrames < 256) return;

  const sampleRate = Atomics.load(audioRing.header, RingHeader.SAMPLE_RATE) || 48_000;
  const timelineTime = audioWriteAnchor + audioWriteFrames / sampleRate;
  const resolved = resolveAudioAt(timeline, timelineTime);
  if (!resolved) {
    const channels = Math.max(1, Atomics.load(audioRing.header, RingHeader.CHANNELS));
    const silenceFrames = Math.min(freeFrames, 1024);
    const written = writeRingPcm(audioRing, new Float32Array(silenceFrames * channels));
    audioWriteFrames += written;
    return;
  }
  const handle = sourceInputs.get(resolved.clip.sourceId);
  if (!handle?.audioSource) {
    const channels = Math.max(1, Atomics.load(audioRing.header, RingHeader.CHANNELS));
    const silenceFrames = Math.min(freeFrames, 1024);
    const written = writeRingPcm(audioRing, new Float32Array(silenceFrames * channels));
    audioWriteFrames += written;
    return;
  }

  const channels = Math.max(1, Atomics.load(audioRing.header, RingHeader.CHANNELS));
  let pcm: Float32Array | null;
  if (pcmRemainder) {
    pcm = pcmRemainder;
    pcmRemainder = null;
  } else {
    pcm = await handle.audioSource.pcmAt(resolved.sourceTime, channels);
    if (!pcm) {
      const silenceFrames = Math.min(freeFrames, 1024);
      const written = writeRingPcm(audioRing, new Float32Array(silenceFrames * channels));
      audioWriteFrames += written;
      return;
    }
  }

  const gain = trackAudible(resolved.trackId);
  if (gain <= 0) {
    pcm.fill(0);
  } else if (gain !== 1) {
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = (pcm[i] ?? 0) * gain;
  }
  const written = writeRingPcm(audioRing, pcm);
  audioWriteFrames += written;
  const totalFrames = pcm.length / channels;
  if (written < totalFrames) {
    pcmRemainder = pcm.subarray(written * channels);
  }
}

function startAudioPump(): void {
  if (!audioRing) return;
  const gen = ++audioPumpGen;
  const loop = async () => {
    while (gen === audioPumpGen && playback?.isPlaying()) {
      try {
        await pumpAudioOnce();
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 4));
    }
  };
  void loop();
}

function stopAudioPump(): void {
  audioPumpGen += 1;
}

function resetAudioRingForSeek(time: number): void {
  if (!audioRing) return;
  bumpRingGeneration(audioRing);
  resetRingPointers(audioRing);
  audioWriteAnchor = time;
  audioWriteFrames = 0;
  pcmRemainder = null;
  if (clockView) {
    clockView[ClockIndex.AUDIO_CLOCK] = time;
    clockView[ClockIndex.CURRENT_TIME] = time;
  }
}

function ensureClockAndTimeline() {
  publishClockFromTimeline();
  postTimelineState();
}

function ensureFrameCache() {
  if (frameCache) return frameCache;
  frameCache = new FrameCache({
    maxBytes: FRAME_CACHE_BUDGET_BYTES,
    estimateBytes: (frame) => frame.codedWidth * frame.codedHeight * 4,
  });
  return frameCache;
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
  if (!audioRing || !hasAudioTimeline()) clockView[ClockIndex.CURRENT_TIME] = currentTime;
  clockView[ClockIndex.PLAY_STATE] = playing ? 1 : 0;
}

async function handleInit(
  canvas: OffscreenCanvas,
  sab: SharedArrayBuffer,
  audioSab?: SharedArrayBuffer | null,
) {
  assertCrossOriginIsolated('Pipeline worker');
  clockView = new Float64Array(sab);
  writeClockFull(0, 0, false);
  audioRing = audioSab ? mapAudioRing(audioSab) : null;

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

  // An import can arrive after `init` is sent but before `ready` is resolved
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
  const source = getPlaybackSource();
  if (!renderer || !adaptive || !source?.frameSource) return;
  const tier = adaptive.current();
  renderer.setPreviewSize(tier.width, tier.height);
  post({ type: 'preview-resolution', resolution: tier });
  playback?.refresh();
}

function teardownMedia() {
  exportAbort?.abort();
  exportAbort = null;
  playback?.dispose();
  playback = null;
  adaptive = null;
  frameCache?.clear();
  frameCache = null;
  for (const handle of sourceInputs.values()) {
    handle.dispose();
  }
  sourceInputs.clear();
  primaryHandle = null;
  timeline = createEmptyTimeline();
}

function wrapDecodedFrameForPlayback(frameSource: MediaInputHandle, sourceTimestamp: number): Promise<DecodedFrame | null> {
  if (!frameSource.frameSource) {
    return Promise.resolve(null);
  }
  // Capture the controller that requested this decode. If playback is disposed or
  // rebuilt (re-import, teardown) before the decode resolves, the old controller
  // will never receive or close this frame — drop it here so it can't leak.
  const activePlayback = playback;
  return frameSource.frameSource.frameAt(sourceTimestamp).then((decoded) => {
    if (!decoded) return null;
    // Close the decoded sample even if toVideoFrame() throws on a corrupt
    // sample — otherwise the underlying decoder resource leaks. The thrown
    // error still propagates to the caller via the .then() chain.
    let base: VideoFrame;
    try {
      base = decoded.toVideoFrame();
    } finally {
      decoded.close();
    }

    if (playback !== activePlayback) {
      base.close();
      return null;
    }

    // The cache owns its own clone; the wrapper owns `base`. `toVideoFrame()` hands
    // the caller a *distinct* clone to render and close. Each VideoFrame here is
    // closed exactly once: the caller's clone by the caller, `base` by close(),
    // the cache's clone on eviction.
    frameCache?.set(makeFrameCacheKey(frameSource.sourceId, sourceTimestamp), base.clone());
    return {
      toVideoFrame: () => base.clone(),
      close: () => base.close(),
    };
  });
}

function makeGetFrame() {
  return async (timestamp: number): Promise<DecodedFrame | null> => {
    const resolved = resolveAt(timeline, timestamp);
    if (!resolved) return null;

    const sourceHandle = sourceInputs.get(resolved.clip.sourceId);
    if (!sourceHandle) return null;

    if (!frameCache) {
      return wrapDecodedFrameForPlayback(sourceHandle, resolved.sourceTime);
    }

    const key = makeFrameCacheKey(resolved.clip.sourceId, resolved.sourceTime);
    // FrameCache.get() returns a caller-owned clone. The wrapper owns it (closed via
    // close()) and hands the renderer a further clone, keeping the two close paths on
    // distinct frames so neither the wrapper nor the cache's own copy is closed twice.
    const cached = frameCache.get(key);
    if (cached) {
      return {
        toVideoFrame: () => cached.clone(),
        close: () => cached.close(),
      };
    }

    return wrapDecodedFrameForPlayback(sourceHandle, resolved.sourceTime);
  };
}

async function handleImport(file: File) {
  post({ type: 'import-progress', stage: 'reading' });

  post({ type: 'import-progress', stage: 'metadata' });
  let sourceId: string | null = null;
  let handle: MediaInputHandle | null = null;
  try {
    sourceId = makeSourceId();
    handle = await openMediaFile(file, sourceId);
    sourceInputs.set(sourceId, handle);

    if (!primaryHandle && handle.frameSource) {
      primaryHandle = handle;
    }

    const start = getTimelineDuration(timeline);
    appendTrackForSource(handle, start);
    appendAudioTrackForSource(handle, start);
    ensureClockAndTimeline();

    if (handle.audioSource && audioRing) {
      Atomics.store(audioRing.header, RingHeader.SAMPLE_RATE, handle.audioSampleRate);
      Atomics.store(audioRing.header, RingHeader.CHANNELS, handle.audioChannels);
    }

    post({ type: 'import-complete', metadata: handle.metadata });

    const playbackHandle = getPlaybackSource();
    if (playbackHandle && playbackHandle.metadata.video) {
      setupPlayback();
      void runProbeOnce(playbackHandle);
    }
  } catch (e) {
    if (handle) {
      handle.dispose();
    }
    if (sourceId) {
      sourceInputs.delete(sourceId);
    }
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'import-error', message });
  }
}

/**
 * Disposes `MediaInputHandle`s for sources no longer referenced by any clip,
 * releasing their decoder resources. Cheap to call after every edit; safe to
 * call when nothing changes (set lookup misses, no disposes).
 */
function pruneUnusedSources(): void {
  if (exportAbort) return;
  const inUse = new Set<string>();
  for (const track of timeline) {
    for (const clip of track.clips) inUse.add(clip.sourceId);
  }
  for (const [id, handle] of [...sourceInputs.entries()]) {
    if (inUse.has(id)) continue;
    handle.dispose();
    sourceInputs.delete(id);
    if (primaryHandle === handle) primaryHandle = null;
  }
}

function applyTimelineCommand(): void {
  pruneUnusedSources();
  ensureClockAndTimeline();
  // The controller was built with the pre-edit duration; refresh it so the loop and
  // clamps respect a timeline that an edit may have shortened, then re-seek to
  // re-render the (possibly changed) frame under the playhead.
  playback?.setDuration(getTimelineDuration(timeline));
  playback?.seek(clockView?.[0] ?? 0);
}

function handleSplit(cmd: Extract<WorkerCommand, { type: 'split' }>) {
  timeline = splitClipAt(timeline, cmd.trackId, cmd.time);
  applyTimelineCommand();
}

function handleDelete(cmd: Extract<WorkerCommand, { type: 'delete-clip' }>) {
  timeline = removeClip(timeline, cmd.trackId, cmd.clipId);
  applyTimelineCommand();
}

function handleMove(cmd: Extract<WorkerCommand, { type: 'move-clip' }>) {
  timeline = reorderClip(timeline, cmd.fromTrackId, cmd.clipId, cmd.toTrackId, cmd.toIndex);
  applyTimelineCommand();
}

function handleSetEffectParam(cmd: Extract<WorkerCommand, { type: 'set-effect-param' }>) {
  timeline = setClipEffectParam(timeline, cmd.trackId, cmd.clipId, cmd.key, cmd.value);
  postTimelineState();
  playback?.refresh();
}

function handleSetTrackGain(cmd: Extract<WorkerCommand, { type: 'set-track-gain' }>) {
  timeline = setTrackGain(timeline, cmd.trackId, cmd.gain);
  postTimelineState();
}

function handleSetTrackMute(cmd: Extract<WorkerCommand, { type: 'set-track-mute' }>) {
  timeline = setTrackMute(timeline, cmd.trackId, cmd.muted);
  postTimelineState();
}

function handleSetTrackSolo(cmd: Extract<WorkerCommand, { type: 'set-track-solo' }>) {
  timeline = setTrackSolo(timeline, cmd.trackId, cmd.solo);
  postTimelineState();
}

function handleTrim(cmd: Extract<WorkerCommand, { type: 'trim-clip' }>) {
  // Look up the underlying source's duration so trimClip can bound an outward
  // extension. Without it, trimClip would refuse to grow the clip past its
  // current edge — preventing the user from restoring a previously-shrunk clip.
  const track = timeline.find((t) => t.id === cmd.trackId);
  const clip = track?.clips.find((c) => c.id === cmd.clipId);
  const sourceDuration = clip ? sourceInputs.get(clip.sourceId)?.duration : undefined;
  timeline = trimClip(timeline, cmd.trackId, cmd.clipId, {
    edge: cmd.edge,
    time: cmd.time,
    sourceDuration,
  });
  applyTimelineCommand();
}

function setupPlayback() {
  const handle = getPlaybackSource();
  if (!handle?.frameSource) return;

  const ladder = buildPreviewLadder(handle.displayWidth, handle.displayHeight);
  // Budget the adaptive downgrade to the source frame period (e.g. ~16.6ms at
  // 60fps, ~41.6ms at 24fps), falling back to 33ms (~30fps) for unknown rates.
  const budgetMs = handle.frameRate > 0 ? 1000 / handle.frameRate : 33;
  adaptive = new AdaptiveResolution(ladder, budgetMs);
  ensureFrameCache();

  const priorTime = playback?.getCurrentTime() ?? 0;
  const wasPlaying = playback?.isPlaying() ?? false;
  playback?.dispose();

  const getFrame = makeGetFrame();
  playback = new PlaybackController({
    duration: getTimelineDuration(timeline),
    frameRate: handle.frameRate,
    getFrame,
    renderFrame: (frame, timestamp) => {
      const resolved = resolveAt(timeline, timestamp);
      renderer?.present(frame, resolved?.clip.effects);
    },
    writeClock: writeTransport,
    onFrameTime: handleFrameTime,
    onPlaybackError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      post({ type: 'error', message: `Playback error: ${message}` });
    },
    getMasterTime,
  });

  const clamped = Math.min(priorTime, getTimelineDuration(timeline));
  playback.seek(clamped);
  if (wasPlaying) {
    playback.play();
  }

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
  if (probe) {
    currentProbe = probe;
    post({ type: 'probe-result', probe });
  }
}

function handlePlay() {
  playback?.play();
  if (audioRing) {
    audioWriteAnchor = clockView?.[ClockIndex.CURRENT_TIME] ?? 0;
    audioWriteFrames = 0;
    Atomics.store(audioRing.header, RingHeader.STATE, RingState.PLAYING);
  }
  startAudioPump();
}

function handlePause() {
  playback?.pause();
  stopAudioPump();
  if (audioRing) Atomics.store(audioRing.header, RingHeader.STATE, RingState.PAUSED);
}

function handleSeek(time: number) {
  resetAudioRingForSeek(time);
  playback?.seek(time);
}

function cloneTimelineForExport(): Timeline {
  return timeline.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({ ...clip, effects: { ...clip.effects } })),
  }));
}

async function handleExportStart(cmd: Extract<WorkerCommand, { type: 'export-start' }>) {
  if (exportAbort) {
    post({ type: 'export-error', message: 'An export is already running.' });
    return;
  }
  if (!renderer) {
    post({ type: 'export-error', message: 'Export requires WebGPU preview to be available.' });
    return;
  }

  handlePause();
  const controller = new AbortController();
  exportAbort = controller;

  try {
    const result = await exportTimelineToMp4({
      timeline: cloneTimelineForExport(),
      sources: sourceInputs,
      renderer,
      outputHandle: cmd.output,
      preset: cmd.preset,
      throughputProbe: currentProbe,
      signal: controller.signal,
      onProgress: (progress) => post({ type: 'export-progress', progress }),
    });
    post({ type: 'export-complete', fileName: cmd.output.name, mimeType: result.mimeType });
  } catch (error) {
    if (error instanceof ExportCancelledError) {
      post({ type: 'export-canceled' });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'export-error', message });
    }
  } finally {
    exportAbort = null;
    pruneUnusedSources();
    ensurePreview();
  }
}

function handleExportCancel() {
  exportAbort?.abort();
}

function handleDispose() {
  stopAudioPump();
  teardownMedia();
  renderer?.destroy();
  renderer = null;
  clockView = null;
  audioRing = null;
}

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'init':
      void handleInit(cmd.canvas, cmd.sab, cmd.audioSab);
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
    case 'step':
      playback?.step(cmd.direction);
      break;
    case 'export-start':
      void handleExportStart(cmd);
      break;
    case 'export-cancel':
      handleExportCancel();
      break;
    case 'split':
      handleSplit(cmd);
      break;
    case 'delete-clip':
      handleDelete(cmd);
      break;
    case 'move-clip':
      handleMove(cmd);
      break;
    case 'trim-clip':
      handleTrim(cmd);
      break;
    case 'set-effect-param':
      handleSetEffectParam(cmd);
      break;
    case 'set-track-gain':
      handleSetTrackGain(cmd);
      break;
    case 'set-track-mute':
      handleSetTrackMute(cmd);
      break;
    case 'set-track-solo':
      handleSetTrackSolo(cmd);
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
