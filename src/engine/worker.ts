/// <reference lib="webworker" />
import {
  assertCrossOriginIsolated,
  ClockIndex,
  type ThroughputProbe,
  type MediaMetadata,
  type SourceDescriptorSnapshot,
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
import { createTimelineHistory, type HistoryCoalesceKey } from './history';
import {
  cloneTimelineSnapshot,
  serializeProject,
  sourceDescriptorMatchesCandidate,
  type ProjectDoc,
  type SourceDescriptor,
} from './project';
import {
  deleteStoredProject,
  loadStoredProject,
  loadStoredSource,
  saveStoredProject,
  saveStoredSource,
  saveStoredSourceWithoutHandle,
  type StoredSourceRecord,
} from './persistence';

let clockView: Float64Array | null = null;
let renderer: PreviewRenderer | null = null;
let primaryHandle: MediaInputHandle | null = null;
let playback: PlaybackController | null = null;
let adaptive: AdaptiveResolution | null = null;
let probeDone = false;
let timeline: Timeline = createEmptyTimeline();
let nextSourceId = 1;
const sourceInputs = new Map<string, MediaInputHandle>();
const sourceDescriptors = new Map<string, SourceDescriptor>();
const restoringSourceIds = new Set<string>();
const history = createTimelineHistory();
let projectId = makeProjectId();
let restoreDoc: ProjectDoc | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveInFlight: Promise<void> | null = null;
let restoreOfferGeneration = 0;
let frameCache: FrameCache | null = null;
let currentProbe: ThroughputProbe | null = null;
let exportAbort: AbortController | null = null;
const FRAME_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
let audioRing: AudioRingViews | null = null;
let audioWriteAnchor = 0;
let audioWriteFrames = 0;
let pcmRemainder: Float32Array | null = null;
let audioPumpGen = 0;
const AUTOSAVE_DEBOUNCE_MS = 300;

function makeSourceId(): string {
  return `source-${nextSourceId++}`;
}

function makeProjectId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `project-${crypto.randomUUID()}`;
  }
  return `project-${Math.random().toString(36).slice(2)}`;
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
      offline: sourceInputs.has(clip.sourceId) ? undefined : true,
    })),
  }));
  post({ type: 'timeline-state', timeline: snapshot });
}

function postHistoryState(): void {
  post({ type: 'history-state', ...history.state() });
}

function postProjectWarning(message: string): void {
  post({ type: 'project-warning', message });
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

function sourceDescriptorFromHandle(
  sourceId: string,
  file: File,
  handle: MediaInputHandle,
): SourceDescriptor {
  const video = handle.metadata.video
    ? {
        width: handle.metadata.video.width,
        height: handle.metadata.video.height,
        frameRate: handle.metadata.video.frameRate,
        codec: handle.metadata.video.codec,
        canDecode: handle.metadata.video.canDecode,
      }
    : undefined;
  const audio = handle.metadata.audio
    ? {
        channels: handle.metadata.audio.channels,
        sampleRate: handle.metadata.audio.sampleRate,
        codec: handle.metadata.audio.codec,
        canDecode: handle.metadata.audio.canDecode,
      }
    : undefined;

  return {
    sourceId,
    fileName: file.name,
    byteSize: file.size,
    durationS: handle.duration,
    mimeType: handle.metadata.mimeType,
    video,
    audio,
  };
}

function timelineSourceIds(): Set<string> {
  const ids = new Set<string>();
  for (const track of timeline) {
    for (const clip of track.clips) {
      ids.add(clip.sourceId);
    }
  }
  return ids;
}

function currentProjectSources(): SourceDescriptor[] {
  const ids = timelineSourceIds();
  const descriptors: SourceDescriptor[] = [];
  for (const id of ids) {
    const descriptor = sourceDescriptors.get(id);
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
}

function unresolvedSourceDescriptors(): SourceDescriptorSnapshot[] {
  const unresolved: SourceDescriptorSnapshot[] = [];
  for (const id of timelineSourceIds()) {
    if (sourceInputs.has(id)) continue;
    const descriptor = sourceDescriptors.get(id);
    if (descriptor) unresolved.push(descriptor);
  }
  return unresolved;
}

function activeMetadata(): MediaMetadata | null {
  const source = getPlaybackSource() ?? sourceInputs.values().next().value ?? null;
  return source?.metadata ?? null;
}

function clearAutosaveTimer(): void {
  if (!autosaveTimer) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

async function persistCurrentProject(): Promise<void> {
  const doc = serializeProject({
    projectId,
    timeline,
    sources: currentProjectSources(),
  });
  await saveStoredProject(doc);
}

function runAutosave(): Promise<void> {
  let save: Promise<void>;
  save = persistCurrentProject()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      postProjectWarning(`Autosave failed: ${message}`);
    })
    .finally(() => {
      if (autosaveInFlight === save) {
        autosaveInFlight = null;
      }
    });
  autosaveInFlight = save;
  return save;
}

function scheduleAutosave(): void {
  clearAutosaveTimer();
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void runAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function flushPendingAutosave(): Promise<void> {
  const shouldSave = autosaveTimer !== null;
  clearAutosaveTimer();
  if (shouldSave) {
    await runAutosave();
  } else if (autosaveInFlight) {
    await autosaveInFlight;
  }
}

async function persistSource(record: StoredSourceRecord): Promise<void> {
  try {
    await saveStoredSource(record);
  } catch (error) {
    if (!record.fileHandle) throw error;
    await saveStoredSourceWithoutHandle(record);
  }
}

async function persistSourceBestEffort(record: StoredSourceRecord): Promise<void> {
  try {
    await persistSource(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postProjectWarning(`Source autosave failed for ${record.descriptor.fileName}: ${message}`);
  }
}

function nextSourceIdFromDescriptors(descriptors: readonly SourceDescriptor[]): number {
  let next = 1;
  for (const descriptor of descriptors) {
    const match = /^source-(\d+)$/.exec(descriptor.sourceId);
    if (!match) continue;
    next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

async function computeWaveformsForSource(handle: MediaInputHandle): Promise<void> {
  if (!handle.audioSource) return;
  const jobs: Promise<void>[] = [];
  for (const track of timeline) {
    if (track.type !== 'audio') continue;
    for (const clip of track.clips) {
      if (clip.sourceId === handle.sourceId) {
        jobs.push(computeAndPostWaveform(handle, track.id, clip.id));
      }
    }
  }
  await Promise.all(jobs);
}

async function fileFromHandle(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    const permissionRequest = { mode: 'read' as const };
    const queryPermission = handle.queryPermission;
    if (queryPermission) {
      const state = await queryPermission.call(handle, permissionRequest);
      if (state === 'denied') return null;
      if (state === 'granted') return await handle.getFile();
    }
    const requestPermission = handle.requestPermission;
    if (requestPermission) {
      const state = await requestPermission.call(handle, permissionRequest);
      if (state !== 'granted') return null;
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function attachSourceFile(
  descriptor: SourceDescriptor,
  file: File,
  fileHandle?: FileSystemFileHandle | null,
  persist = false,
  canAttach: () => boolean = () => true,
): Promise<{ ok: true; handle: MediaInputHandle } | { ok: false; message: string }> {
  let mediaHandle: MediaInputHandle;
  try {
    mediaHandle = await openMediaFile(file, descriptor.sourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }

  const candidate = sourceDescriptorFromHandle(descriptor.sourceId, file, mediaHandle);
  if (!sourceDescriptorMatchesCandidate(descriptor, candidate)) {
    mediaHandle.dispose();
    return {
      ok: false,
      message: `Picked file does not match ${descriptor.fileName}. Match requires the same name, size, and duration.`,
    };
  }
  if (!canAttach()) {
    mediaHandle.dispose();
    return { ok: false, message: 'Restore was superseded by a newer project action.' };
  }

  const previous = sourceInputs.get(descriptor.sourceId);
  if (previous && previous !== mediaHandle) previous.dispose();
  sourceInputs.set(descriptor.sourceId, mediaHandle);
  sourceDescriptors.set(descriptor.sourceId, descriptor);
  if ((!primaryHandle || primaryHandle.sourceId === descriptor.sourceId) && mediaHandle.frameSource) {
    primaryHandle = mediaHandle;
  }
  if (mediaHandle.audioSource && audioRing) {
    Atomics.store(audioRing.header, RingHeader.SAMPLE_RATE, mediaHandle.audioSampleRate);
    Atomics.store(audioRing.header, RingHeader.CHANNELS, mediaHandle.audioChannels);
  }
  void computeWaveformsForSource(mediaHandle);

  if (persist) {
    await persistSourceBestEffort({
      sourceId: descriptor.sourceId,
      descriptor,
      file,
      fileHandle: fileHandle ?? undefined,
    });
  }

  return { ok: true, handle: mediaHandle };
}

async function restoreStoredSources(
  descriptors: readonly SourceDescriptor[],
  isCurrent: () => boolean = () => true,
): Promise<SourceDescriptorSnapshot[]> {
  const unresolved: SourceDescriptorSnapshot[] = [];
  for (const descriptor of descriptors) {
    if (!isCurrent()) break;
    if (sourceInputs.has(descriptor.sourceId)) continue;
    if (restoringSourceIds.has(descriptor.sourceId)) {
      unresolved.push(descriptor);
      continue;
    }
    restoringSourceIds.add(descriptor.sourceId);
    sourceDescriptors.set(descriptor.sourceId, descriptor);
    let attached = false;
    try {
      const stored = await loadStoredSource(descriptor.sourceId).catch(() => null);
      if (!isCurrent()) break;
      if (stored?.file) {
        const result = await attachSourceFile(
          descriptor,
          stored.file,
          stored.fileHandle ?? null,
          false,
          isCurrent,
        );
        attached = result.ok;
      }
      if (!isCurrent()) break;
      if (!attached && stored?.fileHandle) {
        const file = await fileFromHandle(stored.fileHandle);
        if (!isCurrent()) break;
        if (file) {
          const result = await attachSourceFile(
            descriptor,
            file,
            stored.fileHandle,
            false,
            isCurrent,
          );
          attached = result.ok;
        }
      }
      if (!attached) {
        unresolved.push(descriptor);
      }
    } finally {
      restoringSourceIds.delete(descriptor.sourceId);
    }
  }
  return unresolved;
}

async function restoreMissingSources(): Promise<void> {
  const missing = unresolvedSourceDescriptors();
  if (missing.length === 0) return;
  await restoreStoredSources(missing);
  setupPlayback();
  ensureClockAndTimeline();
}

function afterTimelineMutation(options: {
  coalesceKey?: HistoryCoalesceKey;
  refreshPlayback?: 'seek' | 'refresh' | 'none';
  prune?: boolean;
} = {}): void {
  if (options.prune !== false) {
    pruneUnusedSources();
  }
  ensureClockAndTimeline();
  postHistoryState();
  scheduleAutosave();
  if (options.refreshPlayback === 'refresh') {
    playback?.refresh();
  } else if (options.refreshPlayback !== 'none') {
    playback?.setDuration(getTimelineDuration(timeline));
    playback?.seek(clockView?.[0] ?? 0);
  }
  void restoreMissingSources().catch(() => undefined);
}

function commitTimelineMutation(
  mutate: () => Timeline,
  options: {
    coalesceKey?: HistoryCoalesceKey;
    refreshPlayback?: 'seek' | 'refresh' | 'none';
    prune?: boolean;
  } = {},
): boolean {
  const before = timeline;
  const next = mutate();
  if (next === before) return false;
  history.push(before, { coalesceKey: options.coalesceKey });
  timeline = next;
  afterTimelineMutation(options);
  return true;
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
  postHistoryState();
  void checkRestoreAvailable();
}

function projectHasClips(doc: ProjectDoc): boolean {
  return doc.timeline.some((track) => track.clips.length > 0);
}

function currentProjectIsEmpty(): boolean {
  return sourceInputs.size === 0 && timelineSourceIds().size === 0;
}

async function checkRestoreAvailable(): Promise<void> {
  const generation = restoreOfferGeneration;
  const checkedProjectId = projectId;
  const result = await loadStoredProject();
  if (!result.ok) {
    postProjectWarning(`Could not read autosaved project: ${result.reason}`);
    return;
  }
  if (!result.doc || !projectHasClips(result.doc)) return;
  if (
    generation !== restoreOfferGeneration ||
    projectId !== checkedProjectId ||
    !currentProjectIsEmpty()
  ) {
    return;
  }
  restoreDoc = result.doc;
  post({
    type: 'restore-available',
    projectId: result.doc.projectId,
    savedAt: result.doc.savedAt,
    sources: result.doc.sources,
  });
}

async function handleRestoreProject(): Promise<void> {
  restoreOfferGeneration += 1;
  const restoreGeneration = restoreOfferGeneration;
  const emptyProjectId = projectId;
  let doc = restoreDoc;
  if (!currentProjectIsEmpty()) {
    restoreDoc = null;
    post({
      type: 'restore-result',
      projectId,
      restored: false,
      savedAt: null,
      metadata: activeMetadata(),
      unresolvedSources: unresolvedSourceDescriptors(),
      message: 'Restore offer expired after the current project changed.',
    });
    return;
  }
  if (!doc) {
    const loaded = await loadStoredProject();
    if (!loaded.ok) {
      post({
        type: 'restore-result',
        projectId,
        restored: false,
        savedAt: null,
        metadata: null,
        unresolvedSources: [],
        message: `Could not read autosaved project: ${loaded.reason}`,
      });
      return;
    }
    if (
      restoreOfferGeneration !== restoreGeneration ||
      projectId !== emptyProjectId ||
      !currentProjectIsEmpty()
    ) {
      restoreDoc = null;
      return;
    }
    doc = loaded.doc;
  }
  if (!doc) {
    post({
      type: 'restore-result',
      projectId,
      restored: false,
      savedAt: null,
      metadata: null,
      unresolvedSources: [],
      message: 'No autosaved project was found.',
    });
    return;
  }

  teardownMedia();
  clearAutosaveTimer();
  sourceDescriptors.clear();
  history.clear();
  restoreDoc = null;
  projectId = doc.projectId;
  timeline = cloneTimelineSnapshot(doc.timeline);
  nextSourceId = nextSourceIdFromDescriptors(doc.sources);
  for (const descriptor of doc.sources) {
    sourceDescriptors.set(descriptor.sourceId, descriptor);
  }

  const restoreProjectId = projectId;
  const isCurrentRestore = () =>
    restoreOfferGeneration === restoreGeneration && projectId === restoreProjectId;
  const unresolved = await restoreStoredSources(doc.sources, isCurrentRestore);
  if (!isCurrentRestore()) {
    return;
  }
  setupPlayback();
  ensureClockAndTimeline();
  postHistoryState();
  post({
    type: 'restore-result',
    projectId,
    restored: true,
    savedAt: doc.savedAt,
    metadata: activeMetadata(),
    unresolvedSources: unresolved,
    message:
      unresolved.length > 0
        ? `Restored project shell with ${unresolved.length} offline source${unresolved.length === 1 ? '' : 's'}.`
        : 'Restored autosaved project.',
  });
}

async function handleNewProject(): Promise<void> {
  restoreOfferGeneration += 1;
  await flushPendingAutosave();
  restoreDoc = null;
  teardownMedia();
  sourceDescriptors.clear();
  history.clear();
  projectId = makeProjectId();
  nextSourceId = 1;
  ensureClockAndTimeline();
  postHistoryState();
  let message = 'Started a new project.';
  try {
    await deleteStoredProject();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    message = `Started a new project, but autosave could not be cleared: ${reason}`;
  }
  post({
    type: 'restore-result',
    projectId,
    restored: false,
    savedAt: null,
    metadata: null,
    unresolvedSources: [],
    message,
  });
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

async function handleImport(file: File, fileHandle?: FileSystemFileHandle | null) {
  restoreOfferGeneration += 1;
  restoreDoc = null;
  post({ type: 'import-progress', stage: 'reading' });

  post({ type: 'import-progress', stage: 'metadata' });
  let sourceId: string | null = null;
  let handle: MediaInputHandle | null = null;
  try {
    sourceId = makeSourceId();
    handle = await openMediaFile(file, sourceId);
    sourceInputs.set(sourceId, handle);
    const descriptor = sourceDescriptorFromHandle(sourceId, file, handle);
    sourceDescriptors.set(sourceId, descriptor);
    await persistSourceBestEffort({
      sourceId,
      descriptor,
      file,
      fileHandle: fileHandle ?? undefined,
    });

    if (!primaryHandle && handle.frameSource) {
      primaryHandle = handle;
    }

    const before = timeline;
    const start = getTimelineDuration(timeline);
    appendTrackForSource(handle, start);
    appendAudioTrackForSource(handle, start);
    if (timeline !== before) {
      history.push(before);
      afterTimelineMutation();
    } else {
      ensureClockAndTimeline();
      postHistoryState();
      scheduleAutosave();
    }

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
      sourceDescriptors.delete(sourceId);
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

function handleSplit(cmd: Extract<WorkerCommand, { type: 'split' }>) {
  commitTimelineMutation(() => splitClipAt(timeline, cmd.trackId, cmd.time));
}

function handleDelete(cmd: Extract<WorkerCommand, { type: 'delete-clip' }>) {
  commitTimelineMutation(() => removeClip(timeline, cmd.trackId, cmd.clipId));
}

function handleMove(cmd: Extract<WorkerCommand, { type: 'move-clip' }>) {
  commitTimelineMutation(() =>
    reorderClip(timeline, cmd.fromTrackId, cmd.clipId, cmd.toTrackId, cmd.toIndex),
  );
}

function handleSetEffectParam(cmd: Extract<WorkerCommand, { type: 'set-effect-param' }>) {
  commitTimelineMutation(
    () => setClipEffectParam(timeline, cmd.trackId, cmd.clipId, cmd.key, cmd.value),
    {
      coalesceKey: { clipId: cmd.clipId, key: cmd.key },
      refreshPlayback: 'refresh',
      prune: false,
    },
  );
}

function handleSetTrackGain(cmd: Extract<WorkerCommand, { type: 'set-track-gain' }>) {
  commitTimelineMutation(() => setTrackGain(timeline, cmd.trackId, cmd.gain), {
    refreshPlayback: 'none',
    prune: false,
  });
}

function handleSetTrackMute(cmd: Extract<WorkerCommand, { type: 'set-track-mute' }>) {
  commitTimelineMutation(() => setTrackMute(timeline, cmd.trackId, cmd.muted), {
    refreshPlayback: 'none',
    prune: false,
  });
}

function handleSetTrackSolo(cmd: Extract<WorkerCommand, { type: 'set-track-solo' }>) {
  commitTimelineMutation(() => setTrackSolo(timeline, cmd.trackId, cmd.solo), {
    refreshPlayback: 'none',
    prune: false,
  });
}

function handleTrim(cmd: Extract<WorkerCommand, { type: 'trim-clip' }>) {
  // Look up the underlying source's duration so trimClip can bound an outward
  // extension. Without it, trimClip would refuse to grow the clip past its
  // current edge — preventing the user from restoring a previously-shrunk clip.
  const track = timeline.find((t) => t.id === cmd.trackId);
  const clip = track?.clips.find((c) => c.id === cmd.clipId);
  const sourceDuration = clip ? sourceInputs.get(clip.sourceId)?.duration : undefined;
  commitTimelineMutation(() =>
    trimClip(timeline, cmd.trackId, cmd.clipId, {
      edge: cmd.edge,
      time: cmd.time,
      sourceDuration,
    }),
  );
}

function applyHistoryRestore(next: Timeline): void {
  timeline = next;
  afterTimelineMutation();
}

function handleUndo(): void {
  const next = history.undo(timeline);
  if (!next) {
    postHistoryState();
    return;
  }
  applyHistoryRestore(next);
}

function handleRedo(): void {
  const next = history.redo(timeline);
  if (!next) {
    postHistoryState();
    return;
  }
  applyHistoryRestore(next);
}

async function handleRelinkSource(cmd: Extract<WorkerCommand, { type: 'relink-source' }>): Promise<void> {
  const descriptor = sourceDescriptors.get(cmd.sourceId);
  if (!descriptor) {
    post({
      type: 'relink-result',
      sourceId: cmd.sourceId,
      ok: false,
      descriptor: null,
      metadata: activeMetadata(),
      unresolvedSources: unresolvedSourceDescriptors(),
      message: 'This source is not part of the restored project.',
    });
    return;
  }

  const result = await attachSourceFile(descriptor, cmd.file, cmd.fileHandle ?? null, true);
  if (!result.ok) {
    post({
      type: 'relink-result',
      sourceId: cmd.sourceId,
      ok: false,
      descriptor,
      metadata: activeMetadata(),
      unresolvedSources: unresolvedSourceDescriptors(),
      message: result.message,
    });
    return;
  }

  setupPlayback();
  ensureClockAndTimeline();
  scheduleAutosave();
  post({
    type: 'relink-result',
    sourceId: cmd.sourceId,
    ok: true,
    descriptor,
    metadata: activeMetadata(),
    unresolvedSources: unresolvedSourceDescriptors(),
    message: `Re-linked ${descriptor.fileName}.`,
  });
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
  return cloneTimelineSnapshot(timeline);
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

async function handleDispose(): Promise<void> {
  restoreOfferGeneration += 1;
  await flushPendingAutosave();
  stopAudioPump();
  teardownMedia();
  renderer?.destroy();
  renderer = null;
  clockView = null;
  audioRing = null;
  post({ type: 'dispose-complete' });
}

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'init':
      void handleInit(cmd.canvas, cmd.sab, cmd.audioSab);
      break;
    case 'import':
      void handleImport(cmd.file, cmd.fileHandle);
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
    case 'undo':
      handleUndo();
      break;
    case 'redo':
      handleRedo();
      break;
    case 'restore-project':
      void handleRestoreProject().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        post({
          type: 'restore-result',
          projectId,
          restored: false,
          savedAt: null,
          metadata: null,
          unresolvedSources: unresolvedSourceDescriptors(),
          message: `Restore failed: ${message}`,
        });
      });
      break;
    case 'new-project':
      void handleNewProject().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        postProjectWarning(`Could not start new project: ${message}`);
      });
      break;
    case 'relink-source':
      void handleRelinkSource(cmd).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        post({
          type: 'relink-result',
          sourceId: cmd.sourceId,
          ok: false,
          descriptor: sourceDescriptors.get(cmd.sourceId) ?? null,
          metadata: activeMetadata(),
          unresolvedSources: unresolvedSourceDescriptors(),
          message: `Re-link failed: ${message}`,
        });
      });
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
      void handleDispose();
      break;
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
});
