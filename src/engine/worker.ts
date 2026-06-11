/// <reference lib="webworker" />
import {
	assertCrossOriginIsolated,
	type CapabilityProbeResult,
	type CaptionTrackSnapshot,
	ClockIndex,
	TIMELINE_EPSILON,
	type ExportPresetDoc,
	type ExportSettings,
	type MediaAssetSnapshot,
	type RenderQueueJob,
	type RenderQueueState,
	type ThroughputProbe,
	type MediaMetadata,
	type SourceDescriptorSnapshot,
	type TimelineClipboardClip,
	type TimelineTrackSnapshot,
	type TimelineTransitionSnapshot,
	type WorkerCommand,
	type WorkerStateMessage,
	type ExportBackend,
	type PreviewBackend,
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
	DEFAULT_RING_BUFFER_CONFIG,
	type CaptureSessionState,
	type CaptureStreamSettings,
	type LiveAudioChainConfig,
	type SpillRange
} from '../protocol';
import {
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	type StreamTargetChunk
} from 'mediabunny';
import { createRingBuffer, type RingBuffer, type RingBufferEntry } from './replay-buffer/ring-buffer';
import {
	cleanupSpills,
	createReplaySaveFile,
	deleteReplaySaveFile,
	deleteSpillFile,
	readSpillRange,
	spillEntries
} from './replay-buffer/spill';
import { assembleSaveEntries } from './replay-buffer/replay-save';
import { CAPTURE_VIDEO_CODEC_FALLBACKS, getDefaultCaptureConfig } from './replay-buffer/capture';
import {
	anyInsertActive,
	chainLatencyS,
	createLiveChainProcessor,
	interleavedPcmToF32Planes,
	pcmPlaneToF32,
	type LiveChainProcessor,
	type PcmPlane
} from './live-audio/live-chain';
import { exportCaptionSidecars } from './captions/export';
import { activeCaptionPayloadsAt, captionTextureId } from './captions/render';
import {
	buildCaptionSnapTargets,
	makeCaptionSegmentId,
	makeCaptionTrackId,
	mergeCaptionSegments,
	setCaptionSegmentStyle,
	setCaptionSegmentText,
	setCaptionSegmentTiming,
	setCaptionTrackProps,
	snapCaptionTime,
	splitCaptionSegment,
	deleteCaptionSegments
} from './captions/model';
import { captionTrackFromSrt } from './captions/srt';
import { captionTrackFromWebVtt } from './captions/webvtt';
import {
	createCaptionTrack,
	type CaptionExportSettings,
	type CaptionTrack
} from './captions/types';
import {
	addMarker,
	addTrack,
	addTransition,
	closeGaps,
	createEmptyTimeline,
	deleteMarker,
	duplicateClips,
	getTimelineDuration,
	insertClip,
	moveClips,
	pasteClips,
	removeClip,
	removeTrack,
	removeTransition,
	reorderTrack,
	revalidateTransitions,
	resolveAllAt,
	sharedSourceIncomingLayers,
	resolveAudioAt,
	setClipDuration,
	setTransition,
	splitClipAt,
	trimClip,
	setClipEffectParam,
	setClipKeyframe,
	setClipKeyframes,
	deleteClipKeyframe,
	setClipTransform,
	setClipLut,
	setClipLutStrength,
	setTrackGain,
	setTrackMute,
	setTrackSolo,
	setTrackPan,
	setClipAudioFade,
	setTitleContent,
	defaultTimelineClip,
	defaultTitleClip,
	isTitleClip,
	linkClips,
	unlinkClips,
	setTrackLock,
	setTrackVisible,
	setTrackSyncLock,
	setTrackEditTarget,
	rippleDelete,
	rippleTrim,
	rollTrim,
	slipEdit,
	slideEdit,
	insertEdit,
	overwriteEdit,
	liftRegion,
	extractRegion,
	shiftMarkers,
	removeMarkersInRange,
	expandLinkedGroup,
	DEFAULT_MASTER_GAIN,
	DEFAULT_TITLE_DURATION_S,
	normalizeTransform,
	maxTransitionDurationS,
	type Timeline,
	type TimelineClip,
	type TimelineMarker,
	type TimelineTransition,
	type ClipboardTimelineClip,
	type ClipEffectParams,
	type MoveClipTarget,
	type TransformParams
} from './timeline';
import type { SourceVideoTrackInspection } from './media-adapters/types';
import { sampleClipParamsAt } from './keyframes';
import { clipLutFromCubeFile, cloneClipLut, lutSnapshot, type ClipLut } from './lut';
import { applyMixStageInPlace, type AudioTransitionCut } from './audio-mix';
import {
	mapAudioRing,
	ringFreeSamples,
	writeRingPcm,
	RingHeader,
	RingState,
	bumpRingGeneration,
	resetRingPointers,
	type AudioRingViews
} from './audio-ring';
import { openMediaFile, STILL_DEFAULT_DURATION_S, type MediaInputHandle } from './media-io';
import { healthReportForHandle } from './media-adapters/mediabunny-adapter';
import {
	resolveSourceTimestamp,
	unavailableAudioSilenceFrames
} from './media-adapters/source-timing';
import { sourceHealthReportFromError } from './media-adapters/source-health';
import { ThumbnailGenerator } from './thumbnails';
import { initCompatibilityGpu, initGpu, type CompositeLayer, type PreviewRenderer } from './gpu';
import { createCanvasTitleUploader, loadTitleFonts, TitleTextureCache } from './titles';
import type { TitleContent } from './title';
import {
	AdaptiveResolution,
	buildPreviewLadder,
	PlaybackController,
	type DecodedFrame,
	type DecodedLayer
} from './playback';
import { probeEncodeThroughput } from './hardware-probe';
import { FrameCache, makeFrameCacheKey } from './frame-cache';
import { SecondaryFrameSourcePool, type VideoFrameProvider } from './frame-source';
import {
	ExportCancelledError,
	defaultExportSettings,
	exportTimeline,
	layerBudgetFromProbe,
	normalizeExportSettings,
	probeExportCodecs
} from './export';
import { exportTimelineReduced } from './compatibility/compat-export';
import { exportConstraintsForProbe } from './capability-probe-v2';
import {
	CanvasCompatibilityRenderer,
	type CanvasCompatibilityLayer
} from './compatibility/canvas-compositor';
import { mergePresetsWithBuiltIns } from './export-presets';
import {
	advanceQueue,
	cancelAllPending,
	createEmptyQueueState,
	enqueueJob,
	markJobCanceled,
	markJobChoosingDestination,
	markJobCompleted,
	markJobFailed,
	markJobFinalizing,
	markJobRunning,
	removeJob,
	reorderJob,
	retryJob,
	resolveJobRange,
	serializeQueueHistory,
	deserializeQueueHistory,
	setStopOnError,
	shouldStopQueueAfterJob,
	suggestedFileNameForJob,
	updateJobProgress,
	queueSummary
} from './render-queue';
import { createTimelineHistory, type HistoryCoalesceKey } from './history';
import {
	cloneMarkersSnapshot,
	cloneCaptionTracksSnapshot,
	cloneTimelineSnapshot,
	cloneTransitionsSnapshot,
	serializeProject,
	sourceDescriptorMismatchReasons,
	type ProjectDoc,
	type SourceDescriptor
} from './project';
import {
	deleteStoredProject,
	deleteStoredSource,
	loadStoredProject,
	loadStoredSource,
	saveStoredProject,
	saveStoredSource,
	saveStoredSourceWithoutHandle,
	type StoredSourceRecord
} from './persistence';
import {
	cancelBundleJob,
	makeStoredSourceResolver,
	resolveBundleReplaceDecision,
	runCollectProjectMedia,
	runExportProjectBundle,
	runImportProjectBundle,
	type BundleWorkerContext
} from './project-bundle/bundle-jobs';
import { defaultAppVersion } from './project-bundle/manifest';
import { sanitizeBundleFileName } from './project-bundle/paths';
import { serializeTimelineToEdl } from './interchange/edl';
import { serializeTimelineToOtio } from './interchange/otio';
import { proxyStatusForAsset } from './proxy-jobs';
import { buildWorkerDiagnosticSnapshot } from './diagnostics';
import {
	createEmptyRecentErrorLog,
	createRecentError,
	logRecentError,
	type RecentErrorInput
} from '../diagnostics/recent-errors';

let clockView: Float64Array | null = null;
let renderer: PreviewRenderer | null = null;
let reducedRenderer: CanvasCompatibilityRenderer | null = null;
let previewBackend: PreviewBackend = 'none';
let exportBackend: ExportBackend = 'none';
/** Phase 14 title raster cache; created once the GPU device is ready. */
let titleCache: TitleTextureCache | null = null;
/** Shared empty set for dropping every cached title texture via `retain`. */
const EMPTY_CLIP_IDS: ReadonlySet<string> = new Set<string>();
/** Default preview/export geometry for title-only timelines (no video source). */
const TITLE_ONLY_CANVAS = { width: 1920, height: 1080, frameRate: 30 } as const;
const retainedOverlayTextureIds = new Set<string>();
let primaryHandle: MediaInputHandle | null = null;
let playback: PlaybackController<LayerMeta> | null = null;
let adaptive: AdaptiveResolution | null = null;
let probeDone = false;
let timeline: Timeline = createEmptyTimeline();
let captionTracks: CaptionTrack[] = [];
let transitions: TimelineTransition[] = [];
let markers: TimelineMarker[] = [];
let masterGain = DEFAULT_MASTER_GAIN;
/** Phase 13 will populate this; export crossfades only until preview dual-stream lands. */
const audioTransitions: AudioTransitionCut[] = [];
let nextSourceId = 1;
const sourceInputs = new Map<string, MediaInputHandle>();
const sourceDescriptors = new Map<string, SourceDescriptor>();
/** Media-bin membership: every imported/restored source, placed or not. Pruning
 *  and persistence key off this set so unplaced assets survive. */
const binSourceIds = new Set<string>();
const clipboardLuts = new Map<string, ClipLut>();
const restoringSourceIds = new Set<string>();
let thumbnailGen: ThumbnailGenerator | null = null;
const THUMBNAIL_WIDTH = 160;
const history = createTimelineHistory();
let projectId = makeProjectId();
let restoreDoc: ProjectDoc | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveInFlight: Promise<void> | null = null;
let restoreOfferGeneration = 0;
let frameCache: FrameCache | null = null;
/** Secondary decode sinks for same-source transition pairs (Phase 13 T2.2). */
const secondaryFrameSources = new SecondaryFrameSourcePool();
let currentProbe: ThroughputProbe | null = null;
let currentCapabilityProbe: CapabilityProbeResult | null = null;
let layerBudgetWarned = false;
let exportAbort: AbortController | null = null;
let lastExportSettings: ExportSettings | null = null;
let exportPresets: ExportPresetDoc[] = [];
let queueState: RenderQueueState = createEmptyQueueState();
let queueRunning = false;
let queueJobAbort: AbortController | null = null;
let queueJobOutputResolve: ((handle: FileSystemFileHandle | null) => void) | null = null;
let queueJobOutputJobId: string | null = null;
const queueJobOutputHandles = new Map<string, FileSystemFileHandle>();
let recentErrors = createEmptyRecentErrorLog();
let lastWebgpuFeatures: string[] = [];
let lastWebgpuLimits: Record<string, number> = {};
let lastGpuUnavailableReason: string | null = null;
let lastDeviceLost: import('../diagnostics/types').DeviceLostSummary | undefined;
const FRAME_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
let audioRing: AudioRingViews | null = null;
let audioWriteAnchor = 0;
let audioWriteFrames = 0;
let pcmRemainder: Float32Array | null = null;
let audioPumpGen = 0;
const AUTOSAVE_DEBOUNCE_MS = 300;

// ── Phase 46: Replay Buffer + Live Audio Chain ──
const CAPTURE_KEYFRAME_INTERVAL_S = 2;
const CAPTURE_STATS_INTERVAL_MS = 500;
const CAPTURE_MAX_VIDEO_QUEUE = 8;
const CAPTURE_MAX_AUDIO_QUEUE = 16;
const REPLAY_SAVE_PROGRESS_EVERY = 25;

interface CaptureRuntime {
	state: CaptureSessionState;
	videoReader: ReadableStreamDefaultReader<VideoFrame> | null;
	audioReader: ReadableStreamDefaultReader<AudioData> | null;
	videoEncoder: VideoEncoder | null;
	audioEncoder: AudioEncoder | null;
	chain: LiveChainProcessor | null;
	chainErrorPosted: boolean;
	startedAtMs: number;
	statsTimer: ReturnType<typeof setInterval> | null;
	videoFramesSinceKey: number;
	stopping: boolean;
	/** Resolves once both pumps have exited and encoders are flushed/closed. */
	finished: Promise<void>;
}

function cloneLiveChainConfig(config: LiveAudioChainConfig): LiveAudioChainConfig {
	return {
		gate: { ...config.gate },
		compressor: { ...config.compressor },
		limiter: { ...config.limiter },
		denoiserBypass: config.denoiserBypass,
		printToRecording: config.printToRecording
	};
}

const replayRing: RingBuffer = createRingBuffer({ ...DEFAULT_RING_BUFFER_CONFIG });
let liveChainConfig: LiveAudioChainConfig = cloneLiveChainConfig(DEFAULT_LIVE_AUDIO_CHAIN_CONFIG);
let capture: CaptureRuntime | null = null;
/** Serializes OPFS spill writes/deletes so a file is never read or deleted mid-write. */
let replaySpillChain: Promise<void> = Promise.resolve();
/** Decoder configs from the capture encoders; survive capture-stop so the buffer stays saveable. */
let captureVideoDecoderConfig: VideoDecoderConfig | null = null;
let captureAudioDecoderConfig: AudioDecoderConfig | null = null;
let replaySaveAbort: AbortController | null = null;

function makeSourceId(): string {
	return `source-${nextSourceId++}`;
}

function makeClipId(sourceId: string): string {
	// A globally-unique suffix (not a per-session counter) so clips placed after a
	// project restore can't collide with restored clip ids like `clip-<source>-…`.
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `clip-${sourceId}-${suffix}`;
}

function makeTransitionId(): string {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `transition-${suffix}`;
}

function makeProjectId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `project-${crypto.randomUUID()}`;
	}
	return `project-${Math.random().toString(36).slice(2)}`;
}

let checkpointRevision = 0;

function post(msg: WorkerStateMessage) {
	self.postMessage(msg);
}

function postRecoveryCheckpoint(): void {
	checkpointRevision++;
	scheduleAutosave();
}

function recordRecentError(input: RecentErrorInput): void {
	recentErrors = logRecentError(recentErrors, input);
	// Post a single-occurrence delta (count 1), NOT the worker's merged aggregate.
	// The UI's addRecentError folds by subsystem+code and adds occurrence counts, so
	// posting the aggregate would double-count (1, then 1+2, then 3+3, …). A later
	// diagnostic-snapshot still replaces the UI log with the worker's authoritative
	// aggregate, keeping the two in sync.
	post({ type: 'recent-error', error: createRecentError(input) });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function postTimelineState() {
	const snapshot: TimelineTrackSnapshot[] = timeline.map((track) => ({
		id: track.id,
		type: track.type,
		gain: track.gain,
		pan: track.pan,
		muted: track.muted,
		solo: track.solo,
		locked: track.locked,
		visible: track.visible,
		syncLocked: track.syncLocked,
		editTarget: track.editTarget,
		clips: track.clips.map((clip) => ({
			id: clip.id,
			...(clip.kind === 'title' && clip.title
				? {
						kind: 'title' as const,
						title: { text: clip.title.text, style: { ...clip.title.style } }
					}
				: {}),
			sourceId: clip.sourceId,
			start: clip.start,
			duration: clip.duration,
			inPoint: clip.inPoint,
			effects: { ...clip.effects },
			transform: { ...clip.transform },
			keyframes: clip.keyframes,
			lut: lutSnapshot(clip.lut),
			audioFadeIn: clip.audioFadeIn,
			audioFadeOut: clip.audioFadeOut,
			offline: clip.kind === 'title' || sourceInputs.has(clip.sourceId) ? undefined : true,
			linkedGroupId: clip.linkedGroupId
		}))
	}));
	const captionSnapshot: CaptionTrackSnapshot[] = captionTracks.map((track) => ({
		id: track.id,
		kind: 'caption',
		name: track.name,
		language: track.language ?? null,
		segments: track.segments.map((segment: CaptionTrack['segments'][number]) => ({
			id: segment.id,
			start: segment.start,
			duration: segment.duration,
			text: segment.text,
			style: segment.style
				? {
						...(segment.style.presetId !== undefined
							? { presetId: segment.style.presetId ?? null }
							: {}),
						...(segment.style.overrides ? { overrides: { ...segment.style.overrides } } : {}),
						...(segment.style.anchor !== undefined ? { anchor: segment.style.anchor } : {}),
						...(segment.style.insetPx ? { insetPx: { ...segment.style.insetPx } } : {}),
						...(segment.style.maxWidthPercent !== undefined
							? { maxWidthPercent: segment.style.maxWidthPercent }
							: {}),
						...(segment.style.lineWrap !== undefined ? { lineWrap: segment.style.lineWrap } : {})
					}
				: undefined
		})),
		defaultStyle: {
			presetId: track.defaultStyle.presetId ?? null,
			overrides: track.defaultStyle.overrides ? { ...track.defaultStyle.overrides } : {},
			anchor: track.defaultStyle.anchor,
			insetPx: track.defaultStyle.insetPx ? { ...track.defaultStyle.insetPx } : undefined,
			maxWidthPercent: track.defaultStyle.maxWidthPercent,
			lineWrap: track.defaultStyle.lineWrap
		},
		burnedIn: track.burnedIn,
		visible: track.visible
	}));
	const sourceDurs = transitionSourceDurations();
	const transitionSnapshot: TimelineTransitionSnapshot[] = cloneTransitionsSnapshot(
		transitions
	).map((t) => ({
		...t,
		maxDurationS: maxTransitionDurationS(timeline, sourceDurs, t.trackId, t.fromClipId, t.toClipId)
	}));
	post({
		type: 'timeline-state',
		timeline: snapshot,
		captionTracks: captionSnapshot,
		transitions: transitionSnapshot,
		markers: cloneMarkersSnapshot(markers),
		masterGain
	});
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

function trackEnd(tl: Timeline, trackId: string): number {
	const track = tl.find((t) => t.id === trackId);
	if (!track) return 0;
	let end = 0;
	for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
	return end;
}

function timelineHasClips(): boolean {
	return timeline.some((track) => track.clips.length > 0);
}

/** Ensures a track of `type` exists, returning [timeline, trackId]. Prefers the
 *  named track, then the first of that type, then a freshly added one. */
function ensureTrack(
	tl: Timeline,
	type: 'video' | 'audio',
	preferredId?: string
): [Timeline, string] {
	if (preferredId) {
		const named = tl.find((t) => t.id === preferredId && t.type === type);
		if (named) return [tl, named.id];
	}
	const existing = tl.find((t) => t.type === type);
	if (existing) return [tl, existing.id];
	const next = addTrack(tl, type);
	return [next, next[next.length - 1]!.id];
}

/**
 * Places a bin asset on the timeline: a clip on a track of its kind, plus a
 * linked audio clip for video sources that carry audio. Returns the original
 * timeline when an explicit-start placement would overlap an existing clip.
 */
function placeAsset(
	tl: Timeline,
	handle: MediaInputHandle,
	trackId: string | undefined,
	start: number | undefined
): Timeline {
	// A video/still with no decodable frames would render black and can't export.
	if (handle.kind !== 'audio' && !handle.frameSource) return tl;

	// Apply the source file's rotation metadata as the clip's initial transform so
	// portrait-mode phone videos (90°/270°) appear upright without manual correction.
	// Look up the inspection record matching the primary decoded video track, not
	// just the first video track — Mediabunny may select a non-first track as primary
	// (e.g. a MOV with an auxiliary preview track first).
	const primaryVideoTrackId = handle.conformance.primaryVideoTrackId;
	const primaryVideoInspection = primaryVideoTrackId
		? handle.inspection.tracks.find(
				(t): t is SourceVideoTrackInspection =>
					t.kind === 'video' && t.trackId === primaryVideoTrackId
			)
		: undefined;
	const sourceRotation = primaryVideoInspection?.rotationDeg ?? 0;

	if (handle.kind === 'audio') {
		const [withTrack, audioTrackId] = ensureTrack(tl, 'audio', trackId);
		const clipStart = start ?? trackEnd(withTrack, audioTrackId);
		return insertClip(
			withTrack,
			audioTrackId,
			defaultTimelineClip({
				id: makeClipId(handle.sourceId),
				sourceId: handle.sourceId,
				start: clipStart,
				duration: handle.duration,
				inPoint: 0
			})
		);
	}

	// Video or still image → a video track, with the linked audio sub-clip below.
	const [withVideoTrack, videoTrackId] = ensureTrack(tl, 'video', trackId);
	const clipDuration = handle.kind === 'image' ? STILL_DEFAULT_DURATION_S : handle.duration;
	const clipStart = start ?? trackEnd(withVideoTrack, videoTrackId);
	let next = insertClip(
		withVideoTrack,
		videoTrackId,
		defaultTimelineClip({
			id: makeClipId(handle.sourceId),
			sourceId: handle.sourceId,
			start: clipStart,
			duration: clipDuration,
			inPoint: 0,
			transform: normalizeTransform({ rotation: sourceRotation })
		})
	);
	if (next === withVideoTrack) return tl; // overlap rejected

	if (handle.kind === 'video' && handle.audioSource) {
		const [withAudioTrack, audioTrackId] = ensureTrack(next, 'audio');
		const audioPlaced = insertClip(
			withAudioTrack,
			audioTrackId,
			defaultTimelineClip({
				id: makeClipId(handle.sourceId),
				sourceId: handle.sourceId,
				start: clipStart,
				duration: handle.duration,
				inPoint: 0
			})
		);
		// Keep the video placement even if the aligned audio slot is occupied.
		next = audioPlaced === withAudioTrack ? next : audioPlaced;
	}
	return next;
}

function assetSnapshotFromDescriptor(descriptor: SourceDescriptor): MediaAssetSnapshot {
	const asset: MediaAssetSnapshot = {
		sourceId: descriptor.sourceId,
		fileName: descriptor.fileName,
		kind: descriptor.kind,
		durationS: descriptor.kind === 'image' ? STILL_DEFAULT_DURATION_S : descriptor.durationS,
		byteSize: descriptor.byteSize,
		mimeType: descriptor.mimeType,
		video: descriptor.video
			? {
					width: descriptor.video.width,
					height: descriptor.video.height,
					frameRate: descriptor.video.frameRate,
					frameRateMode: descriptor.video.frameRateMode,
					rotationDeg: descriptor.video.rotationDeg,
					codec: descriptor.video.codec,
					canDecode: descriptor.video.canDecode
				}
			: undefined,
		audio: descriptor.audio
			? {
					channels: descriptor.audio.channels,
					sampleRate: descriptor.audio.sampleRate,
					codec: descriptor.audio.codec,
					canDecode: descriptor.audio.canDecode
				}
			: undefined,
		timing: descriptor.timing,
		health: descriptor.health
	};
	asset.proxy = proxyStatusForAsset(asset, currentProbe);
	return asset;
}

function postSourceHealth(report: SourceDescriptor['health']): void {
	if (!report || report.warnings.length === 0) return;
	post({ type: 'source-health', report });
}

function postMediaAssets(): void {
	const assets: MediaAssetSnapshot[] = [];
	for (const id of binSourceIds) {
		const descriptor = sourceDescriptors.get(id);
		if (descriptor) assets.push(assetSnapshotFromDescriptor(descriptor));
	}
	post({ type: 'media-assets', assets });
}

function ensureThumbnailGenerator(): ThumbnailGenerator {
	if (thumbnailGen) return thumbnailGen;
	thumbnailGen = new ThumbnailGenerator({
		decode: (sourceId, timestamp) => {
			const handle = sourceInputs.get(sourceId);
			return handle ? handle.thumbnailAt(timestamp) : Promise.resolve(null);
		},
		toBitmap: (frame, width) =>
			createImageBitmap(frame, { resizeWidth: width, resizeQuality: 'low' }),
		emit: ({ sourceId, timestamp, bitmap, width, height }) => {
			self.postMessage({ type: 'thumbnail', sourceId, timestamp, bitmap, width, height }, [bitmap]);
		},
		targetWidth: THUMBNAIL_WIDTH,
		concurrency: 2
	});
	return thumbnailGen;
}

async function computeAndPostWaveform(handle: MediaInputHandle, trackId: string, clipId: string) {
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

/** Live preview pumps the first resolved audio clip only; export sums all audible tracks. */
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
		const sourceTimestamp = resolveSourceTimestamp({
			clip: resolved.clip,
			timelineTime,
			trackKind: 'audio',
			timing: handle.timing
		});
		if (!sourceTimestamp.available) {
			const silenceFrames = unavailableAudioSilenceFrames({
				resolution: sourceTimestamp,
				timing: handle.timing,
				clip: resolved.clip,
				timelineTime,
				sampleRate,
				maxFrames: Math.min(freeFrames, 1024)
			});
			const written = writeRingPcm(audioRing, new Float32Array(silenceFrames * channels));
			audioWriteFrames += written;
			return;
		}
		pcm = await handle.audioSource.pcmAt(sourceTimestamp.adapterTimestampS, channels, sampleRate);
		if (!pcm) {
			const silenceFrames = Math.min(freeFrames, 1024);
			const written = writeRingPcm(audioRing, new Float32Array(silenceFrames * channels));
			audioWriteFrames += written;
			return;
		}
	}

	const track = timeline.find((item) => item.id === resolved.trackId);
	const gain = trackAudible(resolved.trackId);
	if (gain <= 0 || !track) {
		pcm.fill(0);
	} else {
		const clipOffsetS = timelineTime - resolved.clip.start;
		applyMixStageInPlace(pcm, channels, {
			gain,
			pan: track.pan,
			fadeInS: resolved.clip.audioFadeIn,
			fadeOutS: resolved.clip.audioFadeOut,
			clipOffsetS,
			clipDurationS: resolved.clip.duration,
			sampleRate
		});
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

function syncTimelineLuts(): void {
	if (!renderer) return;
	const activeKeys = new Set<string>();
	for (const track of timeline) {
		for (const clip of track.clips) {
			if (!clip.lut || activeKeys.has(clip.lut.key)) continue;
			renderer.importLut(clip.lut);
			activeKeys.add(clip.lut.key);
		}
	}
	renderer.pruneLuts(activeKeys);
}

function sourceDescriptorFromHandle(
	sourceId: string,
	file: File,
	handle: MediaInputHandle
): SourceDescriptor {
	// Prefer the inspection record for the primary decoded video track so the bin
	// metadata (rotation, codec, colour) reflects the same track placeAsset uses.
	// Mediabunny may pick a non-first track as primary on multi-track files.
	const primaryVideoTrackId = handle.conformance.primaryVideoTrackId;
	const videoInspection =
		(primaryVideoTrackId
			? handle.inspection.tracks.find(
					(t): t is SourceVideoTrackInspection =>
						t.kind === 'video' && t.trackId === primaryVideoTrackId
				)
			: undefined) ??
		handle.inspection.tracks.find((t): t is SourceVideoTrackInspection => t.kind === 'video');
	const video = handle.metadata.video
		? {
				width: handle.metadata.video.width,
				height: handle.metadata.video.height,
				codedWidth: videoInspection?.codedWidth,
				codedHeight: videoInspection?.codedHeight,
				frameRate: handle.metadata.video.frameRate,
				frameRateMode: handle.timing.frameRateMode,
				rotationDeg: videoInspection?.rotationDeg,
				color: videoInspection?.color,
				trackStartS: handle.timing.video?.firstTimestampS,
				trackDurationS: handle.timing.video?.durationS,
				codec: handle.metadata.video.codec,
				canDecode: handle.metadata.video.canDecode
			}
		: undefined;
	const audio = handle.metadata.audio
		? {
				channels: handle.metadata.audio.channels,
				sampleRate: handle.metadata.audio.sampleRate,
				trackStartS: handle.timing.audio?.firstTimestampS,
				trackDurationS: handle.timing.audio?.durationS,
				codec: handle.metadata.audio.codec,
				canDecode: handle.metadata.audio.canDecode
			}
		: undefined;

	return {
		sourceId,
		fileName: file.name,
		kind: handle.kind,
		byteSize: file.size,
		durationS: handle.duration,
		mimeType: handle.metadata.mimeType,
		adapterId: handle.adapterId,
		timing: handle.timing,
		health: healthReportForHandle(handle),
		video,
		audio
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

/** Persisted sources = the whole bin, so unplaced assets survive restore. */
function currentProjectSources(): SourceDescriptor[] {
	const descriptors: SourceDescriptor[] = [];
	for (const id of binSourceIds) {
		const descriptor = sourceDescriptors.get(id);
		if (descriptor) descriptors.push(descriptor);
	}
	return descriptors;
}

function unresolvedSourceDescriptors(): SourceDescriptorSnapshot[] {
	const unresolved: SourceDescriptorSnapshot[] = [];
	for (const id of binSourceIds) {
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
		captionTracks,
		transitions,
		markers,
		sources: currentProjectSources(),
		masterGain,
		exportSettings: lastExportSettings ?? undefined,
		exportPresets: exportPresets.filter((p) => !p.builtIn),
		renderQueueHistory: serializeQueueHistory(queueState),
		replayBufferConfig: replayRing.getConfig(),
		liveAudioChainConfig: liveChainConfig
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
	canAttach: () => boolean = () => true
): Promise<
	| { ok: true; handle: MediaInputHandle; descriptor: SourceDescriptor }
	| { ok: false; message: string }
> {
	let mediaHandle: MediaInputHandle;
	try {
		mediaHandle = await openMediaFile(file, descriptor.sourceId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message };
	}

	const candidate = sourceDescriptorFromHandle(descriptor.sourceId, file, mediaHandle);
	const mismatchReasons = sourceDescriptorMismatchReasons(descriptor, candidate);
	if (mismatchReasons.length > 0) {
		mediaHandle.dispose();
		return {
			ok: false,
			message:
				`Picked file does not match ${descriptor.fileName}. ` +
				`Mismatch: ${mismatchReasons.join(', ')}.`
		};
	}
	if (!canAttach()) {
		mediaHandle.dispose();
		return { ok: false, message: 'Restore was superseded by a newer project action.' };
	}

	const previous = sourceInputs.get(descriptor.sourceId);
	if (previous && previous !== mediaHandle) previous.dispose();
	sourceInputs.set(descriptor.sourceId, mediaHandle);
	sourceDescriptors.set(descriptor.sourceId, candidate);
	if (
		(!primaryHandle || primaryHandle.sourceId === descriptor.sourceId) &&
		mediaHandle.frameSource
	) {
		primaryHandle = mediaHandle;
	}
	// Ring stays at its canonical stereo rate and channel count (set at init);
	// pcmAt resamples and upmixes each source to the ring's format.
	void computeWaveformsForSource(mediaHandle);

	if (persist) {
		await persistSourceBestEffort({
			sourceId: descriptor.sourceId,
			descriptor: candidate,
			file,
			fileHandle: fileHandle ?? undefined
		});
	}

	postSourceHealth(candidate.health);
	return { ok: true, handle: mediaHandle, descriptor: candidate };
}

async function restoreStoredSources(
	descriptors: readonly SourceDescriptor[],
	isCurrent: () => boolean = () => true
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
					isCurrent
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
						isCurrent
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

function transitionSourceDurations() {
	return {
		durationForSource: (sourceId: string) =>
			sourceDescriptors.get(sourceId)?.durationS ?? sourceInputs.get(sourceId)?.duration
	};
}

function reconcileTransitions(
	nextTimeline: Timeline = timeline,
	currentTransitions: readonly TimelineTransition[] = transitions
): TimelineTransition[] {
	return revalidateTransitions(nextTimeline, currentTransitions, transitionSourceDurations());
}

function commitTransitionMutation(
	mutate: () => TimelineTransition[],
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): boolean {
	return commitEditMutation(() => ({ timeline, captionTracks, transitions: mutate(), markers }), {
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false,
		...options
	});
}

function afterTimelineMutation(
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): void {
	if (options.prune !== false) {
		pruneUnusedSources();
	}
	if (options.syncLuts !== false) {
		syncTimelineLuts();
	}
	// Refresh title rasters (no-op on unchanged content) before re-rendering so
	// the cached texture is current when playback refreshes the frame.
	syncTitleRasters();
	if (!playback) {
		setupPlayback();
	}
	ensureClockAndTimeline();
	postHistoryState();
	postRecoveryCheckpoint();
	if (options.refreshPlayback === 'refresh') {
		playback?.refresh();
	} else if (options.refreshPlayback !== 'none') {
		playback?.setDuration(getTimelineDuration(timeline));
		playback?.seek(clockView?.[0] ?? 0);
	}
	void restoreMissingSources().catch(() => undefined);
}

function historySnapshot() {
	return {
		timeline,
		captionTracks,
		transitions,
		markers
	};
}

function commitEditMutation(
	mutate: () => {
		timeline: Timeline;
		captionTracks: CaptionTrack[];
		transitions: TimelineTransition[];
		markers: TimelineMarker[];
	},
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): boolean {
	const before = historySnapshot();
	const next = mutate();
	if (
		next.timeline === timeline &&
		next.captionTracks === captionTracks &&
		next.transitions === transitions &&
		next.markers === markers
	) {
		return false;
	}
	history.push(before, { coalesceKey: options.coalesceKey });
	timeline = next.timeline;
	captionTracks = next.captionTracks;
	transitions = next.transitions;
	markers = next.markers;
	afterTimelineMutation(options);
	return true;
}

function commitTimelineMutation(
	mutate: () => Timeline,
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): boolean {
	return commitEditMutation(() => {
		const nextTimeline = mutate();
		return {
			timeline: nextTimeline,
			captionTracks,
			transitions: reconcileTransitions(nextTimeline, transitions),
			markers
		};
	}, options);
}

function commitMarkerMutation(
	mutate: () => TimelineMarker[],
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): boolean {
	return commitEditMutation(() => ({ timeline, captionTracks, transitions, markers: mutate() }), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false,
		...options
	});
}

function commitCaptionMutation(
	mutate: () => CaptionTrack[],
	options: {
		coalesceKey?: HistoryCoalesceKey;
		refreshPlayback?: 'seek' | 'refresh' | 'none';
		prune?: boolean;
		syncLuts?: boolean;
	} = {}
): boolean {
	return commitEditMutation(() => ({ timeline, captionTracks: mutate(), transitions, markers }), {
		prune: false,
		syncLuts: false,
		...options
	});
}

function ensureFrameCache() {
	if (frameCache) return frameCache;
	frameCache = new FrameCache({
		maxBytes: FRAME_CACHE_BUDGET_BYTES,
		estimateBytes: (frame) => frame.codedWidth * frame.codedHeight * 4
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
	if (clockView) {
		// The audio worklet owns CURRENT_TIME only while *actively playing* an audio
		// timeline (it advances the field every audio quantum). For paused/discrete
		// transport (seek, step, pause) the worklet is idle, so the worker writes
		// CURRENT_TIME itself — keeping the worker the sole transport-clock writer and
		// moving the playhead on a paused seek without any main-thread SAB write.
		if (!playing || !audioRing || !hasAudioTimeline()) {
			clockView[ClockIndex.CURRENT_TIME] = currentTime;
		}
		clockView[ClockIndex.PLAY_STATE] = playing ? 1 : 0;
		return;
	}
	// No SAB (reduced tiers): mirror the shared-clock contract over postMessage.
	// The worker is still the sole clock writer — this fires from the playback loop
	// (per rendered frame while playing) and once on pause/seek/step, never from an
	// untethered main-thread tick, so the playhead never advances while paused.
	post({ type: 'clock-update', currentTime, duration: getTimelineDuration(timeline), playing });
}

async function handleInit(
	canvas: OffscreenCanvas,
	sab?: SharedArrayBuffer | null,
	audioSab?: SharedArrayBuffer | null,
	scopeSab?: SharedArrayBuffer | null,
	probeResult?: CapabilityProbeResult
) {
	currentCapabilityProbe = probeResult ?? null;
	if (probeResult) {
		post({ type: 'capability-probe-v2', result: probeResult });
	}
	if (sab) {
		assertCrossOriginIsolated('Pipeline worker');
		clockView = new Float64Array(sab);
		writeClockFull(0, 0, false);
	} else {
		clockView = null;
	}
	audioRing = audioSab ? mapAudioRing(audioSab) : null;

	// initGpu() resolves with an unavailableReason for expected failures, but shader
	// module / pipeline compilation can still throw; catch so the worker always posts
	// `ready` (the UI would otherwise hang in a loading state).
	try {
		reducedRenderer?.destroy();
		reducedRenderer = null;
		previewBackend = 'none';
		exportBackend = 'none';

		const useCompatibilityAdapter = probeResult?.compatibilityAdapter === true;
		const gpu =
			probeResult?.tier === 'limited-webcodecs'
				? {
						renderer: null,
						features: [],
						limits: {},
						unavailableReason: null,
						deviceLost: null
					}
				: probeResult?.tier === 'shell-only'
					? {
							renderer: null,
							features: [],
							limits: {},
							unavailableReason: 'Preview unavailable in shell-only tier.',
							deviceLost: null
						}
					: useCompatibilityAdapter
						? await initCompatibilityGpu(canvas)
						: await initGpu(canvas);

		if (probeResult?.tier === 'limited-webcodecs') {
			reducedRenderer = new CanvasCompatibilityRenderer(canvas);
			previewBackend = 'canvas2d';
			exportBackend = 'canvas2d';
			lastGpuUnavailableReason =
				'Limited WebCodecs tier active; preview/export use a reduced Canvas2D worker backend.';
		}
		renderer = gpu.renderer;
		lastWebgpuFeatures = gpu.features;
		lastWebgpuLimits = gpu.limits;
		if (renderer) {
			previewBackend = useCompatibilityAdapter ? 'compat-webgpu' : 'core-webgpu';
			exportBackend = previewBackend;
			lastGpuUnavailableReason = gpu.unavailableReason;
		} else if (probeResult?.tier !== 'limited-webcodecs') {
			lastGpuUnavailableReason = gpu.unavailableReason;
		}

		// Phase 21: wire scope SAB to renderer if provided
		if (scopeSab && renderer) {
			renderer.setScopeSab(scopeSab);
		}
		if (renderer) {
			titleCache = new TitleTextureCache(createCanvasTitleUploader(renderer.gpuDevice));
			// Load bundled fonts before the first raster; resolves even when a bundle
			// is missing (generic fallback keeps titles offline-safe). Font availability
			// isn't part of the content hash, so titles rastered during the load race
			// hold fallback metrics — drop those textures, re-raster with the loaded
			// faces, and refresh the current frame.
			void loadTitleFonts().then(() => {
				titleCache?.retain(EMPTY_CLIP_IDS);
				syncTitleRasters();
				playback?.refresh();
			});
		}
		if (reducedRenderer) {
			void loadTitleFonts().then(() => playback?.refresh());
		}
		post({
			type: 'ready',
			webgpu: renderer !== null,
			features: gpu.features,
			gpuUnavailableReason: gpu.unavailableReason,
			previewBackend,
			exportBackend,
			previewReady: previewBackend !== 'none',
			exportReady: exportBackend !== 'none'
		});
		if (!renderer && gpu.unavailableReason) {
			recordRecentError({
				code: 'webgpu.unavailable',
				subsystem: 'gpu',
				severity: 'warning',
				message: gpu.unavailableReason,
				recoveryActionIds: ['retry-gpu-device', 'reload-app']
			});
		}
		if (gpu.deviceLost) {
			void gpu.deviceLost.then((info) => {
				if (info.reason === 'destroyed') return;
				lastDeviceLost = {
					reason: String(info.reason),
					message: info.message,
					occurredAt: new Date().toISOString(),
					recoveryAttempts: 0,
					fallbackMode: 'limited-preview'
				};
				lastGpuUnavailableReason = `GPU device lost: ${info.message || info.reason}`;
				playback?.pause();
				renderer?.destroy();
				renderer = null;
				previewBackend = 'none';
				exportBackend = 'none';
				recordRecentError({
					code: 'gpu.device_lost',
					subsystem: 'gpu',
					severity: 'error',
					message: `GPU device lost (${info.reason}): ${info.message}`,
					recoveryActionIds: ['retry-gpu-device', 'reload-app']
				});
				post({
					type: 'recovery-state',
					state: 'recovering',
					actions: []
				});
			});
		}
	} catch (e) {
		const message = errorMessage(e);
		previewBackend = 'none';
		exportBackend = 'none';
		lastWebgpuFeatures = [];
		lastWebgpuLimits = {};
		lastGpuUnavailableReason = `WebGPU initialization failed: ${message}`;
		recordRecentError({
			code: 'webgpu.init_failed',
			subsystem: 'gpu',
			severity: 'error',
			message: lastGpuUnavailableReason,
			recoveryActionIds: ['reload-app']
		});
		post({
			type: 'ready',
			webgpu: false,
			features: [],
			gpuUnavailableReason: lastGpuUnavailableReason,
			previewBackend: 'none',
			exportBackend: 'none',
			previewReady: false,
			exportReady: false
		});
	}

	// An import can arrive after `init` is sent but before `ready` is resolved
	// (the UI gates imports on `initSent`, not on `ready`). In that case the media
	// was set up with no renderer; wire up its preview now that the GPU is ready.
	syncTimelineLuts();
	ensurePreview();
	postHistoryState();
	postPresetsState();
	postQueueState();
	void checkRestoreAvailable();
}

function projectHasClips(doc: ProjectDoc): boolean {
	return (
		doc.timeline.some((track) => track.clips.length > 0) ||
		doc.captionTracks.some((track) => track.segments.length > 0)
	);
}

/** An autosave is worth offering to restore when it holds any user content —
 *  clips, markers, or bin sources. Marker-only and bin-only projects (e.g. files
 *  imported but not yet placed) are persisted too, so they must remain
 *  restore-eligible or that saved state would be silently lost on next launch. */
function projectHasRestorableContent(doc: ProjectDoc): boolean {
	return (
		projectHasClips(doc) ||
		doc.transitions.length > 0 ||
		doc.markers.length > 0 ||
		doc.sources.length > 0
	);
}

function currentProjectIsEmpty(): boolean {
	return (
		sourceInputs.size === 0 &&
		timelineSourceIds().size === 0 &&
		captionTracks.every((track) => track.segments.length === 0) &&
		transitions.length === 0 &&
		markers.length === 0
	);
}

async function checkRestoreAvailable(): Promise<void> {
	const generation = restoreOfferGeneration;
	const checkedProjectId = projectId;
	const result = await loadStoredProject();
	if (!result.ok) {
		postProjectWarning(`Could not read autosaved project: ${result.reason}`);
		return;
	}
	if (!result.doc || !projectHasRestorableContent(result.doc)) return;
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
		sources: result.doc.sources
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
			message: 'Restore offer expired after the current project changed.'
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
				message: `Could not read autosaved project: ${loaded.reason}`
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
			message: 'No autosaved project was found.'
		});
		return;
	}

	abortQueueWork();
	teardownMedia();
	clearAutosaveTimer();
	sourceDescriptors.clear();
	history.clear();
	restoreDoc = null;
	projectId = doc.projectId;
	timeline = cloneTimelineSnapshot(doc.timeline);
	captionTracks = cloneCaptionTracksSnapshot(doc.captionTracks);
	markers = cloneMarkersSnapshot(doc.markers);
	syncTimelineLuts();
	lastExportSettings = doc.exportSettings ?? null;
	exportPresets = (doc.exportPresets ?? []).filter((p) => !p.builtIn);
	queueState = createEmptyQueueState();
	if (doc.renderQueueHistory) {
		queueState = { ...queueState, jobs: deserializeQueueHistory(doc.renderQueueHistory) };
	}
	masterGain = doc.masterGain;
	applyProjectPhase46Config(doc);
	nextSourceId = nextSourceIdFromDescriptors(doc.sources);
	for (const descriptor of doc.sources) {
		sourceDescriptors.set(descriptor.sourceId, descriptor);
		binSourceIds.add(descriptor.sourceId);
	}
	// Transition validation depends on source durations. Populate descriptors before
	// reconciling so restored projects don't drop otherwise-valid transitions while
	// their media files are still offline.
	transitions = reconcileTransitions(timeline, doc.transitions);
	postMediaAssets();

	const restoreProjectId = projectId;
	const isCurrentRestore = () =>
		restoreOfferGeneration === restoreGeneration && projectId === restoreProjectId;
	const unresolved = await restoreStoredSources(doc.sources, isCurrentRestore);
	if (!isCurrentRestore()) {
		return;
	}
	setupPlayback();
	// Raster any restored title clips so their textures exist before first render.
	syncTitleRasters();
	ensureClockAndTimeline();
	postHistoryState();
	postPresetsState();
	postQueueState();
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
				: 'Restored autosaved project.'
	});
}

async function handleNewProject(): Promise<void> {
	restoreOfferGeneration += 1;
	await flushPendingAutosave();
	restoreDoc = null;
	abortQueueWork();
	teardownMedia();
	sourceDescriptors.clear();
	history.clear();
	lastExportSettings = null;
	exportPresets = [];
	queueState = createEmptyQueueState();
	projectId = makeProjectId();
	nextSourceId = 1;
	captionTracks = [];
	markers = [];
	masterGain = DEFAULT_MASTER_GAIN;
	if (capture) requestCaptureStop();
	replayRing.updateConfig({ ...DEFAULT_RING_BUFFER_CONFIG });
	liveChainConfig = cloneLiveChainConfig(DEFAULT_LIVE_AUDIO_CHAIN_CONFIG);
	postReplayBufferState();
	postLiveChainState();
	ensureClockAndTimeline();
	postMediaAssets();
	postHistoryState();
	postPresetsState();
	postQueueState();
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
		message
	});
}

/**
 * Sizes the preview to the current adaptive tier and renders the current frame.
 * Safe to call repeatedly and before the renderer or media exist (no-op until both
 * are ready), so it reconciles whichever of GPU-init / import completes last.
 */
function ensurePreview() {
	const activeRenderer = renderer ?? reducedRenderer;
	if (!activeRenderer || !adaptive) return;
	// Render when there's a decodable video source or any title clip (title-only
	// timelines composite source-less overlays over black).
	const source = getPlaybackSource();
	const hasBurnedInCaptions = captionTracks.some(
		(track) => track.burnedIn && track.visible && track.segments.length > 0
	);
	if (!source?.frameSource && titleClips().length === 0 && !hasBurnedInCaptions) return;
	const tier = adaptive.current();
	activeRenderer.setPreviewSize(tier.width, tier.height);
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
	secondaryFrameSources.disposeAll();
	for (const handle of sourceInputs.values()) {
		handle.dispose();
	}
	sourceInputs.clear();
	binSourceIds.clear();
	clipboardLuts.clear();
	primaryHandle = null;
	retainedOverlayTextureIds.clear();
	// Release cached title textures: clearing the timeline here (new project,
	// re-import, restore) would otherwise orphan them until worker disposal.
	titleCache?.retain(EMPTY_CLIP_IDS);
	timeline = createEmptyTimeline();
	captionTracks = [];
	transitions = [];
	markers = [];
}

function wrapDecodedFrameForPlayback(
	frameSource: MediaInputHandle,
	sourceTimestamp: number,
	provider: VideoFrameProvider | null = frameSource.frameSource
): Promise<DecodedFrame | null> {
	if (!provider) {
		return Promise.resolve(null);
	}
	// Capture the controller that requested this decode. If playback is disposed or
	// rebuilt (re-import, teardown) before the decode resolves, the old controller
	// will never receive or close this frame — drop it here so it can't leak.
	const activePlayback = playback;
	return provider.frameAt(sourceTimestamp).then((decoded) => {
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
			close: () => base.close()
		};
	});
}

function decodeFrameForLayer(
	sourceHandle: MediaInputHandle,
	sourceId: string,
	sourceTime: number,
	provider: VideoFrameProvider | null = sourceHandle.frameSource
): Promise<DecodedFrame | null> {
	if (!frameCache) {
		return wrapDecodedFrameForPlayback(sourceHandle, sourceTime, provider);
	}
	const key = makeFrameCacheKey(sourceId, sourceTime);
	// FrameCache.get() returns a caller-owned clone. The wrapper owns it (closed via
	// close()) and hands the renderer a further clone, keeping the two close paths on
	// distinct frames so neither the wrapper nor the cache's own copy is closed twice.
	const cached = frameCache.get(key);
	if (cached) {
		return Promise.resolve({
			toVideoFrame: () => cached.clone(),
			close: () => cached.close()
		});
	}
	return wrapDecodedFrameForPlayback(sourceHandle, sourceTime, provider);
}

/** Every title clip on the timeline, paired with its owning track id. */
function titleClips(): { trackId: string; clip: TimelineClip }[] {
	const result: { trackId: string; clip: TimelineClip }[] = [];
	for (const track of timeline) {
		if (track.type !== 'video') continue;
		for (const clip of track.clips) {
			if (isTitleClip(clip) && clip.title) result.push({ trackId: track.id, clip });
		}
	}
	return result;
}

/**
 * Edit-path raster sync: rasterizes every title clip (a no-op when the content
 * hash is unchanged) and drops cached textures for titles no longer present.
 * Called after timeline mutations and once fonts/GPU are ready — never per frame.
 */
function syncTitleRasters(): void {
	if (!titleCache) return;
	const active = new Set<string>(retainedOverlayTextureIds);
	const previewTime = clockView?.[ClockIndex.CURRENT_TIME] ?? 0;
	for (const { clip } of titleClips()) {
		active.add(clip.id);
		titleCache.rasterize(clip.id, clip.title!);
	}
	for (const payload of activeCaptionPayloadsAt(captionTracks, previewTime)) {
		const clipId = captionTextureId(payload.trackId, payload.segmentId);
		active.add(clipId);
		titleCache.rasterize(clipId, payload.content);
	}
	titleCache.retain(active);
}

function exportCaptionTextureId(exportId: string, trackId: string, segmentId: string): string {
	return `export-caption:${exportId}:${trackId}:${segmentId}`;
}

function rasterizeExportCaptionTextures(exportId: string, tracks: readonly CaptionTrack[]): void {
	for (const track of tracks) {
		if (!track.visible || !track.burnedIn) continue;
		for (const segment of track.segments)
			retainedOverlayTextureIds.add(exportCaptionTextureId(exportId, track.id, segment.id));
	}
}

function releaseRetainedOverlayTextures(textureIds: readonly string[]): void {
	if (!titleCache) return;
	for (const textureId of textureIds) {
		retainedOverlayTextureIds.delete(textureId);
		titleCache.remove(textureId);
	}
}

function activeCaptionLayersAt(
	tracks: readonly CaptionTrack[],
	timestamp: number,
	textureIdFor: (trackId: string, segmentId: string) => string = captionTextureId
): Array<{ clipId: string; content: TitleContent; transform: TransformParams }> {
	const layers: Array<{ clipId: string; content: TitleContent; transform: TransformParams }> = [];
	for (const payload of activeCaptionPayloadsAt(tracks, timestamp)) {
		const clipId = textureIdFor(payload.trackId, payload.segmentId);
		if (titleCache && !titleCache.get(clipId)) titleCache.ensure(clipId, payload.content);
		layers.push({ clipId, content: payload.content, transform: payload.transform });
	}
	return layers;
}

/**
 * Colour/transform metadata carried per decoded layer (no shared mutable state).
 * Title layers carry no decode — they composite from the cached title texture.
 * Phase 13: `transition` metadata flows from resolveAllAt through to CompositeLayer.
 */
type LayerMeta =
	| {
			kind: 'frame';
			effects: ClipEffectParams;
			transform: TransformParams;
			lut?: ClipLut;
			transition?: import('./timeline').TransitionResolveMeta;
	  }
	| {
			kind: 'title';
			clipId: string;
			content: TitleContent;
			transform: TransformParams;
			transition?: import('./timeline').TransitionResolveMeta;
	  };

/**
 * Decodes the budgeted video layer stack at `timestamp` (bottom → top) for the
 * compositor. Offline/audio-only layers are skipped (they don't consume budget);
 * decoding stops once the throughput-derived budget of decodable layers is met,
 * dropping the topmost extras with a one-time notice (T2.4). Each decoded layer
 * carries its own colour/transform metadata so `renderFrames` pairs them
 * directly. On a decode failure, every already-decoded layer is closed before
 * the error propagates so no frame leaks.
 */
function makeGetLayers() {
	return async (timestamp: number): Promise<DecodedLayer<LayerMeta>[] | null> => {
		const layers = resolveAllAt(timeline, timestamp, transitions);
		// Same-source transition pairs route the incoming side through a secondary
		// sink so the two cut sides don't keyframe-re-seek each other (T2.2).
		const secondarySinkLayers = sharedSourceIncomingLayers(layers);
		const budget = layerBudgetFromProbe(currentProbe);
		const decodedLayers: DecodedLayer<LayerMeta>[] = [];
		let decodedCount = 0;
		let overBudget = false;
		try {
			for (const layer of layers) {
				// Title layers carry no decode and don't consume the decode budget; they
				// composite from the cached title texture, preserving z-order.
				if (isTitleClip(layer.clip)) {
					if (!layer.clip.title) continue;
					const sampled = sampleClipParamsAt(layer.clip, timestamp);
					decodedLayers.push({
						decoded: null,
						meta: {
							kind: 'title',
							clipId: layer.clip.id,
							content: layer.clip.title,
							transform: sampled.transform,
							transition: layer.transition
						}
					});
					continue;
				}
				const handle = sourceInputs.get(layer.clip.sourceId);
				if (!handle?.frameSource) continue;
				if (decodedCount >= budget) {
					// Stop decoding video past the budget but keep scanning: source-less
					// title layers above the budgeted stack still composite (no decode).
					overBudget = true;
					continue;
				}
				const sourceTimestamp = resolveSourceTimestamp({
					clip: layer.clip,
					timelineTime: timestamp,
					trackKind: 'video',
					timing: handle.timing
				});
				if (!sourceTimestamp.available) continue;
				const decoded = await decodeFrameForLayer(
					handle,
					layer.clip.sourceId,
					sourceTimestamp.adapterTimestampS,
					secondarySinkLayers.has(layer)
						? secondaryFrameSources.acquire(handle)
						: handle.frameSource
				);
				if (!decoded) continue;
				const sampled = sampleClipParamsAt(layer.clip, timestamp);
				decodedCount += 1;
				decodedLayers.push({
					decoded,
					meta: {
						kind: 'frame',
						effects: sampled.effects,
						transform: sampled.transform,
						lut: layer.clip.lut,
						transition: layer.transition
					}
				});
			}
			for (const caption of activeCaptionLayersAt(captionTracks, timestamp)) {
				decodedLayers.push({
					decoded: null,
					meta: {
						kind: 'title',
						clipId: caption.clipId,
						content: caption.content,
						transform: caption.transform
					}
				});
			}
		} catch (error) {
			for (const layer of decodedLayers) layer.decoded?.close();
			throw error;
		}
		noteLayerBudget(overBudget, budget);
		return decodedLayers.length > 0 ? decodedLayers : null;
	};
}

/** Surfaces an over-budget composite stack once per episode (reset when back under). */
function noteLayerBudget(overBudget: boolean, budget: number): void {
	if (!overBudget) {
		layerBudgetWarned = false;
		return;
	}
	if (layerBudgetWarned) return;
	layerBudgetWarned = true;
	postProjectWarning(
		`Composite stack exceeds this device's budget of ${budget} layers; dropping the topmost extras.`
	);
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
			fileHandle: fileHandle ?? undefined
		});

		// Register in the media bin as an unplaced asset; placement is now explicit.
		binSourceIds.add(sourceId);

		if (!primaryHandle && handle.frameSource) {
			primaryHandle = handle;
		}

		// Ring stays at canonical stereo init; pcmAt resamples and upmixes each
		// source to the ring's format (worklet reads rate/channels once at init).

		const hasVideoOnTimeline = timeline.some(
			(track) => track.type === 'video' && track.clips.length > 0
		);
		if (!hasVideoOnTimeline && handle.frameSource) {
			const importedHandle = handle;
			const hadPlayback = playback !== null;
			const placed = commitTimelineMutation(
				() => placeAsset(timeline, importedHandle, undefined, 0),
				{ prune: false }
			);
			if (placed) {
				void computeWaveformsForSource(importedHandle);
				if (hadPlayback) setupPlayback();
			}
		} else if (!timelineHasClips()) {
			const importedHandle = handle;
			const placed = commitTimelineMutation(
				() => placeAsset(timeline, importedHandle, undefined, 0),
				{ prune: false }
			);
			if (placed) {
				void computeWaveformsForSource(importedHandle);
			}
		}

		ensureClockAndTimeline();
		postMediaAssets();
		postSourceHealth(descriptor.health);
		postHistoryState();
		scheduleAutosave();

		post({ type: 'import-complete', metadata: handle.metadata });

		const playbackHandle = getPlaybackSource();
		if (playbackHandle && playbackHandle.metadata.video) {
			void runProbeOnce(playbackHandle);
		}
	} catch (e) {
		if (handle) {
			handle.dispose();
		}
		if (sourceId) {
			sourceInputs.delete(sourceId);
			sourceDescriptors.delete(sourceId);
			binSourceIds.delete(sourceId);
		}
		const message = errorMessage(e);
		recordRecentError({
			code: 'media.import_failed',
			subsystem: 'import',
			severity: 'error',
			message,
			affectedSourceAlias: sourceId ?? undefined,
			recoveryActionIds: ['retry-import']
		});
		if (sourceId) {
			post({
				type: 'source-health',
				report: sourceHealthReportFromError(sourceId, file.name, message)
			});
		}
		post({ type: 'import-error', message });
	}
}

/**
 * Disposes `MediaInputHandle`s for sources no longer in the media bin, releasing
 * their decoder resources. Keyed off bin membership (not clip references) so an
 * imported-but-unplaced asset keeps its handle. Cheap and idempotent.
 */
function pruneUnusedSources(): void {
	if (exportAbort) return;
	for (const [id, handle] of [...sourceInputs.entries()]) {
		if (binSourceIds.has(id)) continue;
		secondaryFrameSources.release(id);
		handle.dispose();
		sourceInputs.delete(id);
		thumbnailGen?.cancelSource(id);
		if (primaryHandle === handle) primaryHandle = null;
	}
}

function isTrackLockedWorker(trackId: string): boolean {
	return timeline.find((t) => t.id === trackId)?.locked === true;
}

function handleSplit(cmd: Extract<WorkerCommand, { type: 'split' }>) {
	if (isTrackLockedWorker(cmd.trackId)) return;
	const track = timeline.find((t) => t.id === cmd.trackId);
	const targetClip = track?.clips.find(
		(c) => cmd.time >= c.start && cmd.time < c.start + c.duration
	);
	if (!targetClip) return;
	const refs = expandLinkedGroup(timeline, [{ trackId: cmd.trackId, clipId: targetClip.id }]);
	if (refs.some((r) => isTrackLockedWorker(r.trackId))) return;
	commitTimelineMutation(() => {
		let tl = timeline;
		for (const ref of refs) {
			tl = splitClipAt(tl, ref.trackId, cmd.time);
		}
		return tl;
	});
}

function handleDelete(cmd: Extract<WorkerCommand, { type: 'delete-clip' }>) {
	const expanded = expandLinkedGroup(timeline, [{ trackId: cmd.trackId, clipId: cmd.clipId }]);
	if (expanded.some((c) => isTrackLockedWorker(c.trackId))) return;
	commitTimelineMutation(() => {
		let next = timeline;
		for (const ref of expanded) {
			next = removeClip(next, ref.trackId, ref.clipId);
		}
		return next;
	});
}

function handleDeleteBatch(cmd: Extract<WorkerCommand, { type: 'delete-clips' }>) {
	const expanded = expandLinkedGroup(timeline, cmd.clips);
	if (expanded.some((c) => isTrackLockedWorker(c.trackId))) return;
	commitTimelineMutation(() => {
		let next = timeline;
		for (const ref of expanded) {
			next = removeClip(next, ref.trackId, ref.clipId);
		}
		return next;
	});
}

function expandMovesForLinkedGroups(moves: readonly MoveClipTarget[]): MoveClipTarget[] {
	const expanded: MoveClipTarget[] = [...moves];
	const seen = new Set(moves.map((m) => `${m.trackId}:${m.clipId}`));
	for (const move of moves) {
		const clip = timeline
			.find((t) => t.id === move.trackId)
			?.clips.find((c) => c.id === move.clipId);
		if (!clip) continue;
		const deltaS = move.toStart - clip.start;
		const partners = expandLinkedGroup(timeline, [{ trackId: move.trackId, clipId: move.clipId }]);
		for (const partner of partners) {
			const key = `${partner.trackId}:${partner.clipId}`;
			if (seen.has(key)) continue;
			const partnerClip = timeline
				.find((t) => t.id === partner.trackId)
				?.clips.find((c) => c.id === partner.clipId);
			if (!partnerClip) continue;
			expanded.push({
				trackId: partner.trackId,
				clipId: partner.clipId,
				toTrackId: partner.trackId,
				toStart: partnerClip.start + deltaS
			});
			seen.add(key);
		}
	}
	return expanded;
}

function handleMove(cmd: Extract<WorkerCommand, { type: 'move-clip' }>) {
	handleMoveBatch({
		type: 'move-clips',
		moves: [
			{
				trackId: cmd.fromTrackId,
				clipId: cmd.clipId,
				toTrackId: cmd.toTrackId,
				toStart: cmd.toStart
			}
		]
	});
}

function handleMoveBatch(cmd: Extract<WorkerCommand, { type: 'move-clips' }>) {
	const expanded = expandMovesForLinkedGroups(cmd.moves);
	if (expanded.some((m) => isTrackLockedWorker(m.trackId) || isTrackLockedWorker(m.toTrackId)))
		return;
	commitTimelineMutation(() => moveClips(timeline, expanded));
}

function handleDuplicate(cmd: Extract<WorkerCommand, { type: 'duplicate-clip' }>) {
	const expanded = expandLinkedGroup(timeline, cmd.clips);
	if (expanded.some((c) => isTrackLockedWorker(c.trackId))) return;
	commitTimelineMutation(() => duplicateClips(timeline, expanded, cmd.atTime));
}

function timelineClipByRef(trackId: string, clipId: string): TimelineClip | null {
	return (
		timeline.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId) ?? null
	);
}

function handleCacheClipboardLuts(cmd: Extract<WorkerCommand, { type: 'cache-clipboard-luts' }>) {
	clipboardLuts.clear();
	for (const ref of cmd.clips) {
		const lut = timelineClipByRef(ref.trackId, ref.clipId)?.lut;
		if (lut) clipboardLuts.set(lut.key, cloneClipLut(lut)!);
	}
}

function clipboardLutFromTimeline(item: TimelineClipboardClip): ClipLut | undefined {
	const snapshot = item.clip.lut;
	if (!snapshot) return undefined;
	const sourceClip = timelineClipByRef(item.trackId, item.clip.id);
	if (sourceClip?.lut?.key === snapshot.key) return cloneClipLut(sourceClip.lut);
	const copied = clipboardLuts.get(snapshot.key);
	if (copied) return cloneClipLut(copied);
	for (const track of timeline) {
		for (const clip of track.clips) {
			if (clip.lut?.key === snapshot.key) return cloneClipLut(clip.lut);
		}
	}
	return undefined;
}

function clipboardClipFromMessage(item: TimelineClipboardClip): ClipboardTimelineClip {
	const lut = clipboardLutFromTimeline(item);
	return {
		trackId: item.trackId,
		clip: {
			id: item.clip.id,
			// Preserve a pasted title clip's kind + text/style; source clips omit both.
			...(item.clip.kind === 'title' && item.clip.title
				? {
						kind: 'title' as const,
						title: { text: item.clip.title.text, style: { ...item.clip.title.style } }
					}
				: {}),
			sourceId: item.clip.sourceId,
			start: item.clip.start,
			duration: item.clip.duration,
			inPoint: item.clip.inPoint,
			effects: { ...item.clip.effects },
			transform: { ...item.clip.transform },
			keyframes: item.clip.keyframes,
			...(lut ? { lut } : {}),
			audioFadeIn: item.clip.audioFadeIn,
			audioFadeOut: item.clip.audioFadeOut
		}
	};
}

function handlePaste(cmd: Extract<WorkerCommand, { type: 'paste-clips' }>) {
	if (cmd.clips.some((c) => isTrackLockedWorker(c.trackId))) return;
	commitTimelineMutation(() =>
		pasteClips(timeline, cmd.clips.map(clipboardClipFromMessage), cmd.atTime)
	);
}

function handleAddMarker(cmd: Extract<WorkerCommand, { type: 'add-marker' }>) {
	commitMarkerMutation(() => addMarker(markers, cmd.time, cmd.label));
}

function handleDeleteMarker(cmd: Extract<WorkerCommand, { type: 'delete-marker' }>) {
	commitMarkerMutation(() => deleteMarker(markers, cmd.markerId));
}

function handleCloseGaps(cmd: Extract<WorkerCommand, { type: 'close-gaps' }>) {
	commitTimelineMutation(() => closeGaps(timeline, cmd.trackId));
}

function handleSetEffectParam(cmd: Extract<WorkerCommand, { type: 'set-effect-param' }>) {
	commitTimelineMutation(
		() => setClipEffectParam(timeline, cmd.trackId, cmd.clipId, cmd.key, cmd.value),
		{
			coalesceKey: { clipId: cmd.clipId, key: cmd.key },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSetTransform(cmd: Extract<WorkerCommand, { type: 'set-transform' }>) {
	commitTimelineMutation(() => setClipTransform(timeline, cmd.trackId, cmd.clipId, cmd.transform), {
		// A gizmo drag streams many updates; coalesce them into one history entry
		// per clip so a single drag doesn't exhaust the undo ring.
		coalesceKey: { clipId: cmd.clipId, key: 'transform' },
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
}

function handleSetKeyframe(cmd: Extract<WorkerCommand, { type: 'set-keyframe' }>) {
	commitTimelineMutation(
		() =>
			setClipKeyframe(
				timeline,
				cmd.trackId,
				cmd.clipId,
				cmd.key,
				cmd.t,
				cmd.value,
				cmd.easing ?? 'linear'
			),
		{
			coalesceKey: { clipId: cmd.clipId, key: `keyframe-${cmd.key}` },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSetKeyframes(cmd: Extract<WorkerCommand, { type: 'set-keyframes' }>) {
	commitTimelineMutation(
		() =>
			setClipKeyframes(
				timeline,
				cmd.trackId,
				cmd.clipId,
				cmd.t,
				cmd.keyframes.map((frame) => ({
					key: frame.key,
					value: frame.value,
					easing: frame.easing ?? 'linear'
				}))
			),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'keyframes' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleDeleteKeyframe(cmd: Extract<WorkerCommand, { type: 'delete-keyframe' }>) {
	commitTimelineMutation(
		() => deleteClipKeyframe(timeline, cmd.trackId, cmd.clipId, cmd.key, cmd.t),
		{
			coalesceKey: { clipId: cmd.clipId, key: `keyframe-${cmd.key}` },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

async function handleImportLut(cmd: Extract<WorkerCommand, { type: 'import-lut' }>): Promise<void> {
	if (!renderer) {
		postProjectWarning('LUT import requires the accelerated WebGPU renderer.');
		return;
	}
	let lut: ClipLut;
	try {
		lut = await clipLutFromCubeFile(cmd.file);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		postProjectWarning(`Could not import LUT: ${message}`);
		return;
	}
	commitTimelineMutation(() => setClipLut(timeline, cmd.trackId, cmd.clipId, lut), {
		coalesceKey: { clipId: cmd.clipId, key: 'lut' },
		refreshPlayback: 'refresh',
		prune: false
	});
}

function handleSetLutStrength(cmd: Extract<WorkerCommand, { type: 'set-lut-strength' }>) {
	commitTimelineMutation(
		() => setClipLutStrength(timeline, cmd.trackId, cmd.clipId, cmd.strength),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'lutStrength' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSetTrackGain(cmd: Extract<WorkerCommand, { type: 'set-track-gain' }>) {
	commitTimelineMutation(() => setTrackGain(timeline, cmd.trackId, cmd.gain), {
		coalesceKey: { clipId: cmd.trackId, key: 'gain' },
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackMute(cmd: Extract<WorkerCommand, { type: 'set-track-mute' }>) {
	commitTimelineMutation(() => setTrackMute(timeline, cmd.trackId, cmd.muted), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackSolo(cmd: Extract<WorkerCommand, { type: 'set-track-solo' }>) {
	commitTimelineMutation(() => setTrackSolo(timeline, cmd.trackId, cmd.solo), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackPan(cmd: Extract<WorkerCommand, { type: 'set-track-pan' }>) {
	commitTimelineMutation(() => setTrackPan(timeline, cmd.trackId, cmd.pan), {
		coalesceKey: { clipId: cmd.trackId, key: 'pan' },
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetMasterGain(cmd: Extract<WorkerCommand, { type: 'set-master-gain' }>) {
	const gain = Number.isFinite(cmd.gain) ? Math.max(0, cmd.gain) : masterGain;
	if (gain === masterGain) return;
	masterGain = gain;
	postTimelineState();
	scheduleAutosave();
}

function handleSetClipFade(cmd: Extract<WorkerCommand, { type: 'set-clip-fade' }>) {
	commitTimelineMutation(
		() => setClipAudioFade(timeline, cmd.trackId, cmd.clipId, cmd.edge, cmd.durationS),
		{
			coalesceKey: { clipId: cmd.clipId, key: `fade-${cmd.edge}` },
			refreshPlayback: 'none',
			prune: false,
			syncLuts: false
		}
	);
}

function handleAddTransition(cmd: Extract<WorkerCommand, { type: 'add-transition' }>) {
	commitTransitionMutation(() =>
		addTransition(timeline, transitions, transitionSourceDurations(), {
			id: makeTransitionId(),
			trackId: cmd.trackId,
			fromClipId: cmd.fromClipId,
			toClipId: cmd.toClipId,
			durationS: cmd.durationS,
			kind: cmd.kind,
			params: cmd.params
		})
	);
}

function handleRemoveTransition(cmd: Extract<WorkerCommand, { type: 'remove-transition' }>) {
	commitTransitionMutation(() => removeTransition(transitions, cmd.transitionId));
}

function handleSetTransition(cmd: Extract<WorkerCommand, { type: 'set-transition' }>) {
	commitTransitionMutation(
		() => setTransition(timeline, transitions, transitionSourceDurations(), cmd.transitionId, cmd),
		{ coalesceKey: { clipId: cmd.transitionId, key: 'transition' } }
	);
}

function handlePlaceClip(cmd: Extract<WorkerCommand, { type: 'place-clip' }>) {
	const handle = sourceInputs.get(cmd.sourceId);
	if (!handle) {
		if (binSourceIds.has(cmd.sourceId)) {
			postProjectWarning('Re-link this source before placing it on the timeline.');
		}
		return;
	}
	if (handle.kind !== 'audio' && !handle.frameSource) {
		postProjectWarning(`${handle.metadata.fileName} has no decodable video track to place.`);
		return;
	}
	const placed = commitTimelineMutation(() => placeAsset(timeline, handle, cmd.trackId, cmd.start));
	if (placed) {
		void computeWaveformsForSource(handle);
		if (handle.metadata.video) setupPlayback();
	}
}

function handleSetStillDuration(cmd: Extract<WorkerCommand, { type: 'set-still-duration' }>) {
	commitTimelineMutation(() => setClipDuration(timeline, cmd.trackId, cmd.clipId, cmd.durationS), {
		coalesceKey: { clipId: cmd.clipId, key: 'still-duration' }
	});
}

function makeTitleClipId(): string {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `clip-title-${suffix}`;
}

/**
 * Adds a source-less title clip at `start` (default 0). Titles want an overlay
 * track: try each existing video track for a free slot, falling back to a fresh
 * video track appended on top (drawn last by `resolveAllAt`) so a title never
 * collides with footage on the base track (Phase 14).
 */
function handleAddTitle(cmd: Extract<WorkerCommand, { type: 'add-title' }>) {
	const added = commitTimelineMutation(() => {
		const start =
			cmd.start !== undefined && Number.isFinite(cmd.start) && cmd.start >= 0 ? cmd.start : 0;
		const makeClip = () =>
			defaultTitleClip({ id: makeTitleClipId(), start, duration: DEFAULT_TITLE_DURATION_S });

		if (cmd.trackId) {
			return insertClip(timeline, cmd.trackId, makeClip());
		}
		for (const track of timeline) {
			if (track.type !== 'video') continue;
			const candidate = insertClip(timeline, track.id, makeClip());
			if (candidate !== timeline) return candidate;
		}
		const withTrack = addTrack(timeline, 'video');
		const overlayTrackId = withTrack[withTrack.length - 1]!.id;
		return insertClip(withTrack, overlayTrackId, makeClip());
	});
	// First title on a footage-free timeline: stand up playback so the title-only
	// preview renders (afterTimelineMutation only refreshes an existing controller).
	if (added && !playback) setupPlayback();
}

function handleSetTitle(cmd: Extract<WorkerCommand, { type: 'set-title' }>) {
	commitTimelineMutation(
		() => setTitleContent(timeline, cmd.trackId, cmd.clipId, { text: cmd.text, style: cmd.style }),
		{
			// A typing/restyle burst streams many updates; coalesce into one history
			// entry per clip so a single edit session doesn't exhaust the undo ring.
			coalesceKey: { clipId: cmd.clipId, key: 'title' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleAddTrack(cmd: Extract<WorkerCommand, { type: 'add-track' }>) {
	commitTimelineMutation(() => addTrack(timeline, cmd.trackType), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleRemoveTrack(cmd: Extract<WorkerCommand, { type: 'remove-track' }>) {
	commitTimelineMutation(() => removeTrack(timeline, cmd.trackId), { prune: false });
}

function handleReorderTrack(cmd: Extract<WorkerCommand, { type: 'reorder-track' }>) {
	commitTimelineMutation(() => reorderTrack(timeline, cmd.trackId, cmd.toIndex), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleRemoveAsset(cmd: Extract<WorkerCommand, { type: 'remove-asset' }>) {
	if (!binSourceIds.has(cmd.sourceId)) return;
	binSourceIds.delete(cmd.sourceId);
	// Drop any clips placed from this source in a single pass, then release its
	// decoder + bitmaps. Guard the commit so removing an unplaced asset doesn't
	// push an empty history entry.
	const referenced = timeline.some((track) =>
		track.clips.some((clip) => clip.sourceId === cmd.sourceId)
	);
	if (referenced) {
		commitTimelineMutation(() =>
			timeline.map((track) => ({
				...track,
				clips: track.clips.filter((clip) => clip.sourceId !== cmd.sourceId)
			}))
		);
	}
	const handle = sourceInputs.get(cmd.sourceId);
	if (handle) {
		secondaryFrameSources.release(cmd.sourceId);
		handle.dispose();
		sourceInputs.delete(cmd.sourceId);
		if (primaryHandle === handle) primaryHandle = null;
	}
	thumbnailGen?.cancelSource(cmd.sourceId);
	// Keep the descriptor in memory so undo can resurrect the clips as an
	// offline, re-linkable source (reconciled in applyHistoryRestore). Drop the
	// stored file record either way — the bin no longer claims it.
	void deleteStoredSource(cmd.sourceId).catch(() => undefined);
	// A pure bin removal skips the clip commit above, so persist the bin change
	// explicitly; otherwise the autosaved project keeps referencing the source.
	scheduleAutosave();
	postMediaAssets();
}

function handleRequestThumbnails(cmd: Extract<WorkerCommand, { type: 'request-thumbnails' }>) {
	if (!sourceInputs.has(cmd.sourceId)) return;
	ensureThumbnailGenerator().request(cmd.sourceId, cmd.timestamps);
}

function handleTrim(cmd: Extract<WorkerCommand, { type: 'trim-clip' }>) {
	if (isTrackLockedWorker(cmd.trackId)) return;
	const track = timeline.find((t) => t.id === cmd.trackId);
	const clip = track?.clips.find((c) => c.id === cmd.clipId);
	const sourceDuration = clip ? sourceInputs.get(clip.sourceId)?.duration : undefined;
	commitTimelineMutation(
		() =>
			trimClip(timeline, cmd.trackId, cmd.clipId, {
				edge: cmd.edge,
				time: cmd.time,
				sourceDuration
			}),
		// Coalesce the ~16/s debounced trim messages of a single drag into one
		// history entry per clip+edge so a long drag doesn't exhaust the undo ring.
		{ coalesceKey: { clipId: cmd.clipId, key: `trim-${cmd.edge}` } }
	);
}

function getSyncLockedTrackIds(): string[] {
	return timeline.filter((t) => t.syncLocked).map((t) => t.id);
}

function getEditTargetTrackIds(): string[] {
	return timeline.filter((t) => t.editTarget).map((t) => t.id);
}

function handleInsertEdit(cmd: Extract<WorkerCommand, { type: 'insert-edit' }>) {
	const targetTrackIds = getEditTargetTrackIds();
	const syncLockedTrackIds = getSyncLockedTrackIds();
	commitEditMutation(() => {
		const nextTimeline = insertEdit(
			timeline,
			targetTrackIds,
			cmd.clips.map(clipboardClipFromMessage),
			cmd.atTime,
			syncLockedTrackIds
		);
		if (nextTimeline === timeline) return { timeline, captionTracks, transitions, markers };
		const targetMarkersSet = new Set(targetTrackIds);
		const insertDuration = cmd.clips.reduce(
			(max, c) => (targetMarkersSet.has(c.trackId) ? Math.max(max, c.clip.duration) : max),
			0
		);
		const nextMarkers = shiftMarkers(markers, cmd.atTime, insertDuration);
		return {
			timeline: nextTimeline,
			captionTracks,
			transitions: reconcileTransitions(nextTimeline, transitions),
			markers: nextMarkers
		};
	});
}

function handleOverwriteEdit(cmd: Extract<WorkerCommand, { type: 'overwrite-edit' }>) {
	const targetTrackIds = getEditTargetTrackIds();
	commitTimelineMutation(() =>
		overwriteEdit(timeline, targetTrackIds, cmd.clips.map(clipboardClipFromMessage), cmd.atTime)
	);
}

function handleRippleDelete(cmd: Extract<WorkerCommand, { type: 'ripple-delete' }>) {
	const syncLockedTrackIds = getSyncLockedTrackIds();
	const expanded = expandLinkedGroup(timeline, cmd.clips);
	const removedRegions: { start: number; end: number }[] = [];
	for (const ref of expanded) {
		const track = timeline.find((t) => t.id === ref.trackId);
		const clip = track?.clips.find((c) => c.id === ref.clipId);
		if (clip) removedRegions.push({ start: clip.start, end: clip.start + clip.duration });
	}
	commitEditMutation(() => {
		const nextTimeline = rippleDelete(timeline, cmd.clips, syncLockedTrackIds);
		if (nextTimeline === timeline) return { timeline, captionTracks, transitions, markers };
		let nextMarkers: TimelineMarker[] = markers as TimelineMarker[];
		const sorted = [...removedRegions].sort((a, b) => a.start - b.start);
		const merged: { start: number; end: number }[] = [];
		for (const r of sorted) {
			if (merged.length > 0 && r.start <= merged[merged.length - 1]!.end + TIMELINE_EPSILON) {
				merged[merged.length - 1]!.end = Math.max(merged[merged.length - 1]!.end, r.end);
			} else {
				merged.push({ start: r.start, end: r.end });
			}
		}
		for (const r of merged) {
			nextMarkers = removeMarkersInRange(nextMarkers, r.start, r.end);
		}
		let cumulativeDelta = 0;
		for (const r of merged) {
			const dur = r.end - r.start;
			nextMarkers = shiftMarkers(nextMarkers, r.start - cumulativeDelta, -dur);
			cumulativeDelta += dur;
		}
		return {
			timeline: nextTimeline,
			captionTracks,
			transitions: reconcileTransitions(nextTimeline, transitions),
			markers: nextMarkers
		};
	});
}

function handleRippleTrim(cmd: Extract<WorkerCommand, { type: 'ripple-trim' }>) {
	const syncLockedTrackIds = getSyncLockedTrackIds();
	const clip = timeline.find((t) => t.id === cmd.trackId)?.clips.find((c) => c.id === cmd.clipId);
	const sourceDuration = clip ? sourceInputs.get(clip.sourceId)?.duration : undefined;
	const oldEnd = clip ? clip.start + clip.duration : 0;
	commitEditMutation(
		() => {
			const nextTimeline = rippleTrim(
				timeline,
				cmd.trackId,
				cmd.clipId,
				cmd.edge,
				cmd.time,
				syncLockedTrackIds,
				sourceDuration
			);
			if (nextTimeline === timeline) return { timeline, captionTracks, transitions, markers };
			const trimmedClip = nextTimeline
				.find((t) => t.id === cmd.trackId)
				?.clips.find((c) => c.id === cmd.clipId);
			const newEnd = trimmedClip ? trimmedClip.start + trimmedClip.duration : oldEnd;
			const afterTime = cmd.edge === 'out' ? oldEnd : (clip?.start ?? 0);
			const delta =
				cmd.edge === 'out'
					? newEnd - oldEnd
					: Math.min(0, (clip?.start ?? 0) - (trimmedClip?.start ?? 0));
			const nextMarkers = delta !== 0 ? shiftMarkers(markers, afterTime, delta) : markers;
			return {
				timeline: nextTimeline,
				captionTracks,
				transitions: reconcileTransitions(nextTimeline, transitions),
				markers: nextMarkers
			};
		},
		{ coalesceKey: { clipId: cmd.clipId, key: `ripple-trim-${cmd.edge}` } }
	);
}

function handleRollTrim(cmd: Extract<WorkerCommand, { type: 'roll-trim' }>) {
	commitTimelineMutation(
		() =>
			rollTrim(timeline, cmd.trackId, cmd.clipId, cmd.edge, cmd.time, transitionSourceDurations()),
		{ coalesceKey: { clipId: cmd.clipId, key: `roll-trim-${cmd.edge}` } }
	);
}

function handleSlipEdit(cmd: Extract<WorkerCommand, { type: 'slip-edit' }>) {
	const refs = expandLinkedGroup(timeline, [{ trackId: cmd.trackId, clipId: cmd.clipId }]);
	commitTimelineMutation(
		() => {
			let tl = timeline;
			for (const ref of refs) {
				const clip = tl.find((t) => t.id === ref.trackId)?.clips.find((c) => c.id === ref.clipId);
				const sourceDuration = clip ? sourceInputs.get(clip.sourceId)?.duration : undefined;
				if (sourceDuration === undefined) return timeline;
				const next = slipEdit(tl, ref.trackId, ref.clipId, cmd.deltaS, sourceDuration);
				if (next === tl) return timeline;
				tl = next;
			}
			return tl;
		},
		{
			coalesceKey: { clipId: cmd.clipId, key: 'slip' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSlideEdit(cmd: Extract<WorkerCommand, { type: 'slide-edit' }>) {
	commitTimelineMutation(
		() => slideEdit(timeline, cmd.trackId, cmd.clipId, cmd.deltaS, transitionSourceDurations()),
		{ coalesceKey: { clipId: cmd.clipId, key: 'slide' } }
	);
}

function handleLiftRegion(cmd: Extract<WorkerCommand, { type: 'lift-region' }>) {
	const targetTrackIds = getEditTargetTrackIds();
	commitTimelineMutation(() => liftRegion(timeline, targetTrackIds, cmd.startTime, cmd.endTime));
}

function handleExtractRegion(cmd: Extract<WorkerCommand, { type: 'extract-region' }>) {
	const targetTrackIds = getEditTargetTrackIds();
	const syncLockedTrackIds = getSyncLockedTrackIds();
	const regionDuration = cmd.endTime - cmd.startTime;
	commitEditMutation(() => {
		const nextTimeline = extractRegion(
			timeline,
			targetTrackIds,
			cmd.startTime,
			cmd.endTime,
			syncLockedTrackIds
		);
		if (nextTimeline === timeline) return { timeline, captionTracks, transitions, markers };
		const pruned = removeMarkersInRange(markers, cmd.startTime, cmd.endTime);
		const nextMarkers = shiftMarkers(pruned, cmd.endTime, -regionDuration);
		return {
			timeline: nextTimeline,
			captionTracks,
			transitions: reconcileTransitions(nextTimeline, transitions),
			markers: nextMarkers
		};
	});
}

function handleLinkClips(cmd: Extract<WorkerCommand, { type: 'link-clips' }>) {
	commitTimelineMutation(() => linkClips(timeline, cmd.clips), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleUnlinkClips(cmd: Extract<WorkerCommand, { type: 'unlink-clips' }>) {
	commitTimelineMutation(() => unlinkClips(timeline, cmd.clips), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackLock(cmd: Extract<WorkerCommand, { type: 'set-track-lock' }>) {
	commitTimelineMutation(() => setTrackLock(timeline, cmd.trackId, cmd.locked), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackVisible(cmd: Extract<WorkerCommand, { type: 'set-track-visible' }>) {
	commitTimelineMutation(() => setTrackVisible(timeline, cmd.trackId, cmd.visible), {
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackSyncLock(cmd: Extract<WorkerCommand, { type: 'set-track-sync-lock' }>) {
	commitTimelineMutation(() => setTrackSyncLock(timeline, cmd.trackId, cmd.syncLocked), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function handleSetTrackEditTarget(cmd: Extract<WorkerCommand, { type: 'set-track-edit-target' }>) {
	commitTimelineMutation(() => setTrackEditTarget(timeline, cmd.trackId, cmd.editTarget), {
		refreshPlayback: 'none',
		prune: false,
		syncLuts: false
	});
}

function appendImportedCaptionTrack(
	trackId: string | undefined,
	imported: CaptionTrack
): CaptionTrack[] {
	if (!trackId) {
		return [...captionTracks, imported];
	}
	const existing = captionTracks.find((track) => track.id === trackId);
	if (!existing) return [...captionTracks, imported];
	return captionTracks.map((track) =>
		track.id !== trackId
			? track
			: createCaptionTrack({
					...track,
					segments: [
						...track.segments,
						...imported.segments.map((segment: CaptionTrack['segments'][number]) => ({
							...segment,
							id: segment.id
						}))
					]
				})
	);
}

async function handleImportCaptions(
	cmd: Extract<WorkerCommand, { type: 'import-captions' }>
): Promise<void> {
	const text = await cmd.file.text();
	const lower = cmd.file.name.toLowerCase();
	const newTrackId = cmd.trackId ?? makeCaptionTrackId();
	const parsed =
		lower.endsWith('.vtt') || text.trimStart().startsWith('WEBVTT')
			? captionTrackFromWebVtt(text, newTrackId, cmd.file.name.replace(/\.[^.]+$/, ''))
			: captionTrackFromSrt(text, newTrackId, cmd.file.name.replace(/\.[^.]+$/, ''));
	const importedTrack = createCaptionTrack({
		...parsed.track,
		id: newTrackId,
		segments: parsed.track.segments.map((segment: CaptionTrack['segments'][number]) => ({
			...segment,
			id: makeCaptionSegmentId()
		}))
	});
	if (importedTrack.segments.length === 0) {
		post({ type: 'caption-import-result', result: { ...parsed, track: importedTrack } });
		return;
	}
	commitCaptionMutation(() => appendImportedCaptionTrack(cmd.trackId, importedTrack), {
		refreshPlayback: 'refresh'
	});
	post({
		type: 'caption-import-result',
		result: {
			...parsed,
			track: importedTrack
		}
	});
}

function handleExportCaptions(cmd: Extract<WorkerCommand, { type: 'export-captions' }>): void {
	const track = captionTracks.find((item) => item.id === cmd.settings.trackId);
	if (!track) {
		postProjectWarning('Selected caption track no longer exists.');
		return;
	}
	const settings = cmd.settings as CaptionExportSettings;
	post({ type: 'caption-export-result', files: exportCaptionSidecars(track, settings) });
}

function handleSetCaptionTrack(cmd: Extract<WorkerCommand, { type: 'set-caption-track' }>): void {
	const patch = {
		...(cmd.name !== undefined ? { name: cmd.name } : {}),
		...(cmd.language !== undefined ? { language: cmd.language } : {}),
		...(cmd.burnedIn !== undefined ? { burnedIn: cmd.burnedIn } : {}),
		...(cmd.visible !== undefined ? { visible: cmd.visible } : {}),
		...(cmd.defaultStyle !== undefined ? { defaultStyle: cmd.defaultStyle } : {})
	};
	commitCaptionMutation(() => setCaptionTrackProps(captionTracks, cmd.trackId, patch), {
		refreshPlayback: 'refresh'
	});
}

function handleSetCaptionSegmentText(
	cmd: Extract<WorkerCommand, { type: 'set-caption-segment-text' }>
): void {
	commitCaptionMutation(
		() => setCaptionSegmentText(captionTracks, cmd.trackId, cmd.segmentId, cmd.text),
		{
			coalesceKey: { clipId: cmd.segmentId, key: 'caption-text' },
			refreshPlayback: 'refresh'
		}
	);
}

function handleSetCaptionSegmentTiming(
	cmd: Extract<WorkerCommand, { type: 'set-caption-segment-timing' }>
): void {
	commitCaptionMutation(
		() => setCaptionSegmentTiming(captionTracks, cmd.trackId, cmd.segmentId, cmd.start, cmd.end),
		{
			coalesceKey: { clipId: cmd.segmentId, key: 'caption-time' },
			refreshPlayback: 'refresh'
		}
	);
}

function handleSetCaptionSegmentStyle(
	cmd: Extract<WorkerCommand, { type: 'set-caption-segment-style' }>
): void {
	commitCaptionMutation(
		() => setCaptionSegmentStyle(captionTracks, cmd.trackId, cmd.segmentId, cmd.style),
		{
			coalesceKey: { clipId: cmd.segmentId, key: 'caption-style' },
			refreshPlayback: 'refresh'
		}
	);
}

function handleSplitCaptionSegment(
	cmd: Extract<WorkerCommand, { type: 'split-caption-segment' }>
): void {
	commitCaptionMutation(
		() => splitCaptionSegment(captionTracks, cmd.trackId, cmd.segmentId, cmd.time),
		{
			refreshPlayback: 'refresh'
		}
	);
}

function handleMergeCaptionSegments(
	cmd: Extract<WorkerCommand, { type: 'merge-caption-segments' }>
): void {
	commitCaptionMutation(() => mergeCaptionSegments(captionTracks, cmd.trackId, cmd.segmentIds), {
		refreshPlayback: 'refresh'
	});
}

function handleDeleteCaptionSegments(
	cmd: Extract<WorkerCommand, { type: 'delete-caption-segments' }>
): void {
	commitCaptionMutation(() => deleteCaptionSegments(captionTracks, cmd.trackId, cmd.segmentIds), {
		refreshPlayback: 'refresh'
	});
}

function handleSnapCaptionSegment(
	cmd: Extract<WorkerCommand, { type: 'snap-caption-segment' }>
): void {
	const track = captionTracks.find((item: CaptionTrack) => item.id === cmd.trackId);
	const segment = track?.segments.find(
		(item: CaptionTrack['segments'][number]) => item.id === cmd.segmentId
	);
	if (!track || !segment) return;
	const targets = buildCaptionSnapTargets(
		timeline,
		markers,
		captionTracks,
		clockView?.[0] ?? 0,
		track.id,
		[segment.id]
	);
	let start = segment.start;
	let end = segment.start + segment.duration;
	if (cmd.edge === 'start' || cmd.edge === 'both') start = snapCaptionTime(start, targets);
	if (cmd.edge === 'end' || cmd.edge === 'both') end = snapCaptionTime(end, targets);
	if (end <= start) end = start + segment.duration;
	commitCaptionMutation(
		() => setCaptionSegmentTiming(captionTracks, cmd.trackId, cmd.segmentId, start, end),
		{
			refreshPlayback: 'refresh'
		}
	);
}

function applyHistoryRestore(next: {
	timeline: Timeline;
	captionTracks?: CaptionTrack[];
	transitions: TimelineTransition[];
	markers: TimelineMarker[];
}): void {
	timeline = cloneTimelineSnapshot(next.timeline);
	captionTracks = cloneCaptionTracksSnapshot(next.captionTracks ?? []);
	transitions = reconcileTransitions(timeline, next.transitions);
	markers = cloneMarkersSnapshot(next.markers);
	syncTimelineLuts();
	// Undo can resurrect clips of a source that was removed from the bin. Re-add
	// any still-described source the restored timeline references so the asset
	// returns to the bin (offline, re-linkable) instead of dangling.
	let binChanged = false;
	for (const id of timelineSourceIds()) {
		if (sourceDescriptors.has(id) && !binSourceIds.has(id)) {
			binSourceIds.add(id);
			binChanged = true;
		}
	}
	afterTimelineMutation();
	if (binChanged) postMediaAssets();
}

function handleUndo(): void {
	const next = history.undo(historySnapshot());
	if (!next) {
		postHistoryState();
		return;
	}
	applyHistoryRestore(next);
}

function handleRedo(): void {
	const next = history.redo(historySnapshot());
	if (!next) {
		postHistoryState();
		return;
	}
	applyHistoryRestore(next);
}

function collectTimelineLuts(): import('./lut').ClipLut[] {
	const luts = new Map<string, import('./lut').ClipLut>();
	for (const track of timeline) {
		for (const clip of track.clips) {
			if (clip.lut) luts.set(clip.lut.key, clip.lut);
		}
	}
	return [...luts.values()];
}

function projectDisplayName(): string {
	const first = currentProjectSources()[0];
	if (!first) return 'Untitled project';
	const stem = first.fileName.replace(/\.[^.]+$/, '');
	return stem || first.fileName;
}

function handleExportInterchange(
	cmd: Extract<WorkerCommand, { type: 'export-interchange' }>
): void {
	const doc = serializeProject({
		projectId,
		timeline,
		captionTracks,
		transitions,
		markers,
		sources: currentProjectSources(),
		masterGain,
		exportSettings: lastExportSettings ?? undefined
	});
	const displayName = projectDisplayName();
	try {
		const output =
			cmd.format === 'otio'
				? serializeTimelineToOtio(doc, { displayName, appVersion: defaultAppVersion() })
				: serializeTimelineToEdl(doc, { displayName, trackId: cmd.trackId });
		const stem = sanitizeBundleFileName(displayName) || 'timeline';
		post({
			type: 'interchange-result',
			format: cmd.format,
			suggestedName: `${stem}.${cmd.format}`,
			text: output.text,
			warnings: output.warnings
		});
	} catch (error) {
		post({ type: 'interchange-error', format: cmd.format, message: errorMessage(error) });
	}
}

async function applyImportedDoc(doc: ProjectDoc): Promise<void> {
	restoreOfferGeneration += 1;
	await flushPendingAutosave();
	restoreDoc = null;
	playback?.dispose();
	playback = null;
	adaptive = null;
	frameCache?.clear();
	frameCache = null;
	primaryHandle = null;
	history.clear();

	projectId = doc.projectId;
	timeline = cloneTimelineSnapshot(doc.timeline);
	captionTracks = cloneCaptionTracksSnapshot(doc.captionTracks);
	markers = cloneMarkersSnapshot(doc.markers);
	syncTimelineLuts();
	lastExportSettings = doc.exportSettings ?? null;
	exportPresets = (doc.exportPresets ?? []).filter((p) => !p.builtIn);
	queueState = createEmptyQueueState();
	if (doc.renderQueueHistory) {
		queueState = { ...queueState, jobs: deserializeQueueHistory(doc.renderQueueHistory) };
	}
	masterGain = doc.masterGain;
	applyProjectPhase46Config(doc);
	nextSourceId = nextSourceIdFromDescriptors(doc.sources);

	const keepIds = new Set(doc.sources.map((source) => source.sourceId));
	for (const id of [...binSourceIds]) {
		if (keepIds.has(id)) continue;
		binSourceIds.delete(id);
		secondaryFrameSources.release(id);
		sourceInputs.get(id)?.dispose();
		sourceInputs.delete(id);
		sourceDescriptors.delete(id);
		void deleteStoredSource(id).catch(() => undefined);
	}
	for (const descriptor of doc.sources) {
		sourceDescriptors.set(descriptor.sourceId, descriptor);
		binSourceIds.add(descriptor.sourceId);
	}

	transitions = reconcileTransitions(timeline, doc.transitions);
	postMediaAssets();
	setupPlayback();
	syncTitleRasters();
	ensureClockAndTimeline();
	postHistoryState();
	scheduleAutosave();
}

const bundleWorkerContext: BundleWorkerContext = {
	getProjectId: () => projectId,
	getDisplayName: projectDisplayName,
	getProjectState: () => ({
		timeline,
		captionTracks,
		transitions,
		markers,
		masterGain,
		exportSettings: lastExportSettings ?? undefined,
		sources: currentProjectSources()
	}),
	resolveSourceFile: makeStoredSourceResolver(loadStoredSource, fileFromHandle),
	collectLuts: collectTimelineLuts,
	attachSourceFile: async (descriptor, file, persist) => {
		const result = await attachSourceFile(descriptor, file, null, persist);
		return result.ok ? { ok: true } : { ok: false, message: result.message };
	},
	applyImportedDoc,
	currentProjectIsEmpty,
	projectHasRestorableContent,
	postProgress: (jobId, phase, bytesDone, bytesTotal) => {
		post({ type: 'bundle-job-progress', jobId, phase, bytesDone, bytesTotal });
	},
	postIntegrity: (jobId, report) => {
		post({ type: 'bundle-integrity-report', jobId, report });
	},
	postImportResult: (jobId, ok, importedProjectId, reason) => {
		post({
			type: 'bundle-import-result',
			jobId,
			ok,
			projectId: importedProjectId,
			reason
		});
	},
	postReplacePrompt: (jobId, message) => {
		post({ type: 'bundle-replace-prompt', jobId, message });
	}
};

async function handleRelinkSource(
	cmd: Extract<WorkerCommand, { type: 'relink-source' }>
): Promise<void> {
	const descriptor = sourceDescriptors.get(cmd.sourceId);
	if (!descriptor) {
		post({
			type: 'relink-result',
			sourceId: cmd.sourceId,
			ok: false,
			descriptor: null,
			metadata: activeMetadata(),
			unresolvedSources: unresolvedSourceDescriptors(),
			message: 'This source is not part of the restored project.'
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
			message: result.message
		});
		return;
	}

	setupPlayback();
	ensureClockAndTimeline();
	scheduleAutosave();
	postMediaAssets();
	post({
		type: 'relink-result',
		sourceId: cmd.sourceId,
		ok: true,
		descriptor: result.descriptor,
		metadata: activeMetadata(),
		unresolvedSources: unresolvedSourceDescriptors(),
		message: `Re-linked ${result.descriptor.fileName}.`
	});
}

function setupPlayback() {
	const handle = getPlaybackSource();
	// Title-only timelines have no decodable video source but are still renderable
	// (source-less title cards over black). Fall back to a default 1080p/30 canvas
	// so preview/playback work without footage (Phase 14 full support).
	const hasTitles = titleClips().length > 0;
	const hasBurnedInCaptions = captionTracks.some(
		(track) => track.burnedIn && track.visible && track.segments.length > 0
	);
	if (!handle?.frameSource && !hasTitles && !hasBurnedInCaptions) return;

	const width = handle?.frameSource ? handle.displayWidth : TITLE_ONLY_CANVAS.width;
	const height = handle?.frameSource ? handle.displayHeight : TITLE_ONLY_CANVAS.height;
	const frameRate =
		handle?.frameSource && handle.frameRate > 0 ? handle.frameRate : TITLE_ONLY_CANVAS.frameRate;

	const ladder = buildPreviewLadder(width, height);
	// Budget the adaptive downgrade to the source frame period (e.g. ~16.6ms at
	// 60fps, ~41.6ms at 24fps), falling back to 33ms (~30fps) for unknown rates.
	const budgetMs = frameRate > 0 ? 1000 / frameRate : 33;
	adaptive = new AdaptiveResolution(ladder, budgetMs);
	ensureFrameCache();

	const priorTime = playback?.getCurrentTime() ?? 0;
	const wasPlaying = playback?.isPlaying() ?? false;
	playback?.dispose();

	const getFrames = makeGetLayers();
	playback = new PlaybackController<LayerMeta>({
		duration: getTimelineDuration(timeline),
		frameRate,
		getFrames,
		renderFrames: (layers) => {
			// The stack is already budgeted + offline-skipped + z-ordered by
			// makeGetLayers. Core/compat GPU consume GPU title textures; Canvas2D
			// reduced preview consumes title payloads and VideoFrames synchronously.
			if (renderer) {
				const stack: CompositeLayer[] = [];
				for (const layer of layers) {
					if (layer.meta.kind === 'title') {
						const texture = titleCache?.get(layer.meta.clipId);
						if (!texture) continue;
						stack.push({
							kind: 'texture',
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform: layer.meta.transform,
							transition: layer.meta.transition
						});
					} else if (layer.frame) {
						stack.push({
							kind: 'frame',
							frame: layer.frame,
							effects: layer.meta.effects,
							transform: layer.meta.transform,
							lut: layer.meta.lut,
							transition: layer.meta.transition
						});
					}
				}
				renderer.present(stack);
				return;
			}
			if (reducedRenderer) {
				const stack: CanvasCompatibilityLayer[] = [];
				for (const layer of layers) {
					if (layer.meta.kind === 'title') {
						stack.push({
							kind: 'title',
							content: layer.meta.content,
							transform: layer.meta.transform
						});
					} else if (layer.frame) {
						stack.push({
							kind: 'frame',
							frame: layer.frame,
							transform: layer.meta.transform
						});
					}
				}
				reducedRenderer.present(stack);
			}
		},
		writeClock: writeTransport,
		onFrameTime: handleFrameTime,
		onPlaybackError: (e) => {
			const message = errorMessage(e);
			recordRecentError({
				code: 'playback.failed',
				subsystem: 'worker',
				severity: 'error',
				message,
				recoveryActionIds: ['reload-app']
			});
			post({ type: 'error', message: `Playback error: ${message}` });
		},
		getMasterTime
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
	const activeRenderer = renderer ?? reducedRenderer;
	if (!adaptive || !activeRenderer) return;
	const next = adaptive.record(frameMs);
	if (next) {
		activeRenderer.setPreviewSize(next.width, next.height);
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
		postMediaAssets();
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

function firstExportVideoHandle(): MediaInputHandle | null {
	for (const track of timeline) {
		if (track.type !== 'video') continue;
		for (const clip of track.clips) {
			const handle = sourceInputs.get(clip.sourceId);
			if (handle?.frameSource) return handle;
		}
	}
	return null;
}

function exportSettingsForProbe(): ExportSettings | null {
	const videoHandle = firstExportVideoHandle();
	// Title-only timelines export over the default canvas (no decodable video).
	if (!videoHandle && titleClips().length === 0) return null;
	const width = videoHandle?.displayWidth ?? TITLE_ONLY_CANVAS.width;
	const height = videoHandle?.displayHeight ?? TITLE_ONLY_CANVAS.height;
	const frameRate = videoHandle?.frameRate ?? TITLE_ONLY_CANVAS.frameRate;
	const timelineDuration = getTimelineDuration(timeline);
	const base =
		lastExportSettings ??
		defaultExportSettings('quality', width, height, frameRate, timelineDuration);
	try {
		return normalizeExportSettings(base, width, height, frameRate, timelineDuration);
	} catch {
		return null;
	}
}

async function handleExportProbe() {
	const settings = exportSettingsForProbe();
	// No videoHandle for title-only timelines; probe still works from the settings
	// geometry (probeExportCodecs needs only width/height/fps/bitrate).
	if (!settings) {
		post({
			type: 'export-codecs',
			supported: [],
			settings: defaultExportSettings('quality', 1920, 1080, 30, 0)
		});
		return;
	}

	const probedSupported = await probeExportCodecs(
		settings.width,
		settings.height,
		settings.fps,
		settings.videoBitrate
	);
	const capabilityProbe = currentCapabilityProbe;
	const supported = capabilityProbe
		? probedSupported.filter((entry) =>
				exportConstraintsForProbe(capabilityProbe).some(
					(allowed) => allowed.codec === entry.codec && allowed.container === entry.container
				)
			)
		: probedSupported;

	if (supported.length === 0) {
		post({ type: 'export-codecs', supported: [], settings });
		return;
	}

	// Fall back to the settings geometry when there's no decodable video source.
	const handleAfterProbe = firstExportVideoHandle();
	const resolvedWidth = handleAfterProbe?.displayWidth ?? settings.width;
	const resolvedHeight = handleAfterProbe?.displayHeight ?? settings.height;
	const resolvedFps = handleAfterProbe?.frameRate ?? settings.fps;

	const preferredCodec = supported.some((entry) => entry.codec === settings.codec)
		? settings.codec
		: (supported[0]?.codec ?? settings.codec);
	const resolved = normalizeExportSettings(
		{ ...settings, codec: preferredCodec, container: preferredCodec === 'h264' ? 'mp4' : 'webm' },
		resolvedWidth,
		resolvedHeight,
		resolvedFps,
		getTimelineDuration(timeline)
	);
	post({ type: 'export-codecs', supported, settings: resolved });
}

async function handleExportStart(cmd: Extract<WorkerCommand, { type: 'export-start' }>) {
	if (exportAbort) {
		recordRecentError({
			code: 'export.already_running',
			subsystem: 'export',
			severity: 'warning',
			message: 'An export is already running.',
			recoveryActionIds: ['cancel-job']
		});
		post({ type: 'export-error', message: 'An export is already running.' });
		return;
	}
	if (queueRunning) {
		recordRecentError({
			code: 'export.queue_running',
			subsystem: 'export',
			severity: 'warning',
			message: 'Cannot start export while the render queue is running.',
			recoveryActionIds: ['cancel-job']
		});
		post({
			type: 'export-error',
			message: 'Cannot start export while the render queue is running.'
		});
		return;
	}
	if (!renderer && !reducedRenderer) {
		recordRecentError({
			code: 'export.webgpu_unavailable',
			subsystem: 'export',
			severity: 'error',
			message: 'Export requires an active preview backend.',
			recoveryActionIds: ['retry-gpu-device']
		});
		post({ type: 'export-error', message: 'Export requires an active preview backend.' });
		return;
	}
	if (renderer && !cmd.output) {
		const message =
			'Accelerated export needs a file destination in this browser. Reduced blob export is only available on the Canvas2D backend.';
		recordRecentError({
			code: 'export.destination_unavailable',
			subsystem: 'export',
			severity: 'warning',
			message,
			recoveryActionIds: ['retry-export']
		});
		post({ type: 'export-error', message });
		return;
	}

	handlePause();
	const controller = new AbortController();
	exportAbort = controller;

	let exportCaptionTextureIds: string[] = [];
	try {
		const exportTimelineSnapshot = cloneTimelineForExport();
		const exportCaptionTracksSnapshot = cloneCaptionTracksSnapshot(captionTracks);
		const exportCaptionTextureGroupId =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		exportCaptionTextureIds = exportCaptionTracksSnapshot.flatMap((track) =>
			track.visible && track.burnedIn
				? track.segments.map((segment) =>
						exportCaptionTextureId(exportCaptionTextureGroupId, track.id, segment.id)
					)
				: []
		);
		rasterizeExportCaptionTextures(exportCaptionTextureGroupId, exportCaptionTracksSnapshot);
		const videoHandle = firstExportVideoHandle();
		const settings = normalizeExportSettings(
			cmd.settings,
			videoHandle?.displayWidth ?? 1920,
			videoHandle?.displayHeight ?? 1080,
			videoHandle?.frameRate ?? 30,
			getTimelineDuration(exportTimelineSnapshot)
		);
		lastExportSettings = settings;
		scheduleAutosave();

		if (renderer) {
			const outputHandle = cmd.output;
			if (!outputHandle) throw new Error('Accelerated export requires a file destination.');
			const result = await exportTimeline({
				timeline: exportTimelineSnapshot,
				sources: sourceInputs,
				renderer,
				outputHandle,
				settings,
				throughputProbe: currentProbe,
				signal: controller.signal,
				onProgress: (progress) => post({ type: 'export-progress', progress }),
				masterGain,
				transitions: audioTransitions,
				videoTransitions: transitions,
				// Title layers composite from the cached raster; `ensure` (re)rasters once
				// per title on the cold export path, never per frame.
				titleTextureFor: (clip) =>
					clip.title ? (titleCache?.ensure(clip.id, clip.title) ?? null) : null,
				overlayTextureLayersAt: (timelineTime) =>
					activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (trackId, segmentId) =>
						exportCaptionTextureId(exportCaptionTextureGroupId, trackId, segmentId)
					)
						.map((layer) => {
							const texture = titleCache?.get(layer.clipId);
							if (!texture) return null;
							return {
								view: texture.view,
								sourceWidth: texture.width,
								sourceHeight: texture.height,
								transform: layer.transform
							};
						})
						.filter(
							(
								layer
							): layer is {
								view: GPUTextureView;
								sourceWidth: number;
								sourceHeight: number;
								transform: TransformParams;
							} => layer !== null
						)
			});
			post({ type: 'export-complete', fileName: outputHandle.name, mimeType: result.mimeType });
		} else if (reducedRenderer) {
			const safeStem =
				projectDisplayName()
					.replace(/[^a-z0-9._-]+/gi, '-')
					.replace(/^-+|-+$/g, '') || 'localcut-reduced';
			const result = await exportTimelineReduced({
				timeline: exportTimelineSnapshot,
				sources: sourceInputs,
				renderer: reducedRenderer,
				outputHandle: cmd.output ?? null,
				settings,
				throughputProbe: currentProbe,
				signal: controller.signal,
				onProgress: (progress) => post({ type: 'export-progress', progress }),
				masterGain,
				transitions: audioTransitions,
				hasVideoTransitions: transitions.length > 0,
				overlayTitleLayersAt: (timelineTime) =>
					activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (trackId, segmentId) =>
						exportCaptionTextureId(exportCaptionTextureGroupId, trackId, segmentId)
					).map((layer) => ({
						content: layer.content,
						transform: layer.transform
					})),
				fallbackFileName: `${safeStem}.${settings.container === 'webm' ? 'webm' : 'mp4'}`
			});
			for (const warning of result.warnings) {
				post({ type: 'export-warning', message: warning });
			}
			if (result.blob) {
				post({
					type: 'export-download-ready',
					fileName: result.fileName,
					mimeType: result.mimeType,
					blob: result.blob
				});
			} else {
				post({ type: 'export-complete', fileName: result.fileName, mimeType: result.mimeType });
			}
		}
	} catch (error) {
		if (error instanceof ExportCancelledError) {
			post({ type: 'export-canceled' });
		} else {
			const message = errorMessage(error);
			recordRecentError({
				code: 'export.failed',
				subsystem: 'export',
				severity: 'error',
				message,
				recoveryActionIds: ['retry-export']
			});
			post({ type: 'export-error', message });
		}
	} finally {
		releaseRetainedOverlayTextures(exportCaptionTextureIds);
		syncTitleRasters();
		exportAbort = null;
		pruneUnusedSources();
		ensurePreview();
	}
}

function handleExportCancel() {
	exportAbort?.abort();
}

// ── Phase 24: Preset handlers ──

function postPresetsState() {
	post({ type: 'presets-state', presets: mergePresetsWithBuiltIns(exportPresets) });
}

function postQueueState() {
	post({ type: 'queue-state', queue: queueState });
}

function resolveWaitingQueueOutput(jobId: string, handle: FileSystemFileHandle | null): boolean {
	if (!queueJobOutputResolve || queueJobOutputJobId !== jobId) return false;
	const resolve = queueJobOutputResolve;
	queueJobOutputResolve = null;
	queueJobOutputJobId = null;
	resolve(handle);
	return true;
}

function abortQueueWork() {
	queueRunning = false;
	queueJobOutputHandles.clear();
	if (queueJobAbort) {
		queueJobAbort.abort();
	} else if (queueJobOutputResolve && queueJobOutputJobId) {
		resolveWaitingQueueOutput(queueJobOutputJobId, null);
	}
}

function handlePresetSave(cmd: Extract<WorkerCommand, { type: 'preset-save' }>) {
	const preset = cmd.preset;
	const idx = exportPresets.findIndex((p) => p.id === preset.id);
	if (idx !== -1) {
		exportPresets[idx] = { ...preset, builtIn: false };
	} else {
		exportPresets.push({ ...preset, builtIn: false });
	}
	postPresetsState();
	scheduleAutosave();
}

function handlePresetDelete(cmd: Extract<WorkerCommand, { type: 'preset-delete' }>) {
	exportPresets = exportPresets.filter((p) => p.id !== cmd.presetId);
	postPresetsState();
	scheduleAutosave();
}

// ── Phase 24: Queue handlers ──

function handleQueueEnqueue(cmd: Extract<WorkerCommand, { type: 'queue-enqueue' }>) {
	queueState = enqueueJob(queueState, cmd.job);
	postQueueState();
	scheduleAutosave();
}

function handleQueueRemove(cmd: Extract<WorkerCommand, { type: 'queue-remove' }>) {
	queueJobOutputHandles.delete(cmd.jobId);
	queueState = removeJob(queueState, cmd.jobId);
	postQueueState();
	scheduleAutosave();
}

function handleQueueReorder(cmd: Extract<WorkerCommand, { type: 'queue-reorder' }>) {
	queueState = reorderJob(queueState, cmd.jobId, cmd.newIndex);
	postQueueState();
}

function handleQueueCancelJob(cmd: Extract<WorkerCommand, { type: 'queue-cancel-job' }>) {
	queueJobOutputHandles.delete(cmd.jobId);
	if (queueState.activeJobId === cmd.jobId) {
		if (queueJobAbort) {
			queueJobAbort.abort();
		} else if (queueJobOutputResolve) {
			resolveWaitingQueueOutput(cmd.jobId, null);
		}
	} else {
		queueState = markJobCanceled(queueState, cmd.jobId);
		postQueueState();
		scheduleAutosave();
	}
}

function handleQueueCancelAll() {
	queueJobOutputHandles.clear();
	if (queueJobAbort) {
		queueJobAbort.abort();
	} else if (queueJobOutputResolve && queueJobOutputJobId) {
		resolveWaitingQueueOutput(queueJobOutputJobId, null);
	}
	queueState = cancelAllPending(queueState);
	queueRunning = false;
	postQueueState();
	scheduleAutosave();
}

function handleQueueRetry(cmd: Extract<WorkerCommand, { type: 'queue-retry' }>) {
	queueState = retryJob(queueState, cmd.jobId);
	postQueueState();
	scheduleAutosave();
}

function handleQueueJobOutput(cmd: Extract<WorkerCommand, { type: 'queue-job-output' }>) {
	if (resolveWaitingQueueOutput(cmd.jobId, cmd.handle)) return;
	const job = queueState.jobs.find((item) => item.id === cmd.jobId);
	if (job?.status === 'pending') {
		queueJobOutputHandles.set(cmd.jobId, cmd.handle);
	}
}

function handleQueueJobSkip(cmd: Extract<WorkerCommand, { type: 'queue-job-skip' }>) {
	resolveWaitingQueueOutput(cmd.jobId, null);
}

function handleQueueSetStopOnError(
	cmd: Extract<WorkerCommand, { type: 'queue-set-stop-on-error' }>
) {
	queueState = setStopOnError(queueState, cmd.stopOnError);
	postQueueState();
}

async function runQueueJob(job: RenderQueueJob): Promise<void> {
	if (!renderer) {
		queueState = markJobFailed(
			queueState,
			job.id,
			'Export requires WebGPU preview to be available.'
		);
		postQueueState();
		return;
	}

	let handle = queueJobOutputHandles.get(job.id) ?? null;
	queueJobOutputHandles.delete(job.id);

	if (!handle) {
		queueState = markJobChoosingDestination(queueState, job.id);
		postQueueState();
		scheduleAutosave();

		const suggestedName = suggestedFileNameForJob(
			job,
			mergePresetsWithBuiltIns(exportPresets),
			projectDisplayName(),
			queueState.jobs.findIndex((item) => item.id === job.id) + 1
		);
		queueJobOutputJobId = job.id;
		const outputHandlePromise = new Promise<FileSystemFileHandle | null>((resolve) => {
			queueJobOutputResolve = resolve;
		});
		post({ type: 'queue-job-destination', jobId: job.id, suggestedName });
		handle = await outputHandlePromise;
	}

	if (!handle) {
		queueState = markJobCanceled(queueState, job.id);
		post({ type: 'queue-job-canceled', jobId: job.id });
		postQueueState();
		scheduleAutosave();
		return;
	}

	queueState = markJobRunning(queueState, job.id);
	postQueueState();
	scheduleAutosave();

	handlePause();
	const controller = new AbortController();
	queueJobAbort = controller;
	const startTime = performance.now();

	let exportCaptionTextureIds: string[] = [];
	let finalizingSaved = false;
	try {
		const exportTimelineSnapshot = cloneTimelineForExport();
		const exportCaptionTracksSnapshot = cloneCaptionTracksSnapshot(captionTracks);
		const exportCaptionTextureGroupId =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		exportCaptionTextureIds = exportCaptionTracksSnapshot.flatMap((track) =>
			track.visible && track.burnedIn
				? track.segments.map((segment) =>
						exportCaptionTextureId(exportCaptionTextureGroupId, track.id, segment.id)
					)
				: []
		);
		rasterizeExportCaptionTextures(exportCaptionTextureGroupId, exportCaptionTracksSnapshot);

		const videoHandle = firstExportVideoHandle();
		const jobSettings: ExportSettings = {
			...job.settings,
			range: resolveJobRange(job.jobRange)
		};
		const settings = normalizeExportSettings(
			jobSettings,
			videoHandle?.displayWidth ?? 1920,
			videoHandle?.displayHeight ?? 1080,
			videoHandle?.frameRate ?? 30,
			getTimelineDuration(exportTimelineSnapshot)
		);

		await exportTimeline({
			timeline: exportTimelineSnapshot,
			sources: sourceInputs,
			renderer,
			outputHandle: handle,
			settings,
			throughputProbe: currentProbe,
			signal: controller.signal,
			videoTransitions: transitions,
			onProgress: (progress) => {
				if (progress.phase === 'finalizing' && !finalizingSaved) {
					queueState = markJobFinalizing(queueState, job.id);
					finalizingSaved = true;
					postQueueState();
					scheduleAutosave();
				}
				queueState = updateJobProgress(queueState, job.id, progress);
				post({ type: 'queue-job-progress', jobId: job.id, progress });
			},
			masterGain,
			transitions: audioTransitions,
			titleTextureFor: (clip) =>
				clip.title ? (titleCache?.ensure(clip.id, clip.title) ?? null) : null,
			overlayTextureLayersAt: (timelineTime) =>
				activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (trackId, segmentId) =>
					exportCaptionTextureId(exportCaptionTextureGroupId, trackId, segmentId)
				)
					.map((layer) => {
						const texture = titleCache?.get(layer.clipId);
						if (!texture) return null;
						return {
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform: layer.transform
						};
					})
					.filter(
						(
							layer
						): layer is {
							view: GPUTextureView;
							sourceWidth: number;
							sourceHeight: number;
							transform: TransformParams;
						} => layer !== null
					)
		});

		const elapsedSeconds = (performance.now() - startTime) / 1000;
		let outputBytes: number | null = null;
		try {
			outputBytes = (await handle.getFile()).size;
		} catch {
			// Size metadata is best-effort; the export itself has already completed.
			outputBytes = null;
		}
		queueState = markJobCompleted(queueState, job.id, handle.name, elapsedSeconds, outputBytes);
		post({
			type: 'queue-job-complete',
			jobId: job.id,
			fileName: handle.name,
			elapsedSeconds,
			outputBytes
		});
	} catch (error) {
		if (error instanceof ExportCancelledError || controller.signal.aborted) {
			queueState = markJobCanceled(queueState, job.id);
			post({ type: 'queue-job-canceled', jobId: job.id });
		} else {
			const message = error instanceof Error ? error.message : String(error);
			queueState = markJobFailed(queueState, job.id, message);
			post({ type: 'queue-job-failed', jobId: job.id, error: message });
		}
	} finally {
		releaseRetainedOverlayTextures(exportCaptionTextureIds);
		syncTitleRasters();
		queueJobAbort = null;
		queueJobOutputJobId = null;
		pruneUnusedSources();
		ensurePreview();
	}

	postQueueState();
	scheduleAutosave();
}

async function handleQueueStart() {
	if (queueRunning) return;
	if (exportAbort) {
		post({ type: 'error', message: 'Cannot start queue while a single export is running.' });
		return;
	}
	queueRunning = true;

	while (queueRunning) {
		const next = advanceQueue(queueState);
		if (!next) break;
		await runQueueJob(next);
		if (shouldStopQueueAfterJob(queueState, next.id)) break;
	}

	queueRunning = false;
	const summary = queueSummary(queueState);
	post({
		type: 'queue-complete',
		completedCount: summary.completedCount,
		failedCount: summary.failedCount,
		canceledCount: summary.canceledCount
	});
	postQueueState();
	scheduleAutosave();
}

async function handleDispose(): Promise<void> {
	restoreOfferGeneration += 1;
	replaySaveAbort?.abort();
	if (capture) {
		const finished = capture.finished;
		requestCaptureStop();
		await finished.catch(() => undefined);
	}
	await flushPendingAutosave();
	stopAudioPump();
	abortQueueWork();
	teardownMedia();
	titleCache?.destroy();
	titleCache = null;
	renderer?.destroy();
	renderer = null;
	reducedRenderer?.destroy();
	reducedRenderer = null;
	previewBackend = 'none';
	exportBackend = 'none';
	currentCapabilityProbe = null;
	clockView = null;
	audioRing = null;
	post({ type: 'dispose-complete' });
}

async function handleDiagnosticSnapshot(requestId: string): Promise<void> {
	const sources = [...sourceDescriptors.values()].map(assetSnapshotFromDescriptor);
	const webgpuReady = renderer !== null;
	let webgpuStatus: import('../diagnostics/types').WebGpuCapability['status'];
	if (webgpuReady) webgpuStatus = 'ready';
	else if (lastDeviceLost) webgpuStatus = 'lost';
	else if (lastGpuUnavailableReason) webgpuStatus = 'failed';
	else webgpuStatus = 'unavailable';

	const snapshot = await buildWorkerDiagnosticSnapshot({
		appVersion: '0.1.0',
		webgpuReady,
		webgpuStatus,
		webgpuFeatures: lastWebgpuFeatures,
		webgpuLimits: lastWebgpuLimits,
		gpuUnavailableReason: lastGpuUnavailableReason,
		lastDeviceLost,
		rendererSubmissionCount: renderer?.lastFrameSubmissionCount ?? null,
		activeExportSettings: lastExportSettings,
		recentErrors,
		sources
	});
	post({ type: 'diagnostic-snapshot', requestId, snapshot });
}

// ── Phase 46: Replay Buffer + Live Audio Chain ──

function postReplayBufferState(): void {
	post({
		type: 'replay-buffer-state',
		state: { config: replayRing.getConfig(), stats: replayRing.getStats() }
	});
}

function postLiveChainState(): void {
	post({ type: 'live-chain-config', config: cloneLiveChainConfig(liveChainConfig) });
	post({ type: 'live-chain-latency', latencyMs: chainLatencyS(liveChainConfig) * 1000 });
}

/** Applies (or defaults) the persisted Phase 46 configs from a project doc. */
function applyProjectPhase46Config(doc: ProjectDoc): void {
	if (capture) requestCaptureStop();
	replayRing.updateConfig(doc.replayBufferConfig ?? { ...DEFAULT_RING_BUFFER_CONFIG });
	liveChainConfig = cloneLiveChainConfig(doc.liveAudioChainConfig ?? DEFAULT_LIVE_AUDIO_CHAIN_CONFIG);
	postReplayBufferState();
	postLiveChainState();
}

function queueSpillWrite(entries: RingBufferEntry[], range: SpillRange): void {
	replaySpillChain = replaySpillChain.then(async () => {
		try {
			await spillEntries(entries, range);
		} catch (error) {
			// The entries were already spliced out of RAM; without the file they
			// are gone, so say so instead of silently shrinking the buffer.
			replayRing.removeSpilledRange(range.opfsFileName);
			postProjectWarning(
				`Replay buffer spill failed — the oldest ${entries.length} buffered chunks were dropped: ${errorMessage(error)}`
			);
		}
	});
}

function queueSpillDelete(range: SpillRange): void {
	replaySpillChain = replaySpillChain.then(() => deleteSpillFile(range)).catch(() => undefined);
}

function maybeSpillForMemory(): void {
	const stats = replayRing.getStats();
	const maxBytes = replayRing.getConfig().maxMemoryBytes;
	if (stats.memoryBytes <= maxBytes) return;
	// Spill down to ~90% of the budget so each overshoot doesn't trigger a write.
	const result = replayRing.spillOldest(stats.memoryBytes - Math.floor(maxBytes * 0.9));
	if (result) queueSpillWrite(result.entries, result.range);
}

function failCapture(rt: CaptureRuntime, error: unknown): void {
	if (capture !== rt) return; // stale callback from an already-replaced session
	if (!rt.stopping) {
		post({ type: 'capture-error', message: errorMessage(error) });
		recordRecentError({
			code: 'capture.session_failed',
			subsystem: 'worker',
			severity: 'error',
			message: errorMessage(error)
		});
	}
	requestCaptureStop();
}

async function ensureCaptureVideoEncoder(rt: CaptureRuntime, frame: VideoFrame): Promise<VideoEncoder> {
	if (rt.videoEncoder) return rt.videoEncoder;
	const defaults = getDefaultCaptureConfig();
	const width = frame.displayWidth || frame.codedWidth;
	const height = frame.displayHeight || frame.codedHeight;
	const framerate = rt.state.frameRate ?? defaults.framerate;
	const candidates = [...new Set([defaults.videoCodec, ...CAPTURE_VIDEO_CODEC_FALLBACKS])];
	let config: VideoEncoderConfig | null = null;
	for (const codec of candidates) {
		const candidate: VideoEncoderConfig = {
			codec,
			width,
			height,
			bitrate: defaults.videoBitrate,
			framerate,
			latencyMode: 'realtime',
			avc: { format: 'avc' }
		};
		const support = await VideoEncoder.isConfigSupported(candidate);
		if (support.supported) {
			config = candidate;
			break;
		}
	}
	if (!config) {
		throw new Error(`No supported H.264 encoder configuration for ${width}×${height} capture.`);
	}
	const encoder = new VideoEncoder({
		output: (chunk, metadata) => {
			if (capture !== rt) return;
			if (metadata?.decoderConfig) captureVideoDecoderConfig = metadata.decoderConfig;
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			const fallbackDurationUs = 1_000_000 / framerate;
			replayRing.pushVideo(
				chunk.timestamp / 1e6,
				(chunk.duration ?? fallbackDurationUs) / 1e6,
				data,
				chunk.type === 'key'
			);
			maybeSpillForMemory();
		},
		error: (error) => failCapture(rt, error)
	});
	encoder.configure(config);
	rt.videoEncoder = encoder;
	rt.state.resolution = { width, height };
	post({ type: 'capture-session-state', state: { ...rt.state } });
	return encoder;
}

function ensureCaptureAudioEncoder(rt: CaptureRuntime, data: AudioData): AudioEncoder {
	if (rt.audioEncoder) return rt.audioEncoder;
	const defaults = getDefaultCaptureConfig();
	const encoder = new AudioEncoder({
		output: (chunk, metadata) => {
			if (capture !== rt) return;
			if (metadata?.decoderConfig) captureAudioDecoderConfig = metadata.decoderConfig;
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			replayRing.pushAudio(chunk.timestamp / 1e6, (chunk.duration ?? 0) / 1e6, bytes);
			maybeSpillForMemory();
		},
		error: (error) => failCapture(rt, error)
	});
	// AAC bitstream format defaults to 'aac' (raw, with AudioSpecificConfig in
	// decoderConfig.description), which is what the mp4 muxer needs.
	encoder.configure({
		codec: defaults.audioCodec,
		sampleRate: data.sampleRate,
		numberOfChannels: data.numberOfChannels,
		bitrate: defaults.audioBitrate
	});
	rt.audioEncoder = encoder;
	return encoder;
}

/**
 * Extracts capture PCM as per-channel f32 planes. `AudioData.copyTo` is only
 * guaranteed to convert *to* f32-planar by newer engines, and capture sources
 * commonly deliver s16/f32 interleaved — so read in the data's native format
 * and convert with the pure helpers instead of relying on implicit conversion.
 */
function captureAudioToPlanes(data: AudioData): Float32Array[] {
	const frames = data.numberOfFrames;
	const channels = data.numberOfChannels;
	const format = data.format;
	const planarBuffer = (): PcmPlane => {
		switch (format) {
			case 's16-planar': return new Int16Array(frames);
			case 's32-planar': return new Int32Array(frames);
			case 'u8-planar': return new Uint8Array(frames);
			default: return new Float32Array(frames);
		}
	};
	const interleavedBuffer = (): PcmPlane => {
		switch (format) {
			case 's16': return new Int16Array(frames * channels);
			case 's32': return new Int32Array(frames * channels);
			case 'u8': return new Uint8Array(frames * channels);
			default: return new Float32Array(frames * channels);
		}
	};
	switch (format) {
		case 'f32-planar':
		case 's16-planar':
		case 's32-planar':
		case 'u8-planar': {
			const planes: Float32Array[] = [];
			for (let c = 0; c < channels; c++) {
				const raw = planarBuffer();
				data.copyTo(raw, { planeIndex: c, format });
				planes.push(pcmPlaneToF32(raw));
			}
			return planes;
		}
		case 'f32':
		case 's16':
		case 's32':
		case 'u8': {
			const raw = interleavedBuffer();
			data.copyTo(raw, { planeIndex: 0, format });
			return interleavedPcmToF32Planes(raw, channels, frames);
		}
		default:
			throw new Error(`Unsupported AudioData format: ${String(format)}`);
	}
}

/**
 * Print-to-recording path: runs gate → compressor → limiter on capture PCM in
 * this worker before encoding, so the recorded chain never depends on the
 * monitor AudioContext running (it can be suspended by autoplay policy or
 * background throttling without starving the encoder).
 */
function applyChainToAudioData(rt: CaptureRuntime, data: AudioData): AudioData | null {
	try {
		const frames = data.numberOfFrames;
		const channels = data.numberOfChannels;
		if (!rt.chain || rt.chain.sampleRate !== data.sampleRate) {
			rt.chain = createLiveChainProcessor(cloneLiveChainConfig(liveChainConfig), data.sampleRate);
		}
		const processed = rt.chain.process(captureAudioToPlanes(data));
		const planar = new Float32Array(frames * channels);
		processed.forEach((plane, c) => planar.set(plane, c * frames));
		return new AudioData({
			format: 'f32-planar',
			sampleRate: data.sampleRate,
			numberOfFrames: frames,
			numberOfChannels: channels,
			timestamp: data.timestamp,
			data: planar
		});
	} catch (error) {
		if (!rt.chainErrorPosted) {
			rt.chainErrorPosted = true;
			post({
				type: 'live-chain-error',
				message: `Live chain processing failed — recording raw audio: ${errorMessage(error)}`
			});
		}
		return null;
	}
}

async function pumpCaptureVideo(rt: CaptureRuntime): Promise<void> {
	if (!rt.videoReader) return;
	const defaults = getDefaultCaptureConfig();
	const keyIntervalFrames = Math.max(
		1,
		Math.round((rt.state.frameRate ?? defaults.framerate) * CAPTURE_KEYFRAME_INTERVAL_S)
	);
	for (;;) {
		const { done, value: frame } = await rt.videoReader.read();
		if (done || rt.stopping) {
			frame?.close();
			break;
		}
		try {
			const encoder = await ensureCaptureVideoEncoder(rt, frame);
			if (encoder.encodeQueueSize > CAPTURE_MAX_VIDEO_QUEUE) {
				// Live sources can't be stalled; shed load at the input instead of
				// queueing unboundedly. Cadence counts encoded frames, so drops
				// don't perturb the GOP structure.
				replayRing.noteDroppedFrame();
				frame.close();
				continue;
			}
			encoder.encode(frame, { keyFrame: rt.videoFramesSinceKey === 0 });
			rt.videoFramesSinceKey = (rt.videoFramesSinceKey + 1) % keyIntervalFrames;
			frame.close();
		} catch (error) {
			frame.close();
			failCapture(rt, error);
			break;
		}
	}
	// The video stream ending on its own (browser "Stop sharing") ends the
	// session even if the audio track keeps producing; otherwise the audio pump
	// would hold the session open forever.
	if (capture === rt && !rt.stopping) {
		rt.stopping = true;
		void rt.audioReader?.cancel().catch(() => undefined);
	}
}

async function pumpCaptureAudio(rt: CaptureRuntime): Promise<void> {
	if (!rt.audioReader) return;
	for (;;) {
		const { done, value } = await rt.audioReader.read();
		if (done || rt.stopping) {
			value?.close();
			break;
		}
		let input = value;
		try {
			const encoder = ensureCaptureAudioEncoder(rt, input);
			if (encoder.encodeQueueSize > CAPTURE_MAX_AUDIO_QUEUE) {
				input.close();
				continue;
			}
			if (liveChainConfig.printToRecording && anyInsertActive(liveChainConfig)) {
				const processed = applyChainToAudioData(rt, input);
				if (processed) {
					input.close();
					input = processed;
				}
			}
			encoder.encode(input);
			input.close();
		} catch (error) {
			input.close();
			failCapture(rt, error);
			break;
		}
	}
	// For an audio-only session the audio stream is the session's lifetime,
	// mirroring the video pump's end-of-stream handling below.
	if (capture === rt && !rt.stopping && !rt.videoReader) {
		rt.stopping = true;
	}
}

function handleCaptureTransferStreams(
	videoStream: ReadableStream<VideoFrame> | undefined,
	audioStream: ReadableStream<AudioData> | undefined,
	settings: CaptureStreamSettings | undefined
): void {
	if (capture) {
		post({ type: 'capture-error', message: 'A capture session is already active.' });
		void videoStream?.cancel().catch(() => undefined);
		void audioStream?.cancel().catch(() => undefined);
		return;
	}
	if (!videoStream && !audioStream) {
		post({ type: 'capture-error', message: 'The captured stream has no video or audio tracks.' });
		return;
	}
	// A new session owns the buffer: discard the previous session's chunks and
	// any spill files left behind (also covers files orphaned by a crash).
	replayRing.reset();
	replaySpillChain = replaySpillChain.then(() => cleanupSpills()).catch(() => undefined);
	captureVideoDecoderConfig = null;
	captureAudioDecoderConfig = null;

	const defaults = getDefaultCaptureConfig();
	const hasVideo = videoStream != null;
	const rt: CaptureRuntime = {
		state: {
			active: true,
			sourceLabel: settings?.sourceLabel ?? 'Screen Capture',
			source: settings?.source ?? 'display',
			hasVideo,
			hasAudio: audioStream != null,
			resolution: hasVideo
				? {
						width: settings?.width ?? defaults.width,
						height: settings?.height ?? defaults.height
					}
				: null,
			frameRate: hasVideo ? (settings?.frameRate ?? defaults.framerate) : null,
			elapsedS: 0
		},
		videoReader: videoStream?.getReader() ?? null,
		audioReader: audioStream?.getReader() ?? null,
		videoEncoder: null,
		audioEncoder: null,
		chain: null,
		chainErrorPosted: false,
		startedAtMs: performance.now(),
		statsTimer: null,
		videoFramesSinceKey: 0,
		stopping: false,
		finished: Promise.resolve()
	};
	capture = rt;

	rt.statsTimer = setInterval(() => {
		if (capture !== rt) return;
		rt.state.elapsedS = (performance.now() - rt.startedAtMs) / 1000;
		post({ type: 'capture-session-state', state: { ...rt.state } });
		postReplayBufferState();
		// Spill files older than the duration window are unreachable by any save.
		const stats = replayRing.getStats();
		if (stats.newestTimestamp !== null) {
			const cutoff = stats.newestTimestamp - replayRing.getConfig().maxDurationS;
			for (const range of replayRing.evictSpilledBefore(cutoff)) {
				queueSpillDelete(range);
			}
		}
	}, CAPTURE_STATS_INTERVAL_MS);

	const pumps = [pumpCaptureVideo(rt), pumpCaptureAudio(rt)];
	rt.finished = (async () => {
		await Promise.allSettled(pumps);
		// Flush so frames buffered inside the encoders land in the ring; the
		// output callbacks still run because `capture === rt` until the end.
		if (rt.statsTimer) clearInterval(rt.statsTimer);
		try {
			if (rt.videoEncoder && rt.videoEncoder.state === 'configured') await rt.videoEncoder.flush();
		} catch { /* flush after an encoder error is expected to fail */ }
		try {
			if (rt.audioEncoder && rt.audioEncoder.state === 'configured') await rt.audioEncoder.flush();
		} catch { /* ditto */ }
		try { if (rt.videoEncoder && rt.videoEncoder.state !== 'closed') rt.videoEncoder.close(); } catch { /* already closed */ }
		try { if (rt.audioEncoder && rt.audioEncoder.state !== 'closed') rt.audioEncoder.close(); } catch { /* already closed */ }
		rt.state.active = false;
		rt.state.elapsedS = (performance.now() - rt.startedAtMs) / 1000;
		capture = null;
		post({ type: 'capture-session-state', state: { ...rt.state } });
		postReplayBufferState();
	})();

	post({ type: 'capture-session-state', state: { ...rt.state } });
	postReplayBufferState();
}

/**
 * Signals the pumps to exit; finalization (encoder flush/close + final state
 * posts) runs in the session's `finished` chain. Idempotent, and also called
 * when a pump fails or the captured track ends on its own.
 */
function requestCaptureStop(): void {
	const rt = capture;
	if (!rt) {
		// Nothing running — still answer so the UI can settle.
		post({
			type: 'capture-session-state',
			state: {
				active: false,
				sourceLabel: '',
				source: 'display',
				hasVideo: false,
				hasAudio: false,
				resolution: null,
				frameRate: null,
				elapsedS: 0
			}
		});
		return;
	}
	if (rt.stopping) return;
	rt.stopping = true;
	void rt.videoReader?.cancel().catch(() => undefined);
	void rt.audioReader?.cancel().catch(() => undefined);
}

function mergeLiveChainConfig(
	current: LiveAudioChainConfig,
	partial: Partial<LiveAudioChainConfig>
): LiveAudioChainConfig {
	return {
		gate: partial.gate ? { ...partial.gate } : { ...current.gate },
		compressor: partial.compressor ? { ...partial.compressor } : { ...current.compressor },
		limiter: partial.limiter ? { ...partial.limiter } : { ...current.limiter },
		denoiserBypass: partial.denoiserBypass ?? current.denoiserBypass,
		printToRecording: partial.printToRecording ?? current.printToRecording
	};
}

async function handleReplaySaveLastN(nSeconds?: number): Promise<void> {
	if (replaySaveAbort) {
		post({ type: 'replay-save-error', message: 'A replay save is already in progress.' });
		return;
	}
	const abort = new AbortController();
	replaySaveAbort = abort;
	let saveFileName: string | null = null;
	try {
		const windowS = nSeconds ?? replayRing.getConfig().saveDurationS;
		const stats = replayRing.getStats();
		if (stats.newestTimestamp === null) {
			throw new Error('Nothing has been captured yet.');
		}
		const endTimestamp = stats.newestTimestamp;
		const rawStart = endTimestamp - windowS;

		// Snapshot RAM now: chunks that arrive after this point stay in the ring
		// and belong to the next save, not this one (R8.4 snapshot semantics).
		const ramEntries = replayRing.getSnapshot(rawStart, endTimestamp).entries;
		// Spill files are written asynchronously; wait for in-flight writes, then
		// read back the ranges that overlap the window.
		await replaySpillChain;
		const overlapping = replayRing
			.getSpilledRanges()
			.filter((r) => r.endTimestamp > rawStart && r.startTimestamp <= endTimestamp);
		const spilled: RingBufferEntry[] = [];
		for (const range of overlapping) {
			spilled.push(...(await readSpillRange(range)));
		}
		const combined = [...spilled, ...ramEntries].sort((a, b) => a.timestamp - b.timestamp);
		const entries = assembleSaveEntries(combined, rawStart, endTimestamp);
		if (entries.length === 0) {
			throw new Error('No saveable media in the requested range.');
		}
		const hasVideoEntries = entries.some((e) => e.type === 'video');
		const hasAudioEntries = entries.some((e) => e.type === 'audio');
		if (hasVideoEntries && !captureVideoDecoderConfig) {
			throw new Error('Video decoder configuration is unavailable for the buffered media.');
		}
		if (hasAudioEntries && !captureAudioDecoderConfig) {
			// Failing loudly beats silently saving a clip without its audio track.
			throw new Error('Audio decoder configuration is unavailable for the buffered media.');
		}

		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		saveFileName = `replay-${stamp}.mp4`;
		const fileHandle = await createReplaySaveFile(saveFileName);
		const writable = await fileHandle.createWritable();
		const output = new Output({
			format: new Mp4OutputFormat({ fastStart: false }),
			target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, {
				chunked: true
			})
		});
		const videoSource = hasVideoEntries ? new EncodedVideoPacketSource('avc') : null;
		if (videoSource) {
			const frameRate = capture?.state.frameRate;
			output.addVideoTrack(videoSource, frameRate ? { frameRate } : undefined);
		}
		const audioSource = hasAudioEntries ? new EncodedAudioPacketSource('aac') : null;
		if (audioSource) output.addAudioTrack(audioSource);
		await output.start();

		const base = entries[0].timestamp;
		let written = 0;
		let firstVideo = true;
		let firstAudio = true;
		let canceled = false;
		for (const entry of entries) {
			if (abort.signal.aborted) {
				canceled = true;
				break;
			}
			const packet = new EncodedPacket(
				entry.data,
				entry.isKeyframe ? 'key' : 'delta',
				Math.max(0, entry.timestamp - base),
				entry.duration
			);
			if (entry.type === 'video' && videoSource) {
				await videoSource.add(
					packet,
					firstVideo ? { decoderConfig: captureVideoDecoderConfig ?? undefined } : undefined
				);
				firstVideo = false;
			} else if (entry.type === 'audio' && audioSource) {
				await audioSource.add(
					packet,
					firstAudio ? { decoderConfig: captureAudioDecoderConfig ?? undefined } : undefined
				);
				firstAudio = false;
			}
			written++;
			if (written % REPLAY_SAVE_PROGRESS_EVERY === 0 || written === entries.length) {
				post({ type: 'replay-save-progress', chunksWritten: written, totalChunks: entries.length });
			}
		}
		if (canceled) {
			await output.cancel();
			await deleteReplaySaveFile(saveFileName).catch(() => undefined);
			post({ type: 'replay-save-canceled' });
			return;
		}
		videoSource?.close();
		audioSource?.close();
		await output.finalize();

		// Register the finalized file as a regular media source and append it to
		// the timeline through the undoable mutation path (T4.5).
		const file = await fileHandle.getFile();
		const sourceId = makeSourceId();
		const handle = await openMediaFile(file, sourceId);
		sourceInputs.set(sourceId, handle);
		const descriptor = sourceDescriptorFromHandle(sourceId, file, handle);
		sourceDescriptors.set(sourceId, descriptor);
		binSourceIds.add(sourceId);
		await persistSourceBestEffort({ sourceId, descriptor, file });
		if (!primaryHandle && handle.frameSource) {
			primaryHandle = handle;
		}
		const placedHandle = handle;
		const placed = commitTimelineMutation(
			() => placeAsset(timeline, placedHandle, undefined, undefined),
			{ prune: false }
		);
		if (placed) void computeWaveformsForSource(placedHandle);
		postMediaAssets();
		postSourceHealth(descriptor.health);
		post({ type: 'replay-save-complete', sourceId, fileName: file.name });
	} catch (error) {
		if (saveFileName) {
			await deleteReplaySaveFile(saveFileName).catch(() => undefined);
		}
		const message = errorMessage(error);
		recordRecentError({
			code: 'replay.save_failed',
			subsystem: 'worker',
			severity: 'error',
			message
		});
		post({ type: 'replay-save-error', message });
	} finally {
		replaySaveAbort = null;
	}
}

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
	const cmd = event.data;
	switch (cmd.type) {
		case 'init':
			void handleInit(
				cmd.canvas,
				cmd.sab,
				cmd.audioSab,
				cmd.scopeSab,
				'probeResult' in cmd ? cmd.probeResult : undefined
			);
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
		case 'export-probe':
			void handleExportProbe();
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
				const message = errorMessage(error);
				recordRecentError({
					code: 'project.restore_failed',
					subsystem: 'worker',
					severity: 'error',
					message,
					recoveryActionIds: ['reload-app']
				});
				post({
					type: 'restore-result',
					projectId,
					restored: false,
					savedAt: null,
					metadata: null,
					unresolvedSources: unresolvedSourceDescriptors(),
					message: `Restore failed: ${message}`
				});
			});
			break;
		case 'new-project':
			void handleNewProject().catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'project.new_failed',
					subsystem: 'worker',
					severity: 'error',
					message
				});
				postProjectWarning(`Could not start new project: ${message}`);
			});
			break;
		case 'relink-source':
			void handleRelinkSource(cmd).catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'source.relink_failed',
					subsystem: 'import',
					severity: 'error',
					message,
					recoveryActionIds: ['relink-source']
				});
				post({
					type: 'relink-result',
					sourceId: cmd.sourceId,
					ok: false,
					descriptor: sourceDescriptors.get(cmd.sourceId) ?? null,
					metadata: activeMetadata(),
					unresolvedSources: unresolvedSourceDescriptors(),
					message: `Re-link failed: ${message}`
				});
			});
			break;
		case 'import-captions':
			void handleImportCaptions(cmd).catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'caption.import_failed',
					subsystem: 'import',
					severity: 'error',
					message
				});
				postProjectWarning(`Caption import failed: ${message}`);
			});
			break;
		case 'export-captions':
			handleExportCaptions(cmd);
			break;
		case 'split':
			handleSplit(cmd);
			break;
		case 'delete-clip':
			handleDelete(cmd);
			break;
		case 'delete-clips':
			handleDeleteBatch(cmd);
			break;
		case 'move-clip':
			handleMove(cmd);
			break;
		case 'move-clips':
			handleMoveBatch(cmd);
			break;
		case 'duplicate-clip':
			handleDuplicate(cmd);
			break;
		case 'paste-clips':
			handlePaste(cmd);
			break;
		case 'cache-clipboard-luts':
			handleCacheClipboardLuts(cmd);
			break;
		case 'add-marker':
			handleAddMarker(cmd);
			break;
		case 'delete-marker':
			handleDeleteMarker(cmd);
			break;
		case 'close-gaps':
			handleCloseGaps(cmd);
			break;
		case 'trim-clip':
			handleTrim(cmd);
			break;
		case 'set-effect-param':
			handleSetEffectParam(cmd);
			break;
		case 'set-transform':
			handleSetTransform(cmd);
			break;
		case 'set-keyframe':
			handleSetKeyframe(cmd);
			break;
		case 'set-keyframes':
			handleSetKeyframes(cmd);
			break;
		case 'delete-keyframe':
			handleDeleteKeyframe(cmd);
			break;
		case 'import-lut':
			void handleImportLut(cmd);
			break;
		case 'set-lut-strength':
			handleSetLutStrength(cmd);
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
		case 'set-track-pan':
			handleSetTrackPan(cmd);
			break;
		case 'set-master-gain':
			handleSetMasterGain(cmd);
			break;
		case 'set-clip-fade':
			handleSetClipFade(cmd);
			break;
		case 'add-transition':
			handleAddTransition(cmd);
			break;
		case 'remove-transition':
			handleRemoveTransition(cmd);
			break;
		case 'set-transition':
			handleSetTransition(cmd);
			break;
		case 'place-clip':
			handlePlaceClip(cmd);
			break;
		case 'set-still-duration':
			handleSetStillDuration(cmd);
			break;
		case 'add-title':
			handleAddTitle(cmd);
			break;
		case 'set-title':
			handleSetTitle(cmd);
			break;
		case 'add-track':
			handleAddTrack(cmd);
			break;
		case 'remove-track':
			handleRemoveTrack(cmd);
			break;
		case 'reorder-track':
			handleReorderTrack(cmd);
			break;
		case 'remove-asset':
			handleRemoveAsset(cmd);
			break;
		case 'request-thumbnails':
			handleRequestThumbnails(cmd);
			break;
		case 'export-project-bundle':
			void runExportProjectBundle(bundleWorkerContext, cmd.jobId, cmd.policy, cmd.outputDir).catch(
				(error) => {
					const message = errorMessage(error);
					recordRecentError({
						code: 'bundle.export_failed',
						subsystem: 'export',
						severity: 'error',
						message,
						affectedJobId: cmd.jobId,
						recoveryActionIds: ['export-project-bundle']
					});
					post({ type: 'error', message: `Export bundle failed: ${message}` });
				}
			);
			break;
		case 'import-project-bundle':
			void runImportProjectBundle(
				bundleWorkerContext,
				cmd.jobId,
				cmd.bundleDir,
				cmd.replaceConfirmed
			).catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'bundle.import_failed',
					subsystem: 'import',
					severity: 'error',
					message,
					affectedJobId: cmd.jobId,
					recoveryActionIds: ['retry-import']
				});
				post({
					type: 'bundle-import-result',
					jobId: cmd.jobId,
					ok: false,
					reason: message
				});
			});
			break;
		case 'collect-project-media':
			void runCollectProjectMedia(
				bundleWorkerContext,
				cmd.jobId,
				cmd.relocate,
				cmd.outputDir
			).catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'bundle.collect_failed',
					subsystem: 'storage',
					severity: 'error',
					message,
					affectedJobId: cmd.jobId,
					recoveryActionIds: ['open-storage-cleanup']
				});
				post({ type: 'error', message: `Collect media failed: ${message}` });
			});
			break;
		case 'cancel-bundle-job':
			cancelBundleJob(cmd.jobId);
			break;
		case 'bundle-replace-decision':
			resolveBundleReplaceDecision(cmd.jobId, cmd.action);
			break;
		case 'export-interchange':
			handleExportInterchange(cmd);
			break;
		case 'insert-edit':
			handleInsertEdit(cmd);
			break;
		case 'overwrite-edit':
			handleOverwriteEdit(cmd);
			break;
		case 'ripple-delete':
			handleRippleDelete(cmd);
			break;
		case 'ripple-trim':
			handleRippleTrim(cmd);
			break;
		case 'roll-trim':
			handleRollTrim(cmd);
			break;
		case 'slip-edit':
			handleSlipEdit(cmd);
			break;
		case 'slide-edit':
			handleSlideEdit(cmd);
			break;
		case 'lift-region':
			handleLiftRegion(cmd);
			break;
		case 'extract-region':
			handleExtractRegion(cmd);
			break;
		case 'link-clips':
			handleLinkClips(cmd);
			break;
		case 'unlink-clips':
			handleUnlinkClips(cmd);
			break;
		case 'set-track-lock':
			handleSetTrackLock(cmd);
			break;
		case 'set-track-visible':
			handleSetTrackVisible(cmd);
			break;
		case 'set-track-sync-lock':
			handleSetTrackSyncLock(cmd);
			break;
		case 'set-track-edit-target':
			handleSetTrackEditTarget(cmd);
			break;
		case 'toggle-scopes': {
			renderer?.setScopesEnabled(cmd.enabled);
			break;
		}
		case 'toggle-zebra': {
			renderer?.setZebraEnabled(cmd.enabled);
			break;
		}
		case 'set-caption-track':
			handleSetCaptionTrack(cmd);
			break;
		case 'set-caption-segment-text':
			handleSetCaptionSegmentText(cmd);
			break;
		case 'set-caption-segment-timing':
			handleSetCaptionSegmentTiming(cmd);
			break;
		case 'set-caption-segment-style':
			handleSetCaptionSegmentStyle(cmd);
			break;
		case 'split-caption-segment':
			handleSplitCaptionSegment(cmd);
			break;
		case 'merge-caption-segments':
			handleMergeCaptionSegments(cmd);
			break;
		case 'delete-caption-segments':
			handleDeleteCaptionSegments(cmd);
			break;
		case 'snap-caption-segment':
			handleSnapCaptionSegment(cmd);
			break;
		case 'preset-save':
			handlePresetSave(cmd);
			break;
		case 'preset-delete':
			handlePresetDelete(cmd);
			break;
		case 'queue-enqueue':
			handleQueueEnqueue(cmd);
			break;
		case 'queue-remove':
			handleQueueRemove(cmd);
			break;
		case 'queue-reorder':
			handleQueueReorder(cmd);
			break;
		case 'queue-start':
			void handleQueueStart();
			break;
		case 'queue-cancel-job':
			handleQueueCancelJob(cmd);
			break;
		case 'queue-cancel-all':
			handleQueueCancelAll();
			break;
		case 'queue-retry':
			handleQueueRetry(cmd);
			break;
		case 'queue-job-output':
			handleQueueJobOutput(cmd);
			break;
		case 'queue-job-skip':
			handleQueueJobSkip(cmd);
			break;
		case 'queue-set-stop-on-error':
			handleQueueSetStopOnError(cmd);
			break;
		case 'request-diagnostic-snapshot':
			void handleDiagnosticSnapshot(cmd.requestId).catch((error) => {
				const message = errorMessage(error);
				recordRecentError({
					code: 'diagnostic.snapshot_failed',
					subsystem: 'worker',
					severity: 'error',
					message
				});
				post({ type: 'error', message: `Diagnostics failed: ${message}` });
			});
			break;
		case 'run-recovery-action':
			post({
				type: 'recovery-state',
				state: 'idle',
				actions: [
					{
						actionId: cmd.actionId,
						kind: cmd.actionId === 'reload-app' ? 'reload-app' : 'export-project-bundle',
						label: cmd.actionId === 'reload-app' ? 'Reload app' : 'Export project bundle',
						description:
							'Recovery actions are surfaced by diagnostics; UI-owned actions run on the main thread.',
						enabled: false,
						destructive: false,
						requiresUserGesture: true,
						reasonDisabled:
							'This recovery action is handled by the UI in this implementation slice.',
						relatedErrorIds: []
					}
				]
			});
			break;
		// Phase 46: Replay Buffer + Live Audio Chain
		case 'capture-stop':
			requestCaptureStop();
			break;
		case 'capture-transfer-streams':
			handleCaptureTransferStreams(cmd.videoStream, cmd.audioStream, cmd.settings);
			break;
		case 'replay-save-last-n':
			void handleReplaySaveLastN(cmd.nSeconds);
			break;
		case 'replay-save-cancel':
			replaySaveAbort?.abort();
			break;
		case 'update-replay-buffer-config':
			replayRing.updateConfig(cmd.config);
			scheduleAutosave();
			postReplayBufferState();
			break;
		case 'update-live-chain-config':
			liveChainConfig = mergeLiveChainConfig(liveChainConfig, cmd.config);
			capture?.chain?.setConfig(cloneLiveChainConfig(liveChainConfig));
			scheduleAutosave();
			postLiveChainState();
			break;
		case 'set-print-to-recording':
			liveChainConfig = { ...liveChainConfig, printToRecording: cmd.enabled };
			scheduleAutosave();
			postLiveChainState();
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
