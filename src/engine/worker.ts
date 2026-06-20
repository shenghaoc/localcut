/// <reference lib="webworker" />
import {
	assertCrossOriginIsolated,
	type CapabilityProbeResult,
	type CaptionPresetIdSnapshot,
	type CaptionTrackSnapshot,
	type CoverFrameDoc,
	ClockIndex,
	TIMELINE_EPSILON,
	type ExportPresetDoc,
	type ExportSettings,
	type InterpolationWorkerCommand,
	type MediaAssetSnapshot,
	type ProjectAspect,
	type ProjectFormat,
	type TimeRange,
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
	type TimeRemapSnapshot,
	type ExportBackend,
	type PreviewBackend,
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
	DEFAULT_RING_BUFFER_CONFIG,
	DEFAULT_VOICE_CLEANUP_SETTINGS,
	type SceneDefinition,
	type SceneDoc,
	type CaptureSessionState,
	type CaptureStreamSettings,
	type LiveAudioChainConfig,
	type SpillRange,
	type VoiceCleanupSettings
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
import {
	createRingBuffer,
	type RingBuffer,
	type RingBufferEntry
} from './replay-buffer/ring-buffer';
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
import {
	activeCaptionPayloadsAt,
	enumerateCaptionRasterTargets,
	type CaptionTextureIdMaker
} from './captions/render';
import { CAPTION_ANIM_IDENTITY } from './captions/animation-curves';
import type { CaptionAnimUniforms } from './captions/animation-curves';
import type { CaptionAnimStylePreset } from './captions/anim-style';
import { resolveAnimPreset, validateCaptionAnimPreset } from './captions/anim-style';
import {
	buildCaptionSnapTargets,
	deleteCaptionTrack,
	deleteCaptionTracks,
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
	type CaptionStyle,
	type CaptionTrack
} from './captions/types';
import { createAsrCaptionTrack } from './asr/caption-track';
import { createTranslatedCaptionTrack } from './language-tools/caption-track';
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
	resolveLayoutAt,
	sharedSourceIncomingLayers,
	setClipDuration,
	setTransition,
	splitClipAt,
	trimClip,
	setClipEffectParam,
	setClipKeyframe,
	setClipKeyframes,
	replaceClipKeyframeTracks,
	deleteClipKeyframe,
	setClipTransform,
	setClipLut,
	setClipLutStrength,
	setClipMatteEnabled,
	setClipMatteStrength,
	setClipMatteMode,
	setClipMatteBlurRadius,
	setTrackGain,
	setTrackMute,
	setTrackSolo,
	setTrackPan,
	setClipAudioFade,
	setClipCleanedAudio,
	setTitleContent,
	setCalloutPayload,
	setPaddedBackground,
	defaultTimelineClip,
	defaultTitleClip,
	defaultCalloutClip,
	isTitleClip,
	isCalloutClip,
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
	setSkinMask,
	setBeautyEffect,
	defaultClipTransform,
	DEFAULT_MASTER_GAIN,
	DEFAULT_TRACK_MIX,
	DEFAULT_TITLE_DURATION_S,
	maxTransitionDurationS,
	type Timeline,
	type TimelineClip,
	type TimelineMarker,
	type TimelineTrack,
	type TimelineTransition,
	type ClipboardTimelineClip,
	type ClipEffectParams,
	type MoveClipTarget,
	type TransformParams
} from './timeline';
import { applyProgramLayoutToResolvedLayers } from './program-layout-resolve';
import { normalizeTransform } from './transform';
import type { SourceVideoTrackInspection } from './media-adapters/types';
import { sampleClipParamsAt } from './keyframes';
import { clipLutFromCubeFile, cloneClipLut, lutSnapshot, type ClipLut } from './lut';
import { normalizeSkinMask } from './skin-smooth';
import { accumulateMix, applyMixStageInPlace, type AudioTransitionCut } from './audio-mix';
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
import {
	openMediaFile,
	STILL_DEFAULT_DURATION_S,
	STILL_MAX_DURATION_S,
	type MediaInputHandle
} from './media-io';
import { healthReportForHandle } from './media-adapters/mediabunny-adapter';
import { BlockedImportError } from './media-adapters/types';
import {
	SilenceStreamDetector,
	intersectSilenceRegions,
	type SilenceRegion as SilenceRegionT
} from './silence-detector';
import {
	resolveSourceTimestamp,
	resolveNormalizedSourceTimestamp,
	audioAvailabilityWindowFrames,
	type SourceTimestampResolution
} from './media-adapters/source-timing';
import { buildRemapLUT, remapOutputToSource, sampleRemapSpeed, type RemapLUT } from './time-remap';
import { WsolaStretcher, WSOLA_SEARCH_RADIUS_SAMPLES, WSOLA_WINDOW_SAMPLES } from './wsola';
import { sourceHealthReportFromError } from './media-adapters/source-health';
import { cleanedAudioMissing, cleanedAudioSubstitute } from './audio-cleanup/cleaned-audio';
import { ThumbnailGenerator } from './thumbnails';
import {
	gpuDeviceLimits,
	initCompatibilityGpu,
	initGpu,
	type CompositeLayer,
	type PreviewRenderer
} from './gpu';
import { colorMetadataFromHints, type ColorMetadata } from './colour';
import { createCanvasTitleUploader, loadTitleFonts, TitleTextureCache } from './titles';
import type { TitleContent } from './title';
import { CalloutTextureCache } from './callout-textures';
import {
	AdaptiveResolution,
	buildPreviewLadder,
	PlaybackController,
	type DecodedFrame,
	type DecodedLayer
} from './playback';
import { probeEncodeThroughput } from './hardware-probe';
import { FrameCache, makeFrameCacheKey } from './frame-cache';
import { MatteOnnxEngine } from './matte/matte-onnx-engine';
import type { MatteBackendEngine } from './matte/matte-backend';
import {
	DEFAULT_INTERPOLATION_MANIFEST_URL,
	InterpolationEngine
} from './interpolation/interpolation-engine';
import { deriveInterpolationAvailability } from './interpolation/interpolation-availability';
import {
	estimateSynthesisMs,
	type CalibrationProfile
} from './interpolation/interpolation-estimate';
import { planTiles, type ModelIoContract, type VramBudget } from './interpolation/tiling';
import { BeautyEngine } from './beauty/beauty-engine';
import {
	InterpolationManifestError,
	toModelIoContract,
	validateInterpolationManifest
} from './interpolation/interpolation-model';
import { SecondaryFrameSourcePool, type VideoFrameProvider } from './frame-source';
import {
	ExportCancelledError,
	defaultExportSettings,
	exportTimeline,
	layerBudgetFromProbe,
	normalizeExportSettings,
	probeExportCodecs,
	videoBitrateForPreset
} from './export';
import { exportTimelineReduced } from './compatibility/compat-export';
import { exportConstraintsForProbe } from './capability-probe-v2';
import { createPublishFrameTap, type PublishFrameTap } from './publish-frame-tap';
import type { EncoderConsumer, EncoderLease } from './encoder-budget';
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
	aspectOutputSize,
	cloneMarkersSnapshot,
	cloneCaptionTracksSnapshot,
	cloneTimelineSnapshot,
	cloneTransitionsSnapshot,
	cloneVoiceCleanupSettings,
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
import { CaptureSession } from './capture/capture-session';
import { allocateCaptureEventRing } from './capture/event-ring';
import { computeGapCollapsedUs, seamMarkerPositionsUs } from './capture/pause-resume';
import { DEFAULT_WEBCAM_PRESET, deriveWebcamTransform } from './capture/webcam-preset';
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
let rendererDeviceLossGeneration = 0;
let rendererAdoptionInFlight: Promise<void> | null = null;
let currentScopeSab: SharedArrayBuffer | null = null;
let currentScopesEnabled = false;
let currentZebraEnabled = false;
/** Phase 14 title raster cache; created once the GPU device is ready. */
let titleCache: TitleTextureCache | null = null;
/** Phase 43 callout raster cache; shares the renderer GPU device with titles. */
let calloutCache: CalloutTextureCache | null = null;
/** Phase 31 matte engine — per-frame zero-copy ORT inference, created lazily on
 *  the first matted frame. The engine notifies the worker to adopt ORT's device
 *  before its matte views are composited. */
let matteEngine: MatteBackendEngine | null = null;
/** One-shot guard for unexpected matte backend/device contract failures. */
let matteCompositingUnavailableWarned = false;

function ensureMatteEngine(): MatteBackendEngine | null {
	if (!renderer) return null;
	if (!matteEngine) {
		matteEngine = new MatteOnnxEngine({
			onStatus: (status) => post({ type: 'matte-status', status }),
			onDeviceReady: (device) => adoptOrtDevice(device, 'matte-onnx')
		});
	}
	return matteEngine;
}

/** Phase 37 frame-interpolation engine — zero-copy ORT-WebGPU synthesis on
 *  the renderer's device; created lazily on the first interpolation action. */
let interpolationEngine: InterpolationEngine | null = null;

function ensureInterpolationEngine(): InterpolationEngine | null {
	if (!renderer) return null;
	if (!interpolationEngine) {
		// ORT owns its WebGPU device (microsoft/onnxruntime#26107); the engine runs on
		// ORT's device and notifies the worker to adopt the renderer before use.
		interpolationEngine = new InterpolationEngine({
			onDeviceReady: (device) => adoptOrtDevice(device, 'interpolation'),
			onStatus: (status, error) => {
				const manifest = interpolationEngine?.getModelManifest();
				post({
					type: 'interp-model-status',
					status,
					accelerator: interpolationEngine?.getExecutionProvider() === 'webnn' ? 'webnn' : 'webgpu',
					...(manifest ? { sizeBytes: manifest.model.sizeBytes } : {}),
					...(error ? { error } : {})
				});
			}
		});
	}
	return interpolationEngine;
}

/** Phase 32b landmark-driven beauty engine — zero-copy ORT-WebGPU face/landmark
 *  inference on the renderer's device; created lazily on the first load action. */
let beautyEngine: BeautyEngine | null = null;

function ensureBeautyEngine(): BeautyEngine | null {
	if (!renderer) return null;
	if (!beautyEngine) {
		// ORT owns its WebGPU device (microsoft/onnxruntime#26107); the engine runs on
		// ORT's device and notifies the worker to adopt the renderer before use.
		beautyEngine = new BeautyEngine({
			onDeviceReady: (device) => adoptOrtDevice(device, 'beauty'),
			onStatus: (status, error) => {
				const manifest = beautyEngine?.getModelManifest();
				const ep = beautyEngine?.getExecutionProvider();
				post({
					type: 'beauty-model-status',
					status,
					...(ep ? { executionProvider: ep } : {}),
					...(manifest ? { sizeBytes: manifest.sizeBytes } : {}),
					...(error ? { error } : {})
				});
			},
			onProgress: ({ downloadedBytes, totalBytes, cached }) => {
				post({
					type: 'beauty-model-status',
					status: 'loading',
					downloadedBytes,
					sizeBytes: totalBytes,
					fraction: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
					cached
				});
			}
		});
	}
	return beautyEngine;
}

function rendererDeviceFeatures(device: GPUDevice): string[] {
	return Array.from(device.features, (feature) => String(feature));
}

function cancelRendererDeviceLossWatch(): void {
	rendererDeviceLossGeneration += 1;
}

function watchRendererDeviceLoss(device: GPUDevice): void {
	const generation = ++rendererDeviceLossGeneration;
	void device.lost.then((info) => {
		if (generation !== rendererDeviceLossGeneration || info.reason === 'destroyed') return;
		void handleRendererDeviceLost({
			reason: info.reason,
			message: info.message
		}).catch((error) => {
			recordRecentError({
				code: 'gpu.device_lost_teardown_failed',
				subsystem: 'gpu',
				severity: 'error',
				message: errorMessage(error),
				recoveryActionIds: ['retry-gpu-device', 'reload-app']
			});
			post({
				type: 'recovery-state',
				state: 'failed',
				actions: []
			});
		});
	});
}

async function disposeAllMlEngines(): Promise<void> {
	const matte = matteEngine;
	const interpolation = interpolationEngine;
	const beauty = beautyEngine;
	matteEngine = null;
	interpolationEngine = null;
	beautyEngine = null;
	await Promise.allSettled([matte?.dispose(), interpolation?.dispose(), beauty?.dispose()]);
}

function destroyRendererTextureCaches(): void {
	titleCache?.destroy();
	titleCache = null;
	calloutCache?.dispose();
	calloutCache = null;
}

function rebuildRendererTextureCaches(): void {
	if (!renderer) return;
	destroyRendererTextureCaches();
	titleCache = new TitleTextureCache(createCanvasTitleUploader(renderer.gpuDevice));
	calloutCache = new CalloutTextureCache(renderer.gpuDevice);
	syncTitleRasters();
	syncCalloutRasters();
	void loadTitleFonts().then(() => {
		titleCache?.retain(EMPTY_CLIP_IDS);
		syncTitleRasters();
		syncCalloutRasters();
		playback?.refresh();
	});
}

function assertRendererAdoptionAllowed(): void {
	if (exportAbort || queueJobAbort || queueRunning) {
		throw new Error(
			'ORT-WebGPU device adoption is blocked while export or the render queue is active. Cancel or wait for export to finish, then load the model again.'
		);
	}
}

async function waitForRendererAdoptionToSettle(): Promise<void> {
	while (rendererAdoptionInFlight) {
		await rendererAdoptionInFlight.catch(() => {});
	}
}

async function adoptOrtDevice(ortDevice: GPUDevice, source: string): Promise<void> {
	await waitForRendererAdoptionToSettle();
	if (!renderer) {
		throw new Error(`${source} requires the accelerated WebGPU renderer.`);
	}
	if (renderer.isUsingDevice(ortDevice)) {
		return;
	}
	assertRendererAdoptionAllowed();

	const run = (async () => {
		const activeRenderer = renderer;
		if (!activeRenderer) {
			throw new Error(`${source} requires the accelerated WebGPU renderer.`);
		}
		const wasPlaying = playback?.isPlaying() ?? false;
		await playback?.cancelAndWaitForIdle();
		assertRendererAdoptionAllowed();

		const previousSize = activeRenderer.size;
		destroyRendererTextureCaches();
		cancelRendererDeviceLossWatch();

		renderer = null;
		renderer = await activeRenderer.rebuildOnExternalDevice(ortDevice);
		lastWebgpuFeatures = rendererDeviceFeatures(ortDevice);
		lastWebgpuLimits = gpuDeviceLimits(ortDevice);
		lastGpuUnavailableReason = null;
		previewBackend = 'core-webgpu';
		exportBackend = 'core-webgpu';

		if (currentScopeSab) {
			renderer.setScopeSab(currentScopeSab);
		}
		renderer.setScopesEnabled(currentScopesEnabled);
		renderer.setZebraEnabled(currentZebraEnabled);
		if (previousSize.width > 0 && previousSize.height > 0) {
			renderer.setPreviewSize(previousSize.width, previousSize.height);
		}
		rebuildRendererTextureCaches();
		syncTimelineLuts();
		matteCompositingUnavailableWarned = false;
		watchRendererDeviceLoss(ortDevice);
		post({
			type: 'ready',
			webgpu: true,
			features: lastWebgpuFeatures,
			gpuUnavailableReason: null,
			previewBackend,
			exportBackend,
			previewReady: true,
			exportReady: true
		});
		ensurePreview();
		if (wasPlaying) {
			playback?.play();
		}
	})().catch((error) => {
		const message = errorMessage(error);
		recordRecentError({
			code: 'ml.ort_device_adoption_failed',
			subsystem: 'gpu',
			severity: 'error',
			message,
			recoveryActionIds: ['retry-gpu-device', 'reload-app']
		});
		throw error;
	});

	rendererAdoptionInFlight = run;
	try {
		await run;
	} finally {
		if (rendererAdoptionInFlight === run) {
			rendererAdoptionInFlight = null;
		}
	}
}

async function handleRetryGpuDevice(actionId: string): Promise<void> {
	await waitForRendererAdoptionToSettle();
	post({ type: 'recovery-state', state: 'recovering', actions: [] });
	try {
		assertRendererAdoptionAllowed();
		if (!previewCanvas) {
			throw new Error('GPU recovery requires an initialized preview canvas.');
		}

		playback?.pause();
		cancelRendererDeviceLossWatch();
		await disposeAllMlEngines();
		destroyRendererTextureCaches();
		renderer?.destroy();
		renderer = null;
		reducedRenderer?.destroy();
		reducedRenderer = null;
		previewBackend = 'none';
		exportBackend = 'none';

		const useCompatibilityAdapter = currentCapabilityProbe?.compatibilityAdapter === true;
		const gpu =
			currentCapabilityProbe?.tier === 'limited-webcodecs'
				? {
						renderer: null,
						features: [],
						limits: {},
						unavailableReason: null
					}
				: currentCapabilityProbe?.tier === 'shell-only'
					? {
							renderer: null,
							features: [],
							limits: {},
							unavailableReason: 'Preview unavailable in shell-only tier.'
						}
					: useCompatibilityAdapter
						? await initCompatibilityGpu(previewCanvas)
						: await initGpu(previewCanvas);

		if (currentCapabilityProbe?.tier === 'limited-webcodecs') {
			reducedRenderer = new CanvasCompatibilityRenderer(previewCanvas);
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
			lastGpuUnavailableReason = null;
			lastDeviceLost = undefined;
			if (currentScopeSab) {
				renderer.setScopeSab(currentScopeSab);
			}
			renderer.setScopesEnabled(currentScopesEnabled);
			renderer.setZebraEnabled(currentZebraEnabled);
			rebuildRendererTextureCaches();
			syncTimelineLuts();
			watchRendererDeviceLoss(renderer.gpuDevice);
		} else if (!reducedRenderer) {
			lastGpuUnavailableReason = gpu.unavailableReason;
			throw new Error(gpu.unavailableReason ?? 'GPU recovery did not create a preview backend.');
		}

		post({
			type: 'ready',
			webgpu: renderer !== null,
			features: lastWebgpuFeatures,
			gpuUnavailableReason: lastGpuUnavailableReason,
			previewBackend,
			exportBackend,
			previewReady: previewBackend !== 'none',
			exportReady: exportBackend !== 'none'
		});
		ensurePreview();
		post({ type: 'recovery-state', state: 'idle', actions: [] });
	} catch (error) {
		const message = errorMessage(error);
		lastGpuUnavailableReason = message;
		recordRecentError({
			code: 'gpu.recovery_failed',
			subsystem: 'gpu',
			severity: 'error',
			message,
			recoveryActionIds: ['retry-gpu-device', 'reload-app']
		});
		post({
			type: 'error',
			message: `GPU recovery failed (${actionId}): ${message}`
		});
		post({ type: 'recovery-state', state: 'failed', actions: [] });
	}
}

async function handleRendererDeviceLost(info: {
	reason: GPUDeviceLostReason;
	message: string;
}): Promise<void> {
	cancelRendererDeviceLossWatch();
	lastDeviceLost = {
		reason: String(info.reason),
		message: info.message,
		occurredAt: new Date().toISOString(),
		recoveryAttempts: 0,
		fallbackMode: 'limited-preview'
	};
	lastGpuUnavailableReason = `GPU device lost: ${info.message || info.reason}`;
	playback?.pause();
	await disposeAllMlEngines();
	destroyRendererTextureCaches();
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
}

/** Conservative default per-tile calibration until a real micro-benchmark
 *  replaces it on first run (R5.2). */
const INTERP_DEFAULT_CALIBRATION: CalibrationProfile = {
	accelerator: 'webgpu',
	msPerTile: 8,
	tilePixels: 256 * 256,
	overheadMs: 50
};

/** Model I/O used for tiling before a model is loaded (FILM-class default). */
const INTERP_DEFAULT_IO: ModelIoContract = {
	inputWidth: 256,
	inputHeight: 256,
	inputChannels: 3,
	bytesPerElement: 2,
	flowOutput: false,
	maxDisplacement: 32
};

function interpVramBudget(): VramBudget {
	const maxBuffer = renderer?.gpuDevice.limits.maxBufferSize ?? 256 * 1024 * 1024;
	return { maxBytes: Math.min(maxBuffer, 1024 * 1024 * 1024), safety: 0.5 };
}

/** Shared empty set for dropping every cached title texture via `retain`. */
const EMPTY_CLIP_IDS: ReadonlySet<string> = new Set<string>();
/** Default preview/export geometry for title-only timelines (no video source). */
const TITLE_ONLY_CANVAS = { width: 1920, height: 1080, frameRate: 30 } as const;
const retainedOverlayTextureIds = new Set<string>();
let primaryHandle: MediaInputHandle | null = null;
let playback: PlaybackController<LayerMeta> | null = null;
let adaptive: AdaptiveResolution | null = null;
// Loop-playback toggle. Held outside the PlaybackController so it survives the
// controller rebuilds in setupPlayback (edits/format changes) like the play state.
let loopEnabled = false;
let probeDone = false;
let timeline: Timeline = createEmptyTimeline();
let captionTracks: CaptionTrack[] = [];
let transitions: TimelineTransition[] = [];
let markers: TimelineMarker[] = [];
let masterGain = DEFAULT_MASTER_GAIN;
let sessionEventLogs: import('../protocol').SessionEventLogRef[] = [];
/** Phase 13 will populate this; export crossfades only until preview dual-stream lands. */
const audioTransitions: AudioTransitionCut[] = [];
let nextSourceId = 1;
const sourceInputs = new Map<string, MediaInputHandle>();
const sourceDescriptors = new Map<string, SourceDescriptor>();
/** Media-bin membership: every imported/restored source, placed or not. Pruning
 *  and persistence key off this set so unplaced assets survive. */
const binSourceIds = new Set<string>();
const clipboardLuts = new Map<string, ClipLut>();
/** Phase 32a: session-only skin-smooth bypass flags (not serialised, not in undo history). */
const skinSmoothBypassMap = new Map<string, boolean>();
/** Phase 35: per-clip remap LUTs (rebuilt on set-time-remap, cleared on clear-time-remap). */
const remapLUTs = new Map<string, RemapLUT>();
const remapLUTSignatures = new Map<string, string>();
const liveWsolaStretchers = new Map<string, WsolaStretcher>();
const WSOLA_INPUT_PAD_FRAMES = WSOLA_WINDOW_SAMPLES + WSOLA_SEARCH_RADIUS_SAMPLES;
const restoringSourceIds = new Set<string>();
/** Phase 44: in-flight silence detection request IDs (cancellation set). */
const inFlightSilenceRequests = new Set<string>();
let thumbnailGen: ThumbnailGenerator | null = null;
const THUMBNAIL_WIDTH = 160;
const history = createTimelineHistory();
let projectId = makeProjectId();
let restoreDoc: ProjectDoc | null = null;
// Phase 39: project format and cover frame
let projectFormat: ProjectFormat = { aspect: '16:9' };
let cover: CoverFrameDoc | null = null;
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
let customAnimCaptionPresets: CaptionAnimStylePreset[] = [];
let queueState: RenderQueueState = createEmptyQueueState();
let queueRunning = false;
let queueJobAbort: AbortController | null = null;
let queueJobOutputResolve: ((handle: FileSystemFileHandle | null) => void) | null = null;
let queueJobOutputJobId: string | null = null;
const queueJobOutputHandles = new Map<string, FileSystemFileHandle>();
const queueJobOutputDirs = new Map<string, FileSystemDirectoryHandle>();
let recentErrors = createEmptyRecentErrorLog();
let lastWebgpuFeatures: string[] = [];
let lastWebgpuLimits: Record<string, number> = {};
let lastGpuUnavailableReason: string | null = null;
let lastDeviceLost: import('../diagnostics/types').DeviceLostSummary | undefined;
const FRAME_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
let audioRing: AudioRingViews | null = null;
// ── Phase 41 Capture Engine ────────────────────────────────────────────
let captureSession: CaptureSession | null = null;
let captureLandingSettings: import('../protocol').CaptureSettingsSnapshot | null = null;
let captureRetakeClipId: string | undefined;
let captureDomTapGeneration = 0;
let captureDomTapSessionId: string | null = null;
/** Tracks the last broadcasted state so we can detect transitions on the
 *  onStatusChange callback and emit pause/resume/stop messages on the right edge. */
let captureDomTapLastState: 'idle' | 'armed' | 'recording' | 'paused' | 'stopping' | null = null;
interface PendingCaptureSource {
	sourceId: string;
	kind: import('../protocol').CaptureSourceKind;
	label: string;
	/** Null for a main-frames push source — main keeps the track (bugfix B5/T5.5). */
	track: MediaStreamTrack | null;
	width?: number;
	height?: number;
	frameRate?: number | null;
}
const pendingCaptureSources = new Map<string, PendingCaptureSource>();
let audioWriteAnchor = 0;
let audioWriteFrames = 0;
let audioPumpGen = 0;
const AUTOSAVE_DEBOUNCE_MS = 300;

// ── Phase 45: Program Mode ──
let programSession: import('./program-session').ProgramSession | null = null;
let programCompositor: import('./program-compositor').ProgramCompositor | null = null;
let programTap: import('./live-compose-tap').LiveComposeTap | null = null;
let programEncoderBudget: import('./encoder-budget').EncoderBudget | null = null;
let programExternalEncoderLeases: EncoderLease[] = [];
let programStopInFlight: Promise<void> | null = null;
let programLandingSettings: import('../protocol').CaptureSettingsSnapshot | null = null;
let programSceneDoc: SceneDoc | null = null;
let programPendingError: import('../protocol').ProgramErrorCode | null = null;
let programPendingErrorDetail: string | null = null;
let programRenderFrame: { kind: 'raf' | 'timeout'; id: number } | null = null;
let programRenderDirty = false;

const PROGRAM_RENDER_FRAME_MS = 1000 / 60;

function requestProgramRenderFrame(callback: () => void): { kind: 'raf' | 'timeout'; id: number } {
	const scope = globalThis as typeof globalThis & {
		requestAnimationFrame?: (callback: FrameRequestCallback) => number;
		cancelAnimationFrame?: (id: number) => void;
	};
	if (scope.requestAnimationFrame) {
		return { kind: 'raf', id: scope.requestAnimationFrame(() => callback()) };
	}
	return {
		kind: 'timeout',
		id: setTimeout(callback, PROGRAM_RENDER_FRAME_MS)
	};
}

function cancelProgramRenderFrame(): void {
	if (!programRenderFrame) return;
	const frame = programRenderFrame;
	programRenderFrame = null;
	const scope = globalThis as typeof globalThis & {
		cancelAnimationFrame?: (id: number) => void;
	};
	if (frame.kind === 'raf') {
		scope.cancelAnimationFrame?.(frame.id);
	} else {
		clearTimeout(frame.id);
	}
	programRenderDirty = false;
}

function scheduleProgramRenderFrame(): void {
	if (programRenderFrame) return;
	programRenderFrame = requestProgramRenderFrame(runProgramRenderFrame);
}

function scheduleProgramRender(): void {
	programRenderDirty = true;
	scheduleProgramRenderFrame();
}

function runProgramRenderFrame(): void {
	programRenderFrame = null;
	const compositor = programCompositor;
	const shouldRender = programRenderDirty || (compositor?.hasActiveTransition() ?? false);
	programRenderDirty = false;
	if (!compositor || !shouldRender) return;
	try {
		compositor.renderTick();
	} catch (error) {
		programPendingError = 'compositor-error';
		programPendingErrorDetail = errorMessage(error);
		void handleProgramStop();
		return;
	}
	if (programCompositor?.hasActiveTransition()) {
		scheduleProgramRenderFrame();
	}
}

function cloneSceneDefinitionForWorker(scene: SceneDefinition): SceneDefinition {
	return {
		...scene,
		layers: scene.layers.map((layer) => ({
			...layer,
			transform: { ...layer.transform }
		}))
	};
}

function cloneSceneDocForWorker(doc: SceneDoc | null | undefined): SceneDoc | null {
	if (!doc) return null;
	return {
		sceneSchemaVersion: 1,
		scenes: doc.scenes.map(cloneSceneDefinitionForWorker)
	};
}

function sceneDocFromDefinitions(scenes: readonly SceneDefinition[]): SceneDoc | null {
	if (scenes.length === 0) return null;
	return {
		sceneSchemaVersion: 1,
		scenes: scenes.map(cloneSceneDefinitionForWorker)
	};
}

function postProgramScenes(): void {
	post({
		type: 'program-scenes',
		scenes: programSceneDoc ? programSceneDoc.scenes.map(cloneSceneDefinitionForWorker) : []
	});
}

function releaseProgramExternalEncoderLeases(): void {
	for (const lease of programExternalEncoderLeases) {
		lease.release();
	}
	programExternalEncoderLeases = [];
}

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
// Phase 36: Voice Cleanup state
let voiceCleanupSettings: VoiceCleanupSettings = { ...DEFAULT_VOICE_CLEANUP_SETTINGS };
let analysisAbortController: AbortController | null = null;
let capture: CaptureRuntime | null = null;
/** Serializes OPFS spill writes/deletes so a file is never read or deleted mid-write. */
let replaySpillChain: Promise<void> = Promise.resolve();
/** Decoder configs from the capture encoders; survive capture-stop so the buffer stays saveable. */
let captureVideoDecoderConfig: VideoDecoderConfig | null = null;
let captureAudioDecoderConfig: AudioDecoderConfig | null = null;
let replaySaveAbort: AbortController | null = null;

// -- Phase 34: Beat Detection --
const beatAnalysisCancels = new Map<string, AbortController>();
const beatResultCache = new Map<string, import('./beat-analysis').BeatAnalysisResult>();
let beatSettings = { enabledSourceIds: [] as string[], globalOffsetMs: 0 };

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

function makeTrackId(sourceId: string): string {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `track-${sourceId}-${suffix}`;
}

function captureTrackType(kind: import('../protocol').CaptureSourceKind): TimelineTrack['type'] {
	return kind === 'mic' || kind === 'system-audio' ? 'audio' : 'video';
}

function captureSourceFileName(
	sessionId: string,
	source: { sourceId: string; kind: import('../protocol').CaptureSourceKind }
): string {
	const prefix = source.kind === 'mic' || source.kind === 'system-audio' ? 'audio' : 'video';
	return `${sessionId}-${prefix}-${source.sourceId}.mp4`;
}

function capturedSourceDescriptor(
	sessionId: string,
	source: ReturnType<CaptureSession['getLandingSources']>[number],
	durationS: number
): SourceDescriptor {
	const isAudio = captureTrackType(source.kind) === 'audio';
	return {
		sourceId: source.sourceId,
		fileName: captureSourceFileName(sessionId, source),
		kind: isAudio ? 'audio' : 'video',
		byteSize: source.bytesWritten,
		durationS,
		mimeType: isAudio ? 'audio/mp4' : 'video/mp4',
		captureMode: source.captureMode,
		captureSessionId: sessionId,
		health: {
			sourceId: source.sourceId,
			fileName: captureSourceFileName(sessionId, source),
			status: 'ok',
			warnings: []
		},
		...(isAudio
			? {
					audio: {
						channels: 2,
						sampleRate: 48_000,
						codec: 'aac',
						canDecode: false,
						trackStartS: 0,
						trackDurationS: durationS
					}
				}
			: {
					video: {
						width: source.width ?? 1920,
						height: source.height ?? 1080,
						frameRate: source.frameRate ?? null,
						frameRateMode: 'constant' as const,
						codec: 'h264',
						canDecode: false,
						trackStartS: 0,
						trackDurationS: durationS
					}
				})
	};
}

function findTimelineClipById(clipId: string): { trackIndex: number; clipIndex: number } | null {
	for (let trackIndex = 0; trackIndex < timeline.length; trackIndex++) {
		const clipIndex = timeline[trackIndex]!.clips.findIndex((clip) => clip.id === clipId);
		if (clipIndex >= 0) return { trackIndex, clipIndex };
	}
	return null;
}

function applyCaptureLanding(
	session: CaptureSession,
	settings: import('../protocol').CaptureSettingsSnapshot,
	retakeClipId?: string,
	extraTracks: TimelineTrack[] = []
): string[] {
	const sources = session.getLandingSources();
	if (sources.length === 0 && extraTracks.length === 0) return [];
	if (sources.length === 0) {
		commitTimelineMutation(() => [...timeline, ...extraTracks], {
			refreshPlayback: 'refresh'
		});
		return [];
	}

	const pairs = session.getPauseResumePairs();
	const epochUs = session.epochValue ?? Math.min(...sources.map((source) => source.firstSampleUs));
	const seamMarkers = seamMarkerPositionsUs(pairs);
	const trackIds: string[] = [];
	const descriptors = new Map<string, SourceDescriptor>();
	const canvasWidth =
		typeof settings.canvasWidth === 'number' && Number.isFinite(settings.canvasWidth)
			? settings.canvasWidth
			: (lastExportSettings?.width ?? 1920);
	const canvasHeight =
		typeof settings.canvasHeight === 'number' && Number.isFinite(settings.canvasHeight)
			? settings.canvasHeight
			: (lastExportSettings?.height ?? 1080);
	const webcamPreset = settings.webcamPreset ?? DEFAULT_WEBCAM_PRESET;

	const sourceClips = sources.map((source) => {
		const adjustedFirstUs = computeGapCollapsedUs(source.firstSampleUs, pairs);
		const adjustedLastUs = computeGapCollapsedUs(source.lastSampleUs, pairs);
		const start = Math.max(0, (adjustedFirstUs - epochUs) / 1_000_000);
		const duration = Math.max(0.1, (adjustedLastUs - adjustedFirstUs) / 1_000_000);
		const descriptor = capturedSourceDescriptor(session.sessionId, source, duration);
		descriptors.set(source.sourceId, descriptor);

		const transform =
			source.kind === 'webcam'
				? {
						...defaultClipTransform(),
						...deriveWebcamTransform(
							webcamPreset,
							canvasWidth,
							canvasHeight,
							source.width ?? 1280,
							source.height ?? 720
						)
					}
				: defaultClipTransform();
		return {
			source,
			clip: defaultTimelineClip({
				id: makeClipId(source.sourceId),
				sourceId: source.sourceId,
				start,
				duration,
				inPoint: 0,
				transform,
				captureSessionId: session.sessionId
			})
		};
	});

	for (const descriptor of descriptors.values()) {
		sourceDescriptors.set(descriptor.sourceId, descriptor);
		binSourceIds.add(descriptor.sourceId);
	}

	const committed = commitEditMutation(
		() => {
			let nextTimeline: Timeline = timeline;
			if (retakeClipId) {
				const loc = findTimelineClipById(retakeClipId);
				const replacement = sourceClips.find(
					(item) =>
						captureTrackType(item.source.kind) === (loc ? timeline[loc.trackIndex]!.type : 'video')
				);
				if (loc && replacement) {
					nextTimeline = timeline.map((track, trackIndex) =>
						trackIndex === loc.trackIndex
							? {
									...track,
									clips: track.clips.map((clip, clipIndex) =>
										clipIndex === loc.clipIndex
											? {
													...clip,
													sourceId: replacement.source.sourceId,
													duration: replacement.clip.duration,
													inPoint: 0,
													cleanedAudio: undefined,
													captureSessionId: session.sessionId
												}
											: clip
									)
								}
							: track
					);
					trackIds.push(timeline[loc.trackIndex]!.id);
				}
			} else {
				nextTimeline = [
					...timeline,
					...sourceClips.map((item) => {
						const trackId = makeTrackId(item.source.sourceId);
						trackIds.push(trackId);
						return {
							id: trackId,
							type: captureTrackType(item.source.kind),
							clips: [item.clip],
							...DEFAULT_TRACK_MIX
						};
					}),
					...extraTracks
				];
			}

			let nextMarkers = markers;
			for (const marker of seamMarkers) {
				nextMarkers = addMarker(
					nextMarkers,
					Math.max(0, marker.positionUs / 1_000_000),
					marker.label
				);
			}
			return { timeline: nextTimeline, captionTracks, transitions, markers: nextMarkers };
		},
		{ prune: false, refreshPlayback: 'refresh' }
	);

	if (!committed) return [];
	const primaryScreenSourceId = sourceClips.find(({ source }) => source.kind === 'screen')?.source
		.sourceId;
	if (primaryScreenSourceId) {
		const nextRef: import('../protocol').SessionEventLogRef = {
			sessionId: session.sessionId,
			sourceId: primaryScreenSourceId,
			opfsPath: `capture/${session.sessionId}/events.ndjson`
		};
		sessionEventLogs = [
			...sessionEventLogs.filter(
				(ref) => !(ref.sessionId === nextRef.sessionId && ref.sourceId === nextRef.sourceId)
			),
			nextRef
		];
		postTimelineState();
	}
	postMediaAssets();
	for (const descriptor of descriptors.values()) {
		postSourceHealth(
			descriptor.health ?? {
				sourceId: descriptor.sourceId,
				fileName: descriptor.fileName,
				status: 'ok',
				warnings: []
			}
		);
	}
	return trackIds;
}

function post(msg: WorkerStateMessage) {
	self.postMessage(msg);
}

function postWithTransfer(msg: WorkerStateMessage, transfer: Transferable[]) {
	(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

// ── Phase 47: program-feed tap for WHIP publish (T5) ──
// The tap clones the composited program frame off the preview canvas and feeds
// the publish track. Bounded (latest-frame-wins) and close-exactly-once live in
// publish-frame-tap.ts; this block only owns the wiring and the canvas capture.

let publishTap: PublishFrameTap<VideoFrame> | null = null;
let publishTapStatsTimer: ReturnType<typeof setInterval> | null = null;
let previewCanvas: OffscreenCanvas | null = null;

type TrackGeneratorLike = MediaStreamTrack & { writable: WritableStream<VideoFrame> };

function postPublishTapStats(tap: PublishFrameTap<VideoFrame>) {
	const stats = tap.stats();
	post({
		type: 'publish-tap-stats',
		framesDelivered: stats.framesDelivered,
		framesDropped: stats.framesDropped
	});
}

function handlePublishTapStart(mode: 'worker-track' | 'main-frames') {
	if (publishTap) return;
	const fail = (message: string) => post({ type: 'publish-tap-error', message });

	if (mode === 'worker-track') {
		const generatorCtor = (globalThis as unknown as Record<string, unknown>)
			.MediaStreamTrackGenerator as
			| (new (init: { kind: 'video' }) => TrackGeneratorLike)
			| undefined;
		if (typeof generatorCtor !== 'function') {
			fail('MediaStreamTrackGenerator is unavailable in the pipeline worker.');
			return;
		}
		let generator: TrackGeneratorLike;
		try {
			generator = new generatorCtor({ kind: 'video' });
		} catch (error) {
			fail(`Could not create the publish track: ${errorMessage(error)}`);
			return;
		}
		publishTap = createPublishFrameTap<VideoFrame>(generator.writable.getWriter(), (error) =>
			fail(`Publish frame tap failed: ${errorMessage(error)}`)
		);
		postWithTransfer({ type: 'publish-tap-track', track: generator }, [
			generator as unknown as Transferable
		]);
	} else {
		// Probed fallback (R4.5): the generator lives on main; the worker transfers
		// one VideoFrame per program frame. This is publish data-plane only — the
		// SAB playback clock is untouched.
		publishTap = createPublishFrameTap<VideoFrame>(
			{
				write(frame) {
					postWithTransfer({ type: 'publish-tap-frame', frame }, [
						frame as unknown as Transferable
					]);
					return Promise.resolve();
				},
				close: () => Promise.resolve()
			},
			(error) => fail(`Publish frame tap failed: ${errorMessage(error)}`)
		);
	}
	publishTapStatsTimer = setInterval(() => {
		if (publishTap) postPublishTapStats(publishTap);
	}, 2_000);
}

async function handlePublishTapStop(): Promise<void> {
	if (publishTapStatsTimer !== null) {
		clearInterval(publishTapStatsTimer);
		publishTapStatsTimer = null;
	}
	const tap = publishTap;
	publishTap = null;
	if (tap) {
		await tap.stop();
		postPublishTapStats(tap);
	}
}

/** Captures the just-presented program frame for the publish tap (zero CPU readback). */
function tapProgramFrame(timestampS: number) {
	if (!publishTap || !previewCanvas || previewCanvas.width === 0 || previewCanvas.height === 0) {
		return;
	}
	let frame: VideoFrame;
	try {
		frame = new VideoFrame(previewCanvas, {
			timestamp: Math.round(timestampS * 1_000_000)
		});
	} catch {
		// Canvas not yet presentable (e.g. context loss mid-recovery); skip the tick.
		return;
	}
	try {
		publishTap.push(frame);
	} finally {
		// The tap works on clones; this capture is closed here, exactly once.
		frame.close();
	}
}

function postRecoveryCheckpoint(): void {
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
			matte: clip.matte ? { ...clip.matte } : undefined,
			audioFadeIn: clip.audioFadeIn,
			audioFadeOut: clip.audioFadeOut,
			offline:
				track.type === 'layout' || clip.kind === 'title' || sourceInputs.has(clip.sourceId)
					? undefined
					: true,
			linkedGroupId: clip.linkedGroupId,
			captureSessionId: clip.captureSessionId,
			skinMask: clip.skinMask ? { ...clip.skinMask } : undefined,
			timeRemap: clip.timeRemap
				? { ...clip.timeRemap, keyframes: [...clip.timeRemap.keyframes] }
				: undefined,
			beauty: clip.beauty ? { ...clip.beauty } : undefined
		})),
		layoutClips: track.layoutClips?.map((clip) => ({
			id: clip.id,
			kind: 'layout',
			startTime: clip.startTime,
			duration: clip.duration,
			sceneId: clip.sceneId,
			sceneSnapshot: {
				...clip.sceneSnapshot,
				layers: clip.sceneSnapshot.layers.map((layer) => ({
					...layer,
					transform: { ...layer.transform }
				}))
			}
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
		visible: track.visible,
		generatedBy: track.generatedBy ?? null
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
		masterGain,
		sessionEventLogs: sessionEventLogs.map((ref) => ({ ...ref }))
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

function colorMetadataForSource(sourceId: string): ColorMetadata | undefined {
	const hints = sourceDescriptors.get(sourceId)?.video?.color;
	return hints ? colorMetadataFromHints(hints) : undefined;
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
	// Distinguish "animated image" (Lottie, animated WebP/GIF) from a literal
	// still. Still adapters report `duration = STILL_MAX_DURATION_S` (very
	// large sentinel) so the clip can be trimmed freely; animated content
	// reports its real playback length. Use that real length when present so
	// Lottie clips don't get the 5-second still default that loses the rest of
	// the animation.
	const isAnimatedImage =
		handle.kind === 'image' && handle.duration > 0 && handle.duration < STILL_MAX_DURATION_S;
	const clipDuration =
		handle.kind === 'image' && !isAnimatedImage ? STILL_DEFAULT_DURATION_S : handle.duration;
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

function voiceCleanupExportParams() {
	return {
		denoiserEnabledTracks: [...voiceCleanupSettings.denoiserEnabledTracks],
		normaliseGainDb: voiceCleanupSettings.normaliseGainDb,
		limiterCeilingDbtp: voiceCleanupSettings.limiterCeilingDbtp,
		gateParams: voiceCleanupSettings.gateParams,
		limiterParams: voiceCleanupSettings.limiterParams
	};
}

async function createConfiguredVoiceCleanupState(): Promise<
	import('./voice-cleanup/voice-cleanup-processor').VoiceCleanupChainState
> {
	const { createVoiceCleanupChainState, ensureDenoiserRings } =
		await import('./voice-cleanup/voice-cleanup-processor');
	const state = createVoiceCleanupChainState();
	await ensureDenoiserRings(state, voiceCleanupSettings.denoiserEnabledTracks);
	return state;
}

async function destroyConfiguredVoiceCleanupState(
	state: import('./voice-cleanup/voice-cleanup-processor').VoiceCleanupChainState | null
): Promise<void> {
	if (!state) return;
	const { destroyVoiceCleanupChainState } = await import('./voice-cleanup/voice-cleanup-processor');
	destroyVoiceCleanupChainState(state);
}

function audioTrackIndex(trackId: string): number {
	let index = 0;
	for (const track of timeline) {
		if (track.type !== 'audio') continue;
		if (track.id === trackId) return index;
		index += 1;
	}
	return -1;
}

function liveClipAt(track: Timeline[number], time: number): TimelineClip | null {
	for (const clip of track.clips) {
		if (time >= clip.start && time < clip.start + clip.duration) return clip;
	}
	return null;
}

function liveNextClipStart(track: Timeline[number], time: number): number {
	let next = Number.POSITIVE_INFINITY;
	for (const clip of track.clips) {
		if (clip.start > time && clip.start < next) next = clip.start;
	}
	return next;
}

async function mixLiveMonitorWindow(
	startTime: number,
	frameCount: number,
	sampleRate: number,
	channels: number
): Promise<{ mixed: Float32Array; stems: Map<number, Float32Array> }> {
	const mixed = new Float32Array(frameCount * channels);
	const stems = new Map<number, Float32Array>();
	if (frameCount <= 0 || channels <= 0) return { mixed, stems };

	for (const track of timeline) {
		if (track.type !== 'audio') continue;
		const gain = trackAudible(track.id);
		if (gain <= 0) continue;
		const trackIndex = audioTrackIndex(track.id);
		if (trackIndex < 0) continue;
		let stem: Float32Array | null = null;
		let offsetFrames = 0;
		while (offsetFrames < frameCount) {
			const timelineTime = startTime + offsetFrames / sampleRate;
			const clip = liveClipAt(track, timelineTime);
			if (!clip) {
				const nextStart = liveNextClipStart(track, timelineTime);
				const skipUntil = Math.min(
					startTime + frameCount / sampleRate,
					Number.isFinite(nextStart) ? nextStart : Number.POSITIVE_INFINITY
				);
				const skipFrames = Number.isFinite(skipUntil)
					? Math.max(1, Math.floor((skipUntil - timelineTime) * sampleRate))
					: frameCount - offsetFrames;
				offsetFrames += Math.min(frameCount - offsetFrames, skipFrames);
				continue;
			}

			const substitute = cleanedAudioSubstitute(clip, sourceInputs);
			const audioClip = substitute?.clip ?? clip;
			const handle = substitute?.handle ?? sourceInputs.get(clip.sourceId);
			const clipEnd = clip.start + clip.duration;
			const runFrames = Math.max(
				1,
				Math.min(frameCount - offsetFrames, Math.ceil((clipEnd - timelineTime) * sampleRate))
			);
			if (!handle?.audioSource) {
				offsetFrames += runFrames;
				continue;
			}

			const sourceTimestamp = resolveSourceTimestampWithRemap({
				clip: audioClip,
				timelineTime,
				trackKind: 'audio',
				timing: handle.timing
			});
			const availableRunFrames = audioAvailabilityWindowFrames({
				resolution: sourceTimestamp,
				timing: handle.timing,
				clip: audioClip,
				timelineTime,
				sampleRate,
				maxFrames: runFrames,
				remapSpeedRatio: speedRatioForRemap(audioClip, timelineTime)
			});
			if (!sourceTimestamp.available) {
				offsetFrames += availableRunFrames;
				continue;
			}

			const pcm = await pcmWindowForRemap({
				handle,
				clip: audioClip,
				timelineTime,
				sourceTime: sourceTimestamp,
				frameCount: availableRunFrames,
				channels,
				sampleRate,
				wsola: liveWsolaForClip(audioClip, channels)
			});
			applyMixStageInPlace(pcm, channels, {
				gain,
				pan: track.pan,
				fadeInS: clip.audioFadeIn,
				fadeOutS: clip.audioFadeOut,
				clipOffsetS: timelineTime - clip.start,
				clipDurationS: clip.duration,
				sampleRate
			});
			const offsetSamples = offsetFrames * channels;
			accumulateMix(mixed, pcm, offsetSamples);
			stem ??= new Float32Array(frameCount * channels);
			accumulateMix(stem, pcm, offsetSamples);
			stems.set(trackIndex, stem);
			offsetFrames += availableRunFrames;
		}
	}

	return { mixed, stems };
}

/** Live preview pumps a bounded all-audible-track monitor mix into the AudioWorklet. */
async function pumpAudioOnce(): Promise<void> {
	if (!audioRing || !clockView) return;
	if (Atomics.load(audioRing.header, RingHeader.STATE) !== RingState.PLAYING) return;
	const freeFrames = ringFreeSamples(audioRing);
	if (freeFrames < 256) return;

	const sampleRate = Atomics.load(audioRing.header, RingHeader.SAMPLE_RATE) || 48_000;
	const timelineTime = audioWriteAnchor + audioWriteFrames / sampleRate;
	const channels = Math.max(1, Atomics.load(audioRing.header, RingHeader.CHANNELS));
	const frameCount = Math.min(freeFrames, 1024);
	const { mixed, stems } = await mixLiveMonitorWindow(
		timelineTime,
		frameCount,
		sampleRate,
		channels
	);
	const written = writeRingPcm(audioRing, mixed, -1, stems);
	audioWriteFrames += written;
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
	liveWsolaStretchers.clear();
	bumpRingGeneration(audioRing);
	resetRingPointers(audioRing);
	audioWriteAnchor = time;
	audioWriteFrames = 0;
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

function timeRemapSourceDuration(
	remap: TimeRemapSnapshot | undefined,
	fallbackDurationS: number
): number {
	if (remap && Number.isFinite(remap.sourceDurationS) && remap.sourceDurationS >= 0) {
		return remap.sourceDurationS;
	}
	return Math.max(0, fallbackDurationS);
}

function remapLutSignature(clip: TimelineClip): string | null {
	if (!clip.timeRemap) return null;
	return JSON.stringify({
		duration: clip.duration,
		inPoint: clip.inPoint,
		sourceDurationS: timeRemapSourceDuration(clip.timeRemap, clip.duration),
		keyframes: clip.timeRemap.keyframes,
		pitchPreserve: clip.timeRemap.pitchPreserve
	});
}

/** Phase 35: Rebuild remap LUTs from the current timeline clips. */
function syncRemapLuts(): void {
	const activeClipIds = new Set<string>();
	for (const track of timeline) {
		for (const clip of track.clips) {
			const signature = remapLutSignature(clip);
			if (!clip.timeRemap || !signature) continue;
			activeClipIds.add(clip.id);
			if (remapLUTSignatures.get(clip.id) === signature) continue;
			const lut = buildRemapLUT(
				clip.timeRemap.keyframes,
				timeRemapSourceDuration(clip.timeRemap, clip.duration)
			);
			remapLUTs.set(clip.id, lut);
			remapLUTSignatures.set(clip.id, signature);
		}
	}
	for (const clipId of remapLUTs.keys()) {
		if (!activeClipIds.has(clipId)) {
			remapLUTs.delete(clipId);
			remapLUTSignatures.delete(clipId);
			deleteLiveWsolaForClip(clipId);
		}
	}
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
		customAnimCaptionPresets,
		transitions,
		markers,
		sources: currentProjectSources(),
		masterGain,
		exportSettings: lastExportSettings ?? undefined,
		exportPresets: exportPresets.filter((p) => !p.builtIn),
		renderQueueHistory: serializeQueueHistory(queueState),
		replayBufferConfig: replayRing.getConfig(),
		liveAudioChainConfig: liveChainConfig,
		voiceCleanup: voiceCleanupSettings,
		sessionEventLogs,
		// Phase 34: persist the user's beat-grid settings so re-opening a
		// project keeps the same enabled sources and global offset (the
		// per-source beat times themselves ride in the bundle's beats cache).
		beatSettings:
			beatSettings.enabledSourceIds.length > 0 || beatSettings.globalOffsetMs !== 0
				? { ...beatSettings, enabledSourceIds: [...beatSettings.enabledSourceIds] }
				: undefined,
		// Phase 39: persist project format and cover frame.
		projectFormat,
		cover: cover ?? undefined,
		scenes: programSceneDoc
	});
	await saveStoredProject(doc);
}

function runAutosave(): Promise<void> {
	const save: Promise<void> = persistCurrentProject()
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
		// eslint-disable-next-line typescript/unbound-method -- optional API; called with explicit `this`
		const queryPermission = handle.queryPermission;
		if (queryPermission) {
			const state = await queryPermission.call(handle, permissionRequest);
			if (state === 'denied') return null;
			if (state === 'granted') return await handle.getFile();
		}
		// eslint-disable-next-line typescript/unbound-method -- optional API; called with explicit `this`
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
		mediaHandle = await openMediaFile(
			file,
			descriptor.sourceId,
			undefined,
			currentCapabilityProbe?.imageDecoder
		);
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
	if (skinSmoothBypassMap.size > 0) {
		const liveIds = new Set(timeline.flatMap((t) => t.clips.map((c) => c.id)));
		for (const id of skinSmoothBypassMap.keys()) {
			if (!liveIds.has(id)) skinSmoothBypassMap.delete(id);
		}
	}
	if (options.syncLuts !== false) {
		syncTimelineLuts();
	}
	syncRemapLuts();
	// Refresh title rasters (no-op on unchanged content) before re-rendering so
	// the cached texture is current when playback refreshes the frame.
	syncTitleRasters();
	syncCalloutRasters();
	if (!playback) {
		setupPlayback();
	}
	ensureClockAndTimeline();
	postHistoryState();
	postRecoveryCheckpoint();
	postCleanedAudioWarnings();
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
		markers,
		voiceCleanup: voiceCleanupSettings,
		projectFormat: { ...projectFormat } as ProjectFormat,
		cover: cover ? ({ ...cover } as CoverFrameDoc) : null
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
	previewCanvas = canvas;
	currentScopeSab = scopeSab ?? null;
	currentScopesEnabled = false;
	currentZebraEnabled = false;
	cancelRendererDeviceLossWatch();
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

		if (renderer) {
			// Phase 21: wire scope SAB. The renderer stays off until the UI sends
			// 'toggle-scopes' on first ScopePanel expansion — no point burning GPU
			// time on dispatches whose results no one is reading.
			if (currentScopeSab) {
				renderer.setScopeSab(currentScopeSab);
			}
			rebuildRendererTextureCaches();
			watchRendererDeviceLoss(renderer.gpuDevice);
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
		doc.sources.length > 0 ||
		(doc.scenes?.scenes.length ?? 0) > 0
	);
}

function currentProjectIsEmpty(): boolean {
	return (
		sourceInputs.size === 0 &&
		timelineSourceIds().size === 0 &&
		captionTracks.every((track) => track.segments.length === 0) &&
		transitions.length === 0 &&
		markers.length === 0 &&
		(programSceneDoc?.scenes.length ?? 0) === 0
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
	programSceneDoc = cloneSceneDocForWorker(doc.scenes);
	sessionEventLogs = (doc.sessionEventLogs ?? []).map((ref) => ({ ...ref }));
	syncTimelineLuts();
	syncRemapLuts();
	lastExportSettings = doc.exportSettings ?? null;
	exportPresets = (doc.exportPresets ?? []).filter((p) => !p.builtIn);
	customAnimCaptionPresets = doc.customAnimCaptionPresets ?? [];
	// Tell the UI about the restored custom presets so the picker shows them.
	post({ type: 'caption-custom-presets-updated', presets: customAnimCaptionPresets });
	queueState = createEmptyQueueState();
	if (doc.renderQueueHistory) {
		queueState = { ...queueState, jobs: deserializeQueueHistory(doc.renderQueueHistory) };
	}
	masterGain = doc.masterGain;
	applyProjectPhase46Config(doc);
	// Phase 39: restore project format and cover frame from saved doc.
	projectFormat = doc.projectFormat ? { ...doc.projectFormat } : { aspect: '16:9' };
	cover = doc.cover ? { ...doc.cover } : null;
	post({ type: 'project-format-changed', aspect: projectFormat.aspect });
	post({ type: 'cover-frame-changed', cover });
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
	syncCalloutRasters();
	ensureClockAndTimeline();
	postHistoryState();
	postPresetsState();
	postQueueState();
	postProgramScenes();
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
	// Phase 30: custom caption presets are project-scoped — clear them so they
	// don't leak from the previous project into the new one. Notify the UI so
	// the inspector's preset picker drops the stale entries.
	customAnimCaptionPresets = [];
	post({ type: 'caption-custom-presets-updated', presets: [] });
	markers = [];
	programSceneDoc = null;
	masterGain = DEFAULT_MASTER_GAIN;
	sessionEventLogs = [];
	if (capture) requestCaptureStop();
	replayRing.updateConfig({ ...DEFAULT_RING_BUFFER_CONFIG });
	liveChainConfig = cloneLiveChainConfig(DEFAULT_LIVE_AUDIO_CHAIN_CONFIG);
	voiceCleanupSettings = { ...DEFAULT_VOICE_CLEANUP_SETTINGS };
	// Phase 39: reset project format and cover frame
	projectFormat = { aspect: '16:9' };
	cover = null;
	// Phase 34: cancel any running beat analysis and clear cached results +
	// grid settings so the next project starts fresh. Without this, a new
	// import would inherit the previous project's BPM/beat grid via the
	// re-used source-id numbering (nextSourceId resets to 1 above).
	for (const controller of beatAnalysisCancels.values()) controller.abort();
	beatAnalysisCancels.clear();
	beatResultCache.clear();
	beatSettings = { enabledSourceIds: [], globalOffsetMs: 0 };
	postReplayBufferState();
	postLiveChainState();
	postVoiceCleanupState();
	ensureClockAndTimeline();
	postMediaAssets();
	postHistoryState();
	postPresetsState();
	postQueueState();
	postProgramScenes();
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
	// Loop survives the per-edit setupPlayback rebuilds, but a project teardown
	// (new project / restore) returns to the off-by-default state so it can't
	// desync from the UI mirror, which resets in resetProjectUiState.
	loopEnabled = false;
	frameCache?.clear();
	frameCache = null;
	secondaryFrameSources.disposeAll();
	for (const handle of sourceInputs.values()) {
		handle.dispose();
	}
	sourceInputs.clear();
	binSourceIds.clear();
	clipboardLuts.clear();
	skinSmoothBypassMap.clear();
	remapLUTs.clear();
	remapLUTSignatures.clear();
	liveWsolaStretchers.clear();
	primaryHandle = null;
	retainedOverlayTextureIds.clear();
	// Release cached title textures: clearing the timeline here (new project,
	// re-import, restore) would otherwise orphan them until worker disposal.
	titleCache?.retain(EMPTY_CLIP_IDS);
	timeline = createEmptyTimeline();
	captionTracks = [];
	customAnimCaptionPresets = [];
	transitions = [];
	markers = [];
	sessionEventLogs = [];
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
 * Edit-path raster sync: rasterises every title clip (a no-op when the content
 * hash is unchanged) and drops cached textures for titles no longer present.
 * Called after timeline mutations and once fonts/GPU are ready — never per
 * frame. Pre-rasterises every caption raster target the project needs,
 * including each per-word karaoke highlight variant, so the playback hot path
 * can read straight from cache without invoking Canvas2D or uploading a new
 * texture on word-boundary crossings.
 */
function syncTitleRasters(): void {
	if (!titleCache) return;
	const active = new Set<string>(retainedOverlayTextureIds);
	for (const { clip } of titleClips()) {
		active.add(clip.id);
		titleCache.rasterize(clip.id, clip.title!);
	}
	for (const target of enumerateCaptionRasterTargets(captionTracks, customAnimCaptionPresets)) {
		active.add(target.textureId);
		titleCache.rasterize(target.textureId, target.content, target.extras);
	}
	titleCache.retain(active);
}

function isRasterCalloutClip(clip: TimelineClip): boolean {
	const kind = clip.callout?.calloutKind;
	return kind === 'arrow' || kind === 'box' || kind === 'step';
}

function syncCalloutRasters(): void {
	if (!calloutCache) return;
	const active = new Set<string>();
	for (const track of timeline) {
		if (track.type !== 'video') continue;
		for (const clip of track.clips) {
			if (!isCalloutClip(clip) || !clip.callout || !isRasterCalloutClip(clip)) continue;
			active.add(clip.id);
			calloutCache.rasterize(clip.id, clip.callout, 1920, 1080);
		}
	}
	calloutCache.retain(active);
}

function exportCaptionTextureId(exportId: string, trackId: string, segmentId: string): string {
	return `export-caption:${exportId}:${trackId}:${segmentId}`;
}

/**
 * Rewrite an edit-path caption textureId (`caption:<trk>:<seg>` or
 * `caption:<trk>:<seg>:highlight:<idx>`) onto the export-path namespace
 * (`export-caption:<exportId>:<trk>:<seg>[…]`). Preserves the karaoke variant
 * suffix so the export cache reads its pre-rasterised per-word texture rather
 * than collapsing to the base id (which is what the prior remap callback,
 * `(trackId, segmentId) => …`, did — silently dropping karaoke highlighting
 * from every export).
 */
function remapToExportCaptionTextureId(exportId: string, editPathId: string): string {
	return editPathId.replace(/^caption:/, `export-caption:${exportId}:`);
}

function rasterizeExportCaptionTextures(
	exportId: string,
	tracks: readonly CaptionTrack[]
): string[] {
	if (!titleCache) return [];
	// Mirror the edit-path pre-rasterise pass under the per-export texture
	// namespace. Without this, removing the hot-path `ensure()` from
	// `activeCaptionLayersAt` would leave the export with empty texture cache
	// entries — burned-in captions would render as black holes, and karaoke
	// variants would never exist at all. Returns every textureId touched so
	// the caller can hand them to releaseRetainedOverlayTextures on teardown.
	const baseFor = (trackId: string, segmentId: string): string =>
		exportCaptionTextureId(exportId, trackId, segmentId);
	const idMaker: CaptionTextureIdMaker = Object.assign(baseFor, {
		withVariant: (trackId: string, segmentId: string, variant: `highlight:${number}`) =>
			`${baseFor(trackId, segmentId)}:${variant}`
	});
	const touched: string[] = [];
	for (const target of enumerateCaptionRasterTargets(tracks, customAnimCaptionPresets, idMaker)) {
		retainedOverlayTextureIds.add(target.textureId);
		titleCache.rasterize(target.textureId, target.content, target.extras);
		touched.push(target.textureId);
	}
	return touched;
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
	remapTextureId: (editPathTextureId: string) => string = (id) => id
): Array<{
	clipId: string;
	content: TitleContent;
	transform: TransformParams;
	animUniforms: CaptionAnimUniforms;
}> {
	const layers: Array<{
		clipId: string;
		content: TitleContent;
		transform: TransformParams;
		animUniforms: CaptionAnimUniforms;
	}> = [];
	for (const payload of activeCaptionPayloadsAt(tracks, timestamp, customAnimCaptionPresets)) {
		// The payload's textureId already encodes the karaoke variant when
		// applicable. The remap callback lets the export path rewrite to its
		// own `export-caption:<exportId>:…` namespace WITHOUT dropping the
		// variant (the prior 2-arg callback signature did exactly that, so
		// karaoke captions exported as unhighlighted base text). The pre-
		// rasterise pass in syncTitleRasters (edit) and rasterizeExport-
		// CaptionTextures (export) has already populated the cache for every
		// variant — this is a read-only hot path, NEVER a Canvas2D / GPU
		// upload site. Hard gate 1: no sustained rasterisation on playback.
		const clipId = remapTextureId(payload.textureId);
		layers.push({
			clipId,
			content: payload.content,
			transform: payload.transform,
			animUniforms: payload.animUniforms
		});
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
			skinMask?: import('./skin-smooth').SkinMaskParams;
			skinSmoothBypass?: boolean;
			beauty?: import('../protocol').BeautyEffectSnapshot;
			/** Phase 32b: smoothed/interpolated primary-face landmarks for this frame. */
			beautyLandmarks?: Float32Array;
			/** Phase 43: per-clip padded-background compositor sidecar. */
			paddedBackground?: import('../protocol').PaddedBackgroundParams;
			transition?: import('./timeline').TransitionResolveMeta;
			/** Phase 21: per-clip source colour metadata for normalize. */
			colorMetadata?: import('./colour').ColorMetadata;
			/** Phase 31: smoothed alpha view from the matte engine, if enabled. */
			matteView?: GPUTextureView;
			/** Phase 31: matte strength (0..1). */
			matteStrength?: number;
			/** Phase 31: matte mode (remove/replace/blur). */
			matteMode?: 'remove' | 'replace' | 'blur';
			/** Phase 31: blur-mode background radius (px). */
			matteBlurRadius?: number;
	  }
	| {
			kind: 'title';
			clipId: string;
			content: TitleContent;
			transform: TransformParams;
			/** Phase 30: caption animation uniforms; CAPTION_ANIM_IDENTITY for non-caption title clips. */
			animUniforms: CaptionAnimUniforms;
			transition?: import('./timeline').TransitionResolveMeta;
	  }
	| {
			kind: 'callout-texture';
			clipId: string;
			transform: TransformParams;
			transition?: import('./timeline').TransitionResolveMeta;
	  }
	| {
			kind: 'callout-effect';
			effect: 'spotlight' | 'blur-region';
			transform: TransformParams;
			darkenStrength?: number;
			blurRadius?: number;
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
		const layoutClip = resolveLayoutAt(timeline, timestamp);
		const layers = resolveAllAt(timeline, timestamp, transitions);
		const arrangedLayers = applyProgramLayoutToResolvedLayers(layers, layoutClip);
		// Same-source transition pairs route the incoming side through a secondary
		// sink so the two cut sides don't keyframe-re-seek each other (T2.2).
		const secondarySinkLayers = sharedSourceIncomingLayers(layers);
		const budget = layerBudgetFromProbe(currentProbe);
		const decodedLayers: DecodedLayer<LayerMeta>[] = [];
		let decodedCount = 0;
		let overBudget = false;
		try {
			for (const arranged of arrangedLayers) {
				const { layer, layoutLayer } = arranged;
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
							transform: layoutLayer
								? normalizeTransform(layoutLayer.transform)
								: sampled.transform,
							animUniforms: CAPTION_ANIM_IDENTITY,
							transition: layer.transition
						}
					});
					continue;
				}
				if (isCalloutClip(layer.clip)) {
					const sampled = sampleClipParamsAt(layer.clip, timestamp);
					const callout = layer.clip.callout;
					if (!callout) continue;
					if (!isRasterCalloutClip(layer.clip)) {
						decodedLayers.push({
							decoded: null,
							meta: {
								kind: 'callout-effect',
								effect: callout.calloutKind === 'spotlight' ? 'spotlight' : 'blur-region',
								transform: sampled.transform,
								darkenStrength: callout.style.darkenStrength,
								blurRadius: callout.style.blurRadius,
								transition: layer.transition
							}
						});
						continue;
					}
					decodedLayers.push({
						decoded: null,
						meta: {
							kind: 'callout-texture',
							clipId: layer.clip.id,
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
				const sourceTimestamp = resolveSourceTimestampWithRemap({
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
				// Phase 31: per-frame zero-copy matte inference. Preview never stalls —
				// the engine returns the previous alpha (or null) while busy/loading.
				let matteView: GPUTextureView | undefined;
				const matte = layer.clip.matte;
				if (matte?.enabled) {
					const engine = ensureMatteEngine();
					if (engine) {
						if (!engine.compositesOnRendererDevice) {
							if (!matteCompositingUnavailableWarned) {
								matteCompositingUnavailableWarned = true;
								recordRecentError({
									code: 'matte.compositing_unavailable',
									subsystem: 'matte',
									severity: 'warning',
									message:
										'Matte backend did not provide renderer-device views; showing the clip without the matte.'
								});
							}
						} else {
							// A matte inference failure must NEVER blank the video — degrade
							// to the unmatted frame and report once. Keeping this catch local
							// (not in makeGetLayers' outer try) is what preserves the frame.
							try {
								matteView =
									(await engine.matteViewFor({
										clipId: layer.clip.id,
										modelKey: matte.modelKey,
										frame: decoded.toVideoFrame(),
										sourceTimeS: sourceTimestamp.adapterTimestampS,
										frameStepS: handle.frameRate > 0 ? 1 / handle.frameRate : 1 / 30,
										quality: 'preview'
									})) ?? undefined;
							} catch (error) {
								matteView = undefined;
								recordRecentError({
									code: 'matte.inference_failed',
									subsystem: 'matte',
									severity: 'warning',
									message: `Portrait matte inference failed; showing the clip without the matte. ${errorMessage(error)}`
								});
							}
						}
					}
				}
				// Phase 32b: per-frame zero-copy landmark solve. Like matte, preview never
				// stalls — the engine returns the latest interpolated landmarks (or null)
				// while a solve runs. Gated on a loaded model, so it's inert (no clone, no
				// work) until a license-verified model is vendored (template → not loaded).
				let beautyLandmarks: Float32Array | undefined;
				const beauty = sampled.beauty;
				if (beauty?.enabled && beautyEngine?.getStatus() === 'loaded') {
					try {
						beautyLandmarks =
							(await beautyEngine.solveFrame({
								clipId: layer.clip.id,
								frame: decoded.toVideoFrame(),
								timeS: timestamp,
								beauty,
								quality: 'preview'
							})) ?? undefined;
					} catch (error) {
						beautyLandmarks = undefined;
						recordRecentError({
							code: 'beauty.inference_failed',
							subsystem: 'beauty',
							severity: 'warning',
							message: `Beauty landmark inference failed; showing the clip without beauty. ${errorMessage(error)}`
						});
					}
				}
				decodedCount += 1;
				const colorMetadata = colorMetadataForSource(layer.clip.sourceId);
				decodedLayers.push({
					decoded,
					meta: {
						kind: 'frame',
						effects: sampled.effects,
						transform: layoutLayer ? normalizeTransform(layoutLayer.transform) : sampled.transform,
						lut: layer.clip.lut,
						skinMask: layer.clip.skinMask,
						skinSmoothBypass: skinSmoothBypassMap.get(layer.clip.id) ?? false,
						transition: layer.transition,
						colorMetadata,
						matteView,
						matteStrength: matte?.enabled ? matte.strength : undefined,
						matteMode: matte?.enabled ? matte.mode : undefined,
						matteBlurRadius: matte?.enabled ? matte.blurRadius : undefined,
						beauty: sampled.beauty,
						beautyLandmarks,
						paddedBackground: layer.clip.paddedBackground
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
						transform: caption.transform,
						animUniforms: caption.animUniforms
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
		handle = await openMediaFile(file, sourceId, undefined, currentCapabilityProbe?.imageDecoder);
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
		// A BlockedImportError carries a structured health report (e.g. unsupported
		// .lottie zip). Surface that to the UI as a source-health warning instead
		// of just a generic import-failed error toast.
		if (e instanceof BlockedImportError) {
			postSourceHealth({
				sourceId: e.inspection.sourceId,
				fileName: e.inspection.fileName,
				status: 'blocked',
				warnings: e.warnings
			});
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
	// eslint-disable-next-line unicorn/no-useless-spread — snapshot needed: deletes during iteration
	for (const [id, handle] of [...sourceInputs.entries()]) {
		if (binSourceIds.has(id)) continue;
		secondaryFrameSources.release(id);
		handle.dispose();
		sourceInputs.delete(id);
		thumbnailGen?.cancelSource(id);
		// Phase 34: abort and drop any beat-analysis state for the gone source
		// so we don't reference its id post-disposal and so Beat Detection can
		// re-run if it's re-imported under a fresh source id.
		beatAnalysisCancels.get(id)?.abort();
		beatAnalysisCancels.delete(id);
		beatResultCache.delete(id);
		if (beatSettings.enabledSourceIds.includes(id)) {
			beatSettings = {
				...beatSettings,
				enabledSourceIds: beatSettings.enabledSourceIds.filter((s) => s !== id)
			};
		}
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
	for (const ref of expanded) {
		matteEngine?.deleteClip(ref.clipId);
		beautyEngine?.deleteClip(ref.clipId);
	}
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
	for (const ref of expanded) {
		matteEngine?.deleteClip(ref.clipId);
		beautyEngine?.deleteClip(ref.clipId);
	}
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

function handleReplaceKeyframeTracks(
	cmd: Extract<WorkerCommand, { type: 'replace-keyframe-tracks' }>
) {
	// Phase 33 R7.5: write all generated reframe tracks (and the fill fit mode)
	// as a single undo entry. No coalesce key so it never merges with a
	// neighbouring keyframe edit.
	commitTimelineMutation(
		() => replaceClipKeyframeTracks(timeline, cmd.trackId, cmd.clipId, cmd.tracks, cmd.fit),
		{ refreshPlayback: 'refresh', prune: false, syncLuts: false }
	);
}

async function handleGetSourceFile(
	cmd: Extract<WorkerCommand, { type: 'get-source-file' }>
): Promise<void> {
	try {
		const resolve = makeStoredSourceResolver(loadStoredSource, fileFromHandle);
		const file = await resolve(cmd.sourceId);
		if (!file) {
			post({
				type: 'source-file-error',
				requestId: cmd.requestId,
				message: 'Source media is offline — re-link it before running Smart Reframe.'
			});
			return;
		}
		// The File is structured-clone-copied to the UI (and again to the analysis
		// worker), so a GB-scale source is briefly duplicated in memory. Acceptable
		// for the user-initiated, one-clip Smart Reframe flow; revisit with a
		// transferable handle / streaming source if it becomes a problem.
		post({ type: 'source-file', requestId: cmd.requestId, file });
	} catch (error) {
		post({ type: 'source-file-error', requestId: cmd.requestId, message: errorMessage(error) });
	}
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

async function handleImportLookPreset(
	cmd: Extract<WorkerCommand, { type: 'import-look-preset' }>
): Promise<void> {
	const { parseLookPreset, applyLookPresetToClip } = await import('./look-preset');
	let preset;
	try {
		const text = await cmd.presetFile.text();
		const json = JSON.parse(text);
		preset = parseLookPreset(json);
	} catch {
		post({ type: 'look-preset-error', clipId: cmd.clipId, reason: 'Invalid JSON file.' });
		return;
	}
	if (!preset) {
		post({
			type: 'look-preset-error',
			clipId: cmd.clipId,
			reason: 'Invalid look preset: missing or invalid fields.'
		});
		return;
	}

	let lut: ClipLut | null = null;
	if (cmd.lutFile) {
		if (!renderer) {
			// Paired LUT but no GPU renderer → can't apply the preset's intended look.
			// Refuse the whole import so the clip isn't left in a half-themed state.
			post({
				type: 'look-preset-error',
				clipId: cmd.clipId,
				reason: 'LUT import requires the accelerated WebGPU renderer.'
			});
			return;
		}
		try {
			lut = await clipLutFromCubeFile(cmd.lutFile);
		} catch (error) {
			// A bad LUT means the look preset and its paired LUT cannot ship
			// together; treat the import as atomic and abort, rather than silently
			// committing the look params without the LUT.
			const message = error instanceof Error ? error.message : String(error);
			post({
				type: 'look-preset-error',
				clipId: cmd.clipId,
				reason: `Could not import LUT: ${message}`
			});
			return;
		}
	}

	commitTimelineMutation(
		() => {
			let nextTimeline = timeline.map((track) => {
				if (track.id !== cmd.trackId) return track;
				return {
					...track,
					clips: track.clips.map((clip) => {
						if (clip.id !== cmd.clipId) return clip;
						return applyLookPresetToClip(preset, clip);
					})
				};
			});
			if (lut) {
				nextTimeline = setClipLut(nextTimeline, cmd.trackId, cmd.clipId, lut);
			}
			return nextTimeline;
		},
		{ coalesceKey: { clipId: cmd.clipId, key: 'look-preset' }, refreshPlayback: 'refresh' }
	);
}

async function handleExportLookPreset(
	cmd: Extract<WorkerCommand, { type: 'export-look-preset' }>
): Promise<void> {
	const { serializeLookPreset } = await import('./look-preset');
	const track = timeline.find((t) => t.id === cmd.trackId);
	const clip = track?.clips.find((c) => c.id === cmd.clipId);
	if (!clip) {
		post({ type: 'look-preset-error', clipId: cmd.clipId, reason: 'Clip not found.' });
		return;
	}
	const preset = {
		lookSchemaVersion: 1 as const,
		name: `Look ${clip.id.slice(0, 8)}`,
		params: {
			grainStrength: clip.effects.grainStrength,
			grainSize: clip.effects.grainSize,
			halationThreshold: clip.effects.halationThreshold,
			halationRadius: clip.effects.halationRadius,
			halationTintR: clip.effects.halationTintR,
			halationTintG: clip.effects.halationTintG,
			halationTintB: clip.effects.halationTintB,
			vignetteAmount: clip.effects.vignetteAmount,
			vignetteFeather: clip.effects.vignetteFeather,
			vignetteRoundness: clip.effects.vignetteRoundness
		},
		...(clip.lut ? { lut: { fileName: clip.lut.fileName, fingerprint: clip.lut.key } } : {})
	};
	post({
		type: 'look-preset-exported',
		clipId: cmd.clipId,
		json: serializeLookPreset(preset),
		lutFileName: clip.lut?.fileName
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

function handleSetSkinMask(cmd: Extract<WorkerCommand, { type: 'set-skin-mask' }>) {
	commitTimelineMutation(
		() => setSkinMask(timeline, cmd.trackId, cmd.clipId, normalizeSkinMask(cmd.mask)),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'skinMask' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSetSkinSmoothBypass(
	cmd: Extract<WorkerCommand, { type: 'set-skin-smooth-bypass' }>
) {
	skinSmoothBypassMap.set(cmd.clipId, cmd.bypass);
	// Re-render the current frame (same pattern as set-effect-param with refreshPlayback: 'refresh').
	playback?.refresh();
}

function handleSetMatteEnabled(cmd: Extract<WorkerCommand, { type: 'set-matte-enabled' }>) {
	commitTimelineMutation(
		() => setClipMatteEnabled(timeline, cmd.trackId, cmd.clipId, cmd.enabled),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'matteEnabled' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
	// Toggling either way drops temporal state and cached alpha — re-enable
	// recomputes cleanly (R4.2).
	matteEngine?.deleteClip(cmd.clipId);
}

function handleSetMatteStrength(cmd: Extract<WorkerCommand, { type: 'set-matte-strength' }>) {
	commitTimelineMutation(
		() => setClipMatteStrength(timeline, cmd.trackId, cmd.clipId, cmd.strength),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'matteStrength' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

function handleSetMatteMode(cmd: Extract<WorkerCommand, { type: 'set-matte-mode' }>) {
	commitTimelineMutation(() => setClipMatteMode(timeline, cmd.trackId, cmd.clipId, cmd.mode), {
		coalesceKey: { clipId: cmd.clipId, key: 'matteMode' },
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
}

function handleSetMatteBlurRadius(cmd: Extract<WorkerCommand, { type: 'set-matte-blur-radius' }>) {
	commitTimelineMutation(
		() => setClipMatteBlurRadius(timeline, cmd.trackId, cmd.clipId, cmd.blurRadius),
		{
			coalesceKey: { clipId: cmd.clipId, key: 'matteBlurRadius' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);
}

// ── Phase 35: Time Remapping ──

/**
 * Resolve source timestamp with optional time-remap. If the clip has a
 * timeRemap set and a LUT is available, the clip-local output time is
 * remapped through the LUT before resolving the source timestamp.
 */
function resolveSourceTimestampWithRemap(options: {
	clip: TimelineClip;
	timelineTime: number;
	trackKind: 'video' | 'audio';
	timing: import('./media-adapters/types').NormalizedSourceTiming;
}): SourceTimestampResolution {
	const { clip, timelineTime, trackKind, timing } = options;

	if (clip.timeRemap) {
		const lut = remapLUTs.get(clip.id);
		if (lut) {
			const clipLocalOutTimeS = timelineTime - clip.start;
			const remappedSourceS = remapOutputToSource(lut, clipLocalOutTimeS) + clip.inPoint;
			return resolveNormalizedSourceTimestamp(timing, trackKind, remappedSourceS);
		}
	}

	return resolveSourceTimestamp({ clip, timelineTime, trackKind, timing });
}

function speedRatioForRemap(clip: TimelineClip, timelineTime: number): number {
	if (!clip.timeRemap) return 1;
	return sampleRemapSpeed(clip.timeRemap.keyframes, timelineTime - clip.start);
}

function deleteLiveWsolaForClip(clipId: string): void {
	for (const key of liveWsolaStretchers.keys()) {
		if (key === clipId || key.startsWith(`${clipId}:`)) {
			liveWsolaStretchers.delete(key);
		}
	}
}

function liveWsolaForClip(clip: TimelineClip, channels: number): WsolaStretcher | undefined {
	if (!clip.timeRemap?.pitchPreserve) return undefined;
	const key = `${clip.id}:${channels}`;
	let stretcher = liveWsolaStretchers.get(key);
	if (!stretcher) {
		stretcher = new WsolaStretcher(channels);
		liveWsolaStretchers.set(key, stretcher);
	}
	return stretcher;
}

async function pcmWindowForRemap(options: {
	handle: MediaInputHandle;
	clip: TimelineClip;
	timelineTime: number;
	sourceTime: SourceTimestampResolution;
	frameCount: number;
	channels: number;
	sampleRate: number;
	wsola?: WsolaStretcher;
}): Promise<Float32Array> {
	const { handle, clip, timelineTime, sourceTime, frameCount, channels, sampleRate, wsola } =
		options;
	const audioSource = handle.audioSource;
	if (!audioSource) return new Float32Array(Math.max(0, frameCount) * channels);
	if (!clip.timeRemap) {
		return audioSource.pcmWindowAt(sourceTime.adapterTimestampS, frameCount, channels, sampleRate);
	}

	const speedRatio = speedRatioForRemap(clip, timelineTime);
	if (!clip.timeRemap.pitchPreserve) {
		return audioSource.pcmWindowAt(
			sourceTime.adapterTimestampS,
			frameCount,
			channels,
			sampleRate / speedRatio
		);
	}

	const inputFrames = Math.max(
		WSOLA_WINDOW_SAMPLES,
		Math.ceil(frameCount * Math.max(1, speedRatio)) + WSOLA_INPUT_PAD_FRAMES
	);
	const input = await audioSource.pcmWindowAt(
		sourceTime.adapterTimestampS,
		inputFrames,
		channels,
		sampleRate
	);
	return (wsola ?? new WsolaStretcher(channels)).stretch(input, speedRatio, frameCount);
}

/** Find a clip and its track in the authoritative timeline. */
function findClipInTimeline(
	trackId: string,
	clipId: string
): { track: TimelineTrack; clip: TimelineClip; clipIndex: number } | null {
	for (const track of timeline) {
		if (track.id !== trackId) continue;
		const clipIndex = track.clips.findIndex((c) => c.id === clipId);
		if (clipIndex < 0) return null;
		return { track, clip: track.clips[clipIndex]!, clipIndex };
	}
	return null;
}

/** Compute the maximum allowed output duration for a clip (gap to next clip or track end). */
function maxAllowedDurationForClip(track: TimelineTrack, clipIndex: number): number {
	const clip = track.clips[clipIndex]!;
	const nextClip = track.clips[clipIndex + 1];
	if (nextClip) {
		return Math.max(0, nextClip.start - clip.start);
	}
	// No next clip — allow up to a generous maximum (6 hours)
	return 21600;
}

interface TimeRemapTarget {
	track: TimelineTrack;
	clip: TimelineClip;
	clipIndex: number;
}

function timeRemapTargetsFor(root: TimelineClip): TimeRemapTarget[] {
	const targets: TimeRemapTarget[] = [];
	for (const track of timeline) {
		for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex += 1) {
			const clip = track.clips[clipIndex]!;
			const matches =
				clip.id === root.id ||
				(root.linkedGroupId !== undefined && clip.linkedGroupId === root.linkedGroupId);
			if (matches) targets.push({ track, clip, clipIndex });
		}
	}
	return targets;
}

function handleSetTimeRemap(cmd: Extract<WorkerCommand, { type: 'set-time-remap' }>) {
	const found = findClipInTimeline(cmd.trackId, cmd.clipId);
	if (!found) {
		post({
			type: 'time-remap-error',
			trackId: cmd.trackId,
			clipId: cmd.clipId,
			reason: 'speed-out-of-range'
		});
		return;
	}

	const { clip } = found;
	const remap = cmd.remap;

	// Validate speed range
	for (const kf of remap.keyframes) {
		if (kf.speed < 0.25 || kf.speed > 4.0) {
			post({
				type: 'time-remap-error',
				trackId: cmd.trackId,
				clipId: cmd.clipId,
				reason: 'speed-out-of-range'
			});
			return;
		}
	}

	// Validate no duplicate outTimeS (within 1e-4 s)
	for (let i = 0; i < remap.keyframes.length - 1; i += 1) {
		for (let j = i + 1; j < remap.keyframes.length; j += 1) {
			if (Math.abs(remap.keyframes[i]!.outTimeS - remap.keyframes[j]!.outTimeS) < 1e-4) {
				post({
					type: 'time-remap-error',
					trackId: cmd.trackId,
					clipId: cmd.clipId,
					reason: 'duplicate-keyframe'
				});
				return;
			}
		}
	}

	// Sort keyframes by outTimeS
	const sortedKeyframes = [...remap.keyframes].sort((a, b) => a.outTimeS - b.outTimeS);
	const targets = timeRemapTargetsFor(clip);
	// Phase 35: linked A/V groups must share the same output duration to stay in
	// sync, so the cap is the *minimum* of every linked target's allowed length.
	const sharedMaxAllowedS = targets.reduce(
		(acc, target) => Math.min(acc, maxAllowedDurationForClip(target.track, target.clipIndex)),
		Number.POSITIVE_INFINITY
	);
	const targetStates = targets.map((target) => {
		const sourceDurationS = timeRemapSourceDuration(target.clip.timeRemap, target.clip.duration);
		const lut = buildRemapLUT(sortedKeyframes, sourceDurationS);
		const outputDurationS = Math.min(lut.outputDurationS, sharedMaxAllowedS);
		return {
			...target,
			timeRemap: {
				keyframes: sortedKeyframes,
				pitchPreserve: remap.pitchPreserve,
				sourceDurationS
			} satisfies TimeRemapSnapshot,
			outputDurationS,
			capped: outputDurationS < lut.outputDurationS
		};
	});
	const targetIds = new Set(targetStates.map((target) => target.clip.id));
	const selectedState = targetStates.find((target) => target.clip.id === cmd.clipId);
	let capped = false;
	for (const target of targetStates) {
		if (target.capped) capped = true;
		deleteLiveWsolaForClip(target.clip.id);
	}

	// Apply the mutation
	commitTimelineMutation(
		() => {
			return timeline.map((t) => {
				return {
					...t,
					clips: t.clips.map((c) => {
						if (!targetIds.has(c.id)) return c;
						const state = targetStates.find((target) => target.clip.id === c.id);
						if (!state) return c;
						return {
							...c,
							timeRemap: state.timeRemap,
							duration: state.outputDurationS
						};
					})
				};
			});
		},
		{
			coalesceKey: { clipId: cmd.clipId, key: 'timeRemap' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);

	post({
		type: 'time-remap-updated',
		trackId: cmd.trackId,
		clipId: cmd.clipId,
		outputDurationS: selectedState?.outputDurationS ?? clip.duration
	});

	if (capped) {
		post({
			type: 'time-remap-error',
			trackId: cmd.trackId,
			clipId: cmd.clipId,
			reason: 'remap-capped'
		});
	}
}

function handleClearTimeRemap(cmd: Extract<WorkerCommand, { type: 'clear-time-remap' }>) {
	const found = findClipInTimeline(cmd.trackId, cmd.clipId);
	if (!found) return;

	const { clip } = found;
	const targetStates = timeRemapTargetsFor(clip).map((target) => {
		const sourceDurationS = timeRemapSourceDuration(target.clip.timeRemap, target.clip.duration);
		const maxAllowed = maxAllowedDurationForClip(target.track, target.clipIndex);
		return {
			...target,
			restoredDuration: Math.min(sourceDurationS, maxAllowed)
		};
	});
	const targetIds = new Set(targetStates.map((target) => target.clip.id));
	const selectedState = targetStates.find((target) => target.clip.id === cmd.clipId);
	for (const target of targetStates) {
		remapLUTs.delete(target.clip.id);
		remapLUTSignatures.delete(target.clip.id);
		deleteLiveWsolaForClip(target.clip.id);
	}

	commitTimelineMutation(
		() => {
			return timeline.map((t) => {
				return {
					...t,
					clips: t.clips.map((c) => {
						if (!targetIds.has(c.id)) return c;
						const state = targetStates.find((target) => target.clip.id === c.id);
						if (!state) return c;
						return {
							...c,
							timeRemap: undefined,
							duration: state.restoredDuration
						};
					})
				};
			});
		},
		{
			coalesceKey: { clipId: cmd.clipId, key: 'timeRemap' },
			refreshPlayback: 'refresh',
			prune: false,
			syncLuts: false
		}
	);

	post({
		type: 'time-remap-updated',
		trackId: cmd.trackId,
		clipId: cmd.clipId,
		outputDurationS: selectedState?.restoredDuration ?? clip.duration
	});
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

// ── Phase 27: Local audio cleanup (WebNN RNNoise) ──
// The pipeline worker only extracts PCM (existing decode path) and routes the
// cleaned derived asset through explicit, undoable timeline state. Model
// inference never runs here; it lives in the separate Audio Cleanup worker.

/** Per-window extraction cap keeps each transferred PCM buffer small. */
const CLIP_AUDIO_WINDOW_MAX_S = 30;

/** Cleaned assets already flagged as missing this session (avoid re-warning). */
const warnedMissingCleanedAssets = new Set<string>();

function postCleanedAudioWarnings(): void {
	for (const track of timeline) {
		if (track.type !== 'audio') continue;
		for (const clip of track.clips) {
			const ref = clip.cleanedAudio;
			if (!ref || warnedMissingCleanedAssets.has(ref.assetId)) continue;
			// Only warn for assets the project no longer knows at all; offline
			// (re-linkable) sources go through the existing relink flow instead.
			if (sourceDescriptors.has(ref.assetId)) continue;
			if (!cleanedAudioMissing(clip, sourceInputs)) continue;
			warnedMissingCleanedAssets.add(ref.assetId);
			const original = sourceDescriptors.get(clip.sourceId);
			const fileName = original?.fileName ?? clip.sourceId;
			post({
				type: 'source-health',
				report: {
					sourceId: clip.sourceId,
					fileName,
					status: 'warnings',
					warnings: [
						{
							code: 'missing-cleaned-audio',
							severity: 'warning',
							blocking: false,
							sourceId: clip.sourceId,
							message: `Cleaned audio for "${fileName}" is unavailable; the original audio will play instead.`,
							details: { cleanedAssetId: ref.assetId, clipId: clip.id }
						}
					]
				}
			});
		}
	}
}

async function handleExtractClipAudio(
	cmd: Extract<WorkerCommand, { type: 'extract-clip-audio' }>
): Promise<void> {
	const fail = (message: string) =>
		post({ type: 'clip-audio-error', requestId: cmd.requestId, message });
	try {
		const track = timeline.find((t) => t.id === cmd.trackId);
		const clip = track?.clips.find((c) => c.id === cmd.clipId);
		if (!track || !clip) return fail('Clip not found.');
		if (isTitleClip(clip)) return fail('Title clips carry no audio.');
		const handle = sourceInputs.get(clip.sourceId);
		if (!handle?.audioSource) return fail('No decodable audio for this clip.');
		const sampleRate = Math.max(8000, Math.floor(cmd.sampleRate));
		const clipOffsetS = Math.max(0, cmd.clipOffsetS);
		if (clipOffsetS >= clip.duration) return fail('Requested window is past the clip end.');
		const durationS = Math.min(
			Math.max(0, cmd.durationS),
			CLIP_AUDIO_WINDOW_MAX_S,
			clip.duration - clipOffsetS
		);
		if (durationS <= 0) return fail('Requested window is empty.');
		const timelineTime = clip.start + clipOffsetS;
		const resolution = resolveSourceTimestampWithRemap({
			clip,
			timelineTime,
			trackKind: 'audio',
			timing: handle.timing
		});
		if (!resolution.available) return fail('Audio is unavailable at the requested time.');
		const channels = Math.max(1, Math.min(2, handle.audioChannels || 1));
		const frameCount = Math.max(1, Math.round(durationS * sampleRate));
		// Phase 35: when the clip has a remap with a varying speed curve the
		// single-window `pcmWindowForRemap` would freeze the speed at the start
		// of the request — wrong for curves spanning multiple speeds. Iterate in
		// chunks so each chunk samples its own local speed and (for pitch
		// preserve) reuses a persistent WSOLA stretcher across chunks.
		let pcm: Float32Array;
		if (clip.timeRemap) {
			pcm = new Float32Array(frameCount * channels);
			const chunkFrames = 1024;
			const localStretcher = clip.timeRemap.pitchPreserve
				? new WsolaStretcher(channels)
				: undefined;
			let written = 0;
			while (written < frameCount) {
				const chunk = Math.min(chunkFrames, frameCount - written);
				const chunkTimelineTime = clip.start + clipOffsetS + written / sampleRate;
				const chunkResolution = resolveSourceTimestampWithRemap({
					clip,
					timelineTime: chunkTimelineTime,
					trackKind: 'audio',
					timing: handle.timing
				});
				if (!chunkResolution.available) {
					written += chunk;
					continue;
				}
				const chunkPcm = await pcmWindowForRemap({
					handle,
					clip,
					timelineTime: chunkTimelineTime,
					sourceTime: chunkResolution,
					frameCount: chunk,
					channels,
					sampleRate,
					wsola: localStretcher
				});
				pcm.set(chunkPcm.subarray(0, chunk * channels), written * channels);
				written += chunk;
			}
		} else {
			pcm = await pcmWindowForRemap({
				handle,
				clip,
				timelineTime,
				sourceTime: resolution,
				frameCount,
				channels,
				sampleRate
			});
		}
		self.postMessage(
			{
				type: 'clip-audio',
				requestId: cmd.requestId,
				pcm,
				sampleRate,
				channels,
				clipOffsetS,
				clipDurationS: clip.duration
			} satisfies WorkerStateMessage,
			[pcm.buffer]
		);
	} catch (error) {
		fail(errorMessage(error));
	}
}

async function handleApplyAudioCleanup(
	cmd: Extract<WorkerCommand, { type: 'apply-audio-cleanup' }>
): Promise<void> {
	const fail = (message: string) =>
		post({
			type: 'audio-cleanup-applied',
			trackId: cmd.trackId,
			clipId: cmd.clipId,
			ok: false,
			message
		});
	const track = timeline.find((t) => t.id === cmd.trackId);
	const clip = track?.clips.find((c) => c.id === cmd.clipId);
	if (!track || !clip || isTitleClip(clip)) return fail('Clip not found.');
	if (cmd.durationS <= 0 || cmd.clipInPointS < 0) return fail('Invalid cleaned-audio range.');

	let assetId: string | null = null;
	let handle: MediaInputHandle | null = null;
	try {
		assetId = makeSourceId();
		handle = await openMediaFile(
			cmd.file,
			assetId,
			undefined,
			currentCapabilityProbe?.imageDecoder
		);
		if (!handle.audioSource) throw new Error('Cleaned WAV has no decodable audio track.');
		sourceInputs.set(assetId, handle);
		const descriptor = sourceDescriptorFromHandle(assetId, cmd.file, handle);
		sourceDescriptors.set(assetId, descriptor);
		await persistSourceBestEffort({ sourceId: assetId, descriptor, file: cmd.file });
		binSourceIds.add(assetId);

		const committed = commitTimelineMutation(
			() =>
				setClipCleanedAudio(timeline, cmd.trackId, cmd.clipId, {
					assetId: assetId!,
					clipInPointS: cmd.clipInPointS,
					durationS: cmd.durationS,
					modelId: cmd.modelId,
					modelVersion: cmd.modelVersion
				}),
			{ refreshPlayback: 'refresh', prune: false, syncLuts: false }
		);
		if (!committed) throw new Error('Timeline update failed.');
		postMediaAssets();
		post({
			type: 'audio-cleanup-applied',
			trackId: cmd.trackId,
			clipId: cmd.clipId,
			ok: true,
			assetId
		});
	} catch (error) {
		if (handle) handle.dispose();
		if (assetId) {
			sourceInputs.delete(assetId);
			sourceDescriptors.delete(assetId);
			binSourceIds.delete(assetId);
		}
		recordRecentError({
			code: 'audio_cleanup.apply_failed',
			subsystem: 'audio',
			severity: 'error',
			message: errorMessage(error)
		});
		fail(errorMessage(error));
	}
}

function handleRemoveAudioCleanup(
	cmd: Extract<WorkerCommand, { type: 'remove-audio-cleanup' }>
): void {
	commitTimelineMutation(() => setClipCleanedAudio(timeline, cmd.trackId, cmd.clipId, null), {
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
}

function handleAsrCreateCaptionTrack(
	cmd: Extract<WorkerCommand, { type: 'asr-create-caption-track' }>
): void {
	const track = createAsrCaptionTrack({
		segments: cmd.segments,
		trackName: cmd.trackName,
		language: cmd.language ?? null,
		engine: cmd.engine,
		accelerator: cmd.accelerator,
		phraseLevel: cmd.phraseLevel
	});
	commitCaptionMutation(() => [...captionTracks, track], {
		refreshPlayback: 'refresh'
	});
	post({
		type: 'asr-caption-track-created',
		trackId: track.id,
		track: {
			id: track.id,
			kind: track.kind,
			name: track.name,
			language: track.language,
			segments: track.segments.map((seg) => ({
				id: seg.id,
				start: seg.start,
				duration: seg.duration,
				text: seg.text,
				style: seg.style ?? null
			})),
			defaultStyle: {
				presetId: track.defaultStyle.presetId ?? null,
				overrides: track.defaultStyle.overrides,
				anchor: track.defaultStyle.anchor,
				insetPx: track.defaultStyle.insetPx,
				maxWidthPercent: track.defaultStyle.maxWidthPercent,
				lineWrap: track.defaultStyle.lineWrap
			},
			burnedIn: track.burnedIn,
			visible: track.visible,
			generatedBy: track.generatedBy ?? null
		}
	});
}

function handleAddTranslatedCaptionTrack(
	cmd: Extract<WorkerCommand, { type: 'add-translated-caption-track' }>
): void {
	// Defence-in-depth: assert segment count and per-segment timing were not
	// altered in transit. The UI copies start/duration verbatim from the source.
	for (const seg of cmd.segments) {
		if (typeof seg.start !== 'number' || typeof seg.duration !== 'number') {
			post({
				type: 'translated-caption-track-error',
				reason: 'malformed-segments',
				message:
					'Translated caption track rejected: at least one segment is missing a numeric start or duration.'
			});
			return;
		}
	}
	if (cmd.segments.length === 0) {
		post({
			type: 'translated-caption-track-error',
			reason: 'empty-segments',
			message:
				'Translated caption track rejected: the segment list is empty (nothing was translated).'
		});
		return;
	}
	const track = createTranslatedCaptionTrack({
		segments: cmd.segments,
		trackName: cmd.name,
		language: cmd.language,
		sourceTrackId: cmd.sourceTrackId
	});
	commitCaptionMutation(() => [...captionTracks, track], {
		refreshPlayback: 'refresh'
	});
	post({
		type: 'translated-caption-track-created',
		trackId: track.id
	});
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

function makeCalloutClipId(): string {
	const suffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `clip-callout-${suffix}`;
}

function handleAddCallout(cmd: Extract<WorkerCommand, { type: 'add-callout' }>) {
	const added = commitTimelineMutation(() => {
		const start =
			cmd.start !== undefined && Number.isFinite(cmd.start) && cmd.start >= 0 ? cmd.start : 0;
		const makeClip = () =>
			defaultCalloutClip({
				id: makeCalloutClipId(),
				start,
				duration: DEFAULT_TITLE_DURATION_S,
				payload: cmd.payload,
				transform: cmd.transform
			});

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
	if (added && !playback) setupPlayback();
}

function handleSetCallout(cmd: Extract<WorkerCommand, { type: 'set-callout' }>) {
	commitTimelineMutation(() => setCalloutPayload(timeline, cmd.trackId, cmd.clipId, cmd.payload), {
		coalesceKey: { clipId: cmd.clipId, key: 'callout' },
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
}

function handleSetPaddedBackground(cmd: Extract<WorkerCommand, { type: 'set-padded-background' }>) {
	commitTimelineMutation(() => setPaddedBackground(timeline, cmd.trackId, cmd.clipId, cmd.params), {
		coalesceKey: { clipId: cmd.clipId, key: 'paddedBackground' },
		refreshPlayback: 'refresh',
		prune: false,
		syncLuts: false
	});
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
	// Phase 20 linked-clip invariant: if an overwrite would trim/delete a clip on
	// a targeted track that's linked to a partner on a non-targeted track, the
	// untargeted partner stays put — silently splitting the A/V pair. Reject the
	// edit before mutating so the link contract holds; the UI should expand the
	// edit targeting or unlink the pair to proceed.
	//
	// Per-track region computation: `overwriteEdit` (timeline.ts) places every
	// incoming clip's start at `cmd.atTime` regardless of any relative offset
	// the cmd carries, and each clip overwrites its own region
	// [atTime, atTime + clip.duration]. The union of those regions per track
	// is therefore [atTime, atTime + max(clip.duration)] across all incoming
	// clips on that track. We compute (regionStart, regionEnd) by iterating
	// the clips explicitly so the calculation tracks `overwriteEdit`'s actual
	// behaviour, not just the max-duration shortcut.
	const targetSet = new Set(targetTrackIds);
	const regionByTrack = new Map<string, { start: number; end: number }>();
	for (const item of cmd.clips) {
		const placedStart = cmd.atTime;
		const placedEnd = placedStart + item.clip.duration;
		const cur = regionByTrack.get(item.trackId);
		if (cur) {
			cur.start = Math.min(cur.start, placedStart);
			cur.end = Math.max(cur.end, placedEnd);
		} else {
			regionByTrack.set(item.trackId, { start: placedStart, end: placedEnd });
		}
	}
	for (const [trackId, region] of regionByTrack) {
		if (!targetSet.has(trackId)) continue;
		const track = timeline.find((t) => t.id === trackId);
		if (!track) continue;
		for (const existing of track.clips) {
			const eStart = existing.start;
			const eEnd = eStart + existing.duration;
			if (eEnd <= region.start || eStart >= region.end) continue;
			if (!existing.linkedGroupId) continue;
			const linked = expandLinkedGroup(timeline, [{ trackId, clipId: existing.id }]);
			for (const ref of linked) {
				if (ref.trackId === trackId) continue;
				if (!targetSet.has(ref.trackId)) {
					postProjectWarning(
						`Overwrite would trim "${existing.id}" but its linked partner is on an untargeted track. Add that track to the edit targets, or unlink the pair, before retrying.`
					);
					return;
				}
			}
		}
	}
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
		const sorted = removedRegions.toSorted((a, b) => a.start - b.start);
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

function handleApplySilenceCuts(cmd: Extract<WorkerCommand, { type: 'apply-silence-cuts' }>) {
	const { regions, trackIds } = cmd;
	if (regions.length === 0 || trackIds.length === 0) return;
	const epsilon = 1e-6;
	const sortedRegions = [...regions]
		.filter((r) => r.endS - r.startS > epsilon)
		.sort((a, b) => a.startS - b.startS);
	if (sortedRegions.length === 0) return;
	const targetTrackIds = new Set(trackIds);

	commitEditMutation(() => {
		// Step 1: split affected clips at every region boundary so the silent
		// slices become their own clip IDs that ripple-delete can target.
		// `splitClipAt` is a no-op at clip edges or outside any clip, so it's
		// safe to call per (track × boundary).
		let splitTimeline = timeline;
		for (const region of sortedRegions) {
			for (const trackId of trackIds) {
				splitTimeline = splitClipAt(splitTimeline, trackId, region.startS);
				splitTimeline = splitClipAt(splitTimeline, trackId, region.endS);
			}
		}

		// Step 2: collect clip refs that sit fully inside any region.
		const toDelete: { trackId: string; clipId: string }[] = [];
		for (const track of splitTimeline) {
			if (!targetTrackIds.has(track.id)) continue;
			for (const clip of track.clips) {
				const clipStart = clip.start;
				const clipEnd = clip.start + clip.duration;
				for (const region of sortedRegions) {
					if (clipStart >= region.startS - epsilon && clipEnd <= region.endS + epsilon) {
						toDelete.push({ trackId: track.id, clipId: clip.id });
						break;
					}
				}
			}
		}

		if (toDelete.length === 0) {
			return { timeline, captionTracks, transitions, markers };
		}

		// Step 3: replay the ripple-delete bookkeeping on the split timeline.
		const syncLockedTrackIds = getSyncLockedTrackIds();
		const expanded = expandLinkedGroup(splitTimeline, toDelete);
		const removedRegions: { start: number; end: number }[] = [];
		for (const ref of expanded) {
			const track = splitTimeline.find((t) => t.id === ref.trackId);
			const clip = track?.clips.find((c) => c.id === ref.clipId);
			if (clip) removedRegions.push({ start: clip.start, end: clip.start + clip.duration });
		}
		const finalTimeline = rippleDelete(splitTimeline, toDelete, syncLockedTrackIds);
		if (finalTimeline === splitTimeline) {
			return { timeline, captionTracks, transitions, markers };
		}
		let nextMarkers: TimelineMarker[] = markers as TimelineMarker[];
		const sortedRemoved = removedRegions.toSorted((a, b) => a.start - b.start);
		const mergedRanges: { start: number; end: number }[] = [];
		for (const r of sortedRemoved) {
			if (
				mergedRanges.length > 0 &&
				r.start <= mergedRanges[mergedRanges.length - 1]!.end + TIMELINE_EPSILON
			) {
				mergedRanges[mergedRanges.length - 1]!.end = Math.max(
					mergedRanges[mergedRanges.length - 1]!.end,
					r.end
				);
			} else {
				mergedRanges.push({ start: r.start, end: r.end });
			}
		}
		for (const r of mergedRanges) {
			nextMarkers = removeMarkersInRange(nextMarkers, r.start, r.end);
		}
		let cumulativeDelta = 0;
		for (const r of mergedRanges) {
			const dur = r.end - r.start;
			nextMarkers = shiftMarkers(nextMarkers, r.start - cumulativeDelta, -dur);
			cumulativeDelta += dur;
		}
		return {
			timeline: finalTimeline,
			captionTracks,
			transitions: reconcileTransitions(finalTimeline, transitions),
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

function handleDeleteCaptionTrack(
	cmd: Extract<WorkerCommand, { type: 'delete-caption-track' }>
): void {
	commitCaptionMutation(() => deleteCaptionTrack(captionTracks, cmd.trackId), {
		refreshPlayback: 'refresh'
	});
}

function handleDeleteCaptionTracks(
	cmd: Extract<WorkerCommand, { type: 'delete-caption-tracks' }>
): void {
	commitCaptionMutation(() => deleteCaptionTracks(captionTracks, cmd.trackIds), {
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

// ── Phase 30: Animated caption style handlers ─────────────────────────────

function handleCaptionImportCustomPreset(
	cmd: Extract<WorkerCommand, { type: 'caption-import-custom-preset' }>
): void {
	const result = validateCaptionAnimPreset(cmd.preset);
	if (!result.ok) {
		// Surface validation failure to the UI so the user knows why an import
		// they just triggered did nothing. Bare `return` would leave the picker
		// silently unchanged and look like a no-op.
		post({
			type: 'caption-custom-preset-import-failed',
			field: result.field,
			message: result.message
		});
		return;
	}
	// Empty id makes the preset un-referenceable: `segment.style.presetId`
	// can't link to it, and `parseCustomAnimCaptionPresets` drops zero-length
	// ids on the next reload, so the preset would "disappear" silently. The
	// inspector's import flow assigns a fresh UUID before sending — guard
	// here so any other producer (e.g. a future automation hook) can't bypass
	// the contract.
	if (cmd.preset.id.length === 0) {
		post({
			type: 'caption-custom-preset-import-failed',
			field: 'id',
			message: 'Preset id is empty; assign a non-empty string before importing.'
		});
		return;
	}
	const preset: CaptionAnimStylePreset = { ...result.value, id: cmd.preset.id, builtIn: false };
	const existing = customAnimCaptionPresets.findIndex((p) => p.id === preset.id);
	if (existing >= 0) {
		customAnimCaptionPresets[existing] = preset;
	} else {
		customAnimCaptionPresets.push(preset);
	}
	post({
		type: 'caption-custom-presets-updated',
		presets: customAnimCaptionPresets
	});
	// Re-rasterise so any segment already referencing this preset id picks up
	// the new fields. `rasterize` is hash-checked, so segments using OTHER
	// presets pay only a hash compare; touched segments get a fresh upload.
	syncTitleRasters();
	syncCalloutRasters();
	scheduleAutosave();
}

function handleCaptionDeleteCustomPreset(
	cmd: Extract<WorkerCommand, { type: 'caption-delete-custom-preset' }>
): void {
	customAnimCaptionPresets = customAnimCaptionPresets.filter((p) => p.id !== cmd.presetId);
	post({
		type: 'caption-custom-presets-updated',
		presets: customAnimCaptionPresets
	});
	// Segments that referenced this preset fall back to the 'subtitle' layout
	// at next resolve; re-rasterise so the cache reflects the fallback instead
	// of holding the now-orphaned custom-preset texture.
	syncTitleRasters();
	syncCalloutRasters();
	scheduleAutosave();
}

function handleCaptionSetAnimStyle(
	cmd: Extract<WorkerCommand, { type: 'caption-set-anim-style' }>
): void {
	const track = captionTracks.find((t: CaptionTrack) => t.id === cmd.trackId);
	if (!track) return;
	// Resolve the anim preset so its layout fields propagate when the user picks
	// a preset. Without this, selecting 'lower-third' would keep captions
	// anchored at the previous position; the user expects layout to follow the
	// preset on selection. `insetPx` is included so custom presets that ship a
	// custom offset don't silently render at the default inset.
	const animPreset = resolveAnimPreset(cmd.presetId, customAnimCaptionPresets);
	const layoutOverlay: Partial<CaptionStyle> = {
		anchor: animPreset.anchor,
		maxWidthPercent: animPreset.maxWidthPercent,
		lineWrap: animPreset.lineWrap,
		...(animPreset.insetPx ? { insetPx: { ...animPreset.insetPx } } : {})
	};
	if (cmd.segmentId) {
		const segment = track.segments.find((s) => s.id === cmd.segmentId);
		if (!segment) return;
		commitCaptionMutation(
			() =>
				setCaptionSegmentStyle(captionTracks, cmd.trackId, cmd.segmentId!, {
					...layoutOverlay,
					presetId: cmd.presetId as CaptionPresetIdSnapshot
				}),
			{ refreshPlayback: 'refresh' }
		);
	} else {
		commitCaptionMutation(
			() =>
				setCaptionTrackProps(captionTracks, cmd.trackId, {
					defaultStyle: {
						...track.defaultStyle,
						...layoutOverlay,
						presetId: cmd.presetId as CaptionPresetIdSnapshot
					}
				}),
			{ refreshPlayback: 'refresh' }
		);
	}
}

function handleCaptionSetWords(cmd: Extract<WorkerCommand, { type: 'caption-set-words' }>): void {
	const track = captionTracks.find((t: CaptionTrack) => t.id === cmd.trackId);
	if (!track) return;
	const segment = track.segments.find((s) => s.id === cmd.segmentId);
	if (!segment) return;
	commitCaptionMutation(
		() => {
			return captionTracks.map((t: CaptionTrack) => {
				if (t.id !== cmd.trackId) return t;
				return {
					...t,
					segments: t.segments.map((s) => {
						if (s.id !== cmd.segmentId) return s;
						return { ...s, words: cmd.words ? [...cmd.words] : undefined };
					})
				};
			});
		},
		{ refreshPlayback: 'refresh' }
	);
}

function applyHistoryRestore(next: {
	timeline: Timeline;
	captionTracks?: CaptionTrack[];
	transitions: TimelineTransition[];
	markers: TimelineMarker[];
	voiceCleanup?: VoiceCleanupSettings;
	projectFormat?: ProjectFormat;
	cover?: CoverFrameDoc | null;
}): void {
	timeline = cloneTimelineSnapshot(next.timeline);
	captionTracks = cloneCaptionTracksSnapshot(next.captionTracks ?? []);
	transitions = reconcileTransitions(timeline, next.transitions);
	markers = cloneMarkersSnapshot(next.markers);
	voiceCleanupSettings = cloneVoiceCleanupSettings(
		next.voiceCleanup ?? DEFAULT_VOICE_CLEANUP_SETTINGS
	);
	// Phase 39: restore project format and cover from history.
	if (next.projectFormat) {
		projectFormat = { ...next.projectFormat };
		post({ type: 'project-format-changed', aspect: projectFormat.aspect });
	}
	cover = next.cover ? { ...next.cover } : null;
	post({ type: 'cover-frame-changed', cover });
	syncTimelineLuts();
	syncRemapLuts();
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
	postVoiceCleanupState();
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
		exportSettings: lastExportSettings ?? undefined,
		scenes: programSceneDoc,
		sessionEventLogs
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
	// Loading a project bundle is a fresh project: drop loop back to the default so
	// it matches the UI mirror (reset in resetProjectUiState) rather than inheriting
	// the prior session's toggle.
	loopEnabled = false;
	frameCache?.clear();
	frameCache = null;
	primaryHandle = null;
	history.clear();

	projectId = doc.projectId;
	timeline = cloneTimelineSnapshot(doc.timeline);
	captionTracks = cloneCaptionTracksSnapshot(doc.captionTracks);
	markers = cloneMarkersSnapshot(doc.markers);
	syncTimelineLuts();
	syncRemapLuts();
	lastExportSettings = doc.exportSettings ?? null;
	exportPresets = (doc.exportPresets ?? []).filter((p) => !p.builtIn);
	customAnimCaptionPresets = doc.customAnimCaptionPresets ?? [];
	// Tell the UI about the restored custom presets so the picker shows them.
	post({ type: 'caption-custom-presets-updated', presets: customAnimCaptionPresets });
	queueState = createEmptyQueueState();
	if (doc.renderQueueHistory) {
		queueState = { ...queueState, jobs: deserializeQueueHistory(doc.renderQueueHistory) };
	}
	masterGain = doc.masterGain;
	applyProjectPhase46Config(doc);
	nextSourceId = nextSourceIdFromDescriptors(doc.sources);

	const keepIds = new Set(doc.sources.map((source) => source.sourceId));
	// eslint-disable-next-line unicorn/no-useless-spread — snapshot needed: deletes during iteration
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
	postProgramScenes();
	setupPlayback();
	syncTitleRasters();
	syncCalloutRasters();
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
		sources: currentProjectSources(),
		customAnimCaptionPresets:
			customAnimCaptionPresets.length > 0 ? customAnimCaptionPresets : undefined,
		projectFormat,
		cover: cover ?? undefined,
		scenes: programSceneDoc
	}),
	resolveSourceFile: makeStoredSourceResolver(loadStoredSource, fileFromHandle),
	collectLuts: collectTimelineLuts,
	renderCoverAsset: async () => {
		if (!cover) return null;
		const rendered = await renderCoverFrameBlob(cover);
		return rendered.ok ? rendered.blob : null;
	},
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

	const outputSize = aspectOutputSize(projectFormat.aspect);
	const width = outputSize.width;
	const height = outputSize.height;
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
		renderFrames: (layers, timestamp) => {
			// The stack is already budgeted + offline-skipped + z-ordered by
			// makeGetLayers. Core/compat GPU consume GPU title textures; Canvas2D
			// reduced preview consumes title payloads and VideoFrames synchronously.
			if (renderer) {
				const { width: rw, height: rh } = renderer.size;
				const stack: CompositeLayer[] = [];
				for (const layer of layers) {
					if (layer.meta.kind === 'title') {
						const texture = titleCache?.get(layer.meta.clipId);
						if (!texture) continue;
						const au = layer.meta.animUniforms;
						// Phase 30: apply caption animation uniforms at composite time.
						// Pixel translation is converted to the 0-centred normalised coord space.
						const transform: TransformParams =
							au.opacity === 1 &&
							au.scaleX === 1 &&
							au.scaleY === 1 &&
							au.translateXPx === 0 &&
							au.translateYPx === 0
								? layer.meta.transform
								: {
										...layer.meta.transform,
										opacity: layer.meta.transform.opacity * au.opacity,
										scale: layer.meta.transform.scale * ((au.scaleX + au.scaleY) / 2),
										x: layer.meta.transform.x + au.translateXPx / rw,
										y: layer.meta.transform.y + au.translateYPx / rh
									};
						// single-submit invariant: caption layers included here
						stack.push({
							kind: 'texture',
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform,
							uvCropMax: [au.cropRightFrac, 1.0],
							transition: layer.meta.transition
						});
					} else if (layer.meta.kind === 'callout-texture') {
						const texture = calloutCache?.get(layer.meta.clipId);
						if (!texture) continue;
						stack.push({
							kind: 'texture',
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform: layer.meta.transform,
							transition: layer.meta.transition
						});
					} else if (layer.meta.kind === 'callout-effect') {
						stack.push(
							layer.meta.effect === 'spotlight'
								? {
										kind: 'spotlight',
										transform: layer.meta.transform,
										darkenStrength: layer.meta.darkenStrength ?? 0.7
									}
								: {
										kind: 'blur-region',
										transform: layer.meta.transform,
										blurRadius: layer.meta.blurRadius ?? 12
									}
						);
					} else if (layer.frame) {
						stack.push({
							kind: 'frame',
							frame: layer.frame,
							effects: layer.meta.effects,
							transform: layer.meta.transform,
							lut: layer.meta.lut,
							skinMask: layer.meta.skinMask,
							skinSmoothBypass: layer.meta.skinSmoothBypass,
							transition: layer.meta.transition,
							colorMetadata: layer.meta.colorMetadata,
							matteView: layer.meta.matteView,
							matteStrength: layer.meta.matteStrength,
							matteMode: layer.meta.matteMode,
							matteBlurRadius: layer.meta.matteBlurRadius,
							beauty: layer.meta.beauty,
							beautyLandmarks: layer.meta.beautyLandmarks,
							paddedBackground: layer.meta.paddedBackground
						});
					}
				}
				renderer.present(stack, timestamp / 1e6);
				tapProgramFrame(timestamp);
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
				tapProgramFrame(timestamp);
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
		getMasterTime,
		loop: loopEnabled,
		// Wrapping to the start re-uses the playing-seek path: reset the audio ring
		// (generation bump + pointer reset) so the worklet re-anchors the audio master
		// clock at the loop point and the worker's pump refills from there.
		onLoopRestart: (time) => resetAudioRingForSeek(time)
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
		liveWsolaStretchers.clear();
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

function handleSetLoop(enabled: boolean) {
	loopEnabled = enabled;
	playback?.setLoop(enabled);
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
	// Burned-in captions are a third source of renderable content (visible without
	// a source clip) — mirror setupPlayback's gate so a caption-only export isn't
	// advertised as unsupported when buildExportPlan would actually accept it.
	const hasBurnedInCaptions = captionTracks.some(
		(track) => track.burnedIn && track.visible && track.segments.length > 0
	);
	if (!videoHandle && titleClips().length === 0 && !hasBurnedInCaptions) return null;
	const outputSize = aspectOutputSize(projectFormat.aspect);
	const width = outputSize.width;
	const height = outputSize.height;
	const frameRate = videoHandle?.frameRate ?? TITLE_ONLY_CANVAS.frameRate;
	const timelineDuration = getTimelineDuration(timeline);
	const base =
		lastExportSettings ??
		({
			...defaultExportSettings('quality', width, height, frameRate, timelineDuration),
			width,
			height,
			videoBitrate: videoBitrateForPreset('quality', width, height)
		} satisfies ExportSettings);
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

	// Project format owns export geometry; source media contributes only cadence.
	const handleAfterProbe = firstExportVideoHandle();
	const outputSize = aspectOutputSize(projectFormat.aspect);
	const resolvedWidth = outputSize.width;
	const resolvedHeight = outputSize.height;
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
	let exportCleanupState:
		| import('./voice-cleanup/voice-cleanup-processor').VoiceCleanupChainState
		| null = null;
	try {
		const exportTimelineSnapshot = cloneTimelineForExport();
		const exportCaptionTracksSnapshot = cloneCaptionTracksSnapshot(captionTracks);
		const exportCaptionTextureGroupId =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		exportCaptionTextureIds = rasterizeExportCaptionTextures(
			exportCaptionTextureGroupId,
			exportCaptionTracksSnapshot
		);
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
			exportCleanupState = await createConfiguredVoiceCleanupState();
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
				voiceCleanupSettings: voiceCleanupExportParams(),
				cleanupState: exportCleanupState,
				// Title layers composite from the cached raster; `ensure` (re)rasters once
				// per title on the cold export path, never per frame.
				titleTextureFor: (clip) =>
					clip.title ? (titleCache?.ensure(clip.id, clip.title) ?? null) : null,
				calloutTextureFor: (clip) =>
					clip.callout && isRasterCalloutClip(clip)
						? (calloutCache?.ensure(clip.id, clip.callout, settings.width, settings.height) ?? null)
						: null,
				overlayTextureLayersAt: (timelineTime) => {
					const ew = settings.width,
						eh = settings.height;
					return activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (editPathId) =>
						remapToExportCaptionTextureId(exportCaptionTextureGroupId, editPathId)
					)
						.map((layer) => {
							const texture = titleCache?.get(layer.clipId);
							if (!texture) return null;
							const au = layer.animUniforms;
							const transform: TransformParams =
								au.opacity === 1 &&
								au.scaleX === 1 &&
								au.scaleY === 1 &&
								au.translateXPx === 0 &&
								au.translateYPx === 0
									? layer.transform
									: {
											...layer.transform,
											opacity: layer.transform.opacity * au.opacity,
											scale: layer.transform.scale * ((au.scaleX + au.scaleY) / 2),
											x: layer.transform.x + au.translateXPx / ew,
											y: layer.transform.y + au.translateYPx / eh
										};
							return {
								view: texture.view,
								sourceWidth: texture.width,
								sourceHeight: texture.height,
								transform,
								uvCropMax: [au.cropRightFrac, 1.0] as [number, number]
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
								uvCropMax: [number, number];
							} => layer !== null
						);
				},
				matteViewFor: (clip, frame, sourceTimeS) => {
					const engine = ensureMatteEngine();
					if (!engine || !clip.matte?.enabled) {
						frame.close();
						return Promise.resolve(null);
					}
					const handle = sourceInputs.get(clip.sourceId);
					return engine.matteViewFor({
						clipId: clip.id,
						modelKey: clip.matte.modelKey,
						frame,
						sourceTimeS,
						frameStepS: handle && handle.frameRate > 0 ? 1 / handle.frameRate : 1 / 30,
						quality: 'export'
					});
				},
				beautyLandmarksFor: (clip, frame, timelineTimeS) => {
					if (!clip.beauty?.enabled || beautyEngine?.getStatus() !== 'loaded') {
						frame.close();
						return Promise.resolve(null);
					}
					return beautyEngine.solveFrame({
						clipId: clip.id,
						frame,
						timeS: timelineTimeS,
						beauty: clip.beauty,
						quality: 'export'
					});
				}
			});
			post({ type: 'export-complete', fileName: outputHandle.name, mimeType: result.mimeType });
		} else if (reducedRenderer) {
			const safeStem =
				projectDisplayName()
					.replace(/[^a-z0-9._-]+/gi, '-')
					.replace(/^-+|-+$/g, '') || 'localcut-reduced';
			exportCleanupState = await createConfiguredVoiceCleanupState();
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
				voiceCleanupSettings: voiceCleanupExportParams(),
				cleanupState: exportCleanupState,
				hasVideoTransitions: transitions.length > 0,
				overlayTitleLayersAt: (timelineTime) =>
					activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (editPathId) =>
						remapToExportCaptionTextureId(exportCaptionTextureGroupId, editPathId)
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
		await destroyConfiguredVoiceCleanupState(exportCleanupState);
		releaseRetainedOverlayTextures(exportCaptionTextureIds);
		syncTitleRasters();
		syncCalloutRasters();
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
	queueJobOutputDirs.clear();
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
	queueJobOutputDirs.delete(cmd.jobId);
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
	queueJobOutputDirs.delete(cmd.jobId);
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
	queueJobOutputDirs.clear();
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
	if (cmd.outputDir) {
		queueJobOutputDirs.set(cmd.jobId, cmd.outputDir);
	}
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
	let outputDir = queueJobOutputDirs.get(job.id) ?? null;
	queueJobOutputHandles.delete(job.id);
	queueJobOutputDirs.delete(job.id);

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
		outputDir = queueJobOutputDirs.get(job.id) ?? outputDir;
		queueJobOutputDirs.delete(job.id);
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
	let exportCleanupState:
		| import('./voice-cleanup/voice-cleanup-processor').VoiceCleanupChainState
		| null = null;
	try {
		const exportTimelineSnapshot = cloneTimelineForExport();
		const exportCaptionTracksSnapshot = cloneCaptionTracksSnapshot(captionTracks);
		const exportCaptionTextureGroupId =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		exportCaptionTextureIds = rasterizeExportCaptionTextures(
			exportCaptionTextureGroupId,
			exportCaptionTracksSnapshot
		);

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

		exportCleanupState = await createConfiguredVoiceCleanupState();
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
			voiceCleanupSettings: voiceCleanupExportParams(),
			cleanupState: exportCleanupState,
			titleTextureFor: (clip) =>
				clip.title ? (titleCache?.ensure(clip.id, clip.title) ?? null) : null,
			calloutTextureFor: (clip) =>
				clip.callout && isRasterCalloutClip(clip)
					? (calloutCache?.ensure(clip.id, clip.callout, settings.width, settings.height) ?? null)
					: null,
			overlayTextureLayersAt: (timelineTime) => {
				const ew = settings.width,
					eh = settings.height;
				return activeCaptionLayersAt(exportCaptionTracksSnapshot, timelineTime, (editPathId) =>
					remapToExportCaptionTextureId(exportCaptionTextureGroupId, editPathId)
				)
					.map((layer) => {
						const texture = titleCache?.get(layer.clipId);
						if (!texture) return null;
						const au = layer.animUniforms;
						const transform: TransformParams =
							au.opacity === 1 &&
							au.scaleX === 1 &&
							au.scaleY === 1 &&
							au.translateXPx === 0 &&
							au.translateYPx === 0
								? layer.transform
								: {
										...layer.transform,
										opacity: layer.transform.opacity * au.opacity,
										scale: layer.transform.scale * ((au.scaleX + au.scaleY) / 2),
										x: layer.transform.x + au.translateXPx / ew,
										y: layer.transform.y + au.translateYPx / eh
									};
						return {
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform,
							uvCropMax: [au.cropRightFrac, 1.0] as [number, number]
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
							uvCropMax: [number, number];
						} => layer !== null
					);
			},
			matteViewFor: (clip, frame, sourceTimeS) => {
				const engine = ensureMatteEngine();
				if (!engine || !clip.matte?.enabled) {
					frame.close();
					return Promise.resolve(null);
				}
				const handle = sourceInputs.get(clip.sourceId);
				return engine.matteViewFor({
					clipId: clip.id,
					modelKey: clip.matte.modelKey,
					frame,
					sourceTimeS,
					frameStepS: handle && handle.frameRate > 0 ? 1 / handle.frameRate : 1 / 30,
					quality: 'export'
				});
			},
			beautyLandmarksFor: (clip, frame, timelineTimeS) => {
				if (!clip.beauty?.enabled || beautyEngine?.getStatus() !== 'loaded') {
					frame.close();
					return Promise.resolve(null);
				}
				return beautyEngine.solveFrame({
					clipId: clip.id,
					frame,
					timeS: timelineTimeS,
					beauty: clip.beauty,
					quality: 'export'
				});
			}
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

		// Phase 39: export cover frame alongside completed queue job.
		if (cover) {
			if (outputDir) {
				const stem = handle.name.replace(/\.[^.]+$/, '');
				const r = await exportCoverFrame(cover, stem, outputDir);
				if (!r.ok) {
					queueState = {
						...queueState,
						jobs: queueState.jobs.map((j) =>
							j.id === job.id ? { ...j, coverExportError: r.error } : j
						)
					};
					post({ type: 'cover-export-warning', jobId: job.id, error: r.error });
				}
			} else {
				const warning = 'Cover export requires a directory destination.';
				queueState = {
					...queueState,
					jobs: queueState.jobs.map((j) =>
						j.id === job.id ? { ...j, coverExportError: warning } : j
					)
				};
				post({ type: 'cover-export-warning', jobId: job.id, error: warning });
			}
		}
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
		await destroyConfiguredVoiceCleanupState(exportCleanupState);
		releaseRetainedOverlayTextures(exportCaptionTextureIds);
		syncTitleRasters();
		syncCalloutRasters();
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

// ── Phase 36: Voice Cleanup handlers ──

// ── Phase 44: Silence Detection handler ──

/** Streaming read chunk for `pcmWindowAt` — 0.5 s of audio (~96 KB mono) so
 *  a 30-minute clip is processed as ~3600 bounded allocations instead of one
 *  multi-hundred-MB buffer that can OOM the worker. */
const SILENCE_READ_CHUNK_S = 0.5;

/** Push `frames` of zero samples to a streaming detector in bounded chunks
 *  (1 second per allocation) — used for timeline gaps between clips. */
function pushSilenceGap(
	detector: SilenceStreamDetector,
	frames: number,
	zeroScratch: Float32Array
): void {
	let remaining = frames;
	while (remaining > 0) {
		const take = Math.min(remaining, zeroScratch.length);
		detector.pushChunk(zeroScratch.subarray(0, take));
		remaining -= take;
	}
}

async function detectSilenceForTrack(
	track: TimelineTrack,
	params: import('./silence-detector').SilenceDetectionParams,
	requestId: string
): Promise<SilenceRegionT[] | null> {
	const trackDuration = getTimelineDuration([track]);
	if (trackDuration <= 0) return [];
	const targetSampleRate = params.sampleRate;
	const detector = new SilenceStreamDetector(params);
	const zeroScratch = new Float32Array(targetSampleRate); // 1 s of zeros, reused.
	const chunkFrames = Math.max(1, Math.round(SILENCE_READ_CHUNK_S * targetSampleRate));

	const sortedClips = [...track.clips]
		.filter((c) => c.kind !== 'title')
		.sort((a, b) => a.start - b.start);

	let timelineCursorFrames = 0;
	for (const clip of sortedClips) {
		if (!inFlightSilenceRequests.has(requestId)) return null;

		// Zero-fill the gap before this clip (timeline silence).
		const clipStartFrame = Math.round(clip.start * targetSampleRate);
		if (clipStartFrame > timelineCursorFrames) {
			pushSilenceGap(detector, clipStartFrame - timelineCursorFrames, zeroScratch);
			timelineCursorFrames = clipStartFrame;
		}

		const handle = sourceInputs.get(clip.sourceId);
		const clipFrames = Math.max(1, Math.round(clip.duration * targetSampleRate));
		if (!handle?.audioSource) {
			// No audio source — treat as silence for the clip's duration.
			pushSilenceGap(detector, clipFrames, zeroScratch);
			timelineCursorFrames += clipFrames;
			continue;
		}

		const channels = Math.max(1, handle.audioChannels || 1);
		let framesEmitted = 0;
		while (framesEmitted < clipFrames) {
			if (!inFlightSilenceRequests.has(requestId)) return null;
			const take = Math.min(chunkFrames, clipFrames - framesEmitted);
			const timelineSeconds = clip.start + framesEmitted / targetSampleRate;
			// Resolve adapter timestamps so sources with media-start offsets
			// (e.g. trimmed MOV/MP4) read the right audio instead of fake
			// leading silence.
			const resolution = resolveSourceTimestamp({
				clip,
				timelineTime: timelineSeconds,
				trackKind: 'audio',
				timing: handle.timing
			});
			const availableRunFrames = audioAvailabilityWindowFrames({
				resolution,
				timing: handle.timing,
				clip,
				timelineTime: timelineSeconds,
				sampleRate: targetSampleRate,
				maxFrames: take
			});
			if (!resolution.available || availableRunFrames <= 0) {
				// Outside the source's audio window → treat as gap-silence so
				// we don't fabricate audible content.
				const skip = availableRunFrames > 0 ? availableRunFrames : take;
				pushSilenceGap(detector, skip, zeroScratch);
				framesEmitted += skip;
				continue;
			}
			const pcm = await handle.audioSource.pcmWindowAt(
				resolution.adapterTimestampS,
				availableRunFrames,
				channels,
				targetSampleRate
			);
			if (!inFlightSilenceRequests.has(requestId)) return null;
			// Mono-mix into a small allocation per chunk.
			const mono = new Float32Array(availableRunFrames);
			if (channels > 1) {
				for (let f = 0; f < availableRunFrames; f++) {
					let sum = 0;
					for (let ch = 0; ch < channels; ch++) sum += pcm[f * channels + ch]!;
					mono[f] = sum / channels;
				}
			} else {
				// pcm may already be mono; copy the slice we need.
				mono.set(pcm.subarray(0, availableRunFrames));
			}
			detector.pushChunk(mono);
			framesEmitted += availableRunFrames;
		}
		timelineCursorFrames += clipFrames;
	}

	// Trailing gap to track duration.
	const totalFrames = Math.ceil(trackDuration * targetSampleRate);
	if (totalFrames > timelineCursorFrames) {
		pushSilenceGap(detector, totalFrames - timelineCursorFrames, zeroScratch);
	}

	if (!inFlightSilenceRequests.has(requestId)) return null;
	return detector.finalize();
}

async function handleDetectSilence(
	cmd: Extract<WorkerCommand, { type: 'detect-silence' }>
): Promise<void> {
	const { requestId, trackIds, params } = cmd;
	inFlightSilenceRequests.add(requestId);
	try {
		const perTrack: SilenceRegionT[][] = [];
		for (let i = 0; i < trackIds.length; i++) {
			if (!inFlightSilenceRequests.has(requestId)) return;
			const trackId = trackIds[i]!;
			const track = timeline.find((t) => t.id === trackId);
			if (!track) {
				perTrack.push([]);
			} else {
				const regions = await detectSilenceForTrack(track, params, requestId);
				if (regions === null) return; // Cancelled mid-stream.
				perTrack.push(regions);
			}
			post({
				type: 'silence-progress',
				requestId,
				progressFraction: (i + 1) / Math.max(1, trackIds.length)
			});
		}
		if (!inFlightSilenceRequests.has(requestId)) return;
		// Dead air is silence on EVERY selected track simultaneously — union
		// would propose cuts where, say, the music bed is quiet but narration
		// is mid-sentence. Intersection avoids those false positives.
		let combined: SilenceRegionT[] = perTrack[0] ?? [];
		for (let i = 1; i < perTrack.length; i++) {
			combined = intersectSilenceRegions(combined, perTrack[i]!);
		}
		post({ type: 'silence-result', requestId, regions: combined });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		post({ type: 'silence-error', requestId, message });
	} finally {
		inFlightSilenceRequests.delete(requestId);
	}
}

// ── Phase 44: Keystroke Overlay handler ──

function handleGenerateKeyOverlay(
	cmd: Extract<WorkerCommand, { type: 'generate-key-overlay' }>
): void {
	const { clips } = cmd;
	if (clips.length === 0) return;
	// The generator emits 1.2 s clips at each shortcut event; consecutive
	// events 300 ms – 1.2 s apart therefore produce overlapping ranges that
	// `insertClip` rejects (same-track overlap returns the original timeline,
	// silently dropping the later clip). Truncate each clip so its end ≤ the
	// next clip's start, preserving the per-event start while still letting
	// every keycap appear.
	const sorted = [...clips].sort((a, b) => a.startS - b.startS);
	for (let i = 0; i < sorted.length - 1; i++) {
		const cur = sorted[i]!;
		const nxt = sorted[i + 1]!;
		const maxEnd = nxt.startS;
		if (cur.startS + cur.durationS > maxEnd) {
			sorted[i] = { ...cur, durationS: Math.max(0, maxEnd - cur.startS) };
		}
	}

	commitTimelineMutation(() => {
		// R3.4: Create a dedicated overlay track at the top for keystroke clips.
		// Always create a new track so overlay clips never interleave with footage.
		let nextTimeline = addTrack(timeline, 'video');
		const overlayTrackId = nextTimeline[nextTimeline.length - 1]!.id;
		nextTimeline = reorderTrack(nextTimeline, overlayTrackId, 0);
		for (const clip of sorted) {
			if (clip.durationS <= 0) continue;
			const titleClip = defaultTitleClip({
				id: makeTitleClipId(),
				start: clip.startS,
				duration: clip.durationS
			});
			const withClip = insertClip(nextTimeline, overlayTrackId, titleClip);
			if (withClip !== nextTimeline) {
				nextTimeline = withClip;
				nextTimeline = setTitleContent(nextTimeline, overlayTrackId, titleClip.id, {
					text: clip.text,
					style: clip.style
				});
			}
		}
		return nextTimeline;
	});
}

// ── Phase 36: Voice Cleanup handlers (continued) ──

async function handleVoiceCleanupAnalyseLoudness(
	cmd: Extract<WorkerCommand, { type: 'voice-cleanup-analyse-loudness' }>
): Promise<void> {
	if (analysisAbortController) {
		post({ type: 'voice-cleanup-analysis-error', message: 'Analysis already in progress.' });
		return;
	}
	if (timeline.length === 0) {
		post({ type: 'voice-cleanup-analysis-error', message: 'Timeline is empty.' });
		return;
	}

	analysisAbortController = new AbortController();
	const { signal } = analysisAbortController;
	const durationS = getTimelineDuration(timeline);
	const sampleRate = audioRing
		? Atomics.load(audioRing.header, RingHeader.SAMPLE_RATE) || 48_000
		: 48_000;
	const channels = audioRing ? Math.max(1, Atomics.load(audioRing.header, RingHeader.CHANNELS)) : 2;
	let cleanupState: Awaited<ReturnType<typeof createConfiguredVoiceCleanupState>> | null = null;

	try {
		cleanupState = await createConfiguredVoiceCleanupState();
		const { analyseLoudness } = await import('./voice-cleanup/loudness-analysis');
		const result = await analyseLoudness(
			{
				timeline,
				sources: sourceInputs,
				sampleRate,
				channels,
				timelineDurationS: durationS,
				targetLufs: cmd.targetLufs,
				masterGain,
				voiceCleanup: voiceCleanupExportParams(),
				cleanupState
			},
			(fraction) => {
				post({
					type: 'voice-cleanup-analysis-progress',
					fraction,
					currentWindowS: fraction * durationS
				});
			},
			signal
		);
		post({
			type: 'voice-cleanup-analysis-result',
			measuredLufs: result.measuredLufs,
			normalisationGainDb: result.normalisationGainDb,
			normalisedLufs: Number.isFinite(result.measuredLufs)
				? result.measuredLufs + result.normalisationGainDb
				: result.measuredLufs
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			post({ type: 'voice-cleanup-analysis-cancelled' });
		} else {
			post({
				type: 'voice-cleanup-analysis-error',
				message: err instanceof Error ? err.message : String(err)
			});
		}
	} finally {
		await destroyConfiguredVoiceCleanupState(cleanupState);
		analysisAbortController = null;
	}
}

function handleVoiceCleanupCancelAnalysis(): void {
	analysisAbortController?.abort();
	// Don't clear the controller here — the running analysis handler's finally
	// block will clear it. This avoids a race where a new analysis starts before
	// the old one has observed the abort.
}

function handleVoiceCleanupApplyNormalisation(normalisationGainDb: number): void {
	const before = historySnapshot();
	voiceCleanupSettings = { ...voiceCleanupSettings, normaliseGainDb: normalisationGainDb };
	history.push(before);
	scheduleAutosave();
	post({ type: 'voice-cleanup-applied', normalisationGainDb });
	postVoiceCleanupState();
	postHistoryState();
}

function handleVoiceCleanupUpdateSettings(settings: VoiceCleanupSettings): void {
	const before = historySnapshot();
	voiceCleanupSettings = { ...settings };
	history.push(before);
	scheduleAutosave();
	// SAB write for denoiser bypass bitmasks happens on the main thread
	// (the worker doesn't have access to the meter SAB).
	postVoiceCleanupState();
	postHistoryState();
}

// ---------------------------------------------------------------------------
// Phase 34: Beat Analysis
// ---------------------------------------------------------------------------

async function handleAnalyzeBeats(sourceId: string): Promise<void> {
	const { analyseBeatTimes } = await import('./beat-analysis');
	const { readBeatCache, writeBeatCache } = await import('./beat-cache');

	// Look up the media handle
	const handle = sourceInputs.get(sourceId);
	if (!handle?.audioSource) {
		post({ type: 'beat-analysis-error', sourceId, message: 'Source not found or has no audio.' });
		return;
	}

	// Check fingerprint for cache
	const descriptor = sourceDescriptors.get(sourceId);
	const fingerprint = descriptor?.fingerprint?.digest;

	// Try cache first
	if (fingerprint) {
		const cached = await readBeatCache(fingerprint);
		if (cached) {
			beatResultCache.set(sourceId, cached);
			post({
				type: 'beat-analysis-result',
				sourceId,
				tempoBpm: cached.tempoBpm,
				beatTimesMs: cached.beatTimesMs,
				analyserVersion: cached.analyserVersion
			});
			return;
		}
	}

	// Create abort controller
	const controller = new AbortController();
	beatAnalysisCancels.set(sourceId, controller);

	// Open an INDEPENDENT audio source for this analysis so we don't seek
	// the shared playback/export audio iterator underneath them. Falls back
	// to the primary audioSource only if the adapter can't open a secondary
	// (older adapters); in that fallback case analysis may glitch concurrent
	// playback but at least produces correct beat times.
	const analysisAudioSource = handle.createSecondaryAudioSource?.() ?? handle.audioSource;
	const ownsAnalysisAudio = analysisAudioSource !== handle.audioSource;

	try {
		const duration = handle.duration ?? 0;
		if (duration <= 0) {
			post({ type: 'beat-analysis-error', sourceId, message: 'Source has no duration.' });
			return;
		}

		const result = await analyseBeatTimes(analysisAudioSource, duration, {
			signal: controller.signal,
			onProgress: (fraction) => {
				post({ type: 'beat-analysis-progress', sourceId, fraction });
			}
		});

		beatResultCache.set(sourceId, result);
		post({
			type: 'beat-analysis-result',
			sourceId,
			tempoBpm: result.tempoBpm,
			beatTimesMs: result.beatTimesMs,
			analyserVersion: result.analyserVersion
		});

		// Cache the result best-effort: a quota-exhausted / private-storage
		// failure here must NOT mask the successful analysis we already posted.
		if (fingerprint) {
			try {
				await writeBeatCache(fingerprint, result);
			} catch {
				// Persisting the cache failed; the in-memory beatResultCache
				// still has the result, so this is purely a cold-restart cost.
			}
		}
	} catch (err) {
		if (controller.signal.aborted) {
			// Explicit cancel -- no message
			return;
		}
		post({
			type: 'beat-analysis-error',
			sourceId,
			message: err instanceof Error ? err.message : 'Beat analysis failed.'
		});
	} finally {
		beatAnalysisCancels.delete(sourceId);
		if (ownsAnalysisAudio) analysisAudioSource.dispose();
	}
}

function handleCancelBeatAnalysis(sourceId: string): void {
	const controller = beatAnalysisCancels.get(sourceId);
	if (controller) {
		controller.abort();
		beatAnalysisCancels.delete(sourceId);
	}
}

function handleSetBeatSettings(enabledSourceIds: string[], globalOffsetMs: number): void {
	beatSettings = {
		enabledSourceIds,
		globalOffsetMs: Math.max(-500, Math.min(500, globalOffsetMs))
	};
	scheduleAutosave();
}

async function handleBeatAutoCut(
	mode: 'split' | 'align',
	clipRefs: { trackId: string; clipId: string }[]
): Promise<void> {
	// Gather active beat times (from all enabled sources, with global offset)
	const allBeatTimesMs: number[] = [];
	for (const sourceId of beatSettings.enabledSourceIds) {
		const result = beatResultCache.get(sourceId);
		if (result) {
			for (const ms of result.beatTimesMs) {
				allBeatTimesMs.push(ms + beatSettings.globalOffsetMs);
			}
		}
	}
	if (allBeatTimesMs.length === 0) return;

	// Deduplicate and sort
	allBeatTimesMs.sort((a, b) => a - b);
	const beatTimesS = [...new Set(allBeatTimesMs)].map((ms) => ms / 1000);

	// Expand linked A/V partners up front so the auto-cut applies the same
	// split / move to the paired video+audio of a linked clip. Then drop any
	// refs that touch a locked track (mirrors the per-clip handlers above).
	const expandedAll = expandLinkedGroup(timeline, clipRefs);
	const expanded = expandedAll.filter((ref) => !isTrackLockedWorker(ref.trackId));
	const skippedLocked = expandedAll.length - expanded.length;
	if (skippedLocked > 0) {
		postProjectWarning(
			`Beat ${mode}: skipped ${skippedLocked} clip${skippedLocked === 1 ? '' : 's'} on locked tracks.`
		);
	}
	if (expanded.length === 0) return;

	if (mode === 'split') {
		// Split mode: split each clip at beat times inside its span
		commitTimelineMutation(
			() => {
				let currentTimeline = timeline;
				for (const { trackId, clipId } of expanded) {
					const track = currentTimeline.find((t) => t.id === trackId);
					if (!track) continue;
					const clip = track.clips.find((c) => c.id === clipId);
					if (!clip) continue;

					const clipStart = clip.start;
					const clipEnd = clip.start + clip.duration;

					// Collect beats inside this clip's span
					const beatsInside = beatTimesS.filter((t) => t > clipStart && t < clipEnd);
					if (beatsInside.length === 0) continue;

					// Sort beats and apply minimum segment guard
					beatsInside.sort((a, b) => a - b);
					let lastSplit = clipStart;
					for (const beatTime of beatsInside) {
						// Check minimum segment from last split point
						if (beatTime - lastSplit < 0.2) continue;
						// Check minimum segment to clip end
						if (clipEnd - beatTime < 0.2) continue;

						currentTimeline = splitClipAt(currentTimeline, trackId, beatTime);
						lastSplit = beatTime;
					}
				}
				return currentTimeline;
			},
			{ coalesceKey: undefined }
		);
	} else {
		// Align mode: move each clip's start to nearest beat. Compute every
		// accepted move first, then commit them as a SINGLE moveClips() batch
		// so a clip that's moving forward isn't rejected as overlapping a
		// sibling's pre-move position.
		commitTimelineMutation(
			() => {
				// Sort by current start so ties (deterministic earlier-wins) and
				// overlap-skip decisions don't depend on UI selection order.
				const sortedRefs = [...expanded].sort((a, b) => {
					const trackA = timeline.find((t) => t.id === a.trackId);
					const trackB = timeline.find((t) => t.id === b.trackId);
					const clipA = trackA?.clips.find((c) => c.id === a.clipId);
					const clipB = trackB?.clips.find((c) => c.id === b.clipId);
					return (clipA?.start ?? 0) - (clipB?.start ?? 0);
				});

				const moves: { trackId: string; clipId: string; toTrackId: string; toStart: number }[] = [];
				// Per-track running intervals of POST-MOVE positions for accepted
				// moves PLUS unchanged-selection / non-selection clip spans, so we
				// can detect collisions against the projected future timeline.
				const acceptedPostMove = new Map<string, { start: number; end: number }[]>();
				// Selected clip IDs per track -- their CURRENT spans are vacated.
				const selectedByTrack = new Map<string, Set<string>>();
				for (const { trackId, clipId } of sortedRefs) {
					const set = selectedByTrack.get(trackId) ?? new Set<string>();
					set.add(clipId);
					selectedByTrack.set(trackId, set);
				}
				for (const track of timeline) {
					const selSet = selectedByTrack.get(track.id) ?? new Set<string>();
					const blockers: { start: number; end: number }[] = [];
					for (const c of track.clips) {
						if (selSet.has(c.id)) continue;
						blockers.push({ start: c.start, end: c.start + c.duration });
					}
					acceptedPostMove.set(track.id, blockers);
				}

				for (const { trackId, clipId } of sortedRefs) {
					const track = timeline.find((t) => t.id === trackId);
					if (!track) continue;
					const clip = track.clips.find((c) => c.id === clipId);
					if (!clip) continue;

					// Find nearest beat (earlier on tie)
					let nearestBeat = beatTimesS[0];
					let minDist = Math.abs(clip.start - nearestBeat);
					for (const bt of beatTimesS) {
						const dist = Math.abs(clip.start - bt);
						if (dist < minDist) {
							minDist = dist;
							nearestBeat = bt;
						} else if (dist === minDist && bt < nearestBeat) {
							nearestBeat = bt; // earlier on tie
						}
					}

					// Clamp to 0
					const newStart = Math.max(0, nearestBeat);
					const newEnd = newStart + clip.duration;

					// Check for overlap against the projected future timeline.
					const trackBlockers = acceptedPostMove.get(trackId) ?? [];
					const overlaps = trackBlockers.some((b) => newStart < b.end && newEnd > b.start);
					if (overlaps) continue; // skip this clip

					if (newStart !== clip.start) {
						moves.push({ trackId, clipId, toTrackId: trackId, toStart: newStart });
					}
					trackBlockers.push({ start: newStart, end: newEnd });
					acceptedPostMove.set(trackId, trackBlockers);
				}

				return moves.length > 0 ? moveClips(timeline, moves) : timeline;
			},
			{ coalesceKey: undefined }
		);
	}
}

async function handleDispose(): Promise<void> {
	await waitForRendererAdoptionToSettle();
	restoreOfferGeneration += 1;
	replaySaveAbort?.abort();
	// Abort all in-flight beat analyses
	for (const controller of beatAnalysisCancels.values()) {
		controller.abort();
	}
	beatAnalysisCancels.clear();
	if (capture) {
		const finished = capture.finished;
		requestCaptureStop();
		await finished.catch(() => undefined);
	}
	await flushPendingAutosave();
	stopAudioPump();
	abortQueueWork();
	teardownMedia();
	await handlePublishTapStop();
	cancelRendererDeviceLossWatch();
	destroyRendererTextureCaches();
	await disposeAllMlEngines();
	renderer?.destroy();
	renderer = null;
	reducedRenderer?.destroy();
	reducedRenderer = null;
	previewBackend = 'none';
	exportBackend = 'none';
	currentCapabilityProbe = null;
	currentScopeSab = null;
	currentScopesEnabled = false;
	currentZebraEnabled = false;
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
		sources,
		voiceCleanup: voiceCleanupSettings,
		livePublish: currentCapabilityProbe?.livePublish ?? null,
		probe: currentCapabilityProbe ?? null,
		programMode: currentCapabilityProbe?.programMode
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

function postVoiceCleanupState(): void {
	post({ type: 'voice-cleanup-settings', settings: { ...voiceCleanupSettings } });
}

/** Applies (or defaults) the persisted Phase 46/36 configs from a project doc. */
function applyProjectPhase46Config(doc: ProjectDoc): void {
	if (capture) requestCaptureStop();
	replayRing.updateConfig(doc.replayBufferConfig ?? { ...DEFAULT_RING_BUFFER_CONFIG });
	liveChainConfig = cloneLiveChainConfig(
		doc.liveAudioChainConfig ?? DEFAULT_LIVE_AUDIO_CHAIN_CONFIG
	);
	// Phase 36: restore voice cleanup settings from project doc
	voiceCleanupSettings = doc.voiceCleanup
		? { ...doc.voiceCleanup }
		: { ...DEFAULT_VOICE_CLEANUP_SETTINGS };
	// Phase 34: restore beat-grid settings (enabled sources + global offset)
	// so a reloaded project keeps the user's previously-chosen grid. The UI
	// learns about this through `beat-settings` below.
	beatSettings = doc.beatSettings
		? {
				enabledSourceIds: [...doc.beatSettings.enabledSourceIds],
				globalOffsetMs: doc.beatSettings.globalOffsetMs
			}
		: { enabledSourceIds: [], globalOffsetMs: 0 };
	postReplayBufferState();
	postLiveChainState();
	postVoiceCleanupState();
	postBeatSettings();
}

function postBeatSettings(): void {
	post({
		type: 'beat-settings',
		enabledSourceIds: [...beatSettings.enabledSourceIds],
		globalOffsetMs: beatSettings.globalOffsetMs
	});
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
		post({ type: 'replay-capture-error', message: errorMessage(error) });
		recordRecentError({
			code: 'capture.session_failed',
			subsystem: 'worker',
			severity: 'error',
			message: errorMessage(error)
		});
	}
	requestCaptureStop();
}

async function ensureCaptureVideoEncoder(
	rt: CaptureRuntime,
	frame: VideoFrame
): Promise<VideoEncoder> {
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
	post({ type: 'replay-capture-state', state: { ...rt.state } });
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
			case 's16-planar':
				return new Int16Array(frames);
			case 's32-planar':
				return new Int32Array(frames);
			case 'u8-planar':
				return new Uint8Array(frames);
			default:
				return new Float32Array(frames);
		}
	};
	const interleavedBuffer = (): PcmPlane => {
		switch (format) {
			case 's16':
				return new Int16Array(frames * channels);
			case 's32':
				return new Int32Array(frames * channels);
			case 'u8':
				return new Uint8Array(frames * channels);
			default:
				return new Float32Array(frames * channels);
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
		post({ type: 'replay-capture-error', message: 'A capture session is already active.' });
		void videoStream?.cancel().catch(() => undefined);
		void audioStream?.cancel().catch(() => undefined);
		return;
	}
	if (!videoStream && !audioStream) {
		post({
			type: 'replay-capture-error',
			message: 'The captured stream has no video or audio tracks.'
		});
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
		post({ type: 'replay-capture-state', state: { ...rt.state } });
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
		} catch {
			/* flush after an encoder error is expected to fail */
		}
		try {
			if (rt.audioEncoder && rt.audioEncoder.state === 'configured') await rt.audioEncoder.flush();
		} catch {
			/* ditto */
		}
		try {
			if (rt.videoEncoder && rt.videoEncoder.state !== 'closed') rt.videoEncoder.close();
		} catch {
			/* already closed */
		}
		try {
			if (rt.audioEncoder && rt.audioEncoder.state !== 'closed') rt.audioEncoder.close();
		} catch {
			/* already closed */
		}
		rt.state.active = false;
		rt.state.elapsedS = (performance.now() - rt.startedAtMs) / 1000;
		capture = null;
		post({ type: 'replay-capture-state', state: { ...rt.state } });
		postReplayBufferState();
	})();

	post({ type: 'replay-capture-state', state: { ...rt.state } });
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
			type: 'replay-capture-state',
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
		const handle = await openMediaFile(
			file,
			sourceId,
			undefined,
			currentCapabilityProbe?.imageDecoder
		);
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

// ── Phase 37: Frame Interpolation handlers ──

async function probeInterpolationManifest(): Promise<
	{ configured: true; sizeBytes: number } | { configured: false; reason: string }
> {
	try {
		const response = await fetch(DEFAULT_INTERPOLATION_MANIFEST_URL);
		if (!response.ok) {
			return {
				configured: false,
				reason: `Interpolation model manifest fetch failed: HTTP ${response.status}.`
			};
		}
		const manifest = validateInterpolationManifest(await response.json());
		return { configured: true, sizeBytes: manifest.model.sizeBytes };
	} catch (error) {
		if (error instanceof InterpolationManifestError) {
			return { configured: false, reason: 'No compatible interpolation model configured.' };
		}
		return {
			configured: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}

async function handleInterpolationProbe(): Promise<void> {
	// Availability is display/feature-gate only — it never feeds tier derivation
	// (R1.1). A usable WebGPU renderer means ORT-WebGPU can share the renderer
	// device; the model graph still must pass manifest validation before controls
	// appear.
	const tier = currentCapabilityProbe?.tier ?? 'shell-only';
	const hasDevice = renderer !== null;
	const baseAvailability = deriveInterpolationAvailability(tier, hasDevice, hasDevice);
	if (baseAvailability.state === 'unavailable') {
		post({ type: 'interp-availability', availability: baseAvailability });
		return;
	}

	const manifestProbe = await probeInterpolationManifest();
	if (!manifestProbe.configured) {
		post({
			type: 'interp-availability',
			availability: { state: 'unavailable', reason: manifestProbe.reason }
		});
		post({
			type: 'interp-model-status',
			status: 'failed',
			error: manifestProbe.reason
		});
		return;
	}

	post({
		type: 'interp-availability',
		availability: baseAvailability
	});
	post({
		type: 'interp-model-status',
		status: interpolationEngine?.getStatus() ?? 'not-loaded',
		accelerator: 'webgpu',
		sizeBytes: manifestProbe.sizeBytes
	});
}

async function handleInterpolationLoadModel(
	cmd: Extract<InterpolationWorkerCommand, { type: 'interp-load-model' }>
): Promise<void> {
	// Single deployed model in v1; `catalogId` is reserved for future selection.
	void cmd.catalogId;
	const engine = ensureInterpolationEngine();
	if (!engine) {
		post({
			type: 'interp-model-status',
			status: 'failed',
			error: 'Frame interpolation requires the accelerated WebGPU renderer.'
		});
		return;
	}
	// Status (loading → loaded/failed, with size/error) flows from the engine's
	// onStatus callback wired in ensureInterpolationEngine.
	await engine.ensureModelLoaded();
}

/** Output frame count + bracketing tile plan for an estimate request. */
function interpEstimateInputs(
	cmd: Extract<InterpolationWorkerCommand, { type: 'interp-estimate' }>
): {
	frames: number;
	range: TimeRange;
} {
	if (cmd.request.kind === 'preview') {
		const seg = cmd.request.segment;
		// Nominal source cadence for the preview estimate; the real per-frame cost
		// comes from the tile plan + calibration below.
		const frames = Math.max(0, Math.round((seg.endS - seg.startS) * 30));
		return { frames, range: seg };
	}
	const settings = cmd.request.settings;
	const range = settings.range ?? { startS: 0, endS: 0 };
	const durationS = Math.max(0, range.endS - range.startS);
	return { frames: Math.round(durationS * settings.fps), range };
}

async function handleInterpolationEstimate(
	cmd: Extract<InterpolationWorkerCommand, { type: 'interp-estimate' }>
): Promise<void> {
	const engine = ensureInterpolationEngine();
	const manifest = engine?.getModelManifest();
	const io = manifest ? toModelIoContract(manifest.io) : INTERP_DEFAULT_IO;
	const width = renderer?.size.width ?? 1920;
	const height = renderer?.size.height ?? 1080;
	const plan = planTiles(width, height, io, interpVramBudget());
	const { frames, range } = interpEstimateInputs(cmd);
	if ('refuse' in plan) {
		post({ type: 'interp-refusal', reason: 'vram', range });
		return;
	}
	const estimateMs = estimateSynthesisMs(frames, plan, INTERP_DEFAULT_CALIBRATION);
	post({
		type: 'interp-estimate-result',
		estimateMs,
		frames,
		tilesPerFrame: plan.tiles.length,
		cachedFraction: 0
	});
}

async function handleInterpolationPreviewSegment(
	cmd: Extract<InterpolationWorkerCommand, { type: 'interp-preview-segment' }>
): Promise<void> {
	const engine = ensureInterpolationEngine();
	if (!engine) {
		post({
			type: 'interp-error',
			message: 'Frame interpolation requires the accelerated WebGPU renderer.'
		});
		return;
	}
	if (engine.getStatus() !== 'loaded') await engine.ensureModelLoaded();
	if (engine.getStatus() !== 'loaded') {
		post({ type: 'interp-error', message: 'Interpolation model is not loaded.' });
		return;
	}
	// The zero-copy synthesis engine (engine.synthesise) and render-cache keying
	// are in place; bounded-preview frame generation feeds them from the
	// DualStreamFrameSource decode path + presents through the render cache
	// (tasks T3.4/T7.3). That decode→cache plumbing is the remaining integration
	// slice and is not yet wired into preview.
	post({
		type: 'interp-error',
		message: `Bounded interpolation preview for ${cmd.segment.startS.toFixed(2)}–${cmd.segment.endS.toFixed(2)}s needs the decode→cache integration (tasks T3.4/T7.3); the model is loaded and synthesis is ready.`
	});
}

function handleInterpolationCancel(): void {
	post({ type: 'interp-cancelled' });
}

function handleInterpolationDispose(): void {
	void interpolationEngine?.dispose();
	interpolationEngine = null;
}

/** Phase 32b: lazily build the beauty engine and trigger a model load. The
 *  frame-coupled face/landmark path is pinned to ORT-WebGPU, so the command's
 *  `preferredExecutionProvider` only matters for a future reduced/export path. */
function handleLoadBeautyModel(cmd: Extract<WorkerCommand, { type: 'load-beauty-model' }>): void {
	void cmd;
	const engine = ensureBeautyEngine();
	if (!engine) {
		post({
			type: 'beauty-model-status',
			status: 'failed',
			error: 'Beauty requires the accelerated WebGPU renderer.'
		});
		return;
	}
	void engine.ensureModelLoaded();
}

function handleUnloadBeautyModel(): void {
	void beautyEngine?.dispose();
	beautyEngine = null;
	post({ type: 'beauty-model-status', status: 'not-loaded' });
}

// ── Phase 39: Vertical and Platform Finishing ──

function handleSetProjectFormat(aspect: ProjectAspect): void {
	if (projectFormat.aspect === aspect) return;
	history.push(historySnapshot());
	projectFormat = { aspect };
	const { width, height } = aspectOutputSize(aspect);
	const handle = getPlaybackSource();
	const frameRate =
		handle?.frameSource && handle.frameRate > 0 ? handle.frameRate : TITLE_ONLY_CANVAS.frameRate;
	adaptive = new AdaptiveResolution(buildPreviewLadder(width, height), 1000 / frameRate);
	ensurePreview();
	post({ type: 'project-format-changed', aspect });
	postTimelineState();
	scheduleAutosave();
}

function handleSetCoverFrame(timeS: number, titleClipId: string | null): void {
	history.push(historySnapshot());
	cover = { timeS, titleClipId };
	post({ type: 'cover-frame-changed', cover });
	scheduleAutosave();
}

async function exportCoverFrame(
	coverDoc: CoverFrameDoc,
	outputStem: string,
	outputDir: FileSystemDirectoryHandle
): Promise<{ ok: true } | { ok: false; error: string }> {
	const rendered = await renderCoverFrameBlob(coverDoc);
	if (!rendered.ok) return rendered;
	try {
		const handle = await outputDir.getFileHandle(`${outputStem}.cover.jpg`, { create: true });
		const w = await handle.createWritable();
		await w.write(rendered.blob);
		await w.close();
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: `Cover export failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

async function renderCoverFrameBlob(
	coverDoc: CoverFrameDoc
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
	try {
		const { width, height } = aspectOutputSize(projectFormat.aspect);
		if (!renderer || !previewCanvas) return { ok: false, error: 'No renderer available.' };
		const getLayers = makeGetLayers();
		const layers = await getLayers(coverDoc.timeS);
		if (!layers || layers.length === 0)
			return { ok: false, error: 'No layers at cover timestamp.' };

		const stack: CompositeLayer[] = [];
		const frames: VideoFrame[] = [];
		try {
			for (const layer of layers) {
				if (layer.meta.kind === 'title') {
					if (coverDoc.titleClipId) continue;
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
				} else if (layer.meta.kind === 'callout-texture') {
					const texture = calloutCache?.get(layer.meta.clipId);
					if (!texture) continue;
					stack.push({
						kind: 'texture',
						view: texture.view,
						sourceWidth: texture.width,
						sourceHeight: texture.height,
						transform: layer.meta.transform,
						transition: layer.meta.transition
					});
				} else if (layer.meta.kind === 'callout-effect') {
					stack.push(
						layer.meta.effect === 'spotlight'
							? {
									kind: 'spotlight',
									transform: layer.meta.transform,
									darkenStrength: layer.meta.darkenStrength ?? 0.7,
									transition: layer.meta.transition
								}
							: {
									kind: 'blur-region',
									transform: layer.meta.transform,
									blurRadius: layer.meta.blurRadius ?? 12,
									transition: layer.meta.transition
								}
					);
				} else if (layer.meta.kind === 'frame' && layer.decoded) {
					const frame = layer.decoded.toVideoFrame();
					frames.push(frame);
					stack.push({
						kind: 'frame',
						frame,
						effects: layer.meta.effects,
						transform: layer.meta.transform,
						lut: layer.meta.lut,
						transition: layer.meta.transition
					});
				}
			}

			if (coverDoc.titleClipId) {
				const selected = titleClips().find(({ clip }) => clip.id === coverDoc.titleClipId)?.clip;
				if (selected?.title) {
					const texture = titleCache?.ensure(selected.id, selected.title);
					if (texture) {
						stack.push({
							kind: 'texture',
							view: texture.view,
							sourceWidth: texture.width,
							sourceHeight: texture.height,
							transform: sampleClipParamsAt(selected, coverDoc.timeS).transform
						});
					}
				}
			}

			renderer.setPreviewSize(width, height);
			renderer.present(stack);
			if (typeof previewCanvas.convertToBlob !== 'function')
				return { ok: false, error: 'Canvas does not support convertToBlob.' };
			// Cover export: one-shot readback, not a sustained pixel loop - hard gate 2 exemption.
			const blob = await previewCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
			return { ok: true, blob };
		} finally {
			for (const frame of frames) frame.close();
			for (const layer of layers) layer.decoded?.close();
		}
	} catch (error) {
		return {
			ok: false,
			error: `Cover render failed: ${error instanceof Error ? error.message : String(error)}`
		};
	} finally {
		ensurePreview();
	}
}

async function handleRequestCoverThumbnail(
	cmd: Extract<WorkerCommand, { type: 'request-cover-thumbnail' }>
): Promise<void> {
	const coverDoc: CoverFrameDoc = { timeS: cmd.timeS, titleClipId: cmd.titleClipId ?? null };
	const rendered = await renderCoverFrameBlob(coverDoc);
	if (rendered.ok) {
		post({ type: 'cover-thumbnail', cover: coverDoc, blob: rendered.blob });
	} else {
		post({ type: 'cover-thumbnail-error', cover: coverDoc, error: rendered.error });
	}
}

// ── Phase 45: Program Mode handlers ──

function isProgramVideoSource(kind: import('../protocol').ProgramSourceKind): boolean {
	return kind === 'screen' || kind === 'webcam';
}

function programSourceKindToCapture(
	kind: import('../protocol').ProgramSourceKind
): import('../protocol').CaptureSourceKind | null {
	switch (kind) {
		case 'screen':
		case 'webcam':
		case 'mic':
			return kind;
		default:
			return null;
	}
}

function programVideoConfig(
	config: VideoEncoderConfig | AudioEncoderConfig | null
): VideoEncoderConfig {
	const partial = (config ?? {}) as Partial<VideoEncoderConfig>;
	return {
		codec: partial.codec ?? 'avc1.42001E',
		width: partial.width ?? 1920,
		height: partial.height ?? 1080,
		bitrate: partial.bitrate ?? 5_000_000,
		framerate: partial.framerate,
		latencyMode: 'realtime',
		hardwareAcceleration: 'prefer-hardware'
	};
}

function programAudioConfig(
	config: VideoEncoderConfig | AudioEncoderConfig | null
): AudioEncoderConfig {
	const partial = (config ?? {}) as Partial<AudioEncoderConfig>;
	return {
		codec: partial.codec ?? 'opus',
		sampleRate: partial.sampleRate ?? 48_000,
		numberOfChannels: partial.numberOfChannels ?? 2,
		bitrate: partial.bitrate ?? 128_000
	};
}

function captureSourceStatusToProgram(
	source: import('../protocol').CaptureSourceStatusSnapshot
): import('../protocol').ProgramSourceStatusSnapshot {
	return {
		sourceId: source.sourceId,
		kind: source.kind === 'screen' || source.kind === 'webcam' ? source.kind : 'mic',
		label: source.label,
		state:
			source.state === 'error' ? 'failed' : source.state === 'capturing' ? 'active' : 'dropped',
		preEncodeDrops: source.preEncodeDrops
	};
}

function activeExternalEncoderConsumers(): EncoderConsumer[] {
	const consumers: EncoderConsumer[] = [];
	if (publishTap) {
		consumers.push('whip-publish');
	}
	if (exportAbort || queueRunning) {
		consumers.push('export');
	}
	return consumers;
}

function programLandingSettingsFromConfig(
	config: import('../protocol').ProgramSessionConfig
): import('../protocol').CaptureSettingsSnapshot {
	const videoSource = config.sources.find((source) => isProgramVideoSource(source.kind));
	const videoConfig = (videoSource?.encoderConfig ?? {}) as Partial<VideoEncoderConfig>;
	const audioSource = config.sources.find((source) => source.kind === 'mic');
	const audioConfig = (audioSource?.encoderConfig ?? {}) as Partial<AudioEncoderConfig>;
	return {
		chunkDurationS: config.chunkTargetS,
		videoCodec: videoConfig.codec ?? 'avc1.42001E',
		audioCodec: audioConfig.codec ?? 'opus',
		videoBitrate: videoConfig.bitrate ?? 5_000_000,
		canvasWidth: videoConfig.width,
		canvasHeight: videoConfig.height
	};
}

async function handleProgramStart(
	cmd: Extract<WorkerCommand, { type: 'program-start' }>
): Promise<void> {
	let sessionForStart: CaptureSession | null = null;
	try {
		if (!renderer) {
			throw new Error('Program Mode requires the accelerated preview renderer.');
		}
		if (programSession) {
			throw new Error('Program session is already running.');
		}
		if (captureSession) {
			throw new Error('Capture engine is already active.');
		}
		const mod = await import('./program-session');
		const { createProgramCompositor } = await import('./program-compositor');
		const { createLiveComposeTap } = await import('./live-compose-tap');
		const { createEncoderBudget, budgetSessionsForProbe } = await import('./encoder-budget');

		releaseProgramExternalEncoderLeases();
		const maxEncoderSessions = budgetSessionsForProbe(
			currentCapabilityProbe?.livePublish.hardwareH264Encode === 'supported'
		);
		programEncoderBudget = createEncoderBudget(maxEncoderSessions);
		for (const consumer of activeExternalEncoderConsumers()) {
			const lease = programEncoderBudget.acquire(consumer);
			if (!lease) {
				throw new Error(
					`Encoder budget is already full with active ${programEncoderBudget.activeConsumers().join(', ')} work.`
				);
			}
			programExternalEncoderLeases.push(lease);
		}
		programLandingSettings = programLandingSettingsFromConfig(cmd.config);
		programSceneDoc = sceneDocFromDefinitions(cmd.config.scenes);
		scheduleAutosave();

		// Create compositor
		programCompositor = createProgramCompositor({
			renderer: renderer!,
			scenes: cmd.config.scenes,
			sourceWidth: 1920,
			sourceHeight: 1080
		});

		// Create tap
		programTap = createLiveComposeTap(programCompositor);

		sessionForStart = new CaptureSession(
			`program-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			{
				onStatusChange(status) {
					const programState = (
						status.state === 'recording' || status.state === 'paused' ? 'running' : status.state
					) as 'idle' | 'armed' | 'running' | 'stopping';
					post({
						type: 'program-status',
						state: programState,
						elapsedUs: status.elapsedUs,
						activeSceneId: programSession?.getCurrentSceneId() ?? cmd.config.initialSceneId,
						sources: status.sources.map(captureSourceStatusToProgram)
					});
				},
				onError(_sourceId, code, detail) {
					programPendingError = code === 'quota-exceeded' ? 'storage-quota' : 'source-failed';
					programPendingErrorDetail = detail;
					void handleProgramStop();
				}
			},
			cmd.writerPort
		);

		let capturedSourceCount = 0;
		for (const source of cmd.config.sources) {
			if (!source.track) continue;
			const captureKind = programSourceKindToCapture(source.kind);
			if (!captureKind) continue;
			const videoConfig = isProgramVideoSource(source.kind)
				? programVideoConfig(source.encoderConfig)
				: undefined;
			const audioConfig =
				source.kind === 'mic' ? programAudioConfig(source.encoderConfig) : undefined;
			sessionForStart.addSource(
				source.sourceId,
				captureKind,
				source.label,
				source.track,
				videoConfig,
				audioConfig,
				videoConfig
					? {
							width: videoConfig.width,
							height: videoConfig.height,
							frameRate: null
						}
					: {},
				videoConfig
					? (sourceId, frame) => {
							programTap?.onFrame(sourceId, frame);
							scheduleProgramRender();
						}
					: undefined
			);
			capturedSourceCount++;
		}
		if (capturedSourceCount === 0) {
			throw new Error(
				'Program Mode requires at least one captured screen, camera, or microphone source.'
			);
		}

		// Create session (acquires encoder leases)
		programSession = mod.createProgramSession(
			cmd.config,
			programEncoderBudget,
			sessionForStart,
			programCompositor,
			programTap
		);
		captureSession = sessionForStart;
		sessionForStart = null;
		await programSession.start();

		post({
			type: 'program-status',
			state: 'running',
			elapsedUs: 0,
			activeSceneId: cmd.config.initialSceneId,
			sources: cmd.config.sources.map((s) => ({
				sourceId: s.sourceId,
				kind: s.kind,
				label: s.label,
				state: 'active' as const,
				preEncodeDrops: 0
			}))
		});
	} catch (err) {
		if (err instanceof (await import('./program-session')).ProgramBudgetError) {
			post({
				type: 'program-error',
				code: 'budget-exhausted',
				detail: err.message
			});
		} else {
			post({
				type: 'program-error',
				code: 'compositor-error',
				detail: String(err)
			});
		}
		const failedCaptureSession = sessionForStart ?? captureSession;
		failedCaptureSession?.reset();
		releaseProgramExternalEncoderLeases();
		programSession = null;
		cancelProgramRenderFrame();
		programCompositor?.dispose();
		programCompositor = null;
		programTap?.dispose();
		programTap = null;
		programLandingSettings = null;
		programPendingError = null;
		programPendingErrorDetail = null;
		if (captureSession === failedCaptureSession) {
			captureSession = null;
		}
	}
}

async function handleProgramStop(): Promise<void> {
	if (programStopInFlight) return programStopInFlight;
	if (!programSession) return;
	const session = programSession;
	const activeCaptureSession = captureSession;
	const landingSettings = programLandingSettings ?? {
		chunkDurationS: 2,
		videoCodec: 'avc1.42001E',
		audioCodec: 'opus',
		videoBitrate: 5_000_000
	};
	programStopInFlight = (async () => {
		try {
			const result = await session.stop();
			const isoTrackIds = activeCaptureSession
				? applyCaptureLanding(
						activeCaptureSession,
						landingSettings,
						undefined,
						result.layoutTrack ? [result.layoutTrack] : []
					)
				: [];
			post({
				type: 'program-landed',
				sessionId: result.sessionId,
				isoTrackIds,
				layoutTrackId: result.layoutTrack?.id ?? ''
			});
			if (programPendingError && programPendingErrorDetail) {
				post({
					type: 'program-error',
					code: programPendingError,
					detail: programPendingErrorDetail
				});
			}
		} catch (err) {
			post({
				type: 'program-error',
				code: programPendingError ?? 'session-error',
				detail: String(err)
			});
		} finally {
			activeCaptureSession?.reset();
			if (captureSession === activeCaptureSession) {
				captureSession = null;
			}
			releaseProgramExternalEncoderLeases();
			cancelProgramRenderFrame();
			programCompositor?.dispose();
			programTap?.dispose();
			programSession = null;
			programCompositor = null;
			programTap = null;
			programEncoderBudget = null;
			programLandingSettings = null;
			programPendingError = null;
			programPendingErrorDetail = null;
			programStopInFlight = null;
		}
	})();
	return programStopInFlight;
}

function handleProgramSceneSwitch(sceneId: string, transitionMs: 0 | 200): void {
	if (programSession) {
		programSession.switchScene(sceneId, transitionMs);
		scheduleProgramRender();
	}
}

function handleProgramUpdateScenes(scenes: SceneDefinition[]): void {
	programSceneDoc = sceneDocFromDefinitions(scenes);
	scheduleAutosave();
	if (programSession) {
		programSession.updateScenes(scenes);
		scheduleProgramRender();
	} else if (programCompositor) {
		programCompositor.updateScenes(scenes);
		scheduleProgramRender();
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
		case 'set-loop':
			handleSetLoop(cmd.enabled);
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
		case 'replace-keyframe-tracks':
			handleReplaceKeyframeTracks(cmd);
			break;
		case 'get-source-file':
			void handleGetSourceFile(cmd);
			break;
		case 'delete-keyframe':
			handleDeleteKeyframe(cmd);
			break;
		case 'import-lut':
			void handleImportLut(cmd);
			break;
		case 'import-look-preset':
			void handleImportLookPreset(cmd);
			break;
		case 'export-look-preset':
			void handleExportLookPreset(cmd);
			break;
		case 'set-lut-strength':
			handleSetLutStrength(cmd);
			break;
		case 'set-skin-mask':
			handleSetSkinMask(cmd);
			break;
		case 'set-skin-smooth-bypass':
			handleSetSkinSmoothBypass(cmd);
			break;
		case 'set-matte-enabled':
			handleSetMatteEnabled(cmd);
			break;
		case 'set-matte-strength':
			handleSetMatteStrength(cmd);
			break;
		case 'set-matte-mode':
			handleSetMatteMode(cmd);
			break;
		case 'set-matte-blur-radius':
			handleSetMatteBlurRadius(cmd);
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
		case 'extract-clip-audio':
			void handleExtractClipAudio(cmd);
			break;
		case 'apply-audio-cleanup':
			void handleApplyAudioCleanup(cmd);
			break;
		case 'remove-audio-cleanup':
			handleRemoveAudioCleanup(cmd);
			break;
		case 'asr-create-caption-track':
			handleAsrCreateCaptionTrack(cmd);
			break;
		case 'add-translated-caption-track':
			handleAddTranslatedCaptionTrack(cmd);
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
		case 'add-callout':
			handleAddCallout(cmd);
			break;
		case 'set-callout':
			handleSetCallout(cmd);
			break;
		case 'set-padded-background':
			handleSetPaddedBackground(cmd);
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
		case 'request-cover-thumbnail':
			void handleRequestCoverThumbnail(cmd);
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
			const wasActive = renderer?.scopesActive ?? false;
			currentScopesEnabled = cmd.enabled;
			renderer?.setScopesEnabled(cmd.enabled);
			if (cmd.enabled && renderer && !wasActive) {
				playback?.refresh();
			}
			break;
		}
		case 'toggle-zebra': {
			currentZebraEnabled = cmd.enabled;
			renderer?.setZebraEnabled(cmd.enabled);
			break;
		}
		case 'set-caption-track':
			handleSetCaptionTrack(cmd);
			break;
		case 'delete-caption-track':
			handleDeleteCaptionTrack(cmd);
			break;
		case 'delete-caption-tracks':
			handleDeleteCaptionTracks(cmd);
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
		case 'caption-import-custom-preset':
			handleCaptionImportCustomPreset(cmd);
			break;
		case 'caption-delete-custom-preset':
			handleCaptionDeleteCustomPreset(cmd);
			break;
		case 'caption-set-anim-style':
			handleCaptionSetAnimStyle(cmd);
			break;
		case 'caption-set-words':
			handleCaptionSetWords(cmd);
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
		case 'queue-pause':
			handleQueueCancelAll();
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
			if (cmd.actionId === 'retry-gpu-device' || cmd.actionId === 'device-lost-recovery') {
				void handleRetryGpuDevice(cmd.actionId);
			} else {
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
			}
			break;
		// Phase 46: Replay Buffer + Live Audio Chain
		case 'replay-capture-stop':
			requestCaptureStop();
			break;
		case 'replay-capture-transfer-streams':
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
		case 'publish-tap-start':
			handlePublishTapStart(cmd.mode);
			break;
		case 'publish-tap-stop':
			void handlePublishTapStop();
			break;
		case 'capture-add-source':
			if (captureSession?.stateValue === 'recording' || captureSession?.stateValue === 'paused') {
				const videoConfig: VideoEncoderConfig | undefined =
					cmd.source.kind === 'screen' || cmd.source.kind === 'webcam'
						? {
								codec: 'avc1.64002a',
								width: cmd.source.width ?? 1920,
								height: cmd.source.height ?? 1080,
								bitrate: 5_000_000,
								latencyMode: 'realtime',
								hardwareAcceleration: 'prefer-hardware'
							}
						: undefined;
				const audioConfig: AudioEncoderConfig | undefined =
					cmd.source.kind === 'mic' || cmd.source.kind === 'system-audio'
						? {
								codec: 'mp4a.40.2',
								sampleRate: 48_000,
								numberOfChannels: 2,
								bitrate: 128_000
							}
						: undefined;
				captureSession.addSource(
					cmd.source.sourceId,
					cmd.source.kind,
					cmd.source.label,
					// Omitted track ⇒ trackless push pipeline (main forwards frames).
					cmd.track ?? null,
					videoConfig,
					audioConfig,
					{
						width: cmd.source.width,
						height: cmd.source.height,
						frameRate: cmd.source.frameRate
					}
				);
			} else {
				pendingCaptureSources.set(cmd.source.sourceId, {
					sourceId: cmd.source.sourceId,
					kind: cmd.source.kind,
					label: cmd.source.label,
					track: cmd.track ?? null,
					width: cmd.source.width,
					height: cmd.source.height,
					frameRate: cmd.source.frameRate
				});
			}
			break;
		case 'capture-push-frame':
			// Main-frames fallback (bugfix B5/T5.5): route the forwarded frame to its
			// push pipeline, or close it here if there is no active session so the
			// transferred frame never leaks.
			if (captureSession) {
				captureSession.pushFrame(cmd.sourceId, cmd.frame);
			} else {
				cmd.frame.close();
			}
			break;
		case 'capture-remove-source':
			pendingCaptureSources.delete(cmd.sourceId);
			break;
		case 'capture-start': {
			if (pendingCaptureSources.size === 0) break;
			captureSession = new CaptureSession(
				`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				{
					onStatusChange(status) {
						post({ type: 'capture-status', ...status });
						// Transition-edge DOM tap messages. Each fires exactly once per
						// edge by comparing the previously seen state. We emit the stop on
						// the first 'stopping' transition so main removes listeners BEFORE
						// the session's final ring drain — in-flight events still land in
						// the SAB and are picked up by that drain. Without this, internal
						// stops (audio-overrun, all-sources-ended) only signal main after
						// the drain runs and late events are lost.
						if (captureDomTapSessionId !== null) {
							const prev = captureDomTapLastState;
							if (prev !== 'paused' && status.state === 'paused') {
								post({ type: 'capture-dom-tap-pause', sessionId: captureDomTapSessionId });
							} else if (prev === 'paused' && status.state === 'recording') {
								post({ type: 'capture-dom-tap-resume', sessionId: captureDomTapSessionId });
							}
							// CaptureSession.stop() always transitions through 'stopping'
							// before 'idle', so observing 'stopping' is sufficient. The
							// previous code also matched 'idle' as a fallback, but that
							// branch was dead and would have falsely fired on a hypothetical
							// armed→idle transition; keep the guard strict.
							if (prev !== 'stopping' && status.state === 'stopping') {
								post({ type: 'capture-dom-tap-stop', sessionId: captureDomTapSessionId });
								captureDomTapSessionId = null;
							}
						}
						captureDomTapLastState = status.state;
					},
					onError(sourceId, code, detail) {
						post({
							type: 'capture-error',
							sourceId,
							code: code as import('../protocol').CaptureErrorCode,
							detail
						});
					}
				},
				cmd.writerPort
			);
			const settings = cmd.settings;
			captureLandingSettings = settings;
			captureRetakeClipId = cmd.retakeClipId;
			for (const [, src] of pendingCaptureSources) {
				const videoConfig: VideoEncoderConfig | undefined =
					src.kind === 'screen' || src.kind === 'webcam'
						? {
								codec: settings.videoCodec,
								width: src.width ?? settings.canvasWidth ?? 1920,
								height: src.height ?? settings.canvasHeight ?? 1080,
								bitrate: settings.videoBitrate ?? 5_000_000,
								latencyMode: 'realtime',
								hardwareAcceleration: 'prefer-hardware'
							}
						: undefined;
				const audioConfig: AudioEncoderConfig | undefined =
					src.kind === 'mic' || src.kind === 'system-audio'
						? {
								codec: settings.audioCodec,
								sampleRate: 48_000,
								numberOfChannels: 2,
								bitrate: 128_000
							}
						: undefined;
				captureSession!.addSource(
					src.sourceId,
					src.kind,
					src.label,
					src.track,
					videoConfig,
					audioConfig,
					{
						width: src.width,
						height: src.height,
						frameRate: src.frameRate
					}
				);
			}
			pendingCaptureSources.clear();
			// Phase 41 own-tab DOM event tap: allocate a fresh SAB ring per session
			// (no reuse — avoids stale-record/GC concerns) and signal main to install
			// listeners. Generation is informational; the SAB itself is authoritative.
			try {
				captureDomTapGeneration = (captureDomTapGeneration + 1) | 0;
				const ring = allocateCaptureEventRing(captureDomTapGeneration);
				captureSession.attachEventRing(ring);
				captureDomTapSessionId = captureSession.sessionId;
				captureDomTapLastState = 'recording';
				post({
					type: 'capture-dom-tap-init',
					sessionId: captureSession.sessionId,
					ring,
					// epochMs is a wall-clock-equivalent absolute timestamp so the main
					// thread can subtract its own `timeOrigin + now()` from it. Workers
					// and windows have different `performance.timeOrigin` baselines but
					// the same wall-clock UTC, so adding them gives a consistent epoch.
					epochMs: performance.timeOrigin + performance.now()
				});
			} catch (err) {
				// Event ring is non-fatal: recording itself must continue if SAB
				// allocation fails (e.g. crossOriginIsolated dropped mid-session).
				post({
					type: 'capture-error',
					sourceId: null,
					code: 'session-error',
					detail: `event-ring init failed: ${String(err)}`
				});
			}
			void captureSession.start(settings.chunkDurationS).catch((err: Error) => {
				post({ type: 'capture-error', sourceId: null, code: 'session-error', detail: String(err) });
			});
			break;
		}
		case 'capture-stop':
			if (captureSession) {
				const session = captureSession;
				// Signal main to remove DOM listeners *before* the async stop chain so
				// no late event lands in a torn-down session. The SAB drain inside
				// session.stop() handles any in-flight records already enqueued.
				if (captureDomTapSessionId === session.sessionId) {
					post({ type: 'capture-dom-tap-stop', sessionId: session.sessionId });
					captureDomTapSessionId = null;
				}
				// Reset the edge-detection state so back-to-back sessions can't observe
				// stale 'recording'/'paused' values left over from this one.
				captureDomTapLastState = null;
				void (async () => {
					try {
						await session.stop();
						const trackIds = applyCaptureLanding(
							session,
							captureLandingSettings ?? {
								chunkDurationS: 2,
								videoCodec: 'avc1.64002a',
								audioCodec: 'mp4a.40.2',
								videoBitrate: 5_000_000
							},
							captureRetakeClipId
						);
						post({ type: 'capture-landed', sessionId: session.sessionId, trackIds });
						// session.stop() already awaited the writer's finalize-ack, so
						// events.ndjson is flushed + closed at this point and the panel can
						// safely consume the sidecar via `readCaptureEventsSidecar`. Posted
						// regardless of whether the sidecar contains data — absent sidecar
						// still fires this so the panel's gating doesn't wait forever.
						post({ type: 'capture-events-sidecar-ready', sessionId: session.sessionId });
					} finally {
						session.reset();
						if (captureSession === session) {
							captureSession = null;
						}
						captureLandingSettings = null;
						captureRetakeClipId = undefined;
					}
				})();
			}
			for (const [, src] of pendingCaptureSources) {
				// Push sources have no worker-side track — main owns and stops it.
				src.track?.stop();
			}
			pendingCaptureSources.clear();
			break;
		case 'capture-pause':
			// Phase 42: Pause capture session (suspend MSTP reader loops)
			if (captureSession) {
				void captureSession.pause().catch((err: Error) => {
					post({
						type: 'capture-error',
						sourceId: null,
						code: 'session-error',
						detail: String(err)
					});
				});
			}
			break;
		case 'capture-resume':
			// Phase 42: Resume capture session (restart MSTP reader loops)
			if (captureSession) {
				void captureSession.resume().catch((err: Error) => {
					post({
						type: 'capture-error',
						sourceId: null,
						code: 'session-error',
						detail: String(err)
					});
				});
			}
			break;
		case 'capture-apply-region':
			captureSession?.applyRegion(cmd.sourceId, cmd.mode);
			break;
		case 'capture-recovery-import':
			// TODO: Phase 41 — T7 crash recovery: scan + import orphaned session
			void cmd;
			break;
		case 'capture-recovery-discard':
			// TODO: Phase 41 — T7 crash recovery: discard orphaned session
			void cmd;
			break;
		// Phase 45: Program Mode
		case 'program-start':
			void handleProgramStart(cmd);
			break;
		case 'program-stop':
			void handleProgramStop();
			break;
		case 'program-scene-switch':
			handleProgramSceneSwitch(cmd.sceneId, cmd.transitionMs);
			break;
		case 'program-update-scenes':
			handleProgramUpdateScenes(cmd.scenes);
			break;
		// Phase 36: Voice Cleanup
		case 'voice-cleanup-analyse-loudness':
			void handleVoiceCleanupAnalyseLoudness(cmd);
			break;
		case 'voice-cleanup-cancel-analysis':
			handleVoiceCleanupCancelAnalysis();
			break;
		case 'voice-cleanup-apply-normalisation':
			handleVoiceCleanupApplyNormalisation(cmd.normalisationGainDb);
			break;
		case 'voice-cleanup-update-settings':
			handleVoiceCleanupUpdateSettings(cmd.settings);
			break;
		// -- Phase 34: Beat Detection --
		case 'analyze-beats':
			void handleAnalyzeBeats(cmd.sourceId);
			break;
		case 'cancel-beat-analysis':
			handleCancelBeatAnalysis(cmd.sourceId);
			break;
		case 'beat-auto-cut':
			void handleBeatAutoCut(cmd.mode, cmd.clipRefs);
			break;
		case 'set-beat-settings':
			handleSetBeatSettings(cmd.enabledSourceIds, cmd.globalOffsetMs);
			break;
		// Phase 35: Time Remapping
		case 'set-time-remap':
			handleSetTimeRemap(cmd);
			break;
		case 'clear-time-remap':
			handleClearTimeRemap(cmd);
			break;
		// Phase 44: Silence Detection
		case 'detect-silence':
			void handleDetectSilence(cmd);
			break;
		case 'cancel-silence-detection':
			inFlightSilenceRequests.delete(cmd.requestId);
			break;
		case 'apply-silence-cuts':
			handleApplySilenceCuts(cmd);
			break;
		// Phase 44: Keystroke overlay
		case 'generate-key-overlay':
			handleGenerateKeyOverlay(cmd);
			break;
		// ── Phase 37: Frame Interpolation ──
		case 'interp-probe':
			void handleInterpolationProbe();
			break;
		case 'interp-load-model':
			void handleInterpolationLoadModel(cmd);
			break;
		case 'interp-estimate':
			void handleInterpolationEstimate(cmd);
			break;
		case 'interp-preview-segment':
			void handleInterpolationPreviewSegment(cmd);
			break;
		case 'interp-cancel':
			handleInterpolationCancel();
			break;
		case 'interp-dispose':
			handleInterpolationDispose();
			break;
		// Phase 32b: Landmark-Driven Beauty
		case 'load-beauty-model':
			handleLoadBeautyModel(cmd);
			break;
		case 'set-beauty-effect':
			commitTimelineMutation(() => setBeautyEffect(timeline, cmd.trackId, cmd.clipId, cmd.beauty), {
				coalesceKey: { clipId: cmd.clipId, key: 'beauty' },
				refreshPlayback: 'refresh',
				prune: false,
				syncLuts: false
			});
			break;
		case 'unload-beauty-model':
			handleUnloadBeautyModel();
			break;
		// Phase 39: Vertical and Platform Finishing
		case 'set-project-format':
			handleSetProjectFormat(cmd.aspect);
			break;
		case 'set-cover-frame':
			handleSetCoverFrame(cmd.timeS, cmd.titleClipId ?? null);
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
