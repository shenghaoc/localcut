/** Shared types for main ↔ pipeline worker messages. */
import type { DiagnosticSnapshot, RecentError, RecoveryAction } from './diagnostics/types';

/** Clock SAB layout: [0] currentTime, [1] duration, [2] playState, [3] audioClock. */
export const CLOCK_FIELD_COUNT = 4;
export const CLOCK_BUFFER_BYTES = CLOCK_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;

export const ClockIndex = {
	CURRENT_TIME: 0,
	DURATION: 1,
	PLAY_STATE: 2,
	AUDIO_CLOCK: 3
} as const;

/** Meter SAB layout: peak/RMS pairs written by the AudioWorklet (single writer). */
export const METER_FIELD_COUNT = 4;
export const METER_BUFFER_BYTES = METER_FIELD_COUNT * Float32Array.BYTES_PER_ELEMENT;

export const MeterIndex = {
	PEAK_L: 0,
	PEAK_R: 1,
	RMS_L: 2,
	RMS_R: 3
} as const;

export type PlayState = 'paused' | 'playing';
/** Source media kind. Images are stills serving one decoded frame for any timestamp. */
export type MediaKind = 'video' | 'image' | 'audio';
export type ExportPreset = 'quality' | 'fast';
export type ExportVideoCodec = 'h264' | 'vp9' | 'av1';
export type ExportContainer = 'mp4' | 'webm';
export type ExportSourceMode = 'original' | 'proxy';
export type FeatureSupport = 'supported' | 'unsupported' | 'unknown';

export type CapabilityTierV2 =
	| 'core-webgpu'
	| 'compatibility-webgpu'
	| 'limited-webcodecs'
	| 'shell-only';

export type PreviewBackend = 'core-webgpu' | 'compat-webgpu' | 'canvas2d' | 'none';
export type ExportBackend = 'core-webgpu' | 'compat-webgpu' | 'canvas2d' | 'none';

export interface CodecProbeResult {
	h264Decode: FeatureSupport;
	vp9Decode: FeatureSupport;
	av1Decode: FeatureSupport;
	h264Encode: FeatureSupport;
	vp9Encode: FeatureSupport;
	av1Encode: FeatureSupport;
	aacDecode: FeatureSupport;
	opusDecode: FeatureSupport;
	aacEncode: FeatureSupport;
	opusEncode: FeatureSupport;
}

export interface CapabilityProbeResult {
	crossOriginIsolated: boolean;
	sharedArrayBuffer: FeatureSupport;
	webGPUCore: FeatureSupport;
	webGPUCompat: FeatureSupport;
	compatibilityAdapter: boolean;
	webCodecsDecode: FeatureSupport;
	webCodecsEncode: FeatureSupport;
	codecs: CodecProbeResult;
	fileSystemAccess: FeatureSupport;
	opfs: FeatureSupport;
	audioWorklet: FeatureSupport;
	offscreenCanvas: FeatureSupport;
	tier: CapabilityTierV2;
}

export interface WorkerInit {
	type: 'init';
	canvas: OffscreenCanvas;
	sab?: SharedArrayBuffer | null;
	audioSab?: SharedArrayBuffer | null;
	scopeSab?: SharedArrayBuffer | null;
}

export interface WorkerInitV2 extends WorkerInit {
	probeResult: CapabilityProbeResult;
}

export interface ExportRange {
	startS: number;
	endS: number;
}

export interface ExportSettings {
	preset: ExportPreset;
	codec: ExportVideoCodec;
	container: ExportContainer;
	width: number;
	height: number;
	fps: number;
	videoBitrate: number;
	range?: ExportRange;
	/** Original sources are the default. Proxy export requires explicit opt-in. */
	sourceMode?: ExportSourceMode;
}

export interface ExportCodecSupport {
	codec: ExportVideoCodec;
	container: ExportContainer;
}

// ── Phase 24: Render Queue + Export Presets ──

export interface ExportPresetDoc {
	id: string;
	name: string;
	builtIn: boolean;
	codec: ExportVideoCodec;
	container: ExportContainer;
	width: number;
	height: number;
	fps: number;
	videoBitrate: number;
	preset: ExportPreset;
	outputTemplate?: string;
}

export type JobRangeMode = 'full' | 'range' | 'markers';

export type JobRange =
	| { mode: 'full' }
	| { mode: 'range'; startS: number; endS: number }
	| {
			mode: 'markers';
			startMarkerId: string;
			endMarkerId: string;
			resolvedStartS: number;
			resolvedEndS: number;
	  };

export type JobStatus =
	| 'pending'
	| 'choosing-destination'
	| 'running'
	| 'finalizing'
	| 'completed'
	| 'failed'
	| 'canceled';

export interface RenderQueueJob {
	id: string;
	presetId: string | null;
	settings: ExportSettings;
	jobRange: JobRange;
	outputTemplate: string | null;
	outputFileName: string | null;
	status: JobStatus;
	error: string | null;
	progress: ExportProgress | null;
	enqueuedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	elapsedSeconds: number | null;
	outputBytes: number | null;
}

export interface PersistedQueueJob {
	id: string;
	presetId: string | null;
	settings: ExportSettings;
	jobRange: JobRange;
	outputTemplate: string | null;
	outputFileName: string | null;
	status: JobStatus;
	error: string | null;
	enqueuedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	elapsedSeconds: number | null;
	outputBytes: number | null;
}

export interface RenderQueueState {
	jobs: RenderQueueJob[];
	stopOnError: boolean;
	activeJobId: string | null;
}

export interface OutputNameTemplateContext {
	project: string;
	preset: string;
	codec: string;
	date: string;
	time: string;
	range: string;
	index: number;
}

export interface MediaMetadata {
	fileName: string;
	duration: number;
	mimeType: string | null;
	video: {
		codec: string | null;
		width: number;
		height: number;
		frameRate: number | null;
		canDecode: boolean;
	} | null;
	audio: {
		codec: string | null;
		channels: number;
		sampleRate: number;
		canDecode: boolean;
	} | null;
	trackCount: number;
}

export type MediaAdapterIdSnapshot = 'mediabunny' | 'web-demuxer-diagnostics';
export type SourceFrameRateModeSnapshot = 'constant' | 'variable' | 'unknown';

export interface SourceColorHintsSnapshot {
	primaries: string | null;
	transfer: string | null;
	matrix: string | null;
	fullRange: boolean | null;
}

export interface SourceTrackTimingSnapshot {
	trackId: string;
	firstTimestampS: number;
	lastTimestampS: number | null;
	durationS: number | null;
}

export interface NormalizedSourceTimingSnapshot {
	normalizedStartS: number;
	durationS: number;
	video?: SourceTrackTimingSnapshot;
	audio?: SourceTrackTimingSnapshot;
	avOffsetS: number;
	frameRateMode: SourceFrameRateModeSnapshot;
}

export type SourceHealthWarningCodeSnapshot =
	| 'variable-frame-rate'
	| 'non-zero-track-start'
	| 'audio-video-offset'
	| 'rotation-metadata'
	| 'mixed-audio-sample-rates'
	| 'unsupported-video-codec'
	| 'unsupported-audio-codec'
	| 'corrupt-or-truncated-file'
	| 'missing-duration'
	| 'undecodable-track';

export interface SourceHealthWarningSnapshot {
	code: SourceHealthWarningCodeSnapshot;
	severity: 'info' | 'warning' | 'error';
	blocking: boolean;
	sourceId: string;
	trackId?: string;
	message: string;
	details: Record<string, string | number | boolean | null>;
}

export interface SourceHealthReportSnapshot {
	sourceId: string;
	fileName: string;
	status: 'ok' | 'warnings' | 'blocked';
	warnings: readonly SourceHealthWarningSnapshot[];
}

export interface ClipEffectParamsSnapshot {
	brightness: number;
	contrast: number;
	saturation: number;
	temperature: number;
	temperatureStrength: number;
	lutStrength: number;
}

export type FitModeSnapshot = 'fill' | 'fit' | 'letterbox';

export interface TransformParamsSnapshot {
	x: number;
	y: number;
	scale: number;
	rotation: number;
	opacity: number;
	anchorX: number;
	anchorY: number;
	fit: FitModeSnapshot;
}

export type ClipKindSnapshot = 'video' | 'title';
export type TitleAlignSnapshot = 'left' | 'center' | 'right';

export interface TitleStyleSnapshot {
	fontFamily: string;
	fontSizePx: number;
	color: string;
	backgroundColor: string;
	backgroundOpacity: number;
	outlineColor: string;
	outlineWidthPx: number;
	shadowColor: string;
	shadowBlurPx: number;
	shadowOffsetXPx: number;
	shadowOffsetYPx: number;
	align: TitleAlignSnapshot;
}

export interface TitleContentSnapshot {
	text: string;
	style: TitleStyleSnapshot;
}

export type CaptionFormatSnapshot = 'srt' | 'webvtt';
export type CaptionAnchorSnapshot =
	| 'bottom-center'
	| 'bottom-left'
	| 'bottom-right'
	| 'top-center'
	| 'custom';
export type CaptionLineWrapSnapshot = 'balanced' | 'greedy';
export type CaptionPresetIdSnapshot = 'subtitle' | 'lower-third' | 'note';

export interface CaptionDiagnosticSnapshot {
	code:
		| 'invalid-index'
		| 'invalid-timecode'
		| 'negative-duration'
		| 'overlap'
		| 'unsupported-setting'
		| 'empty-cue'
		| 'missing-header';
	severity: 'info' | 'warning' | 'error';
	cueIndex?: number;
	line?: number;
	message: string;
}

export interface CaptionStyleSnapshot {
	presetId?: CaptionPresetIdSnapshot | null;
	overrides?: Partial<TitleStyleSnapshot>;
	anchor: CaptionAnchorSnapshot;
	insetPx?: { x: number; y: number };
	maxWidthPercent: number;
	lineWrap: CaptionLineWrapSnapshot;
}

export interface CaptionSegmentSnapshot {
	id: string;
	start: number;
	duration: number;
	text: string;
	style?: Partial<CaptionStyleSnapshot> | null;
}

export interface CaptionTrackSnapshot {
	id: string;
	kind: 'caption';
	name: string;
	language?: string | null;
	segments: CaptionSegmentSnapshot[];
	defaultStyle: CaptionStyleSnapshot;
	burnedIn: boolean;
	visible: boolean;
}

export interface CaptionImportResultSnapshot {
	track: CaptionTrackSnapshot;
	diagnostics: readonly CaptionDiagnosticSnapshot[];
	format: CaptionFormatSnapshot;
	recovered: boolean;
}

export type CaptionExportRangeSnapshot =
	| { mode: 'full-track' }
	| { mode: 'timeline-range'; startS: number; endS: number };

export interface CaptionExportSettingsSnapshot {
	trackId: string;
	formats: readonly CaptionFormatSnapshot[];
	range: CaptionExportRangeSnapshot;
	fileStem: string;
}

export interface CaptionSidecarFileSnapshot {
	fileName: string;
	mimeType: string;
	content: string;
}

export type KeyframeEasingSnapshot = 'linear' | 'ease' | 'hold';

export interface KeyframeSnapshot {
	/** Clip-local time in seconds. */
	t: number;
	value: number;
	easing: KeyframeEasingSnapshot;
}

export const TIMELINE_EPSILON = 1e-6;
export const KEYFRAME_EPSILON = 1e-4;

export type TransformKeyframeParamSnapshot = Exclude<keyof TransformParamsSnapshot, 'fit'>;
export type ClipKeyframeParamSnapshot =
	| keyof ClipEffectParamsSnapshot
	| TransformKeyframeParamSnapshot;
export type ClipKeyframesSnapshot = Partial<Record<ClipKeyframeParamSnapshot, KeyframeSnapshot[]>>;

export interface ClipLutSnapshot {
	key: string;
	fileName: string;
	title?: string;
	size: number;
}

export interface TimelineClipSnapshot {
	id: string;
	/** Absent/`'video'` for source clips; `'title'` for source-less titles (Phase 14). */
	kind?: ClipKindSnapshot;
	sourceId: string;
	start: number;
	duration: number;
	inPoint: number;
	effects: ClipEffectParamsSnapshot;
	transform: TransformParamsSnapshot;
	keyframes?: ClipKeyframesSnapshot;
	lut?: ClipLutSnapshot;
	audioFadeIn: number;
	audioFadeOut: number;
	offline?: boolean;
	/** Present iff `kind === 'title'`. */
	title?: TitleContentSnapshot;
	linkedGroupId?: string;
}

export interface TimelineTrackSnapshot {
	id: string;
	type: 'video' | 'audio';
	clips: TimelineClipSnapshot[];
	gain: number;
	pan: number;
	muted: boolean;
	solo: boolean;
	locked: boolean;
	visible: boolean;
	syncLocked: boolean;
	editTarget: boolean;
}

export interface TimelineMarkerSnapshot {
	id: string;
	time: number;
	label: string;
}

export type TransitionKindSnapshot = 'cross-dissolve' | 'dip-to-black' | 'wipe' | 'slide';

export interface TransitionParamsSnapshot {
	direction?: 'left' | 'right' | 'up' | 'down';
}

export interface TimelineTransitionSnapshot {
	id: string;
	trackId: string;
	fromClipId: string;
	toClipId: string;
	durationS: number;
	kind: TransitionKindSnapshot;
	params: TransitionParamsSnapshot;
}

export interface TimelineClipReference {
	trackId: string;
	clipId: string;
}

export interface TimelineClipMove extends TimelineClipReference {
	toTrackId: string;
	toStart: number;
}

export interface TimelineClipboardClip {
	trackId: string;
	clip: TimelineClipSnapshot;
}

/** Min/max peak pairs (2 floats per bucket) for waveform rendering. */
export type WaveformPeaks = Float32Array;

export interface MediaFingerprintSnapshot {
	algorithm: 'sha-256';
	digest: string;
}

export interface SourceDescriptorSnapshot {
	sourceId: string;
	fileName: string;
	kind: MediaKind;
	byteSize: number;
	durationS: number;
	mimeType: string | null;
	fingerprint?: MediaFingerprintSnapshot;
	adapterId?: MediaAdapterIdSnapshot;
	timing?: NormalizedSourceTimingSnapshot;
	health?: SourceHealthReportSnapshot;
	video?: {
		width: number;
		height: number;
		codedWidth?: number;
		codedHeight?: number;
		frameRate: number | null;
		frameRateMode?: SourceFrameRateModeSnapshot;
		rotationDeg?: number;
		color?: SourceColorHintsSnapshot;
		trackStartS?: number;
		trackDurationS?: number | null;
		codec: string | null;
		canDecode: boolean;
	};
	audio?: {
		channels: number;
		sampleRate: number;
		trackStartS?: number;
		trackDurationS?: number | null;
		codec: string | null;
		canDecode: boolean;
	};
}

/** A media-bin asset: an imported source that is not (yet) placed on the timeline. */
export interface MediaAssetSnapshot {
	sourceId: string;
	fileName: string;
	kind: MediaKind;
	/** Intrinsic duration in seconds; stills report their default placement duration. */
	durationS: number;
	byteSize: number;
	mimeType: string | null;
	video?: {
		width: number;
		height: number;
		frameRate: number | null;
		frameRateMode?: SourceFrameRateModeSnapshot;
		rotationDeg?: number;
		codec?: string | null;
		canDecode?: boolean;
	};
	audio?: {
		channels: number;
		sampleRate: number;
		codec?: string | null;
		canDecode?: boolean;
	};
	timing?: NormalizedSourceTimingSnapshot;
	health?: SourceHealthReportSnapshot;
	proxy?: ProxyAssetSnapshot;
}

export type ProxyAssetUiStatus =
	| 'not-generated'
	| 'recommended'
	| 'queued'
	| 'generating'
	| 'ready'
	| 'stale'
	| 'failed'
	| 'disabled';

export interface ProxyAssetSnapshot {
	status: ProxyAssetUiStatus;
	mode: 'original' | 'proxy';
	reason?: string;
	progress?: number;
	width?: number;
	height?: number;
	byteSize?: number;
	pinned?: boolean;
}

interface SplitTimelineCommand {
	type: 'split';
	trackId: string;
	time: number;
}

interface DeleteTimelineClipCommand {
	type: 'delete-clip';
	trackId: string;
	clipId: string;
}

interface DeleteTimelineClipsCommand {
	type: 'delete-clips';
	clips: TimelineClipReference[];
}

interface MoveTimelineClipCommand {
	type: 'move-clip';
	fromTrackId: string;
	toTrackId: string;
	clipId: string;
	toStart: number;
}

interface MoveTimelineClipsCommand {
	type: 'move-clips';
	moves: TimelineClipMove[];
}

interface DuplicateTimelineClipCommand {
	type: 'duplicate-clip';
	clips: TimelineClipReference[];
	atTime?: number;
}

interface PasteTimelineClipsCommand {
	type: 'paste-clips';
	clips: TimelineClipboardClip[];
	atTime: number;
}

interface CacheClipboardLutsCommand {
	type: 'cache-clipboard-luts';
	clips: TimelineClipReference[];
}

interface AddTimelineMarkerCommand {
	type: 'add-marker';
	time: number;
	label?: string;
}

interface DeleteTimelineMarkerCommand {
	type: 'delete-marker';
	markerId: string;
}

interface CloseTimelineGapsCommand {
	type: 'close-gaps';
	trackId?: string;
}

interface TrimTimelineClipCommand {
	type: 'trim-clip';
	trackId: string;
	clipId: string;
	edge: 'in' | 'out';
	time: number;
}

interface SetEffectParamCommand {
	type: 'set-effect-param';
	trackId: string;
	clipId: string;
	key: keyof ClipEffectParamsSnapshot;
	value: number;
}

interface SetTransformCommand {
	type: 'set-transform';
	trackId: string;
	clipId: string;
	transform: Partial<TransformParamsSnapshot>;
}

interface SetKeyframeCommand {
	type: 'set-keyframe';
	trackId: string;
	clipId: string;
	key: ClipKeyframeParamSnapshot;
	/** Absolute timeline time in seconds; the worker stores it clip-local. */
	t: number;
	value: number;
	easing?: KeyframeEasingSnapshot;
}

interface SetKeyframesCommand {
	type: 'set-keyframes';
	trackId: string;
	clipId: string;
	/** Absolute timeline time in seconds; the worker stores it clip-local. */
	t: number;
	keyframes: Array<{
		key: ClipKeyframeParamSnapshot;
		value: number;
		easing?: KeyframeEasingSnapshot;
	}>;
}

interface DeleteKeyframeCommand {
	type: 'delete-keyframe';
	trackId: string;
	clipId: string;
	key: ClipKeyframeParamSnapshot;
	/** Absolute timeline time in seconds; the worker stores tracks clip-local. */
	t: number;
}

interface ImportLutCommand {
	type: 'import-lut';
	trackId: string;
	clipId: string;
	file: File;
}

interface SetLutStrengthCommand {
	type: 'set-lut-strength';
	trackId: string;
	clipId: string;
	strength: number;
}

interface SetTrackGainCommand {
	type: 'set-track-gain';
	trackId: string;
	gain: number;
}

interface SetTrackMuteCommand {
	type: 'set-track-mute';
	trackId: string;
	muted: boolean;
}

interface SetTrackSoloCommand {
	type: 'set-track-solo';
	trackId: string;
	solo: boolean;
}

interface SetTrackPanCommand {
	type: 'set-track-pan';
	trackId: string;
	pan: number;
}

interface SetMasterGainCommand {
	type: 'set-master-gain';
	gain: number;
}

interface SetClipFadeCommand {
	type: 'set-clip-fade';
	trackId: string;
	clipId: string;
	edge: 'in' | 'out';
	durationS: number;
}

interface AddTransitionCommand {
	type: 'add-transition';
	trackId: string;
	fromClipId: string;
	toClipId: string;
	durationS: number;
	kind?: TransitionKindSnapshot;
	params?: TransitionParamsSnapshot;
}

interface RemoveTransitionCommand {
	type: 'remove-transition';
	transitionId: string;
}

interface SetTransitionCommand {
	type: 'set-transition';
	transitionId: string;
	durationS?: number;
	kind?: TransitionKindSnapshot;
	params?: TransitionParamsSnapshot;
}

/** Places a bin asset on the timeline. When `trackId` is omitted the worker finds
 *  or creates a track matching the asset's kind; when `start` is omitted the clip
 *  appends past the track's last clip. */
interface PlaceClipCommand {
	type: 'place-clip';
	sourceId: string;
	trackId?: string;
	start?: number;
}

interface SetStillDurationCommand {
	type: 'set-still-duration';
	trackId: string;
	clipId: string;
	durationS: number;
}

/** Adds a source-less title clip; the worker picks/creates an overlay (video)
 *  track and appends when `trackId`/`start` are omitted (Phase 14). */
interface AddTitleCommand {
	type: 'add-title';
	trackId?: string;
	start?: number;
}

interface SetTitleCommand {
	type: 'set-title';
	trackId: string;
	clipId: string;
	text?: string;
	style?: Partial<TitleStyleSnapshot>;
}

interface AddTrackCommand {
	type: 'add-track';
	trackType: 'video' | 'audio';
}

interface RemoveTrackCommand {
	type: 'remove-track';
	trackId: string;
}

interface ReorderTrackCommand {
	type: 'reorder-track';
	trackId: string;
	toIndex: number;
}

interface RemoveAssetCommand {
	type: 'remove-asset';
	sourceId: string;
}

interface RequestThumbnailsCommand {
	type: 'request-thumbnails';
	sourceId: string;
	timestamps: number[];
}

interface ImportCaptionsCommand {
	type: 'import-captions';
	file: File;
	trackId?: string;
}

interface ExportCaptionsCommand {
	type: 'export-captions';
	settings: CaptionExportSettingsSnapshot;
}

interface SetCaptionTrackCommand {
	type: 'set-caption-track';
	trackId: string;
	name?: string;
	language?: string | null;
	burnedIn?: boolean;
	visible?: boolean;
	defaultStyle?: Partial<CaptionStyleSnapshot>;
}

interface SetCaptionSegmentTextCommand {
	type: 'set-caption-segment-text';
	trackId: string;
	segmentId: string;
	text: string;
}

interface SetCaptionSegmentTimingCommand {
	type: 'set-caption-segment-timing';
	trackId: string;
	segmentId: string;
	start: number;
	end: number;
}

interface SetCaptionSegmentStyleCommand {
	type: 'set-caption-segment-style';
	trackId: string;
	segmentId: string;
	style: Partial<CaptionStyleSnapshot>;
}

interface SplitCaptionSegmentCommand {
	type: 'split-caption-segment';
	trackId: string;
	segmentId: string;
	time: number;
}

interface MergeCaptionSegmentsCommand {
	type: 'merge-caption-segments';
	trackId: string;
	segmentIds: readonly string[];
}

interface DeleteCaptionSegmentsCommand {
	type: 'delete-caption-segments';
	trackId: string;
	segmentIds: readonly string[];
}

interface SnapCaptionSegmentCommand {
	type: 'snap-caption-segment';
	trackId: string;
	segmentId: string;
	edge: 'start' | 'end' | 'both';
}

export type BundleSourcePolicySnapshot =
	| { mode: 'embed-media' }
	| { mode: 'reference-only' }
	| { mode: 'collect-media'; relocate: boolean };

export type BundleIntegrityCodeSnapshot =
	| 'ok'
	| 'missing-file'
	| 'size-mismatch'
	| 'fingerprint-mismatch'
	| 'descriptor-mismatch'
	| 'corrupt-json'
	| 'unsupported-bundle-schema'
	| 'unsupported-project-schema'
	| 'unsupported-operation'
	| 'cache-stale';

export interface BundleIntegrityItemSnapshot {
	code: BundleIntegrityCodeSnapshot;
	severity: 'info' | 'warning' | 'error';
	sourceId?: string;
	assetId?: string;
	relativePath?: string;
	message: string;
	details?: Record<string, string | number | boolean | null>;
}

export interface BundleIntegrityReportSnapshot {
	bundleId: string;
	ok: boolean;
	items: readonly BundleIntegrityItemSnapshot[];
	summary: {
		sourcesEmbedded: number;
		sourcesOffline: number;
		assetsVerified: number;
		assetsFailed: number;
		cachesSkipped: number;
	};
}

interface InsertEditCommand {
	type: 'insert-edit';
	clips: TimelineClipboardClip[];
	atTime: number;
}

interface OverwriteEditCommand {
	type: 'overwrite-edit';
	clips: TimelineClipboardClip[];
	atTime: number;
}

interface RippleDeleteCommand {
	type: 'ripple-delete';
	clips: TimelineClipReference[];
}

interface RippleTrimCommand {
	type: 'ripple-trim';
	trackId: string;
	clipId: string;
	edge: 'in' | 'out';
	time: number;
}

interface RollTrimCommand {
	type: 'roll-trim';
	trackId: string;
	clipId: string;
	edge: 'in' | 'out';
	time: number;
}

interface SlipEditCommand {
	type: 'slip-edit';
	trackId: string;
	clipId: string;
	deltaS: number;
}

interface SlideEditCommand {
	type: 'slide-edit';
	trackId: string;
	clipId: string;
	deltaS: number;
}

interface LiftRegionCommand {
	type: 'lift-region';
	startTime: number;
	endTime: number;
}

interface ExtractRegionCommand {
	type: 'extract-region';
	startTime: number;
	endTime: number;
}

interface LinkClipsCommand {
	type: 'link-clips';
	clips: TimelineClipReference[];
}

interface UnlinkClipsCommand {
	type: 'unlink-clips';
	clips: TimelineClipReference[];
}

interface SetTrackLockCommand {
	type: 'set-track-lock';
	trackId: string;
	locked: boolean;
}

interface SetTrackVisibleCommand {
	type: 'set-track-visible';
	trackId: string;
	visible: boolean;
}

interface SetTrackSyncLockCommand {
	type: 'set-track-sync-lock';
	trackId: string;
	syncLocked: boolean;
}

interface SetTrackEditTargetCommand {
	type: 'set-track-edit-target';
	trackId: string;
	editTarget: boolean;
}

export type WorkerCommand =
	| WorkerInit
	| WorkerInitV2
	| { type: 'import'; file: File; fileHandle?: FileSystemFileHandle | null }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'seek'; time: number }
	| { type: 'step'; direction: 1 | -1 }
	| { type: 'export-probe' }
	| { type: 'export-start'; settings: ExportSettings; output?: FileSystemFileHandle | null }
	| { type: 'export-cancel' }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'restore-project' }
	| { type: 'new-project' }
	| {
			type: 'relink-source';
			sourceId: string;
			file: File;
			fileHandle?: FileSystemFileHandle | null;
	  }
	| SplitTimelineCommand
	| DeleteTimelineClipCommand
	| DeleteTimelineClipsCommand
	| MoveTimelineClipCommand
	| MoveTimelineClipsCommand
	| DuplicateTimelineClipCommand
	| PasteTimelineClipsCommand
	| CacheClipboardLutsCommand
	| AddTimelineMarkerCommand
	| DeleteTimelineMarkerCommand
	| CloseTimelineGapsCommand
	| TrimTimelineClipCommand
	| SetEffectParamCommand
	| SetTransformCommand
	| SetKeyframeCommand
	| SetKeyframesCommand
	| DeleteKeyframeCommand
	| ImportLutCommand
	| SetLutStrengthCommand
	| SetTrackGainCommand
	| SetTrackMuteCommand
	| SetTrackSoloCommand
	| SetTrackPanCommand
	| SetMasterGainCommand
	| SetClipFadeCommand
	| AddTransitionCommand
	| RemoveTransitionCommand
	| SetTransitionCommand
	| PlaceClipCommand
	| SetStillDurationCommand
	| AddTitleCommand
	| SetTitleCommand
	| AddTrackCommand
	| RemoveTrackCommand
	| ReorderTrackCommand
	| RemoveAssetCommand
	| RequestThumbnailsCommand
	| ImportCaptionsCommand
	| ExportCaptionsCommand
	| SetCaptionTrackCommand
	| SetCaptionSegmentTextCommand
	| SetCaptionSegmentTimingCommand
	| SetCaptionSegmentStyleCommand
	| SplitCaptionSegmentCommand
	| MergeCaptionSegmentsCommand
	| DeleteCaptionSegmentsCommand
	| SnapCaptionSegmentCommand
	| {
			type: 'export-project-bundle';
			jobId: string;
			policy: BundleSourcePolicySnapshot;
			outputDir: FileSystemDirectoryHandle;
	  }
	| {
			type: 'import-project-bundle';
			jobId: string;
			bundleDir: FileSystemDirectoryHandle;
			replaceConfirmed?: boolean;
	  }
	| {
			type: 'collect-project-media';
			jobId: string;
			relocate: boolean;
			outputDir: FileSystemDirectoryHandle;
	  }
	| { type: 'cancel-bundle-job'; jobId: string }
	| { type: 'bundle-replace-decision'; jobId: string; action: 'replace' | 'cancel' }
	| InsertEditCommand
	| OverwriteEditCommand
	| RippleDeleteCommand
	| RippleTrimCommand
	| RollTrimCommand
	| SlipEditCommand
	| SlideEditCommand
	| LiftRegionCommand
	| ExtractRegionCommand
	| LinkClipsCommand
	| UnlinkClipsCommand
	| SetTrackLockCommand
	| SetTrackVisibleCommand
	| SetTrackSyncLockCommand
	| SetTrackEditTargetCommand
	| { type: 'toggle-scopes'; enabled: boolean }
	| { type: 'toggle-zebra'; enabled: boolean }
	| { type: 'preset-save'; preset: ExportPresetDoc }
	| { type: 'preset-delete'; presetId: string }
	| { type: 'queue-enqueue'; job: RenderQueueJob }
	| { type: 'queue-remove'; jobId: string }
	| { type: 'queue-reorder'; jobId: string; newIndex: number }
	| { type: 'queue-start' }
	| { type: 'queue-cancel-job'; jobId: string }
	| { type: 'queue-cancel-all' }
	| { type: 'queue-retry'; jobId: string }
	| { type: 'queue-job-output'; jobId: string; handle: FileSystemFileHandle }
	| { type: 'queue-job-skip'; jobId: string }
	| { type: 'queue-set-stop-on-error'; stopOnError: boolean }
	| { type: 'request-diagnostic-snapshot'; requestId: string }
	| { type: 'run-recovery-action'; actionId: string }
	| { type: 'dispose' };

/** A measured preview resolution tier (adaptive downscale of the decode path). */
export interface PreviewResolution {
	width: number;
	height: number;
	/** Human label, e.g. "1080p". */
	label: string;
}

/** Result of the one-shot startup encode-throughput probe (session ETA hint). */
export interface ThroughputProbe {
	encodeFps: number;
	codec: string;
	width: number;
	height: number;
}

export interface ExportProgress {
	preset: ExportPreset;
	codec: ExportVideoCodec;
	container: ExportContainer;
	phase: 'video' | 'audio' | 'finalizing';
	doneFrames: number;
	totalFrames: number;
	percent: number;
	etaSeconds: number | null;
	elapsedSeconds: number;
	subRealtime: boolean;
}

export type HDRWarningTypeSnapshot =
	| 'hdr-content-detected'
	| 'gamut-mismatch'
	| 'tone-map-active'
	| 'export-hdr-to-sdr';

export interface HDRWarningSnapshot {
	type: HDRWarningTypeSnapshot;
	clipIds: string[];
	message: string;
}

export type WorkerStateMessage =
	| {
			type: 'ready';
			webgpu: boolean;
			features: string[];
			gpuUnavailableReason: string | null;
			previewBackend: PreviewBackend;
			exportBackend: ExportBackend;
			previewReady: boolean;
			exportReady: boolean;
	  }
	| { type: 'capability-probe-v2'; result: CapabilityProbeResult }
	// Reduced tiers without SharedArrayBuffer: the worker stays the sole clock
	// source but reports transport over postMessage instead of shared memory.
	| { type: 'clock-update'; currentTime: number; duration: number; playing: boolean }
	| { type: 'import-progress'; stage: 'reading' | 'metadata' }
	| { type: 'import-complete'; metadata: MediaMetadata }
	| { type: 'import-error'; message: string }
	| { type: 'source-health'; report: SourceHealthReportSnapshot }
	| { type: 'project-warning'; message: string }
	| { type: 'history-state'; canUndo: boolean; canRedo: boolean }
	| {
			type: 'restore-available';
			projectId: string;
			savedAt: string;
			sources: SourceDescriptorSnapshot[];
	  }
	| {
			type: 'restore-result';
			projectId: string;
			restored: boolean;
			savedAt: string | null;
			metadata: MediaMetadata | null;
			unresolvedSources: SourceDescriptorSnapshot[];
			message: string;
	  }
	| {
			type: 'relink-result';
			sourceId: string;
			ok: boolean;
			descriptor: SourceDescriptorSnapshot | null;
			metadata: MediaMetadata | null;
			unresolvedSources: SourceDescriptorSnapshot[];
			message: string;
	  }
	| { type: 'preview-resolution'; resolution: PreviewResolution }
	| { type: 'probe-result'; probe: ThroughputProbe }
	| {
			type: 'timeline-state';
			timeline: TimelineTrackSnapshot[];
			captionTracks: CaptionTrackSnapshot[];
			transitions: TimelineTransitionSnapshot[];
			markers: TimelineMarkerSnapshot[];
			masterGain: number;
	  }
	| { type: 'caption-import-result'; result: CaptionImportResultSnapshot }
	| { type: 'caption-export-result'; files: readonly CaptionSidecarFileSnapshot[] }
	| { type: 'media-assets'; assets: MediaAssetSnapshot[] }
	| {
			type: 'thumbnail';
			sourceId: string;
			timestamp: number;
			bitmap: ImageBitmap;
			width: number;
			height: number;
	  }
	| { type: 'waveform-peaks'; trackId: string; clipId: string; peaks: WaveformPeaks }
	| { type: 'export-codecs'; supported: ExportCodecSupport[]; settings: ExportSettings }
	| { type: 'export-progress'; progress: ExportProgress }
	| { type: 'export-complete'; fileName: string; mimeType: string }
	| { type: 'export-download-ready'; fileName: string; mimeType: string; blob: Blob }
	| { type: 'export-warning'; message: string }
	| { type: 'export-canceled' }
	| { type: 'export-error'; message: string }
	| { type: 'dispose-complete' }
	| { type: 'bundle-replace-prompt'; jobId: string; message: string }
	| {
			type: 'bundle-job-progress';
			jobId: string;
			phase: string;
			bytesDone: number;
			bytesTotal: number | null;
	  }
	| { type: 'bundle-integrity-report'; jobId: string; report: BundleIntegrityReportSnapshot }
	| {
			type: 'bundle-import-result';
			jobId: string;
			ok: boolean;
			projectId?: string;
			reason?: string;
	  }
	| { type: 'hdr-warnings'; warnings: HDRWarningSnapshot[] }
	| { type: 'presets-state'; presets: ExportPresetDoc[] }
	| { type: 'queue-state'; queue: RenderQueueState }
	| { type: 'queue-job-destination'; jobId: string; suggestedName: string }
	| { type: 'queue-job-progress'; jobId: string; progress: ExportProgress }
	| {
			type: 'queue-job-complete';
			jobId: string;
			fileName: string;
			elapsedSeconds: number;
			outputBytes: number | null;
	  }
	| { type: 'queue-job-failed'; jobId: string; error: string }
	| { type: 'queue-job-canceled'; jobId: string }
	| { type: 'queue-complete'; completedCount: number; failedCount: number; canceledCount: number }
	| { type: 'diagnostic-snapshot'; requestId?: string; snapshot: DiagnosticSnapshot }
	| { type: 'recent-error'; error: RecentError }
	| {
			type: 'recovery-state';
			state: 'idle' | 'recovering' | 'failed';
			actions: readonly RecoveryAction[];
	  }
	| { type: 'error'; message: string };

export function assertCrossOriginIsolated(context: string): void {
	if (!globalThis.crossOriginIsolated) {
		throw new Error(
			`${context}: crossOriginIsolated is false. ` +
				'SharedArrayBuffer requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).'
		);
	}
}
