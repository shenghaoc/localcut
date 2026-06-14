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

/** Phase 47: features the WHIP publish path needs, probed on the main thread. */
export interface LivePublishProbeResult {
	rtcPeerConnection: FeatureSupport;
	/** Insertable-streams `MediaStreamTrackGenerator` for the worker-side tap. */
	trackGeneratorWorker: FeatureSupport;
	/** Transferable `MediaStreamTrack` — pure transfer capability, one shared
	 *  probe with `CaptureProbeResult.transferableMediaStreamTrack`; the
	 *  worker-side generator mode additionally needs `trackGeneratorWorker`. */
	trackTransfer: FeatureSupport;
	/** `RTCRtpSender.prototype.generateKeyFrame` — keyframe-interval timer. */
	generateKeyFrame: FeatureSupport;
	/** H.264 encode with `hardwareAcceleration: 'prefer-hardware'` honoured. */
	hardwareH264Encode: FeatureSupport;
}

export interface CaptureProbeResult {
	mediaStreamTrackProcessor: FeatureSupport;
	/** Same shared transfer probe as `LivePublishProbeResult.trackTransfer`. */
	transferableMediaStreamTrack: FeatureSupport;
	displayCapture: FeatureSupport;
	displayAudioCapture: FeatureSupport;
	videoEncodeRealtime: FeatureSupport;
	audioEncodeOpus: FeatureSupport;
	audioEncodeAac: FeatureSupport;
	opfsSyncAccessHandle: FeatureSupport;
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
	livePublish: LivePublishProbeResult;
	capture: CaptureProbeResult;
	tier: CapabilityTierV2;
	/** Phase 28 (LiteRT DTLN audio cleanup): display/feature-gate only — never
	 *  consulted by tier derivation or any pipeline code path. */
	cleanup?: CleanupProbeResult;
	/** Phase 29 (ASR auto captions): display/feature-gate only — never
	 *  consulted by tier derivation or any pipeline code path. */
	asr?: AsrProbeResult;
	/** Phase 33 (Smart Reframe): display/feature-gate only — never
	 *  consulted by tier derivation or any pipeline code path. */
	smartReframe?: SmartReframeProbeResult;
}

// ── Phase 28: Local Audio Cleanup (LiteRT DTLN) ──

export type CleanupAccelerator = 'wasm' | 'webgpu' | 'webnn';

export interface CleanupProbeResult {
	wasmAvailable: boolean;
	accelerator: CleanupAccelerator;
}

/** Reference from a timeline clip to its denoised derived audio asset. */
export interface CleanedAudioRefSnapshot {
	/** Source id of the derived (cleaned) audio asset. */
	assetId: string;
	/** Clip `inPoint` at generation time; the cleaned asset's t=0 maps here. */
	clipInPointS: number;
	/** Covered duration in source seconds starting at `clipInPointS`. */
	durationS: number;
	modelId: string;
	modelVersion: string;
}

export type CleanupModelStatus = 'not-loaded' | 'loading' | 'loaded' | 'failed';

export interface CleanupModelAssetSnapshot {
	url: string;
	sizeBytes: number;
	checksum: string;
}

/** Commands posted from the UI bridge to the Audio Cleanup worker. */
export type CleanupWorkerCommand =
	| { type: 'cleanup-probe' }
	| {
			type: 'cleanup-load-model';
			manifestUrl: string;
			wasmPath: string;
			preferredAccelerator: CleanupAccelerator;
	  }
	| { type: 'cleanup-begin'; jobId: number; totalFrames: number }
	| {
			type: 'cleanup-chunk';
			jobId: number;
			pcm: Float32Array;
			sampleRate: number;
			channels: number;
	  }
	| { type: 'cleanup-end'; jobId: number; output: 'pcm' | 'wav' }
	| { type: 'cleanup-cancel'; jobId?: number }
	| { type: 'cleanup-dispose' };

/** State messages posted from the Audio Cleanup worker back to the UI. */
export type CleanupWorkerState =
	| { type: 'cleanup-probe-result'; result: CleanupProbeResult }
	| {
			type: 'cleanup-model-status';
			status: CleanupModelStatus;
			accelerator?: CleanupAccelerator;
			sizeBytes?: number;
			version?: string;
			error?: string;
	  }
	| {
			type: 'cleanup-progress';
			jobId: number;
			processedFrames: number;
			totalFrames: number;
			fraction: number;
	  }
	| {
			type: 'cleanup-result';
			jobId: number;
			sampleRate: 16000;
			channels: 1;
			pcm?: Float32Array;
			wav?: ArrayBuffer;
			durationMs: number;
	  }
	| { type: 'cleanup-cancelled'; jobId?: number }
	| { type: 'cleanup-error'; jobId?: number; message: string };

// ── Phase 29: Auto Captions (ASR) — LiteRT.js Whisper ──

/** The only ASR engine: LiteRT.js Whisper, compiled on WebGPU, WebNN, or WASM. */
export type AsrRecommendedEngine = 'litert-whisper' | 'none';

/** LiteRT accelerator used to compile the Whisper graphs. `wasm` is the
 *  baseline that works without WebGPU/WebNN; `webgpu` and `webnn` are optional
 *  faster paths when the browser exposes those accelerators. */
export type AsrAccelerator = 'wasm' | 'webgpu' | 'webnn';

/** ASR capability probe result. LiteRT.js needs only WebAssembly; WebGPU, WebNN,
 *  and cross-origin isolation are reported for information and do not gate
 *  availability. */
export interface AsrProbeResult {
	/** WebAssembly is available — the minimum LiteRT requirement. */
	wasm: FeatureSupport;
	/** WebGPU adapter available as an optional faster accelerator. */
	webgpu: FeatureSupport;
	/** Experimental WebNN API available as an optional NPU/system ML accelerator. */
	webnn: FeatureSupport;
	/** `crossOriginIsolated === true` for SAB-capable full-performance builds. */
	crossOriginIsolated: boolean;
	recommended: AsrRecommendedEngine;
}

export type AsrModelStatus = 'not-loaded' | 'loading' | 'loaded' | 'failed';

/** One downloadable, digest-verified model asset. */
export interface AsrModelAssetSnapshot {
	/** Same-origin URL the asset is fetched from. */
	url: string;
	sizeBytes: number;
	/** `sha256-<64 hex>` digest of the asset bytes; verified before use. */
	checksum: string;
}

/** Special token ids for the Whisper vocabulary the model was trained on. */
export interface AsrSpecialTokens {
	startOfTranscript: number;
	endOfText: number;
	transcribe: number;
	noTimestamps: number;
	/** Id of `<|nospeech|>`; used to probe no-speech probability. */
	noSpeech: number;
	/** Id of `<|0.00|>`; timestamp seconds = (id − timestampBegin) × 0.02. */
	timestampBegin: number;
	/** ISO code → language token id (e.g. `{ en: 50259, zh: 50260 }`). */
	language: Record<string, number>;
}

/** Manifest document validated by the ASR worker before any fetch. Declares the
 *  single TFLite Whisper graph (with `encode`/`decode` signatures), the
 *  byte-level BPE tokenizer vocabulary, the fixed audio contract, the special
 *  token ids, and provenance (license/source/size/digests). */
export interface AsrModelManifestSnapshot {
	id: string;
	version: string;
	license: string;
	source: string;
	/** Sum of all asset sizes — the total download budget shown to the user. */
	sizeBytes: number;
	/** Single TFLite Whisper graph exposing `encode` and `decode` signatures. */
	model: AsrModelAssetSnapshot;
	/** Tokenizer vocabulary JSON (byte-level BPE token string → id). */
	tokenizer: AsrModelAssetSnapshot;
	audio: {
		sampleRate: 16000;
		channels: 1;
		hopLength: number;
		nMel: number;
		/** Decoder context window in seconds (Whisper = 30). */
		chunkLengthS: number;
	};
	/** Fixed decoder context length — the token buffer and causal-mask size. */
	maxDecodeTokens: number;
	vocabSize: number;
	encoderFramesPerSecond: number;
	tokens: AsrSpecialTokens;
	languages: string[];
	/** Language forced when the user picks "auto", or null for model detection. */
	defaultLanguage: string | null;
	/** Model-specific decode quality thresholds. Smaller models need more
	 *  permissive values to avoid the silence gate and temperature fallback
	 *  misfiring on real speech. Omitted fields use built-in defaults. */
	decode: AsrDecodeParams | null;
}

/** Per-model decode quality parameters. All fields are optional; the decode
 *  loop falls back to built-in defaults (calibrated for whisper-base) when a
 *  field is absent or the whole section is omitted. */
export interface AsrDecodeParams {
	/** Average log-probability below which a decode is considered low-confidence
	 *  and retried at the next temperature. Default: -1.0. */
	logProbThreshold?: number;
	/** No-speech probability above which (combined with low logprob) the window
	 *  is treated as silence. Default: 0.6. */
	noSpeechThreshold?: number;
	/** Compression ratio above which the text is considered degenerate repetition.
	 *  Default: 2.4. */
	compressionRatioThreshold?: number;
	/** Temperature schedule for fallback. Default: [0, 0.2, 0.4, 0.6, 0.8, 1.0]. */
	temperatures?: number[];
}

/** Metadata marker for auto-generated caption tracks. */
export interface AsrGeneratedCaptionMetadata {
	generatedBy: 'auto-captions-phase-29';
	engine: 'litert-whisper';
	accelerator: AsrAccelerator;
	language: string | null;
	phraseLevel: boolean;
	createdAt: string;
}

/** Commands posted from the UI bridge to the ASR worker. */
export type AsrWorkerCommand =
	| { type: 'asr-probe' }
	| {
			type: 'asr-load-model';
			/** Same-origin URL of the model manifest JSON. */
			manifestUrl: string;
			/** Preferred accelerator; the worker falls back to `wasm` if needed. */
			accelerator: AsrAccelerator;
			/** Directory (or .js file) the LiteRT.js WASM runtime loads from. */
			wasmPath: string;
	  }
	| {
			type: 'asr-transcribe';
			jobId: number;
			pcm: Float32Array;
			sampleRate: number;
			channels: number;
			offsetS: number;
			totalDurationS: number;
			language?: string;
			/**
			 * De-overlap bounds for overlapping decode windows: keep only segments
			 * whose start falls in [trustedFromS, trustedToS). Adjacent windows' trusted
			 * ranges tile the timeline without overlap, so no segment is emitted twice.
			 * Omitted ⇒ keep all (single / non-overlapping window).
			 */
			trustedFromS?: number;
			trustedToS?: number;
			/** True on the last window of the job; triggers finalisation. */
			isFinal?: boolean;
	  }
	| { type: 'asr-cancel'; jobId?: number }
	| { type: 'asr-dispose' };

/** State messages posted from the ASR worker back to the UI. */
export type AsrWorkerState =
	| { type: 'asr-probe-result'; result: AsrProbeResult }
	| {
			type: 'asr-model-status';
			status: AsrModelStatus;
			accelerator?: AsrAccelerator;
			/** Total model size in bytes (from the manifest). */
			sizeBytes?: number;
			/** Bytes downloaded so far while `status === 'loading'`. */
			downloadedBytes?: number;
			/** Download/compile progress in [0, 1] while `status === 'loading'`. */
			fraction?: number;
			/** On `loaded`: true when every asset came from the on-device cache. */
			cached?: boolean;
			error?: string;
	  }
	| {
			type: 'asr-progress';
			jobId: number;
			fraction: number;
			processedSeconds: number;
			totalSeconds: number;
	  }
	| {
			type: 'asr-result';
			jobId: number;
			segments: CaptionSegmentSnapshot[];
			language: string | null;
			phraseLevel: boolean;
			durationMs: number;
	  }
	| { type: 'asr-cancelled'; jobId?: number }
	| { type: 'asr-error'; jobId?: number; message: string };

/** Timeline command: create a caption track from ASR result. */
export interface AsrCreateCaptionTrackCommand {
	type: 'asr-create-caption-track';
	segments: CaptionSegmentSnapshot[];
	language: string | null;
	engine: 'litert-whisper';
	accelerator: AsrAccelerator;
	phraseLevel: boolean;
	/** Human-readable name for the generated track. */
	trackName: string;
}

// ── Phase 33: Smart Reframe ──

/** Supported target aspect ratios for Smart Reframe. */
export type ReframeTargetAspect = '9:16' | '1:1' | '4:5' | '16:9' | '4:3';

/** Aspect ratio value for each named target. */
export const REFRAME_ASPECT_VALUES: Record<ReframeTargetAspect, number> = {
	'9:16': 9 / 16,
	'1:1': 1,
	'4:5': 4 / 5,
	'16:9': 16 / 9,
	'4:3': 4 / 3
};

/** Face detection capability probe for Smart Reframe. */
export interface SmartReframeProbeResult {
	faceDetection: FeatureSupport;
	saliency: FeatureSupport;
	analysisWorker: FeatureSupport;
}

/** Detection mode used during the last analysis. */
export type ReframeAnalysisMode = 'face' | 'saliency' | 'mixed';

/** LiteRT.js compile target for the face-detection model. */
export type ReframeAccelerator = 'wasm' | 'webgpu' | 'webnn';

/** Model manifest for the LiteRT.js face-detection model (TFLite). */
export interface ReframeModelManifestSnapshot {
	id: string;
	version: string;
	license: string;
	source: string;
	/** The TFLite model asset: URL + size + `sha256-` digest. */
	model: { url: string; sizeBytes: number; checksum: string };
	/** Square model input edge in px. */
	inputSize: number;
	/** Floats per detection row in the model's flat output (≥ 5). */
	outputStride: number;
	format: 'tflite';
}

/** Commands posted from the UI to the Smart Reframe worker. */
export type SmartReframeWorkerCommand =
	| {
			type: 'reframe-start';
			clipId: string;
			sourceFile: File;
			sourceRotation: number;
			sourceWidth: number;
			sourceHeight: number;
			targetAspect: number;
			clipDuration: number;
			inPoint: number;
			analysisFps?: number;
			velocityBound?: number;
			accelerationBound?: number;
			shotBoundaryThreshold?: number;
			/** Optional face-detection model (R2). When omitted (the default in
			 *  builds that ship no model catalogue entry), analysis runs
			 *  saliency-only (R2.6 / R8.2). When present, the model is downloaded +
			 *  digest-verified via the shared asset cache and compiled with
			 *  LiteRT.js from `wasmPath`; a checksum/size mismatch is a hard error,
			 *  never a silent fallback (R2.2). */
			faceModel?: {
				manifest: ReframeModelManifestSnapshot;
				/** Directory the LiteRT.js WASM runtime loads from (same-origin). */
				wasmPath: string;
				accelerator: ReframeAccelerator;
			};
	  }
	| { type: 'reframe-cancel' }
	| { type: 'reframe-dispose' };

/** State messages posted from the Smart Reframe worker back to the UI. */
export type SmartReframeWorkerState =
	| {
			type: 'reframe-progress';
			fraction: number;
			framesProcessed: number;
			totalFrames: number;
	  }
	| {
			type: 'reframe-result';
			keyframes: ClipKeyframesSnapshot;
			stats: ReframeAnalysisStatsSnapshot;
	  }
	| {
			type: 'reframe-error';
			reason: string;
			/** True when the failure is a model-integrity violation (checksum/size
			 *  mismatch, R2.2) rather than a recoverable runtime issue. Integrity
			 *  failures must never silently fall back to saliency. */
			integrity?: boolean;
	  }
	| { type: 'reframe-cancelled' };

/** Analysis statistics returned with the reframe result. */
export interface ReframeAnalysisStatsSnapshot {
	framesAnalysed: number;
	facesDetected: number;
	saliencyFrames: number;
	shotBoundaries: number;
	keyframesGenerated: number;
	safeZoneCompliance: number;
	mode: ReframeAnalysisMode;
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

// ── Phase 47: WHIP Publish ──

export type PublishEndpointType = 'twitch-whip' | 'cloudflare-whip' | 'mediamtx' | 'custom';
export type PublishVideoCodec = 'h264' | 'av1';

/**
 * Device-scoped publish settings. Deliberately NOT part of `ProjectDoc`:
 * destinations (and especially bearer tokens) must never travel inside Phase 23
 * project bundles or autosaves.
 */
export interface PublishSettingsDoc {
	endpointType: PublishEndpointType;
	endpointUrl: string;
	codec: PublishVideoCodec;
	videoBitrateKbps: number;
	keyframeIntervalS: number;
	/** Stream-side cap; null streams at program resolution/rate. */
	maxHeight: number | null;
	maxFps: number | null;
	/** Token is persisted only with this explicit opt-in (R7.2). */
	rememberToken: boolean;
	bearerToken?: string;
}

export interface PublishStats {
	bitrateKbps: number;
	rttMs: number | null;
	framesSent: number;
	framesDropped: number;
}

export type PublishFailureReason =
	/** `400` — the server rejected the SDP offer (codec/format mismatch). */
	| 'rejected-offer'
	/** `401`/`403` — bearer token missing or wrong. */
	| 'auth'
	/** `404` — endpoint URL does not exist. */
	| 'not-found'
	/** Reconnect policy exhausted its attempts. */
	| 'gave-up'
	/** Encoder-session budget had no free lease (R3.4). */
	| 'budget-exhausted'
	/** Required browser feature missing (R3.1). */
	| 'unsupported'
	/** Local error before/while connecting. */
	| 'local-error';

export type PublishState =
	| { phase: 'idle' }
	| { phase: 'connecting' }
	| { phase: 'live'; stats: PublishStats }
	| { phase: 'reconnecting'; attempt: number; nextRetryMs: number }
	| { phase: 'ended' }
	| { phase: 'failed'; reason: PublishFailureReason };

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
	| 'undecodable-track'
	| 'missing-cleaned-audio';

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
	skinSmoothStrength: number;
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
// Phase 22 original three + Phase 30 extended preset IDs + custom-preset strings (UUIDs).
export type CaptionPresetIdSnapshot =
	| 'subtitle'
	| 'lower-third'
	| 'note'
	| 'bold-outline'
	| 'neon-glow'
	| 'karaoke'
	| 'cinematic'
	| 'pop-card'
	| 'bounce-card'
	| 'slide-news'
	| (string & Record<never, never>);

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
	/** Phase 30: optional per-word timing for karaoke highlight. */
	words?: readonly { text: string; startS: number; endS: number }[];
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
	generatedBy?: string | null;
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

export interface SkinMaskSnapshot {
	cbMin: number;
	cbMax: number;
	crMin: number;
	crMax: number;
	softness: number;
}

export const DEFAULT_SKIN_MASK: SkinMaskSnapshot = {
	cbMin: -0.2,
	cbMax: 0.0,
	crMin: 0.05,
	crMax: 0.2,
	softness: 0.04
};

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
	skinMask?: SkinMaskSnapshot;
	audioFadeIn: number;
	audioFadeOut: number;
	offline?: boolean;
	/** Present iff `kind === 'title'`. */
	title?: TitleContentSnapshot;
	linkedGroupId?: string;
	/** Optional denoised audio routing (Phase 27); absent = original audio. */
	cleanedAudio?: CleanedAudioRefSnapshot;
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
	/** Maximum achievable duration in seconds, derived from clip headroom on both sides. */
	maxDurationS: number;
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

/** Phase 33: replace entire keyframe tracks for a clip in a single undo step
 *  (R7.5). Times in each track are **clip-local** seconds — generated reframe
 *  keyframes are authored clip-local. Tracks listed in `tracks` overwrite the
 *  clip's existing tracks for those params; params not listed are untouched.
 *  An empty array for a param clears that track. */
interface ReplaceKeyframeTracksCommand {
	type: 'replace-keyframe-tracks';
	trackId: string;
	clipId: string;
	tracks: ClipKeyframesSnapshot;
	/** Optional fit mode to set atomically with the tracks (Smart Reframe sends
	 *  `'fill'` because its x/y translations are only correct under the fill
	 *  crop, R6.2a). Applied in the same single-undo mutation. */
	fit?: FitModeSnapshot;
}

/** Phase 33: resolve the source `File` for a clip's source so a separate
 *  analysis worker can demux it. The pipeline worker owns the media bytes
 *  (OPFS / File System Access handle); the UI requests the File via this
 *  command and forwards it to the lazily-spawned Smart Reframe worker. */
interface GetSourceFileCommand {
	type: 'get-source-file';
	requestId: string;
	sourceId: string;
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

interface DeleteCaptionTrackCommand {
	type: 'delete-caption-track';
	trackId: string;
}

interface DeleteCaptionTracksCommand {
	type: 'delete-caption-tracks';
	trackIds: readonly string[];
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

// Phase 30: Animated caption style commands.
// Mirrors the engine's CaptionAnimKind union literally — kept here so that the
// protocol boundary catches typos at compile time instead of routing them
// through `string` and silently degrading to identity at the curve evaluator.
export type CaptionAnimKindSnapshot =
	| 'none'
	| 'pop'
	| 'bounce'
	| 'slide-up'
	| 'slide-down'
	| 'typewriter';

export interface CaptionAnimStylePresetSnapshot {
	captionStyleSchemaVersion: 1;
	id: string;
	label: string;
	builtIn: boolean;
	anchor: CaptionAnchorSnapshot;
	maxWidthPercent: number;
	lineWrap: CaptionLineWrapSnapshot;
	insetPx?: { x: number; y: number };
	titleStyle: Partial<TitleStyleSnapshot>;
	glow?: { color: string; blurPx: number };
	pill?: {
		paddingXPx: number;
		paddingYPx: number;
		radiusPx: number;
		color: string;
		opacity: number;
	};
	animation?: { enter: CaptionAnimKindSnapshot; exit: CaptionAnimKindSnapshot; durationS: number };
	highlightColor?: string;
}

interface CaptionImportCustomPresetCommand {
	type: 'caption-import-custom-preset';
	preset: CaptionAnimStylePresetSnapshot;
}

interface CaptionDeleteCustomPresetCommand {
	type: 'caption-delete-custom-preset';
	presetId: string;
}

interface CaptionSetAnimStyleCommand {
	type: 'caption-set-anim-style';
	trackId: string;
	segmentId?: string;
	presetId: string;
}

interface CaptionSetWordsCommand {
	type: 'caption-set-words';
	trackId: string;
	segmentId: string;
	words: readonly { text: string; startS: number; endS: number }[] | null;
}

export type BundleSourcePolicySnapshot =
	| { mode: 'embed-media' }
	| { mode: 'reference-only' }
	| { mode: 'collect-media'; relocate: boolean };

/** Phase 48 timeline interchange formats: OpenTimelineIO JSON and CMX3600 EDL. */
export type InterchangeFormat = 'otio' | 'edl';

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
	| 'interchange-export-failed'
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

/** Extracts a window of a clip's source audio PCM for local analysis
 *  (Phase 28 audio cleanup). Decode stays in the pipeline worker; inference
 *  never runs here. */
interface ExtractClipAudioCommand {
	type: 'extract-clip-audio';
	requestId: string;
	trackId: string;
	clipId: string;
	clipOffsetS: number;
	durationS: number;
	sampleRate: number;
}

/** Registers a cleaned WAV as a derived audio asset and routes the clip's
 *  audio through it (undoable timeline mutation). */
interface ApplyAudioCleanupCommand {
	type: 'apply-audio-cleanup';
	trackId: string;
	clipId: string;
	file: File;
	clipInPointS: number;
	durationS: number;
	modelId: string;
	modelVersion: string;
}

interface RemoveAudioCleanupCommand {
	type: 'remove-audio-cleanup';
	trackId: string;
	clipId: string;
}

// ── Capture Engine (Phase 41) ────────────────────────────────────────────

export type CaptureErrorCode =
	| 'permission-denied'
	| 'picker-cancelled'
	| 'device-in-use'
	| 'encoder-error'
	| 'writer-error'
	| 'quota-exceeded'
	| 'audio-overrun'
	| 'source-ended'
	| 'session-error';

export type CaptureStopReason = 'user-stop' | 'quota' | 'audio-overrun' | 'error';

export type CaptureSourceEndReason =
	| 'user-removed'
	| 'browser-stop-sharing'
	| 'encoder-error'
	| 'reader-error';

export type CaptureSourceKind = 'screen' | 'webcam' | 'mic' | 'system-audio';

export interface CaptureSourceDescriptor {
	sourceId: string;
	kind: CaptureSourceKind;
	label: string;
}

export interface CaptureSettingsSnapshot {
	chunkDurationS: number;
	videoCodec: string;
	audioCodec: string;
	videoBitrate: number | null;
}

export interface CaptureSourceSnapshot {
	sourceId: string;
	kind: CaptureSourceKind;
	label: string;
	encoderConfig: string;
	hardwareAcceleration: 'prefer-hardware' | 'no-preference';
}

export interface CaptureSourceStatusSnapshot {
	sourceId: string;
	kind: CaptureSourceKind;
	label: string;
	preEncodeDrops: number;
	bytesWritten: number;
	state: 'capturing' | 'stopping' | 'ended' | 'error';
}

export interface CaptureRecoverySessionSnapshot {
	sessionId: string;
	startedAtIso: string;
	sources: CaptureSourceSnapshot[];
	recoveredDurationS: number;
	totalBytes: number;
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
	| ReplaceKeyframeTracksCommand
	| GetSourceFileCommand
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
	| DeleteCaptionTrackCommand
	| DeleteCaptionTracksCommand
	| SetCaptionSegmentTextCommand
	| SetCaptionSegmentTimingCommand
	| SetCaptionSegmentStyleCommand
	| SplitCaptionSegmentCommand
	| MergeCaptionSegmentsCommand
	| DeleteCaptionSegmentsCommand
	| SnapCaptionSegmentCommand
	| CaptionImportCustomPresetCommand
	| CaptionDeleteCustomPresetCommand
	| CaptionSetAnimStyleCommand
	| CaptionSetWordsCommand
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
	| { type: 'export-interchange'; format: InterchangeFormat; trackId?: string }
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
	| ExtractClipAudioCommand
	| ApplyAudioCleanupCommand
	| RemoveAudioCleanupCommand
	| AsrCreateCaptionTrackCommand
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
	// Phase 46: Replay Buffer + Live Audio Chain. Commands are 'replay-'
	// prefixed to stay clear of the Phase 41 capture engine's namespace.
	| { type: 'replay-capture-stop' }
	| {
			// At least one stream is present; an audio-only capture (R1.2) omits
			// videoStream entirely.
			type: 'replay-capture-transfer-streams';
			videoStream?: ReadableStream<VideoFrame>;
			audioStream?: ReadableStream<AudioData>;
			settings?: CaptureStreamSettings;
	  }
	| { type: 'replay-save-last-n'; nSeconds?: number }
	| { type: 'replay-save-cancel' }
	| { type: 'update-replay-buffer-config'; config: Partial<RingBufferConfig> }
	| { type: 'update-live-chain-config'; config: Partial<LiveAudioChainConfig> }
	| { type: 'set-print-to-recording'; enabled: boolean }
	// Phase 47: program-feed tap for WHIP publish. 'worker-track' transfers a
	// MediaStreamTrack out of the worker; 'main-frames' is the probed fallback that
	// transfers one VideoFrame at a time (bounded to a single frame in flight).
	| { type: 'publish-tap-start'; mode: 'worker-track' | 'main-frames' }
	| { type: 'publish-tap-stop' }
	| { type: 'capture-add-source'; source: CaptureSourceDescriptor; track: MediaStreamTrack }
	| { type: 'capture-remove-source'; sourceId: string }
	| { type: 'capture-start'; settings: CaptureSettingsSnapshot; writerPort?: MessagePort }
	| { type: 'capture-stop' }
	| { type: 'capture-recovery-import'; sessionId: string }
	| { type: 'capture-recovery-discard'; sessionId: string }
	| { type: 'set-skin-mask'; trackId: string; clipId: string; mask: SkinMaskSnapshot }
	| { type: 'set-skin-smooth-bypass'; trackId: string; clipId: string; bypass: boolean }
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
	| { type: 'caption-custom-presets-updated'; presets: readonly CaptionAnimStylePresetSnapshot[] }
	| {
			type: 'caption-custom-preset-import-failed';
			/** Field name from the validator (e.g. `'animation.durationS'`). */
			field: string;
			/** Human-readable description of the failure, suitable for UI display. */
			message: string;
	  }
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
	| {
			type: 'interchange-result';
			format: InterchangeFormat;
			suggestedName: string;
			text: string;
			warnings: readonly string[];
	  }
	| { type: 'interchange-error'; format: InterchangeFormat; message: string }
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
	| {
			type: 'clip-audio';
			requestId: string;
			pcm: Float32Array;
			sampleRate: number;
			channels: number;
			/** Clip-local start of the returned window in seconds. */
			clipOffsetS: number;
			/** Total extractable clip duration in seconds (for progress math). */
			clipDurationS: number;
	  }
	| { type: 'clip-audio-error'; requestId: string; message: string }
	// Phase 33: resolved source File for Smart Reframe analysis. The File is
	// structured-clone-copied to the UI, which forwards it to the analysis worker
	// (the UI already holds source dimensions/rotation via its asset snapshot).
	| { type: 'source-file'; requestId: string; file: File }
	| { type: 'source-file-error'; requestId: string; message: string }
	| {
			type: 'audio-cleanup-applied';
			trackId: string;
			clipId: string;
			ok: boolean;
			assetId?: string;
			message?: string;
	  }
	// Phase 29: ASR auto-caption result to pass back to the caller.
	| {
			type: 'asr-caption-track-created';
			trackId: string;
			track: CaptionTrackSnapshot;
	  }
	| { type: 'diagnostic-snapshot'; requestId?: string; snapshot: DiagnosticSnapshot }
	| { type: 'recent-error'; error: RecentError }
	// Phase 47: publish tap responses. The track/frame messages carry transferables.
	| { type: 'publish-tap-track'; track: MediaStreamTrack }
	| { type: 'publish-tap-frame'; frame: VideoFrame }
	| { type: 'publish-tap-stats'; framesDelivered: number; framesDropped: number }
	| { type: 'publish-tap-error'; message: string }
	| {
			type: 'recovery-state';
			state: 'idle' | 'recovering' | 'failed';
			actions: readonly RecoveryAction[];
	  }
	// Phase 46: Replay Buffer + Live Audio Chain. Messages are 'replay-'
	// prefixed to stay clear of the Phase 41 capture engine's namespace.
	| { type: 'replay-capture-state'; state: CaptureSessionState }
	| { type: 'replay-capture-error'; message: string }
	| { type: 'replay-buffer-state'; state: RingBufferState }
	| { type: 'replay-save-progress'; chunksWritten: number; totalChunks: number }
	| { type: 'replay-save-complete'; sourceId: string; fileName: string }
	| { type: 'replay-save-error'; message: string }
	| { type: 'replay-save-canceled' }
	| { type: 'live-chain-config'; config: LiveAudioChainConfig }
	| { type: 'live-chain-latency'; latencyMs: number }
	| { type: 'live-chain-error'; message: string }
	| {
			type: 'capture-status';
			state: 'idle' | 'armed' | 'recording' | 'stopping';
			elapsedUs: number;
			bytesWritten: number;
			remainingSeconds: number | null;
			sources: CaptureSourceStatusSnapshot[];
	  }
	| {
			type: 'capture-error';
			sourceId: string | null;
			code: CaptureErrorCode;
			detail: string;
	  }
	| { type: 'capture-recovery-list'; sessions: CaptureRecoverySessionSnapshot[] }
	| {
			type: 'capture-landed';
			sessionId: string;
			trackIds: string[];
	  }
	| { type: 'error'; message: string };

// ── Phase 46: Replay Buffer + Live Audio Chain ──

export interface CaptureConfig {
	videoCodec: string;
	audioCodec: string;
	videoBitrate: number;
	audioBitrate: number;
	width: number;
	height: number;
	framerate: number;
	sampleRate: number;
	numberOfChannels: number;
}

export type CaptureSource = 'display' | 'camera';

/** Track metadata captured on the main thread alongside the transferred streams. */
export interface CaptureStreamSettings {
	source: CaptureSource;
	sourceLabel: string;
	width?: number;
	height?: number;
	frameRate?: number;
}

export interface CaptureSessionState {
	active: boolean;
	sourceLabel: string;
	source: CaptureSource;
	hasVideo: boolean;
	hasAudio: boolean;
	resolution: { width: number; height: number } | null;
	frameRate: number | null;
	elapsedS: number;
}

export interface RingBufferConfig {
	maxDurationS: number;
	maxMemoryBytes: number;
	saveDurationS: number;
}

export const DEFAULT_RING_BUFFER_CONFIG: RingBufferConfig = {
	maxDurationS: 30,
	maxMemoryBytes: 256 * 1024 * 1024,
	saveDurationS: 30
};

export interface RingBufferStats {
	totalDurationS: number;
	memoryBytes: number;
	spilledBytes: number;
	oldestTimestamp: number | null;
	newestTimestamp: number | null;
	keyframeCount: number;
	droppedFrameCount: number;
}

export interface SpillRange {
	startTimestamp: number;
	endTimestamp: number;
	opfsFileName: string;
	byteCount: number;
	entryCount: number;
	hasKeyframe: boolean;
}

export interface RingBufferState {
	config: RingBufferConfig;
	stats: RingBufferStats;
}

export interface AudioInsertParams {
	bypass: boolean;
}

export interface GateParams extends AudioInsertParams {
	thresholdDb: number;
	rangeDb: number;
	attackMs: number;
	holdMs: number;
	releaseMs: number;
}

export interface CompressorParams extends AudioInsertParams {
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	kneeDb: number;
	makeupGainDb: number;
}

export interface LimiterParams extends AudioInsertParams {
	ceilingDb: number;
	attackUs: number;
	releaseMs: number;
}

export interface LiveAudioChainConfig {
	gate: GateParams;
	compressor: CompressorParams;
	limiter: LimiterParams;
	denoiserBypass: boolean;
	printToRecording: boolean;
}

export const DEFAULT_GATE_PARAMS: GateParams = {
	bypass: true,
	thresholdDb: -40,
	rangeDb: -80,
	attackMs: 0.1,
	holdMs: 20,
	releaseMs: 50
};

export const DEFAULT_COMPRESSOR_PARAMS: CompressorParams = {
	bypass: true,
	thresholdDb: -24,
	ratio: 4,
	attackMs: 5,
	releaseMs: 100,
	kneeDb: 6,
	makeupGainDb: 0
};

export const DEFAULT_LIMITER_PARAMS: LimiterParams = {
	bypass: true,
	ceilingDb: -1,
	attackUs: 100,
	releaseMs: 50
};

export const DEFAULT_LIVE_AUDIO_CHAIN_CONFIG: LiveAudioChainConfig = {
	gate: DEFAULT_GATE_PARAMS,
	compressor: DEFAULT_COMPRESSOR_PARAMS,
	limiter: DEFAULT_LIMITER_PARAMS,
	denoiserBypass: true,
	printToRecording: false
};

// Extended SAB layout for live audio chain (appended to Phase 16 meter SAB).
// Used by the future monitor-path AudioWorklet; the v1 print-to-recording
// path runs the chain in the pipeline worker and does not touch this SAB.
export const LIVE_CHAIN_METER_OFFSET = 4; // After Phase 16 meters [0..3]
// Indices 4..34 are assigned below; 35..47 (13 slots) are reserved for the
// Phase 36 denoiser parameters so adding them won't resize existing SABs.
export const LIVE_CHAIN_METER_FIELD_COUNT = 44; // Indices 4..47
export const LIVE_CHAIN_TOTAL_FIELDS = METER_FIELD_COUNT + LIVE_CHAIN_METER_FIELD_COUNT;

export const LiveChainMeterIndex = {
	// Insert-level meters (indices 4–15)
	GATE_INPUT_PEAK_L: 4,
	GATE_INPUT_PEAK_R: 5,
	GATE_OUTPUT_PEAK_L: 6,
	GATE_OUTPUT_PEAK_R: 7,
	COMP_INPUT_PEAK_L: 8,
	COMP_INPUT_PEAK_R: 9,
	COMP_OUTPUT_PEAK_L: 10,
	COMP_OUTPUT_PEAK_R: 11,
	LIMITER_INPUT_PEAK_L: 12,
	LIMITER_INPUT_PEAK_R: 13,
	LIMITER_OUTPUT_PEAK_L: 14,
	LIMITER_OUTPUT_PEAK_R: 15,
	// Aggregate latency
	CHAIN_LATENCY_SAMPLES: 16,
	// Gate params (17–22)
	GATE_BYPASS: 17,
	GATE_THRESHOLD: 18,
	GATE_RANGE: 19,
	GATE_ATTACK: 20,
	GATE_HOLD: 21,
	GATE_RELEASE: 22,
	// Compressor params (23–29)
	COMP_BYPASS: 23,
	COMP_THRESHOLD: 24,
	COMP_RATIO: 25,
	COMP_ATTACK: 26,
	COMP_RELEASE: 27,
	COMP_KNEE: 28,
	COMP_MAKEUP: 29,
	// Limiter params (30–33)
	LIMITER_BYPASS: 30,
	LIMITER_CEILING: 31,
	LIMITER_ATTACK: 32,
	LIMITER_RELEASE: 33,
	// Reserved denoiser (34); params 35..47 reserved for Phase 36
	DENOISER_BYPASS: 34
} as const;

export function assertCrossOriginIsolated(context: string): void {
	if (!globalThis.crossOriginIsolated) {
		throw new Error(
			`${context}: crossOriginIsolated is false. ` +
				'SharedArrayBuffer requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).'
		);
	}
}
