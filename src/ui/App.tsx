import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
	on,
	onMount,
	onCleanup
} from 'solid-js';
import { Tabs } from '@ark-ui/solid/tabs';
import { useRegisterSW } from 'virtual:pwa-register/solid';
import { Link2, RotateCcw, Plus } from 'lucide-solid';
import {
	CLOCK_BUFFER_BYTES,
	type CapabilityProbeResult,
	type CaptionDiagnosticSnapshot,
	type CaptionExportSettingsSnapshot,
	type CaptionTrackSnapshot,
	type ClipKeyframeParamSnapshot,
	type ExportCodecSupport,
	type ExportBackend,
	type ExportPresetDoc,
	type ExportProgress,
	type ExportSettings,
	type PreviewBackend,
	type InterpolationAvailability,
	type InterpolationModelStatus,
	type BeautyModelStatus,
	type CalloutGeometry,
	type CalloutKind,
	type CalloutPayload,
	type RenderQueueState,
	type BundleIntegrityReportSnapshot,
	type BundleSourcePolicySnapshot,
	type MediaAssetSnapshot,
	type MediaMetadata,
	type SessionEventLogRef,
	type SourceDescriptorSnapshot,
	type SourceHealthReportSnapshot,
	type TimelineClipboardClip,
	type TimelineClipReference,
	type TimelineClipSnapshot,
	type TimelineMarkerSnapshot,
	type TimelineTrackSnapshot,
	type TimelineTransitionSnapshot,
	type PublishState,
	type WorkerStateMessage,
	type WaveformPeaks,
	type MatteEngineStatusSnapshot,
	type FeatureSupport,
	type ProgramSourceDescriptor,
	type ProgramSourceStatusSnapshot,
	type SceneDefinition,
	type SceneLayer,
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
	DEFAULT_VOICE_CLEANUP_SETTINGS,
	type CaptureSessionState,
	type LiveAudioChainConfig,
	type RingBufferState,
	type CaptureSourceKind,
	type TransformParamsSnapshot,
	type VoiceCleanupSettings,
	VOICE_CLEANUP_NORMALISE_GAIN_DB
} from '../protocol';
import type {
	DiagnosticSnapshot,
	DiagnosticSourceInput,
	InterpolationDiagnosticSummary
} from '../diagnostics/types';
import {
	createEmptyRecentErrorLog,
	addRecentError,
	createRecentError
} from '../diagnostics/recent-errors';
import { createSharedClock } from './clock';
import { createWorkerBridge } from './worker-bridge';
import { PreviewCanvas } from './PreviewCanvas';
import { PreviewGizmo } from './PreviewGizmo';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { buildUiDiagnosticSnapshot } from './diagnostic-snapshot';
import { Toolbar } from './Toolbar';
import { CalloutTool } from './CalloutTool';
import { Timeline } from './Timeline';
import { Inspector, type SelectedClip, type SelectedTransition } from './Inspector';
import { MediaBin } from './MediaBin';
import { BeatPanel } from './BeatPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { ThumbnailStore } from './thumbnail-store';
import { AudioEngine } from './audio-engine';
import { writeChainParamsToSab, writeDenoiserBypassToSab } from '../engine/live-audio/live-chain';
import { ExportDialog } from './ExportDialog';
import { RenderQueuePanel } from './RenderQueuePanel';
import { ReplayBufferPanel } from './ReplayBufferPanel';
import { RecordPanel, type RecorderStatusSnapshot } from './RecordPanel';
import { LiveAudioChainPanel } from './LiveAudioChainPanel';
import { VoiceCleanupPanel, voiceCleanupLatencyMs } from './VoiceCleanupPanel';
import { ProgramPanel } from './ProgramPanel';
import { probeMediaStreamTrackProcessor, startCapture, stopCaptureStreams } from './capture-bridge';
import { createCaptureDomTap } from './capture-dom-tap';
import { BundleDialog } from './BundleDialog';
import { InterchangeMenu } from './InterchangeMenu';
import { Button, buttonVariants } from './components/button';
import { cn } from '../lib/utils';
import { CapabilityPanel } from './CapabilityPanel';
import { DocsPage } from '../features/docs/DocsPage';
import { DOCS_INDEX_SLUG, docsPath, parseDocsPath } from '../features/docs/docsManifest';
import { PublishPanel } from './PublishPanel';
import { createPublishController, type PublishTapStats } from './publish-controller';
import { LimitedPreview } from './LimitedPreview';
import { registerKeyboardShortcuts } from './keyboard';
import {
	clipLocalTime,
	hasKeyframeTrack,
	sampleBeautyAt,
	sampleEffectsAt,
	sampleTransformAt
} from './keyframes';
import {
	canCompatibilityPreview,
	deriveCapabilityTier,
	importUnavailableReason,
	listCapabilityFeatures,
	primaryLimitedIssue,
	probeCapabilities,
	type CapabilitySnapshot,
	type CapabilityTier
} from './capabilities';
import {
	exportConstraintsForProbe,
	probeCapabilities as probeCapabilitiesV2
} from '../engine/capability-probe-v2';
import { budgetSessionsForProbe } from '../engine/encoder-budget';
import { compatibilityReadiness } from '../engine/compatibility/compat-status';
import { extractCompatibilityPreview } from '../compatibility/thumbnail';
import {
	createJob,
	createJobsFromMarkers,
	createEmptyQueueState,
	suggestedFileNameForJob
} from '../engine/render-queue';
import { BUILT_IN_PRESETS } from '../engine/export-presets';
import type { CaptionAnimStylePresetSnapshot } from '../protocol';
import { aspectOutputSize } from '../engine/project';
import { validateSafeZoneFile } from '../engine/safe-zones';
import { SafeZoneOverlay } from './SafeZoneOverlay';
import { createRecoveryMachine, type WorkerRecoveryState } from '../engine/recovery';
import { AppErrorBoundary } from './ErrorBoundary';
import { AudioCleanupPanel, type AppliedCleanupInfo } from './AudioCleanupPanel';
import { SilenceReviewPanel } from './SilenceReviewPanel';
import ScopePanel from './ScopePanel';
import { SCOPE_RES_X, scopeTotalBufferBytes } from '../engine/scopes';
import { KeystrokeOverlayPanel } from './KeystrokeOverlayPanel';
import {
	CleanupController,
	type CleanupClipTarget,
	type CleanupControllerState
} from './cleanup-controller';
import { spawnCleanupWorker } from './cleanup-bridge';
// Phase 29: Auto Captions (ASR)
import { AutoCaptionsPanel } from './AutoCaptionsPanel';
import {
	AsrController,
	ASR_PREVIEW_SECONDS,
	type AsrClipTarget,
	type AsrControllerState
} from './asr-controller';
import { spawnAsrWorker } from './asr-bridge';
import { SmartReframePanel, type ReframeAnalyseSettings } from './SmartReframePanel';
import { ReframeOverlay } from './ReframeOverlay';
import { ReframeController, type ReframeControllerState } from './reframe-controller';
import { spawnSmartReframeWorker } from './reframe-bridge';
import { REFRAME_FACE_ONNX_MANIFEST_URL } from '../engine/reframe/face-models';
import { REFRAME_ASPECT_VALUES } from '../protocol';
// Phase 40: On-Device Language Tools
import { LanguageToolsPanel } from './LanguageToolsPanel';
import {
	TranslationController,
	type TranslationControllerState
} from './language-tools/translation-controller';
import { DraftController, type DraftControllerState } from './language-tools/draft-controller';
import { languageToolsSurfaceVisible } from '../protocol';
import { probeLanguageTools } from '../engine/language-tools/probe';
import { languageSuffixedStem } from '../engine/language-tools/bilingual-export';
import PipelineWorker from '../engine/worker.ts?worker';
import CaptureWriterWorker from '../engine/capture/writer-worker.ts?worker';

const VIDEO_ACCEPT =
	'video/mp4,video/quicktime,video/webm,image/*,audio/*,application/json,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.ogg,.json';
const VIDEO_PICKER_TYPES = [
	{
		description: 'Media files',
		accept: {
			'video/mp4': ['.mp4'],
			'video/quicktime': ['.mov'],
			'video/webm': ['.webm'],
			'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
			'audio/*': ['.mp3', '.m4a', '.wav', '.ogg'],
			// Phase 38b: plain Lottie .json (the mediabunny adapter recognises
			// `"v":` / `"layers"` headers). `.lottie` zip containers are not yet
			// supported and produce a structured import-blocked warning.
			'application/json': ['.json']
		}
	}
];

const MEDIA_FILE_PATTERN = /\.(mp4|mov|webm|png|jpe?g|webp|gif|bmp|avif|mp3|m4a|wav|ogg|json)$/i;
const INTERPOLATION_EXPORT_PIPELINE_WIRED = false;
const INITIAL_INTERPOLATION_AVAILABILITY: InterpolationAvailability = {
	state: 'unavailable',
	reason: 'Frame interpolation has not been probed yet.'
};

type QueuePickerType = {
	description?: string;
	accept: Record<string, string[]>;
};

type DirectoryPickerWindow = Window & {
	showDirectoryPicker?: (options?: {
		mode?: 'read' | 'readwrite';
	}) => Promise<FileSystemDirectoryHandle>;
};

function isImportableFile(file: File): boolean {
	return (
		file.type.startsWith('video/') ||
		file.type.startsWith('image/') ||
		file.type.startsWith('audio/') ||
		file.type === 'application/json' ||
		MEDIA_FILE_PATTERN.test(file.name)
	);
}

interface CompatibilityPreviewState {
	url: string;
	width: number;
	height: number;
	fileName: string;
	duration: number;
	revoke: () => void;
}

interface HistoryUiState {
	canUndo: boolean;
	canRedo: boolean;
}

interface RestoreOfferState {
	projectId: string;
	savedAt: string;
	sources: SourceDescriptorSnapshot[];
}

function initialOnlineStatus(): boolean {
	return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

const DEFAULT_PROGRAM_LAYER_TRANSFORM = {
	x: 0,
	y: 0,
	scale: 1,
	rotation: 0,
	opacity: 1,
	anchorX: 0.5,
	anchorY: 0.5,
	fit: 'fill' as const
};

interface ProgramSourceHandle {
	descriptor: ProgramSourceDescriptor;
	monitorTrack?: MediaStreamTrack;
}

function formatSourceSummary(source: SourceDescriptorSnapshot): string {
	const mb = source.byteSize / 1_000_000;
	return `${source.fileName} · ${mb.toFixed(mb >= 10 ? 0 : 1)} MB · ${source.durationS.toFixed(2)}s`;
}

function captureKindFromSourceId(sourceId: string): CaptureSourceKind | null {
	if (sourceId.startsWith('capture-webcam-')) return 'webcam';
	if (sourceId.startsWith('capture-screen-')) return 'screen';
	if (sourceId.startsWith('capture-mic-')) return 'mic';
	if (sourceId.startsWith('capture-system-audio-')) return 'system-audio';
	return null;
}

function formatSavedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

function downloadTextFile(fileName: string, mimeType: string, content: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

/** File System Access save with download-blob fallback (Phase 48 R8.1). */
async function saveTextFile(fileName: string, mimeType: string, content: string): Promise<void> {
	let handle: FileSystemFileHandle | null = null;
	if (typeof window.showSaveFilePicker === 'function') {
		try {
			handle = await window.showSaveFilePicker({ suggestedName: fileName });
		} catch (error) {
			// User canceled the picker — not a failure, and not a download.
			if (error instanceof DOMException && error.name === 'AbortError') return;
			// The picker API itself failed; fall back to a plain download.
			handle = null;
		}
	}
	if (!handle) {
		downloadTextFile(fileName, mimeType, content);
		return;
	}
	// Write failures (disk full, permission revoked) propagate to the caller:
	// the user picked a destination, so silently downloading instead would
	// misreport where the file went.
	const writable = await handle.createWritable();
	await writable.write(new Blob([content], { type: mimeType }));
	await writable.close();
}

function capabilityTierV2Label(probe: CapabilityProbeResult | null): string | null {
	if (!probe) return null;
	switch (probe.tier) {
		case 'core-webgpu':
			return 'Core WebGPU';
		case 'compatibility-webgpu':
			return probe.compatibilityAdapter ? 'GPU (compat)' : 'Compatibility GPU';
		case 'limited-webcodecs':
			return 'Limited WebCodecs';
		case 'shell-only':
			return 'Shell Only';
	}
}

const SIDE_RAIL_TABS = [
	{ id: 'inspector', label: 'Inspector' },
	{ id: 'captions', label: 'Captions' },
	{ id: 'record', label: 'Record' },
	{ id: 'program', label: 'Program' },
	{ id: 'replay', label: 'Replay' },
	{ id: 'live-audio', label: 'Audio' },
	{ id: 'voice-cleanup', label: 'Cleanup' }
] as const;
type SideRailTab = (typeof SIDE_RAIL_TABS)[number]['id'];

const SIDE_RAIL_COLLAPSED_KEY = 'side-rail-collapsed';

function isSideRailTab(value: string | null): value is SideRailTab {
	return SIDE_RAIL_TABS.some((tab) => tab.id === value);
}

function readSideRailCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDE_RAIL_COLLAPSED_KEY) === '1';
	} catch {
		return false;
	}
}

export function App() {
	const [capabilities, setCapabilities] = createSignal<CapabilitySnapshot>(probeCapabilities());
	const [capabilityProbeV2, setCapabilityProbeV2] = createSignal<CapabilityProbeResult | null>(
		null
	);
	const [runtimeIssue, setRuntimeIssue] = createSignal<string | null>(null);
	const [isIsolated, setIsIsolated] = createSignal(
		typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false
	);
	const [workerReady, setWorkerReady] = createSignal(false);
	const [webgpuAvailable, setWebgpuAvailable] = createSignal(false);
	const [previewBackend, setPreviewBackend] = createSignal<PreviewBackend>('none');
	const [exportBackend, setExportBackend] = createSignal<ExportBackend>('none');
	const [previewReady, setPreviewReady] = createSignal(false);
	const [exportReady, setExportReady] = createSignal(false);
	const [capabilityPanelOpen, setCapabilityPanelOpen] = createSignal(false);
	// In-app user guide route (/docs[/section]); null means the editor view.
	const [docsSlug, setDocsSlug] = createSignal<string | null>(
		typeof window === 'undefined' ? null : parseDocsPath(window.location.pathname)
	);
	const [publishPanelOpen, setPublishPanelOpen] = createSignal(false);
	const [publishState, setPublishState] = createSignal<PublishState>({ phase: 'idle' });
	const [publishTapStats, setPublishTapStats] = createSignal<PublishTapStats | null>(null);
	const [publishErrorDetail, setPublishErrorDetail] = createSignal<string | null>(null);
	const [diagnosticsPanelOpen, setDiagnosticsPanelOpen] = createSignal(false);
	const [audioCleanupOpen, setAudioCleanupOpen] = createSignal(false);
	const [asrPanelOpen, setAsrPanelOpen] = createSignal(false);
	const [smartReframeOpen, setSmartReframeOpen] = createSignal(false);
	const [silenceReviewOpen, setSilenceReviewOpen] = createSignal(false);
	const [keystrokeOverlayOpen, setKeystrokeOverlayOpen] = createSignal(false);
	const [diagnosticSnapshot, setDiagnosticSnapshot] = createSignal<DiagnosticSnapshot | null>(null);
	const [recentErrorLog, setRecentErrorLog] = createSignal(createEmptyRecentErrorLog());
	const [compatibilityPreview, setCompatibilityPreview] =
		createSignal<CompatibilityPreviewState | null>(null);
	const [metadata, setMetadata] = createSignal<MediaMetadata | null>(null);
	const [importing, setImporting] = createSignal(false);
	const [statusLine, setStatusLine] = createSignal('Checking client capabilities…');
	const [previewLabel, setPreviewLabel] = createSignal<string | null>(null);
	const [previewSize, setPreviewSize] = createSignal<{ width: number; height: number } | null>(
		null
	);
	const [previewCanvasEl, setPreviewCanvasEl] = createSignal<HTMLCanvasElement | undefined>(
		undefined
	);
	const [previewCanvasBox, setPreviewCanvasBox] = createSignal<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	const [safeAreaGuides, setSafeAreaGuides] = createSignal(false);
	// Phase 39: Vertical and Platform Finishing
	const [projectAspect, setProjectAspect] =
		createSignal<import('../protocol').ProjectAspect>('16:9');
	const [safeZoneFile, setSafeZoneFile] = createSignal<
		import('../engine/safe-zones').SafeZoneFile | null
	>(null);
	const [selectedPlatformId, setSelectedPlatformId] = createSignal('');
	const [coverFrame, setCoverFrame] = createSignal<import('../protocol').CoverFrameDoc | null>(
		null
	);
	const [coverTitleClipId, setCoverTitleClipId] = createSignal('');
	const [coverThumbnailUrl, setCoverThumbnailUrl] = createSignal<string | null>(null);
	const [coverThumbnailError, setCoverThumbnailError] = createSignal<string | null>(null);
	const [_coverExportError, setCoverExportError] = createSignal<string | null>(null);
	const projectOutputSize = createMemo(() => aspectOutputSize(projectAspect()));
	const previewAspectStyle = createMemo(() => {
		const { width, height } = projectOutputSize();
		return `${width} / ${height}`;
	});
	const previewAspectNum = createMemo(() => {
		const { width, height } = projectOutputSize();
		return width / height;
	});
	const previewCanvasBoxStyle = createMemo((): Record<string, string> => {
		const box = previewCanvasBox();
		if (!box) return {};
		return {
			'--preview-canvas-left': `${box.left}px`,
			'--preview-canvas-top': `${box.top}px`,
			'--preview-canvas-width': `${box.width}px`,
			'--preview-canvas-height': `${box.height}px`,
			'--preview-canvas-transform': 'none'
		};
	});
	const selectedPlatform = createMemo<import('../engine/safe-zones').SafeZonePlatform | null>(
		() => {
			const id = selectedPlatformId();
			if (!id) return null;
			return safeZoneFile()?.platforms.find((p) => p.id === id) ?? null;
		}
	);
	const matchingPlatforms = createMemo(() => {
		return safeZoneFile()?.platforms.filter((p) => p.aspect === projectAspect()) ?? [];
	});

	createEffect(() => {
		const canvas = previewCanvasEl();
		const aspect = previewAspectNum();
		if (!canvas) {
			setPreviewCanvasBox(null);
			return;
		}

		let frame = 0;
		const updateCanvasBox = () => {
			if (frame) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = 0;
				const parent = canvas.parentElement;
				if (!parent) return;
				const parentRect = parent.getBoundingClientRect();
				const width = Math.min(parentRect.width, parentRect.height * aspect);
				const height = width / aspect;
				const next = {
					left: (parentRect.width - width) / 2,
					top: (parentRect.height - height) / 2,
					width,
					height
				};
				setPreviewCanvasBox((previous) =>
					previous &&
					Math.abs(previous.left - next.left) < 0.5 &&
					Math.abs(previous.top - next.top) < 0.5 &&
					Math.abs(previous.width - next.width) < 0.5 &&
					Math.abs(previous.height - next.height) < 0.5
						? previous
						: next
				);
			});
		};

		const updateCanvasBoxNow = () => {
			const parent = canvas.parentElement;
			if (!parent) return;
			const parentRect = parent.getBoundingClientRect();
			const width = Math.min(parentRect.width, parentRect.height * aspect);
			const height = width / aspect;
			setPreviewCanvasBox({
				left: (parentRect.width - width) / 2,
				top: (parentRect.height - height) / 2,
				width,
				height
			});
		};

		updateCanvasBoxNow();
		const observer = new ResizeObserver(updateCanvasBox);
		if (canvas.parentElement) observer.observe(canvas.parentElement);
		window.addEventListener('resize', updateCanvasBox);
		onCleanup(() => {
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', updateCanvasBox);
		});
	});
	function aspectLabel(aspect: import('../protocol').ProjectAspect): string {
		switch (aspect) {
			case '16:9':
				return 'Landscape';
			case '9:16':
				return 'Vertical';
			case '1:1':
				return 'Square';
			case '4:5':
				return 'Portrait';
		}
	}
	const [calloutToolActive, setCalloutToolActive] = createSignal(false);
	const [calloutPlacementActive, setCalloutPlacementActive] = createSignal(false);
	const [calloutPlacementKind, setCalloutPlacementKind] = createSignal<CalloutKind>('arrow');
	const [previewRegionPickHandler, setPreviewRegionPickHandler] = createSignal<
		((x: number, y: number) => void) | null
	>(null);
	const [encodeFps, setEncodeFps] = createSignal<number | null>(null);
	const [timeline, setTimeline] = createSignal<TimelineTrackSnapshot[]>([]);
	const coverTitleOptions = createMemo(() => {
		const options: { id: string; label: string }[] = [];
		for (const track of timeline()) {
			if (track.type !== 'video') continue;
			for (const clip of track.clips) {
				if (clip.kind !== 'title' || !clip.title) continue;
				options.push({ id: clip.id, label: clip.title.text.trim() || 'Untitled title' });
			}
		}
		return options;
	});
	const [captionTracks, setCaptionTracks] = createSignal<CaptionTrackSnapshot[]>([]);
	const [sessionEventLogs, setSessionEventLogs] = createSignal<SessionEventLogRef[]>([]);
	const [captionDiagnostics, setCaptionDiagnostics] = createSignal<CaptionDiagnosticSnapshot[]>([]);
	// Phase 30: user-imported animated caption presets, kept in sync with the worker.
	// The snapshot type is the structured-clone-safe wire format; the engine type
	// (`CaptionAnimStylePreset`) is structurally compatible so we don't need to
	// convert at the boundary.
	const [customAnimCaptionPresets, setCustomAnimCaptionPresets] = createSignal<
		CaptionAnimStylePresetSnapshot[]
	>([]);
	const [markers, setMarkers] = createSignal<TimelineMarkerSnapshot[]>([]);
	const [transitions, setTransitions] = createSignal<TimelineTransitionSnapshot[]>([]);
	// Phase 13: currently selected transition for the Inspector panel.
	const transitionMeta = new Map<
		string,
		{ trackId: string; fromClipId: string; toClipId: string }
	>();
	const [selectedTransitionId, setSelectedTransitionId] = createSignal<string | null>(null);
	const selectedTransition = createMemo<SelectedTransition | null>(() => {
		const id = selectedTransitionId();
		if (!id) return null;
		const all = transitions();
		const live = all.find((t) => t.id === id);
		if (!live) return null;
		// Derive SelectedTransition from the live snapshot so durationS and
		// maxDurationS always reflect worker-side clamping.
		// trackId/fromClipId/toClipId/kind are captured when the user selects
		// a transition (onSelectTransition) and stored in a companion map.
		const meta = transitionMeta.get(id);
		if (!meta) return null;
		return {
			transitionId: id,
			trackId: meta.trackId,
			fromClipId: meta.fromClipId,
			toClipId: meta.toClipId,
			durationS: live.durationS,
			maxDurationS: live.maxDurationS,
			kind: live.kind
		};
	});
	const [masterGain, setMasterGain] = createSignal(1);
	const [selectedClipRefs, setSelectedClipRefs] = createSignal<TimelineClipReference[]>([]);
	const [selectedCaptionTrackId, setSelectedCaptionTrackId] = createSignal<string | null>(null);
	const [selectedCaptionSegmentIds, setSelectedCaptionSegmentIds] = createSignal<string[]>([]);
	const [timelineClipboard, setTimelineClipboard] = createSignal<TimelineClipboardClip[]>([]);
	const [waveformPeaks, setWaveformPeaks] = createSignal<Record<string, WaveformPeaks>>({});
	const [exporting, setExporting] = createSignal(false);
	const [exportProgress, setExportProgress] = createSignal<ExportProgress | null>(null);
	const [exportResult, setExportResult] = createSignal<string | null>(null);
	const [exportError, setExportError] = createSignal<string | null>(null);
	const [exportWarnings, setExportWarnings] = createSignal<string[]>([]);
	const [exportCodecs, setExportCodecs] = createSignal<ExportCodecSupport[]>([]);
	const [exportSettings, setExportSettings] = createSignal<ExportSettings | null>(null);
	const [interpolationAvailability, setInterpolationAvailability] =
		createSignal<InterpolationAvailability>(INITIAL_INTERPOLATION_AVAILABILITY);
	const [interpolationModelStatus, setInterpolationModelStatus] =
		createSignal<InterpolationModelStatus>('not-loaded');
	const [interpolationModelSizeBytes, setInterpolationModelSizeBytes] = createSignal<number | null>(
		null
	);
	const [interpolationModelCacheSource, setInterpolationModelCacheSource] = createSignal<
		'cache' | 'network' | null
	>(null);
	const [interpolationEstimateMs, setInterpolationEstimateMs] = createSignal<number | null>(null);
	const [interpolationRefusals, setInterpolationRefusals] = createSignal(0);
	const [interpolationRecentErrors, setInterpolationRecentErrors] = createSignal<readonly string[]>(
		[]
	);
	// Phase 32b: beauty model load state (mirrors interpolation; drives Inspector gating).
	const [beautyModelStatus, setBeautyModelStatus] = createSignal<BeautyModelStatus>('not-loaded');
	const [beautyModelSizeBytes, setBeautyModelSizeBytes] = createSignal<number | null>(null);
	const [beautyModelDownloadedBytes, setBeautyModelDownloadedBytes] = createSignal<number | null>(
		null
	);
	const [beautyModelError, setBeautyModelError] = createSignal<string | null>(null);
	// Phase 32b: accelerated beauty path needs WebGPU + cross-origin isolation.
	const beautyAvailable = (): boolean => {
		const probe = capabilityProbeV2()?.beauty;
		return probe ? probe.webgpu === 'supported' && probe.crossOriginIsolated : false;
	};
	const [exportPresets, setExportPresets] = createSignal<ExportPresetDoc[]>(
		BUILT_IN_PRESETS.map((preset) => ({ ...preset }))
	);
	const [renderQueue, setRenderQueue] = createSignal<RenderQueueState>(createEmptyQueueState());
	// Phase 46: Replay Buffer + Live Audio Chain
	const [captureSession, setCaptureSession] = createSignal<CaptureSessionState | null>(null);
	const [recorderStatus, setRecorderStatus] = createSignal<RecorderStatusSnapshot | null>(null);
	// Phase 41: own-tab DOM event tap — singleton driven by capture-dom-tap-init /
	// capture-dom-tap-stop messages from the worker. Idle when no session is active
	// (no DOM listeners installed). Cleaned up on App unmount.
	const captureDomTap = createCaptureDomTap();
	onCleanup(() => captureDomTap.stop());
	/** Session id whose `events.ndjson` is flushed + closed by the writer worker.
	 *  Drives the panel's "Load events from last recording" gating so we never read
	 *  the sidecar while the writer's handle is still open. Cleared on each new
	 *  capture-dom-tap-init so a stale ready signal can't gate the next session. */
	const [sidecarReadySessionId, setSidecarReadySessionId] = createSignal<string | null>(null);
	const [recorderLandedSessionId, setRecorderLandedSessionId] = createSignal<string | null>(null);
	const [retakeClipId, setRetakeClipId] = createSignal<string | null>(null);
	const [replayBufferState, setReplayBufferState] = createSignal<RingBufferState | null>(null);
	const [replaySaveInProgress, setReplaySaveInProgress] = createSignal(false);
	const [programSources, setProgramSources] = createSignal<ProgramSourceDescriptor[]>([]);
	const [programScenes, setProgramScenes] = createSignal<SceneDefinition[]>([]);
	const [programSessionState, setProgramSessionState] = createSignal<
		'idle' | 'armed' | 'running' | 'stopping'
	>('idle');
	const [programActiveSceneId, setProgramActiveSceneId] = createSignal<string | null>(null);
	const [programSourceStatus, setProgramSourceStatus] = createSignal<ProgramSourceStatusSnapshot[]>(
		[]
	);
	const [programError, setProgramError] = createSignal<string | null>(null);
	const [programTransitionMs, setProgramTransitionMs] = createSignal<0 | 200>(0);
	let programSourceHandles = new Map<string, ProgramSourceHandle>();
	let activeProgramMonitorTracks = new Map<string, MediaStreamTrack>();
	let programWriterWorker: Worker | null = null;
	const [liveChainConfig, setLiveChainConfig] = createSignal<LiveAudioChainConfig>(
		DEFAULT_LIVE_AUDIO_CHAIN_CONFIG
	);
	const [liveChainLatencyMs, setLiveChainLatencyMs] = createSignal(0);
	// Phase 36: Voice Cleanup
	const [voiceCleanupSettings, setVoiceCleanupSettings] = createSignal<VoiceCleanupSettings>(
		DEFAULT_VOICE_CLEANUP_SETTINGS
	);
	const [voiceCleanupAnalysisState, setVoiceCleanupAnalysisState] = createSignal<
		'idle' | 'running' | 'done' | 'error'
	>('idle');
	const [voiceCleanupAnalysisProgress, setVoiceCleanupAnalysisProgress] = createSignal(0);
	const [voiceCleanupMeasuredLufs, setVoiceCleanupMeasuredLufs] = createSignal(0);
	const [voiceCleanupProposedGainDb, setVoiceCleanupProposedGainDb] = createSignal(0);
	const [voiceCleanupNormalisedLufs, setVoiceCleanupNormalisedLufs] = createSignal(0);
	const [voiceCleanupAnalysisError, setVoiceCleanupAnalysisError] = createSignal('');
	const [voiceCleanupDenoiserStatus, setVoiceCleanupDenoiserStatus] = createSignal<
		'idle' | 'loading' | 'ready' | 'unavailable'
	>('idle');
	const [voiceCleanupDenoiserUnavailableReason, setVoiceCleanupDenoiserUnavailableReason] =
		createSignal('');
	const [voiceCleanupWasmSha256, setVoiceCleanupWasmSha256] = createSignal<string | null>(null);
	const [voiceCleanupWasmLoadTimeMs, setVoiceCleanupWasmLoadTimeMs] = createSignal<number | null>(
		null
	);
	const [voiceCleanupMonitorSampleRate, setVoiceCleanupMonitorSampleRate] = createSignal(48_000);
	const [voiceCleanupMonitorLatencyMs, setVoiceCleanupMonitorLatencyMs] = createSignal(
		voiceCleanupLatencyMs(48_000)
	);
	const [isOffline, setIsOffline] = createSignal(!initialOnlineStatus());
	const [hasActiveSW, setHasActiveSW] = createSignal(false);
	const [audioWarning, setAudioWarning] = createSignal<string | null>(null);
	const [isDraggingFile, setIsDraggingFile] = createSignal(false);
	const [historyState, setHistoryState] = createSignal<HistoryUiState>({
		canUndo: false,
		canRedo: false
	});
	const [restoreOffer, setRestoreOffer] = createSignal<RestoreOfferState | null>(null);
	const [unresolvedSources, setUnresolvedSources] = createSignal<SourceDescriptorSnapshot[]>([]);
	// Phase 34: Beat analysis state
	const [beatResults, setBeatResults] = createSignal<
		Map<string, { tempoBpm: number; beatTimesMs: number[] }>
	>(new Map());
	const [beatProgress, setBeatProgress] = createSignal<Map<string, number>>(new Map());
	const [beatSettings, setBeatSettings] = createSignal<{
		enabledSourceIds: string[];
		globalOffsetMs: number;
	}>({
		enabledSourceIds: [],
		globalOffsetMs: 0
	});
	const [assets, setAssets] = createSignal<MediaAssetSnapshot[]>([]);
	const [latestHealthReport, setLatestHealthReport] =
		createSignal<SourceHealthReportSnapshot | null>(null);
	const [bundleBusy, setBundleBusy] = createSignal(false);
	const [bundleJobId, setBundleJobId] = createSignal<string | null>(null);
	const [bundlePhase, setBundlePhase] = createSignal<string | null>(null);
	const [bundleReport, setBundleReport] = createSignal<BundleIntegrityReportSnapshot | null>(null);
	const [activeSideRailTab, setActiveSideRailTab] = createSignal<SideRailTab>('inspector');
	const [sideRailCollapsed, setSideRailCollapsed] = createSignal(readSideRailCollapsed());
	const toggleSideRail = (collapsed: boolean) => {
		setSideRailCollapsed(collapsed);
		try {
			localStorage.setItem(SIDE_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
		} catch {
			// Persistence is best-effort; private browsing may block storage.
		}
		// Toggling unmounts the focused button; move focus to its counterpart
		// so keyboard and screen reader users are not dropped onto <body>.
		// oxlint-disable-next-line solid/reactivity -- one-shot deferred focus inside an event handler, reads current values intentionally
		queueMicrotask(() => {
			if (collapsed) {
				document.getElementById('side-rail-expand-btn')?.focus();
			} else {
				document.getElementById(`tab-${activeSideRailTab()}`)?.focus();
			}
		});
	};
	const openSideRailTab = (tab: SideRailTab) => {
		setActiveSideRailTab(tab);
		if (sideRailCollapsed()) toggleSideRail(false);
	};
	const [bundleMessage, setBundleMessage] = createSignal<string | null>(null);
	// Phase 23: replace-on-import confirm. Replaces window.confirm() which is
	// silently suppressed in cross-origin / gesture-lapsed contexts and would
	// then read as "Cancel" without the user ever seeing a prompt.
	const [bundleReplacePrompt, setBundleReplacePrompt] = createSignal<{
		jobId: string;
		message: string;
	} | null>(null);
	const [interchangeWarnings, setInterchangeWarnings] = createSignal<readonly string[]>([]);
	const [interchangeMessage, setInterchangeMessage] = createSignal<string | null>(null);
	const [thumbnailVersion, setThumbnailVersion] = createSignal(0);
	const thumbnailStore = new ThumbnailStore();

	const unresolvedIds = createMemo(() => new Set(unresolvedSources().map((s) => s.sourceId)));

	const {
		offlineReady: [offlineReady],
		needRefresh: [needRefresh],
		updateServiceWorker
	} = useRegisterSW({
		onRegisterError(error) {
			console.error('SW registration error', error);
		}
	});

	const sab = (() => {
		if (typeof SharedArrayBuffer !== 'function') return null;
		try {
			return new SharedArrayBuffer(CLOCK_BUFFER_BYTES);
		} catch {
			return null;
		}
	})();
	let bridge: ReturnType<typeof createWorkerBridge> | null = null;
	let worker: Worker | null = null;
	let initSent = false;
	let pendingInitCanvas: OffscreenCanvas | null = null;
	let compatibilityImportGeneration = 0;
	let dockImportInput: HTMLInputElement | undefined;
	let relinkInput: HTMLInputElement | undefined;
	let pendingRelinkSourceId: string | null = null;
	const audioEngine = new AudioEngine({
		onVoiceCleanupStatus(status) {
			if (status.status === 'ready') {
				setVoiceCleanupDenoiserStatus('ready');
				setVoiceCleanupDenoiserUnavailableReason('');
			} else {
				setVoiceCleanupDenoiserStatus('unavailable');
				setVoiceCleanupDenoiserUnavailableReason(status.reason);
			}
		}
	});
	let voiceCleanupWasmLoad: Promise<ArrayBuffer> | null = null;

	function clearCoverThumbnail(): void {
		setCoverThumbnailUrl((current) => {
			if (current) URL.revokeObjectURL(current);
			return null;
		});
	}

	createEffect(
		on([coverFrame, workerReady], ([currentCover, ready]) => {
			clearCoverThumbnail();
			setCoverThumbnailError(null);
			if (!currentCover || !ready) return;
			bridge?.send({
				type: 'request-cover-thumbnail',
				timeS: currentCover.timeS,
				titleClipId: currentCover.titleClipId ?? null
			});
		})
	);

	onCleanup(() => clearCoverThumbnail());
	function loadVoiceCleanupWasm(): Promise<ArrayBuffer> {
		voiceCleanupWasmLoad ??= loadVerifiedVoiceCleanupWasm();
		return voiceCleanupWasmLoad;
	}
	async function loadVerifiedVoiceCleanupWasm(): Promise<ArrayBuffer> {
		const startedAt = performance.now();
		const assetBase = new URL(
			'rnnoise/',
			new URL(import.meta.env.BASE_URL, globalThis.location.href)
		);
		const [manifestResponse, wasmResponse] = await Promise.all([
			fetch(new URL('manifest.json', assetBase)),
			fetch(new URL('rnnoise.wasm', assetBase))
		]);
		if (!manifestResponse.ok) {
			throw new Error(`RNNoise manifest fetch failed with HTTP ${manifestResponse.status}`);
		}
		if (!wasmResponse.ok) {
			throw new Error(`RNNoise WASM fetch failed with HTTP ${wasmResponse.status}`);
		}
		const manifest = (await manifestResponse.json()) as { sizeBytes: number; checksum: string };
		setVoiceCleanupWasmSha256(manifest.checksum);
		const buffer = await wasmResponse.arrayBuffer();
		if (buffer.byteLength !== manifest.sizeBytes) {
			throw new Error(
				`RNNoise WASM size mismatch: expected ${manifest.sizeBytes} bytes, got ${buffer.byteLength}`
			);
		}
		const digest = await crypto.subtle.digest('SHA-256', buffer);
		const actual = Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		const expected = manifest.checksum.replace('sha256-', '');
		if (actual !== expected) {
			throw new Error(`RNNoise WASM checksum mismatch: expected sha256-${expected}`);
		}
		setVoiceCleanupWasmLoadTimeMs(performance.now() - startedAt);
		return buffer;
	}
	let audioReady: Promise<{
		audioSab: SharedArrayBuffer | null;
		meterSab: SharedArrayBuffer | null;
	}> | null = null;
	const [meterSab, setMeterSab] = createSignal<SharedArrayBuffer | null>(null);
	const [audioSabReady, setAudioSabReady] = createSignal(false);

	// Phase 21: scope SAB ring buffer. Allocated once, passed to the worker on
	// init, and read by ScopePanel on its own rAF loop. `null` when SAB isn't
	// supported (non-isolated tier) — ScopePanel hides itself in that case.
	const scopeSab = (() => {
		if (typeof SharedArrayBuffer !== 'function') return null;
		try {
			return new SharedArrayBuffer(scopeTotalBufferBytes(SCOPE_RES_X));
		} catch {
			return null;
		}
	})();
	const [scopePanelCollapsed, setScopePanelCollapsed] = createSignal(true);
	const scopePanelAvailable = createMemo(
		() =>
			scopeSab !== null &&
			(previewBackend() === 'core-webgpu' || previewBackend() === 'compat-webgpu')
	);
	const scopeFramePixelCount = createMemo(() => {
		const size = previewSize();
		return size ? size.width * size.height : null;
	});
	// Drive the worker's scope compute pass off panel visibility: collapsed →
	// skip the per-frame dispatch entirely (GPU + readback are idle when the
	// user isn't watching). The send is guarded on workerReady so commands
	// don't drop before the bridge attaches.
	createEffect(() => {
		if (!workerReady() || !scopeSab) return;
		const enabled = scopePanelAvailable() && !scopePanelCollapsed();
		bridge?.send({ type: 'toggle-scopes', enabled });
	});

	// Phase 47: WHIP publish. The controller owns the WhipSession, the encoder
	// lease, and the worker tap wiring; the component only mirrors its state into
	// signals. No media objects live in component state.
	const publishController = createPublishController({
		sendCommand: (command) => ensureWorker().bridge.send(command),
		getProbe: () => capabilityProbeV2(),
		getAudioTrack: () => audioEngine.createStreamTap(),
		releaseAudioTrack: () => audioEngine.removeStreamTap()
	});
	const publishBusy = createMemo(() => {
		const phase = publishState().phase;
		return phase === 'connecting' || phase === 'live' || phase === 'reconnecting';
	});

	createEffect(() => {
		const meterBuffer = meterSab();
		const settings = voiceCleanupSettings();
		const audioTrackIds = timeline()
			.filter((track) => track.type === 'audio')
			.map((track) => track.id);
		if (meterBuffer) {
			const sab = new Float32Array(meterBuffer);
			writeChainParamsToSab(sab, {
				...DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
				gate: settings.gateParams,
				limiter: { ...settings.limiterParams, ceilingDb: settings.limiterCeilingDbtp },
				denoiserBypass: settings.denoiserEnabledTracks.length === 0
			});
			sab[VOICE_CLEANUP_NORMALISE_GAIN_DB] = settings.normaliseGainDb;
			writeDenoiserBypassToSab(sab, audioTrackIds, settings.denoiserEnabledTracks);
		}
		if (settings.denoiserEnabledTracks.length === 0) {
			audioEngine.configureVoiceCleanup(false);
			setVoiceCleanupDenoiserStatus((status) => (status === 'unavailable' ? status : 'idle'));
			return;
		}
		if (voiceCleanupDenoiserStatus() !== 'ready') {
			setVoiceCleanupDenoiserStatus('loading');
			setVoiceCleanupDenoiserUnavailableReason('');
		}
		void loadVoiceCleanupWasm().then(
			// oxlint-disable-next-line solid/reactivity -- async load resolve; the guarded re-check of current state is intentional
			(wasmBytes) => {
				if (
					voiceCleanupSettings().denoiserEnabledTracks.length > 0 &&
					voiceCleanupDenoiserStatus() !== 'ready'
				) {
					audioEngine.configureVoiceCleanup(true, wasmBytes);
				}
			},
			(error) => {
				setVoiceCleanupDenoiserStatus('unavailable');
				setVoiceCleanupDenoiserUnavailableReason(
					error instanceof Error ? error.message : String(error)
				);
			}
		);
	});

	// Re-evaluated on publish transitions: the lease count changes at go-live/stop.
	const recordWhileStreaming = createMemo(() => {
		publishState();
		return publishController.canRecordWhileStreaming();
	});

	const recoveryMachine = createRecoveryMachine();
	const [workerRecoveryState, setWorkerRecoveryState] =
		createSignal<WorkerRecoveryState>('running');
	const [previewKey, setPreviewKey] = createSignal(0);
	let awaitingRestartReady = false;

	// ── Phase 28: Local Audio Cleanup (ORT DTLN, experimental) ──
	// The controller spawns its dedicated worker lazily on first action; the
	// pipeline worker only supplies PCM windows and applies the result.
	const cleanupController = new CleanupController({
		spawnWorker: spawnCleanupWorker,
		requestClipAudio: (request) => {
			if (!bridge) throw new Error('Media pipeline is not ready.');
			bridge.send({ type: 'extract-clip-audio', ...request });
		},
		applyToClip: (request) => {
			if (!bridge) throw new Error('Media pipeline is not ready.');
			const file = new File([request.wav], request.fileName, { type: 'audio/wav' });
			bridge.send({
				type: 'apply-audio-cleanup',
				trackId: request.trackId,
				clipId: request.clipId,
				file,
				clipInPointS: request.clipInPointS,
				durationS: request.durationS,
				modelId: request.modelId,
				modelVersion: request.modelVersion
			});
		},
		manifestUrl: `${import.meta.env.BASE_URL}models/dtln-onnx/manifest.json`,
		onError: (message) => {
			setRecentErrorLog((prev) =>
				addRecentError(
					prev,
					createRecentError({
						code: 'audio_cleanup.worker_crashed',
						subsystem: 'audio',
						severity: 'error',
						message
					})
				)
			);
		}
	});
	const [cleanupState, setCleanupState] = createSignal<CleanupControllerState>(
		cleanupController.getState()
	);
	cleanupController.subscribe(setCleanupState);

	// Phase 31: matte status comes from the pipeline worker — the matte engine
	// lives there (per-frame zero-copy inference on the compositor's device);
	// there is no separate inference worker or UI-side orchestration.
	const [matteStatus, setMatteStatus] = createSignal<MatteEngineStatusSnapshot>({
		probe: null,
		modelStatus: 'not-loaded',
		backend: null
	});

	const selectedAudioCleanupClip = createMemo<CleanupClipTarget | null>(() => {
		for (const ref of selectedClipRefs()) {
			const track = timeline().find((item) => item.id === ref.trackId);
			if (!track || track.type !== 'audio') continue;
			const clip = track.clips.find((item) => item.id === ref.clipId);
			if (!clip || clip.kind === 'title' || !clip.sourceId) continue;
			const asset = assets().find((item) => item.sourceId === clip.sourceId);
			return {
				trackId: track.id,
				clipId: clip.id,
				inPointS: clip.inPoint,
				durationS: clip.duration,
				fileName: asset?.fileName ?? clip.sourceId
			};
		}
		return null;
	});

	const appliedCleanupInfo = createMemo<AppliedCleanupInfo | null>(() => {
		const target = selectedAudioCleanupClip();
		if (!target) return null;
		const track = timeline().find((item) => item.id === target.trackId);
		const clip = track?.clips.find((item) => item.id === target.clipId);
		if (!clip?.cleanedAudio) return null;
		return {
			trackId: target.trackId,
			clipId: target.clipId,
			modelId: clip.cleanedAudio.modelId,
			modelVersion: clip.cleanedAudio.modelVersion
		};
	});

	// ── Phase 29: Auto Captions (ASR, experimental) ──
	const asrController = new AsrController({
		spawnWorker: spawnAsrWorker,
		requestClipAudio: (request) => {
			if (!bridge) throw new Error('Media pipeline is not ready.');
			bridge.send({ type: 'extract-clip-audio', ...request });
		},
		createCaptionTrack: (request) => {
			if (!bridge) throw new Error('Media pipeline is not ready.');
			bridge.send({
				type: 'asr-create-caption-track',
				...request
			});
		},
		onError: (message) => {
			setRecentErrorLog((prev) =>
				addRecentError(
					prev,
					createRecentError({
						code: 'asr.worker_crashed',
						subsystem: 'audio',
						severity: 'error',
						message
					})
				)
			);
		}
	});
	const [asrState, setAsrState] = createSignal<AsrControllerState>(asrController.getState());
	asrController.subscribe(setAsrState);

	// ── Phase 40: On-Device Language Tools ──
	const translationController = new TranslationController({
		createTranslatedTrack: (request) => {
			if (!bridge) throw new Error('Media pipeline is not ready.');
			bridge.send({
				type: 'add-translated-caption-track',
				sourceTrackId: request.sourceTrackId,
				name: request.name,
				language: request.language,
				segments: request.segments,
				generatedBy: 'language-tools-phase-40'
			});
		},
		onTranslatedTrackCreated: (trackId) => {
			const track = captionTracks().find((t) => t.id === trackId);
			setStatusLine(
				track
					? `Translated caption track "${track.name}" created`
					: 'Translated caption track created'
			);
		},
		onError: (message) => {
			setRecentErrorLog((prev) =>
				addRecentError(
					prev,
					createRecentError({
						code: 'language-tools.translate_error',
						subsystem: 'language-tools',
						severity: 'error',
						message
					})
				)
			);
		}
	});
	const [translationState, setTranslationState] = createSignal<TranslationControllerState>(
		translationController.getState()
	);
	translationController.subscribe(setTranslationState);

	const draftController = new DraftController({
		onError: (message) => {
			setRecentErrorLog((prev) =>
				addRecentError(
					prev,
					createRecentError({
						code: 'language-tools.draft_error',
						subsystem: 'language-tools',
						severity: 'error',
						message
					})
				)
			);
		}
	});
	const [draftState, setDraftState] = createSignal<DraftControllerState>(
		draftController.getState()
	);
	draftController.subscribe(setDraftState);

	/**
	 * Phase 40: probe Chrome's built-in AI on the main thread (the Prompt API is
	 * document-context-only, so it can't be detected from the pipeline worker), then
	 * feed the controllers and merge the result into the capability snapshot used by
	 * the toolbar gate. Re-runnable so availability refreshes as models download.
	 */
	async function refreshLanguageToolsProbe(): Promise<void> {
		const result = await probeLanguageTools().catch(() => null);
		if (!result) return;
		translationController.setProbe(result);
		draftController.setProbe(result);
		setCapabilityProbeV2((prev) => (prev ? { ...prev, languageTools: result } : prev));
	}

	const [languageToolsPanelOpen, setLanguageToolsPanelOpen] = createSignal(false);

	const selectedAsrClip = createMemo<AsrClipTarget | null>(() => {
		for (const ref of selectedClipRefs()) {
			const track = timeline().find((item) => item.id === ref.trackId);
			if (!track) continue;
			const clip = track.clips.find((item) => item.id === ref.clipId);
			if (!clip || clip.kind === 'title' || !clip.sourceId) continue;
			const asset = assets().find((item) => item.sourceId === clip.sourceId);
			return {
				trackId: track.id,
				clipId: clip.id,
				timelineStartS: clip.start,
				durationS: clip.duration,
				fileName: asset?.fileName ?? clip.sourceId
			};
		}
		return null;
	});

	// ── Phase 33: Smart Reframe (experimental) ──
	// The controller spawns its dedicated analysis worker lazily on first use;
	// the pipeline worker only resolves the source File and applies keyframes.
	const reframeController = new ReframeController({
		spawnWorker: spawnSmartReframeWorker,
		onError: (message) => {
			setRecentErrorLog((prev) =>
				addRecentError(
					prev,
					createRecentError({
						code: 'smart_reframe.analysis_failed',
						subsystem: 'worker',
						severity: 'error',
						message
					})
				)
			);
		}
	});
	const [reframeState, setReframeState] = createSignal<ReframeControllerState>(
		reframeController.getState()
	);
	reframeController.subscribe(setReframeState);

	// Pending get-source-file round-trips to the pipeline worker, resolved in
	// handleState when the `source-file` / `source-file-error` message arrives.
	interface PendingSourceFile {
		resolve: (file: File) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}
	const pendingSourceFileRequests = new Map<string, PendingSourceFile>();
	let sourceFileRequestSeq = 0;
	/** Bound the wait so a dropped worker reply can't hang analysis at "resolving". */
	const SOURCE_FILE_TIMEOUT_MS = 30_000;

	/** Settle one pending request exactly once, clearing its timer + map entry. */
	function settleSourceFile(requestId: string, action: (pending: PendingSourceFile) => void): void {
		const pending = pendingSourceFileRequests.get(requestId);
		if (!pending) return;
		pendingSourceFileRequests.delete(requestId);
		clearTimeout(pending.timer);
		action(pending);
	}

	/** Reject every in-flight request (teardown / worker crash) so no Promise or
	 *  `File` handle leaks. */
	function drainPendingSourceFileRequests(reason: string): void {
		for (const [, pending] of pendingSourceFileRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error(reason));
		}
		pendingSourceFileRequests.clear();
	}

	function requestSourceFile(sourceId: string): Promise<File> {
		if (!bridge) return Promise.reject(new Error('Media pipeline is not ready.'));
		const requestId = `reframe-src-${sourceFileRequestSeq++}`;
		return new Promise<File>((resolve, reject) => {
			const timer = setTimeout(() => {
				settleSourceFile(requestId, (pending) =>
					pending.reject(new Error('Timed out resolving the source media for Smart Reframe.'))
				);
			}, SOURCE_FILE_TIMEOUT_MS);
			pendingSourceFileRequests.set(requestId, { resolve, reject, timer });
			bridge!.send({ type: 'get-source-file', requestId, sourceId });
		});
	}

	interface ReframeClipTarget {
		trackId: string;
		clipId: string;
		sourceId: string;
		hasKeyframes: boolean;
		sourceWidth: number;
		sourceHeight: number;
		rotationDeg: number;
		duration: number;
		inPoint: number;
	}

	const selectedReframeClip = createMemo<ReframeClipTarget | null>(() => {
		for (const ref of selectedClipRefs()) {
			const track = timeline().find((item) => item.id === ref.trackId);
			if (!track || track.type !== 'video') continue;
			const clip = track.clips.find((item) => item.id === ref.clipId);
			if (!clip || clip.kind === 'title' || !clip.sourceId) continue;
			const video = assets().find((item) => item.sourceId === clip.sourceId)?.video;
			if (!video) continue;
			// Rotation-aware dimensions (Phase 18): 90°/270° swap width and height.
			const rotation = (((video.rotationDeg ?? 0) % 360) + 360) % 360;
			const swap = rotation === 90 || rotation === 270;
			const kf = clip.keyframes;
			return {
				trackId: track.id,
				clipId: clip.id,
				sourceId: clip.sourceId,
				hasKeyframes: Boolean(kf?.x?.length || kf?.y?.length || kf?.scale?.length),
				sourceWidth: swap ? video.height : video.width,
				sourceHeight: swap ? video.width : video.height,
				rotationDeg: rotation,
				duration: clip.duration,
				inPoint: clip.inPoint
			};
		}
		return null;
	});

	const reframePanelClip = createMemo(() => {
		const clip = selectedReframeClip();
		return clip
			? { id: clip.clipId, trackId: clip.trackId, hasKeyframes: clip.hasKeyframes }
			: null;
	});

	/** Clip-local playhead time for the overlay preview, from the analysed clip. */
	const reframeOverlayTime = createMemo(() => {
		const ctx = reframeState().context;
		if (!ctx) return 0;
		const track = timeline().find((item) => item.id === ctx.trackId);
		const clip = track?.clips.find((item) => item.id === ctx.clipId);
		if (!clip) return 0;
		return clipLocalTime(clip, clock.currentTime()) ?? 0;
	});

	async function handleReframeAnalyse(settings: ReframeAnalyseSettings) {
		const clip = selectedReframeClip();
		if (!clip) return;
		pauseFromKeyboard();
		const targetAspectValue = REFRAME_ASPECT_VALUES[settings.targetAspect];
		const sourceAspect = clip.sourceHeight > 0 ? clip.sourceWidth / clip.sourceHeight : 1;
		const runId = reframeController.beginAnalysis({
			trackId: clip.trackId,
			clipId: clip.clipId,
			sourceAspect,
			targetAspectValue
		});
		let file: File;
		try {
			file = await requestSourceFile(clip.sourceId);
		} catch (error) {
			// Only surface the failure if this is still the current run — the user
			// may have cancelled or started another analysis while the File was in
			// flight (a stale resolve must not touch the newer run).
			if (reframeController.getState().context?.runId === runId) {
				reframeController.fail(error instanceof Error ? error.message : String(error));
			}
			return;
		}
		// The user may have cancelled or superseded this run during the (awaited)
		// File resolution; don't kick off analysis behind their back.
		if (reframeController.getState().context?.runId !== runId) return;
		await reframeController.runStart({
			type: 'reframe-start',
			clipId: clip.clipId,
			sourceFile: file,
			sourceRotation: clip.rotationDeg,
			sourceWidth: clip.sourceWidth,
			sourceHeight: clip.sourceHeight,
			targetAspect: targetAspectValue,
			clipDuration: clip.duration,
			inPoint: clip.inPoint,
			velocityBound: settings.velocityBound,
			accelerationBound: settings.accelerationBound,
			analysisFps: settings.analysisFps
		});
	}

	function handleReframeApply() {
		const state = reframeController.getState();
		if (!state.context || !state.result) return;
		bridge?.send({
			type: 'replace-keyframe-tracks',
			trackId: state.context.trackId,
			clipId: state.context.clipId,
			tracks: state.result,
			// The generated x/y translations only crop correctly under fill (R6.2a).
			fit: 'fill'
		});
		reframeController.discard();
		setStatusLine('Smart Reframe keyframes applied');
	}

	function findTimelineClip(ref: TimelineClipReference): TimelineClipSnapshot | null {
		const track = timeline().find((item) => item.id === ref.trackId);
		return track?.clips.find((clip) => clip.id === ref.clipId) ?? null;
	}

	const selectedClip = createMemo<SelectedClip | null>(() => {
		for (const ref of selectedClipRefs()) {
			const clip = findTimelineClip(ref);
			if (clip) {
				const sourceVideo = clip.sourceId
					? assets().find((asset) => asset.sourceId === clip.sourceId)?.video
					: undefined;
				const localTime = clipLocalTime(clip, clock.currentTime());
				return {
					trackId: ref.trackId,
					clipId: clip.id,
					kind: clip.kind,
					sourceId: clip.sourceId,
					sourceWidth: sourceVideo?.width,
					sourceHeight: sourceVideo?.height,
					start: clip.start,
					inPoint: clip.inPoint,
					duration: clip.duration,
					effects: sampleEffectsAt(clip.effects, clip.keyframes, localTime),
					transform: sampleTransformAt(clip.transform, clip.keyframes, localTime),
					keyframes: clip.keyframes,
					lut: clip.lut,
					skinMask: clip.skinMask,
					matte: clip.matte,
					timeRemap: clip.timeRemap,
					beauty: sampleBeautyAt(clip.beauty, clip.keyframes, localTime),
					captureSessionId: clip.captureSessionId,
					callout: clip.callout,
					paddedBackground: clip.paddedBackground
				};
			}
		}
		return null;
	});

	/** Phase 41 T13: timeline start (seconds) of any clip whose `captureSessionId`
	 *  matches the given session. For retakes this is the retake clip's offset;
	 *  for fresh captures it's typically 0. Null when no matching clip exists
	 *  (session discarded, sources still landing).
	 *
	 *  Plain function (not a memo) so the O(tracks×clips) scan runs only when
	 *  the panel actually needs it (on user Load/Insert click), not on every
	 *  `timeline()` mutation during recording. */
	function resolveSessionStartS(sessionId: string): number | null {
		for (const track of timeline()) {
			for (const clip of track.clips) {
				if (clip.captureSessionId === sessionId) return clip.start;
			}
		}
		return null;
	}

	const retakeSourceKinds = createMemo<CaptureSourceKind[]>(() => {
		const clipId = retakeClipId();
		if (!clipId) return [];
		let sessionId: string | undefined;
		const kinds: CaptureSourceKind[] = [];
		for (const track of timeline()) {
			for (const clip of track.clips) {
				if (clip.id === clipId) {
					sessionId = clip.captureSessionId;
					break;
				}
			}
			if (sessionId) break;
		}
		if (!sessionId) return [];
		for (const track of timeline()) {
			for (const clip of track.clips) {
				if (clip.captureSessionId !== sessionId) continue;
				const kind = captureKindFromSourceId(clip.sourceId);
				if (kind) kinds.push(kind);
			}
		}
		return kinds;
	});

	// Selecting a clip or transition is an edit intent: bring the Inspector tab
	// to the front. Keyed on identity (not the memo object, which is recreated
	// every timeline-state/playhead update) so the tab only switches on a new
	// selection, never while the user is browsing another tab.
	createEffect(
		on(
			() => selectedClip()?.clipId ?? selectedTransitionId(),
			(selectionId) => {
				if (selectionId) setActiveSideRailTab('inspector');
			},
			{ defer: true }
		)
	);

	const selectedClipFades = createMemo(() => {
		const clip = selectedClip();
		if (!clip) return null;
		const track = timeline().find((t) => t.id === clip.trackId);
		if (!track || track.type !== 'audio') return null;
		const timelineClip = track.clips.find((c) => c.id === clip.clipId);
		if (!timelineClip) return null;
		return {
			trackId: track.id,
			clipId: timelineClip.id,
			duration: timelineClip.duration,
			audioFadeIn: timelineClip.audioFadeIn,
			audioFadeOut: timelineClip.audioFadeOut
		};
	});

	const selectedTrackMix = createMemo(() => {
		const clip = selectedClip();
		if (!clip) return null;
		const track = timeline().find((t) => t.id === clip.trackId);
		if (!track || track.type !== 'audio') return null;
		return {
			trackId: track.id,
			gain: track.gain,
			pan: track.pan,
			muted: track.muted,
			solo: track.solo
		};
	});
	// Transform applies to video clips; pair it with the source's intrinsic size so
	// the gizmo/inspector can compute the fit rect. Audio clips have no transform UI.
	const selectedClipTransform = createMemo(() => {
		const clip = selectedClip();
		if (!clip) return null;
		const track = timeline().find((t) => t.id === clip.trackId);
		if (!track || track.type !== 'video') return null;
		const timelineClip = track.clips.find((c) => c.id === clip.clipId);
		if (!timelineClip) return null;
		const localTime = clipLocalTime(timelineClip, clock.currentTime());
		// Source-less overlays raster against a fixed 1920×1080 (16:9) card, so
		// the gizmo/inspector size them against that rather than a media asset.
		if (timelineClip.kind === 'title' || timelineClip.kind === 'callout') {
			return {
				trackId: track.id,
				clipId: timelineClip.id,
				transform: sampleTransformAt(timelineClip.transform, timelineClip.keyframes, localTime),
				sourceWidth: 1920,
				sourceHeight: 1080
			};
		}
		const asset = assets().find((a) => a.sourceId === timelineClip.sourceId);
		return {
			trackId: track.id,
			clipId: timelineClip.id,
			transform: sampleTransformAt(timelineClip.transform, timelineClip.keyframes, localTime),
			sourceWidth: asset?.video?.width ?? metadata()?.video?.width ?? 16,
			sourceHeight: asset?.video?.height ?? metadata()?.video?.height ?? 9
		};
	});

	// Text + style for a selected title clip; null for source clips (Phase 14).
	const selectedTitle = createMemo(() => {
		const clip = selectedClip();
		if (!clip) return null;
		const track = timeline().find((t) => t.id === clip.trackId);
		if (!track || track.type !== 'video') return null;
		const timelineClip = track.clips.find((c) => c.id === clip.clipId);
		if (!timelineClip || timelineClip.kind !== 'title' || !timelineClip.title) return null;
		return {
			trackId: track.id,
			clipId: timelineClip.id,
			title: timelineClip.title
		};
	});

	const hasTimeline = createMemo(
		() =>
			timeline().some((track) => track.clips.length > 0) ||
			captionTracks().some((track) => track.segments.length > 0)
	);

	const clock = createSharedClock(sab);

	const pipelineMode = createMemo<CapabilityTier>(() =>
		workerReady()
			? previewBackend() === 'core-webgpu'
				? 'accelerated'
				: 'limited'
			: deriveCapabilityTier(capabilities(), {
					workerReady: workerReady(),
					webgpuReady: webgpuAvailable(),
					runtimeIssue: runtimeIssue()
				})
	);

	const accelerated = () => previewBackend() === 'core-webgpu';
	const previewSurfaceAvailable = () => previewReady();
	const exportSurfaceAvailable = () => exportReady();
	const pipelineLabel = createMemo(() => {
		switch (previewBackend()) {
			case 'core-webgpu':
				return 'Accelerated';
			case 'compat-webgpu':
				return 'GPU compat';
			case 'canvas2d':
				return 'Limited WebCodecs';
			case 'none':
				if (pipelineMode() === 'starting') return 'Starting pipeline';
				if (pipelineMode() === 'blocked') return 'Blocked';
				return capabilityProbeV2()?.tier === 'shell-only' ? 'Shell only' : 'Limited shell';
		}
	});
	const compatibilityImportEnabled = () =>
		pipelineMode() === 'limited' &&
		(previewSurfaceAvailable() || canCompatibilityPreview(capabilities()));
	const importBlocked = () =>
		importing() ||
		pipelineMode() === 'blocked' ||
		pipelineMode() === 'starting' ||
		(pipelineMode() === 'limited' &&
			!previewSurfaceAvailable() &&
			!canCompatibilityPreview(capabilities()));
	const importHint = () =>
		importBlocked()
			? importUnavailableReason(pipelineMode(), capabilities(), {
					workerReady: workerReady(),
					webgpuReady: webgpuAvailable(),
					runtimeIssue: runtimeIssue()
				})
			: pipelineMode() === 'limited' && previewSurfaceAvailable()
				? 'Loads media into the reduced client-side preview/export path.'
				: compatibilityImportEnabled()
					? 'Loads a reduced compatibility thumbnail for inspection.'
					: null;
	const limitedIssue = () =>
		primaryLimitedIssue(capabilities(), {
			workerReady: workerReady(),
			webgpuReady: webgpuAvailable(),
			runtimeIssue: runtimeIssue()
		});
	// Phase 46: capture needs MediaStreamTrackProcessor + getDisplayMedia and a
	// running pipeline worker; crossOriginIsolated is NOT required (R0.8).
	const replayCaptureSupported = () =>
		workerReady() &&
		probeMediaStreamTrackProcessor() &&
		typeof navigator !== 'undefined' &&
		typeof navigator.mediaDevices?.getDisplayMedia === 'function';
	const replayCaptureUnsupportedReason = () => {
		if (!probeMediaStreamTrackProcessor()) {
			return 'Replay Buffer requires MediaStreamTrackProcessor (a recent Chromium browser).';
		}
		if (
			typeof navigator === 'undefined' ||
			typeof navigator.mediaDevices?.getDisplayMedia !== 'function'
		) {
			return 'Replay Buffer requires screen capture (getDisplayMedia) in a secure context.';
		}
		if (!workerReady()) return 'Replay Buffer is unavailable until the pipeline worker is ready.';
		return null;
	};
	const diagnosticSources = createMemo<DiagnosticSourceInput[]>(() => [
		...assets(),
		...unresolvedSources().map((source) => ({ ...source, offline: true }))
	]);
	const interpolationDiagnostic = createMemo<InterpolationDiagnosticSummary>(() => {
		const availability = interpolationAvailability();
		return {
			available: availability.state !== 'unavailable',
			accelerator: availability.state === 'unavailable' ? null : availability.accelerator,
			modelStatus: interpolationModelStatus(),
			modelSizeBytes: interpolationModelSizeBytes(),
			cacheSource: interpolationModelCacheSource(),
			lastEstimateMs: interpolationEstimateMs(),
			lastActualMs: null,
			lastRefusals: interpolationRefusals(),
			recentErrors: interpolationRecentErrors()
		};
	});

	function recordInterpolationError(message: string): void {
		setInterpolationRecentErrors((current) => [message, ...current].slice(0, 5));
	}

	async function refreshDiagnostics(workerSnapshot?: DiagnosticSnapshot | null) {
		const snapshot = await buildUiDiagnosticSnapshot({
			capabilities: capabilities(),
			tier: pipelineMode(),
			runtimeIssue: runtimeIssue() ?? audioWarning(),
			webgpuReady: webgpuAvailable(),
			exportSettings: exportSettings(),
			assets: assets(),
			recentErrors: workerSnapshot?.recentErrors ?? recentErrorLog(),
			workerSnapshot,
			asr: { engine: asrState().engine, accelerator: asrState().accelerator },
			voiceCleanup: {
				denoiserEnabledTrackCount: voiceCleanupSettings().denoiserEnabledTracks.length,
				wasmLoadStatus:
					voiceCleanupDenoiserStatus() === 'ready'
						? 'loaded'
						: voiceCleanupDenoiserStatus() === 'loading'
							? 'loading'
							: voiceCleanupDenoiserStatus() === 'unavailable'
								? 'error'
								: 'not-loaded',
				wasmLoadTimeMs: voiceCleanupWasmLoadTimeMs(),
				wasmSha256: voiceCleanupWasmSha256(),
				unavailableReason: voiceCleanupDenoiserUnavailableReason(),
				workletLatencyMs: voiceCleanupMonitorLatencyMs(),
				normalisationTargetLufs: voiceCleanupSettings().normalisationTargetLufs,
				normaliseGainDb: voiceCleanupSettings().normaliseGainDb,
				limiterCeilingDbtp: voiceCleanupSettings().limiterCeilingDbtp
			},
			interpolation: interpolationDiagnostic()
		});
		setDiagnosticSnapshot(snapshot);
	}

	function openDiagnostics() {
		setDiagnosticsPanelOpen(true);
		void refreshDiagnostics();
		if (bridge) {
			const requestId =
				typeof crypto !== 'undefined' && 'randomUUID' in crypto
					? crypto.randomUUID()
					: `diag-${Date.now()}`;
			bridge.send({ type: 'request-diagnostic-snapshot', requestId });
		}
	}

	// The user guide is a history-backed view layered over the editor; the
	// editor stays mounted (worker, timeline, autosave all keep running) and is
	// made inert while the docs cover it (via the declarative `inert` attribute
	// on the app shell div below).
	let docsReturnFocus: HTMLElement | null = null;

	function openDocs(slug: string = DOCS_INDEX_SLUG) {
		if (docsSlug() === null) {
			docsReturnFocus =
				document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}
		const path = docsPath(slug);
		if (window.location.pathname !== path) window.history.pushState(null, '', path);
		setDocsSlug(slug);
	}

	function closeDocs() {
		if (parseDocsPath(window.location.pathname) !== null) {
			window.history.pushState(null, '', '/');
		}
		setDocsSlug(null);
		const target = docsReturnFocus;
		docsReturnFocus = null;
		// `setDocsSlug(null)` triggers a synchronous Solid update that removes
		// `inert` from the editor shell; queue the focus so it runs after that flush.
		queueMicrotask(() => target?.focus());
	}

	function clearCompatibilityPreview() {
		const preview = compatibilityPreview();
		if (preview) preview.revoke();
		setCompatibilityPreview(null);
	}

	// Phase 46: the main thread owns the MediaStream (getDisplayMedia needs a
	// user gesture and tracks can't leave this thread); the frame/audio streams
	// are transferred to the pipeline worker, which encodes into the ring buffer.
	let replayCaptureStream: MediaStream | null = null;

	function releaseReplayCaptureStream() {
		if (!replayCaptureStream) return;
		stopCaptureStreams(replayCaptureStream);
		replayCaptureStream = null;
	}

	async function startReplayCapture() {
		if (replayCaptureStream || captureSession()?.active) return;
		try {
			const streams = await startCapture('display');
			replayCaptureStream = streams.mediaStream;
			// The browser's own "Stop sharing" ends the track; mirror it as a stop.
			const lifetimeTrack =
				streams.mediaStream.getVideoTracks()[0] ?? streams.mediaStream.getAudioTracks()[0];
			lifetimeTrack?.addEventListener('ended', () => stopReplayCapture(), { once: true });
			const transfer: Transferable[] = [];
			if (streams.videoStream) transfer.push(streams.videoStream);
			if (streams.audioStream) transfer.push(streams.audioStream);
			bridge?.send(
				{
					type: 'replay-capture-transfer-streams',
					videoStream: streams.videoStream,
					audioStream: streams.audioStream,
					settings: {
						source: 'display',
						sourceLabel: streams.sourceLabel,
						width: streams.videoTrackSettings?.width,
						height: streams.videoTrackSettings?.height,
						frameRate: streams.videoTrackSettings?.frameRate
					}
				},
				transfer
			);
		} catch (error) {
			releaseReplayCaptureStream();
			// Dismissing the browser's share picker surfaces as NotAllowedError;
			// treat it like a cancel rather than a failure.
			const dismissed =
				isAbortError(error) || (error instanceof DOMException && error.name === 'NotAllowedError');
			if (!dismissed) {
				const message = error instanceof Error ? error.message : String(error);
				setStatusLine(`Capture failed: ${message}`);
			}
		}
	}

	function stopReplayCapture() {
		bridge?.send({ type: 'replay-capture-stop' });
		releaseReplayCaptureStream();
	}

	const programModeSupport = createMemo<FeatureSupport>(
		() => capabilityProbeV2()?.programMode ?? 'unsupported'
	);

	const programBudgetUsage = createMemo(() => {
		const pendingVideo = programSources().filter(
			(source) => source.kind === 'screen' || source.kind === 'webcam'
		).length;
		const activeVideo = programSourceStatus().filter(
			(source) => source.kind === 'screen' || source.kind === 'webcam'
		).length;
		const max = budgetSessionsForProbe(
			capabilityProbeV2()?.livePublish.hardwareH264Encode === 'supported'
		);
		return {
			active: (publishBusy() ? 1 : 0) + Math.max(pendingVideo, activeVideo),
			max
		};
	});

	function makeProgramId(prefix: string): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? `${prefix}-${crypto.randomUUID()}`
			: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function sanitizedProgramSources(): ProgramSourceDescriptor[] {
		return [...programSourceHandles.values()].map(({ descriptor }) => ({
			...descriptor,
			track: null,
			encoderConfig: descriptor.encoderConfig ? { ...descriptor.encoderConfig } : null
		}));
	}

	function refreshProgramSourceList(): void {
		setProgramSources(sanitizedProgramSources());
	}

	function programVideoSources(): ProgramSourceDescriptor[] {
		return [...programSourceHandles.values()]
			.map(({ descriptor }) => descriptor)
			.filter((source) => source.kind === 'screen' || source.kind === 'webcam');
	}

	function programLayerForSource(source: ProgramSourceDescriptor, zIndex: number): SceneLayer {
		return {
			sourceRef: source.sourceId,
			transform: { ...DEFAULT_PROGRAM_LAYER_TRANSFORM },
			visible: true,
			zIndex
		};
	}

	function syncProgramScenes(next: SceneDefinition[]): SceneDefinition[] {
		bridge?.send({ type: 'program-update-scenes', scenes: next });
		return next;
	}

	function updateProgramScenes(mutator: (scenes: SceneDefinition[]) => SceneDefinition[]): void {
		setProgramScenes((prev) => syncProgramScenes(mutator(prev)));
	}

	function ensureProgramSceneForSource(source: ProgramSourceDescriptor): void {
		if (source.kind !== 'screen' && source.kind !== 'webcam') return;
		updateProgramScenes((prev) => {
			if (prev.length === 0) {
				return [
					{
						id: makeProgramId('scene'),
						name: 'Scene 1',
						hotkey: '1',
						layers: [programLayerForSource(source, 0)]
					}
				];
			}
			return prev.map((scene) => ({
				...scene,
				layers: scene.layers.some((layer) => layer.sourceRef === source.sourceId)
					? scene.layers
					: [...scene.layers, programLayerForSource(source, scene.layers.length)]
			}));
		});
	}

	function stopProgramWriter(): void {
		programWriterWorker?.terminate();
		programWriterWorker = null;
	}

	function releaseActiveProgramMonitorTracks(): void {
		for (const track of activeProgramMonitorTracks.values()) {
			track.stop();
		}
		activeProgramMonitorTracks = new Map();
	}

	function releasePendingProgramSources(stopTracks = true): void {
		if (stopTracks) {
			for (const { descriptor, monitorTrack } of programSourceHandles.values()) {
				descriptor.track?.stop();
				monitorTrack?.stop();
			}
		}
		programSourceHandles = new Map();
		refreshProgramSourceList();
	}

	function removeProgramSource(sourceId: string): void {
		const handle = programSourceHandles.get(sourceId);
		handle?.descriptor.track?.stop();
		handle?.monitorTrack?.stop();
		programSourceHandles.delete(sourceId);
		activeProgramMonitorTracks.get(sourceId)?.stop();
		activeProgramMonitorTracks.delete(sourceId);
		refreshProgramSourceList();
		updateProgramScenes((prev) =>
			prev.map((scene) => ({
				...scene,
				layers: scene.layers.filter((layer) => layer.sourceRef !== sourceId)
			}))
		);
	}

	function addProgramSource(
		descriptor: ProgramSourceDescriptor,
		monitorTrack?: MediaStreamTrack
	): void {
		programSourceHandles.set(descriptor.sourceId, { descriptor, monitorTrack });
		refreshProgramSourceList();
		ensureProgramSceneForSource(descriptor);
	}

	function videoConfigForTrack(track: MediaStreamTrack): VideoEncoderConfig {
		const settings = track.getSettings();
		return {
			codec: 'avc1.42001E',
			width: settings.width ?? 1920,
			height: settings.height ?? 1080,
			bitrate: 5_000_000,
			framerate: settings.frameRate,
			latencyMode: 'realtime',
			hardwareAcceleration: 'prefer-hardware'
		};
	}

	function audioConfigForTrack(track: MediaStreamTrack): AudioEncoderConfig {
		const settings = track.getSettings();
		return {
			codec: 'opus',
			sampleRate: settings.sampleRate ?? 48_000,
			numberOfChannels: settings.channelCount ?? 2,
			bitrate: 128_000
		};
	}

	async function addProgramScreen(): Promise<void> {
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
			const track = stream.getVideoTracks()[0];
			if (!track) throw new Error('Screen picker returned no video track.');
			const sourceId = makeProgramId('screen');
			const monitorTrack = track.clone();
			monitorTrack.addEventListener('ended', () => removeProgramSource(sourceId), { once: true });
			addProgramSource(
				{
					sourceId,
					kind: 'screen',
					label: track.label || 'Screen',
					track,
					encoderConfig: videoConfigForTrack(track)
				},
				monitorTrack
			);
			setProgramError(null);
		} catch (error) {
			if (
				isAbortError(error) ||
				(error instanceof DOMException && error.name === 'NotAllowedError')
			) {
				return;
			}
			setProgramError(error instanceof Error ? error.message : String(error));
		}
	}

	async function addProgramCamera(deviceId: string): Promise<void> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId } } : true,
				audio: false
			});
			const track = stream.getVideoTracks()[0];
			if (!track) throw new Error('Camera capture returned no video track.');
			const sourceId = makeProgramId('camera');
			const monitorTrack = track.clone();
			monitorTrack.addEventListener('ended', () => removeProgramSource(sourceId), { once: true });
			addProgramSource(
				{
					sourceId,
					kind: 'webcam',
					label: track.label || 'Camera',
					track,
					encoderConfig: videoConfigForTrack(track)
				},
				monitorTrack
			);
			setProgramError(null);
		} catch (error) {
			if (
				isAbortError(error) ||
				(error instanceof DOMException && error.name === 'NotAllowedError')
			) {
				return;
			}
			setProgramError(error instanceof Error ? error.message : String(error));
		}
	}

	async function addProgramMic(deviceId: string): Promise<void> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: deviceId ? { deviceId: { exact: deviceId } } : true,
				video: false
			});
			const track = stream.getAudioTracks()[0];
			if (!track) throw new Error('Microphone capture returned no audio track.');
			const sourceId = makeProgramId('mic');
			const monitorTrack = track.clone();
			monitorTrack.addEventListener('ended', () => removeProgramSource(sourceId), { once: true });
			addProgramSource(
				{
					sourceId,
					kind: 'mic',
					label: track.label || 'Microphone',
					track,
					encoderConfig: audioConfigForTrack(track)
				},
				monitorTrack
			);
			setProgramError(null);
		} catch (error) {
			if (
				isAbortError(error) ||
				(error instanceof DOMException && error.name === 'NotAllowedError')
			) {
				return;
			}
			setProgramError(error instanceof Error ? error.message : String(error));
		}
	}

	function addProgramScene(): void {
		updateProgramScenes((prev) => {
			if (prev.length >= 9) return prev;
			const sources = programVideoSources();
			const index = prev.length;
			return [
				...prev,
				{
					id: makeProgramId('scene'),
					name: `Scene ${index + 1}`,
					hotkey: index < 9 ? (`${index + 1}` as SceneDefinition['hotkey']) : null,
					layers: sources.map((source, sourceIndex) => programLayerForSource(source, sourceIndex))
				}
			];
		});
	}

	function removeProgramScene(sceneId: string): void {
		updateProgramScenes((prev) => prev.filter((scene) => scene.id !== sceneId));
	}

	function renameProgramScene(sceneId: string, name: string): void {
		updateProgramScenes((prev) =>
			prev.map((scene) =>
				scene.id === sceneId ? { ...scene, name: name.trim() || scene.name } : scene
			)
		);
	}

	function setProgramSceneHotkey(sceneId: string, hotkey: string | null): void {
		const nextHotkey = /^[1-9]$/.test(hotkey ?? '') ? (hotkey as SceneDefinition['hotkey']) : null;
		updateProgramScenes((prev) =>
			prev.map((scene) => ({
				...scene,
				hotkey:
					scene.id === sceneId ? nextHotkey : scene.hotkey === nextHotkey ? null : scene.hotkey
			}))
		);
	}

	function updateProgramSceneLayers(sceneId: string, layers: SceneLayer[]): void {
		updateProgramScenes((prev) =>
			prev.map((scene) => (scene.id === sceneId ? { ...scene, layers } : scene))
		);
	}

	function startProgramSession(initialSceneId: string): void {
		if (!bridge) {
			setProgramError('Pipeline worker is not ready.');
			return;
		}
		const sources = [...programSourceHandles.values()].map(({ descriptor }) => descriptor);
		if (sources.length === 0 || programScenes().length === 0) return;
		stopProgramWriter();
		releaseActiveProgramMonitorTracks();
		const writerWorker = new CaptureWriterWorker();
		const { port1, port2 } = new MessageChannel();
		writerWorker.postMessage({ type: 'init', port: port1 }, [port1]);
		programWriterWorker = writerWorker;
		const transfer: Transferable[] = [port2];
		for (const source of sources) {
			if (source.track) transfer.push(source.track as unknown as Transferable);
		}
		bridge.send(
			{
				type: 'program-start',
				config: {
					scenes: programScenes(),
					initialSceneId,
					sources,
					chunkTargetS: 2,
					transitionMs: programTransitionMs()
				},
				writerPort: port2
			},
			transfer
		);
		setProgramSessionState('armed');
		setProgramActiveSceneId(initialSceneId);
		setProgramSourceStatus([]);
		setProgramError(null);
		const monitorEntries: [string, MediaStreamTrack][] = [];
		for (const [sourceId, handle] of programSourceHandles.entries()) {
			if (handle.monitorTrack) monitorEntries.push([sourceId, handle.monitorTrack]);
		}
		activeProgramMonitorTracks = new Map(monitorEntries);
		releasePendingProgramSources(false);
	}

	function stopProgramSession(): void {
		bridge?.send({ type: 'program-stop' });
		setProgramSessionState('stopping');
	}

	function switchProgramScene(sceneId: string): void {
		setProgramActiveSceneId(sceneId);
		bridge?.send({ type: 'program-scene-switch', sceneId, transitionMs: programTransitionMs() });
	}

	function handleAddCallout(payload: CalloutPayload, transform?: Partial<TransformParamsSnapshot>) {
		bridge?.send({
			type: 'add-callout',
			start: Math.max(0, clock.currentTime()),
			payload,
			transform
		});
		setStatusLine('Callout added');
	}

	function requestPreviewRegionPick(onPick: (x: number, y: number) => void): void {
		setCalloutPlacementActive(false);
		setPreviewRegionPickHandler(() => onPick);
	}

	function beginCalloutPlacement(kind: CalloutKind): void {
		setPreviewRegionPickHandler(null);
		setCalloutPlacementKind(kind);
		setCalloutPlacementActive(true);
	}

	function endCalloutPlacement(): void {
		setCalloutToolActive(false);
		setCalloutPlacementActive(false);
	}

	function completeCalloutPlacement(
		kind: CalloutKind,
		startX: number,
		startY: number,
		endX: number,
		endY: number
	): void {
		const cx = (startX + endX) * 0.5;
		const cy = (startY + endY) * 0.5;
		const w = Math.max(0.05, Math.abs(endX - startX));
		const h = Math.max(0.05, Math.abs(endY - startY));
		const placementTransform: Partial<TransformParamsSnapshot> = {
			x: cx - 0.5,
			y: cy - 0.5,
			scale: Math.max(w, h),
			fit: 'fit'
		};
		let geometry: CalloutGeometry;
		if (kind === 'arrow') {
			geometry = { kind: 'arrow', x1: startX, y1: startY, x2: endX, y2: endY };
		} else if (kind === 'box') {
			geometry = {
				kind: 'box',
				x: Math.min(startX, endX),
				y: Math.min(startY, endY),
				w: Math.abs(endX - startX),
				h: Math.abs(endY - startY)
			};
		} else if (kind === 'step') {
			geometry = { kind: 'step', cx: startX, cy: startY, r: 0.05, number: 1 };
		} else {
			geometry = { kind };
		}
		handleAddCallout(
			{
				calloutKind: kind,
				geometry,
				style: {
					color: '#FFD700',
					strokeWidth: 3,
					fillOpacity: kind === 'spotlight' ? 0.15 : 0,
					fontSize: 28,
					arrowheadSize: 14,
					blurRadius: 12,
					darkenStrength: 0.7
				}
			},
			kind === 'spotlight' || kind === 'blur' ? placementTransform : undefined
		);
		endCalloutPlacement();
	}

	function handleState(msg: WorkerStateMessage) {
		// Publish tap messages route to the controller (it owns the track/frames).
		if (publishController.handleWorkerMessage(msg)) return;
		switch (msg.type) {
			case 'capability-probe-v2':
				setCapabilityProbeV2(msg.result);
				setExportCodecs([...exportConstraintsForProbe(msg.result)]);
				cleanupController.setCleanupProbe(msg.result.cleanup ?? null);
				asrController.setProbe();
				// Phase 40: language-tools availability is probed on the main thread
				// (see refreshLanguageToolsProbe) — never sourced from the worker.
				void refreshLanguageToolsProbe();
				break;
			case 'clip-audio':
			case 'clip-audio-error':
				cleanupController.handlePipelineMessage(msg);
				asrController.handlePipelineMessage(msg);
				break;
			case 'source-file':
				settleSourceFile(msg.requestId, (pending) => pending.resolve(msg.file));
				break;
			case 'source-file-error':
				settleSourceFile(msg.requestId, (pending) => pending.reject(new Error(msg.message)));
				break;
			case 'audio-cleanup-applied':
				cleanupController.handlePipelineMessage(msg);
				setStatusLine(
					msg.ok
						? 'Cleaned audio asset applied'
						: `Audio cleanup failed: ${msg.message ?? 'unknown error'}`
				);
				break;
			case 'matte-status':
				setMatteStatus(msg.status);
				break;
			case 'interp-availability':
				setInterpolationAvailability(msg.availability);
				break;
			case 'interp-model-status':
				setInterpolationModelStatus(msg.status);
				if (msg.sizeBytes !== undefined) setInterpolationModelSizeBytes(msg.sizeBytes);
				if (msg.source) setInterpolationModelCacheSource(msg.source);
				if (msg.error) recordInterpolationError(msg.error);
				break;
			case 'interp-estimate-result':
				setInterpolationEstimateMs(msg.estimateMs);
				break;
			case 'interp-progress':
				setStatusLine(
					`Frame interpolation · ${Math.round(msg.fraction * 100)}% (${msg.processedFrames}/${msg.totalFrames})`
				);
				break;
			case 'interp-preview-ready':
				setStatusLine(
					`Frame interpolation preview ready · ${msg.segment.startS.toFixed(2)}-${msg.segment.endS.toFixed(2)}s`
				);
				break;
			case 'interp-refusal':
				setInterpolationRefusals((count) => count + 1);
				recordInterpolationError(
					`Refused ${msg.reason} at ${msg.range.startS.toFixed(2)}-${msg.range.endS.toFixed(2)}s`
				);
				break;
			case 'interp-cancelled':
				setStatusLine('Frame interpolation canceled');
				break;
			case 'interp-error':
				recordInterpolationError(msg.message);
				setStatusLine(`Frame interpolation unavailable: ${msg.message}`);
				break;
			case 'beauty-model-status':
				setBeautyModelStatus(msg.status);
				if (msg.sizeBytes !== undefined) setBeautyModelSizeBytes(msg.sizeBytes);
				if (msg.downloadedBytes !== undefined) setBeautyModelDownloadedBytes(msg.downloadedBytes);
				if (msg.error) setBeautyModelError(msg.error);
				else if (msg.status === 'loaded' || msg.status === 'not-loaded') setBeautyModelError(null);
				break;
			case 'beauty-runtime-status':
				// Display-only; the model-load status drives Inspector gating.
				if (msg.reason) setBeautyModelError(msg.reason);
				break;
			case 'asr-caption-track-created':
				asrController.handlePipelineMessage(msg);
				setStatusLine(`Auto-caption track "${msg.track.name}" created`);
				break;
			case 'time-remap-error':
				setRuntimeIssue(`Speed ramp failed: ${msg.reason}`);
				break;
			case 'time-remap-updated':
				setStatusLine(`Speed ramp applied (new duration: ${msg.outputDurationS.toFixed(2)}s)`);
				setRuntimeIssue(null);
				break;
			case 'translated-caption-track-created':
				translationController.onTranslatedTrackCreated(msg.trackId);
				break;
			case 'translated-caption-track-error':
				translationController.onTranslatedTrackError?.(msg.reason, msg.message);
				setRuntimeIssue(msg.message);
				break;
			case 'look-preset-exported': {
				const blob = new Blob([msg.json], { type: 'application/json' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `${msg.clipId.slice(0, 8)}-look.json`;
				a.click();
				URL.revokeObjectURL(url);
				setStatusLine(
					msg.lutFileName
						? `Look preset exported (paired LUT: ${msg.lutFileName})`
						: 'Look preset exported'
				);
				break;
			}
			case 'look-preset-error':
				setRuntimeIssue(`Look preset import failed: ${msg.reason}`);
				break;
			case 'clock-update':
				// Reduced tiers without SAB: the worker drives the clock over postMessage.
				clock.applyUpdate(msg);
				break;
			case 'ready':
				setWorkerReady(true);
				setWebgpuAvailable(msg.webgpu);
				setPreviewBackend(msg.previewBackend);
				setExportBackend(msg.exportBackend);
				setPreviewReady(msg.previewReady);
				setExportReady(msg.exportReady);
				// A fresh worker has republished its authoritative clock reset; re-attach
				// the read-side that handleWorkerCrash detached.
				clock.setActive(true);
				if (recoveryMachine.state !== 'running') {
					awaitingRestartReady = false;
					recoveryMachine.recordRestartSuccess();
					setWorkerRecoveryState('running');
				}
				if (msg.previewBackend === 'canvas2d') {
					setRuntimeIssue(
						'Limited WebCodecs tier active. Preview/export use a reduced worker Canvas2D backend.'
					);
				} else if (msg.previewBackend === 'compat-webgpu') {
					setRuntimeIssue(
						'Compatibility GPU tier active. Preview/export use a reduced GPU backend.'
					);
				} else if (!msg.webgpu) {
					setRuntimeIssue(
						msg.gpuUnavailableReason ??
							'WebGPU is unavailable in this browser. Accelerated import, playback, effects, and export require a WebGPU-capable Chromium browser.'
					);
				} else {
					setRuntimeIssue(null);
				}
				setStatusLine(
					msg.previewBackend === 'core-webgpu'
						? `Pipeline ready · WebGPU (${msg.features.join(', ') || 'default'})`
						: msg.previewBackend === 'compat-webgpu'
							? 'Compatibility GPU ready · reduced effects/export'
							: msg.previewBackend === 'canvas2d'
								? 'Limited WebCodecs ready · Canvas2D preview/export'
								: `Limited shell · ${msg.gpuUnavailableReason ?? 'preview unavailable'}`
				);
				bridge?.send({ type: 'interp-probe' });
				break;
			case 'import-progress':
				setImporting(true);
				setStatusLine(msg.stage === 'reading' ? 'Reading file…' : 'Extracting metadata…');
				break;
			case 'import-complete':
				setImporting(false);
				clearCompatibilityPreview();
				setRestoreOffer(null);
				setUnresolvedSources([]);
				setMetadata(msg.metadata);
				setPreviewLabel(null);
				// Do NOT clear the timeline here: the worker posts `timeline-state` (with
				// the new track for this import) *before* `import-complete`, so clearing
				// it now would erase the snapshot that just arrived.
				// Duration is written to the shared clock by the worker; the rAF reader
				// in createSharedClock() surfaces it. Main thread never writes the SAB.
				setStatusLine(`Loaded ${msg.metadata.fileName}`);
				break;
			case 'timeline-state': {
				setTimeline(msg.timeline);
				setCaptionTracks(msg.captionTracks);
				setSessionEventLogs(msg.sessionEventLogs);
				setTransitions(msg.transitions);
				setMarkers(msg.markers);
				setMasterGain(msg.masterGain);
				audioEngine.setMasterGain(msg.masterGain);
				const nextCaptionTrackId = msg.captionTracks.some(
					(track) => track.id === selectedCaptionTrackId()
				)
					? selectedCaptionTrackId()
					: (msg.captionTracks[0]?.id ?? null);
				setSelectedClipRefs((prev) => {
					const live = new Set<string>();
					for (const track of msg.timeline) {
						for (const clip of track.clips) live.add(`${track.id}:${clip.id}`);
					}
					return prev.filter((ref) => live.has(`${ref.trackId}:${ref.clipId}`));
				});
				setSelectedCaptionTrackId(nextCaptionTrackId);
				setSelectedCaptionSegmentIds((prev) => {
					const live = new Set(
						msg.captionTracks
							.filter((track) => track.id === nextCaptionTrackId)
							.flatMap((track) => track.segments.map((segment) => segment.id))
					);
					const next = prev.filter((id) => live.has(id));
					const first = live.values().next().value as string | undefined;
					return next.length > 0 ? next : first ? [first] : [];
				});
				break;
			}
			case 'caption-import-result':
				setCaptionDiagnostics([...msg.result.diagnostics]);
				setSelectedCaptionTrackId(msg.result.track.id);
				setActiveSideRailTab('captions');
				setSelectedCaptionSegmentIds(
					msg.result.track.segments[0] ? [msg.result.track.segments[0].id] : []
				);
				setStatusLine(
					msg.result.diagnostics.length > 0
						? `Imported captions with ${msg.result.diagnostics.length} diagnostic${msg.result.diagnostics.length === 1 ? '' : 's'}`
						: 'Imported captions'
				);
				break;
			case 'caption-custom-presets-updated':
				setCustomAnimCaptionPresets([...msg.presets]);
				break;
			case 'caption-custom-preset-import-failed':
				setStatusLine(`Preset import failed: ${msg.field} — ${msg.message}`);
				break;
			case 'caption-export-result':
				for (const file of msg.files) {
					downloadTextFile(file.fileName, file.mimeType, file.content);
				}
				setStatusLine(
					`Exported ${msg.files.length} caption file${msg.files.length === 1 ? '' : 's'}`
				);
				break;
			case 'interchange-result':
				void saveTextFile(
					msg.suggestedName,
					msg.format === 'otio' ? 'application/json' : 'text/plain',
					msg.text
				).catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					setInterchangeMessage(`Save failed: ${message}`);
					setStatusLine(`Interchange save failed: ${message}`);
				});
				setInterchangeWarnings(msg.warnings);
				setInterchangeMessage(
					msg.warnings.length > 0
						? `Exported ${msg.suggestedName} with ${msg.warnings.length} warning${msg.warnings.length === 1 ? '' : 's'}`
						: `Exported ${msg.suggestedName}`
				);
				setStatusLine(`Exported ${msg.suggestedName}`);
				break;
			case 'interchange-error':
				setInterchangeWarnings([]);
				setInterchangeMessage(`Export failed: ${msg.message}`);
				setStatusLine(`Interchange export failed: ${msg.message}`);
				break;
			case 'history-state':
				setHistoryState({ canUndo: msg.canUndo, canRedo: msg.canRedo });
				break;
			case 'media-assets': {
				setAssets(msg.assets);
				setLatestHealthReport((prev) =>
					prev && msg.assets.some((asset) => asset.sourceId === prev.sourceId) ? null : prev
				);
				// Free bitmaps for assets that left the bin.
				const live = new Set(msg.assets.map((asset) => asset.sourceId));
				for (const id of thumbnailStore.sourceIds()) {
					if (!live.has(id)) thumbnailStore.clearSource(id);
				}
				// Removing the last asset leaves no active media: clear the stale
				// metadata so the preview-empty state and disabled export reflect reality.
				if (msg.assets.length === 0 && !hasTimeline()) {
					setMetadata(null);
					setSelectedClipRefs([]);
				}
				setThumbnailVersion((v) => v + 1);
				break;
			}
			case 'thumbnail':
				thumbnailStore.set(msg.sourceId, msg.timestamp, {
					bitmap: msg.bitmap,
					width: msg.width,
					height: msg.height
				});
				setThumbnailVersion((v) => v + 1);
				break;
			case 'restore-available':
				setRestoreOffer({
					projectId: msg.projectId,
					savedAt: msg.savedAt,
					sources: msg.sources
				});
				setStatusLine(`Autosave available · ${formatSavedAt(msg.savedAt)}`);
				break;
			case 'restore-result':
				setRestoreOffer(null);
				setLatestHealthReport(null);
				setUnresolvedSources(msg.unresolvedSources);
				setStatusLine(msg.message);
				if (msg.metadata) {
					clearCompatibilityPreview();
					setMetadata(msg.metadata);
				} else {
					clearCompatibilityPreview();
					setMetadata(null);
					setWaveformPeaks({});
					if (!msg.restored) {
						setSelectedClipRefs([]);
					}
				}
				break;
			case 'relink-result':
				setUnresolvedSources(msg.unresolvedSources);
				setLatestHealthReport(null);
				setStatusLine(msg.message);
				if (msg.ok && msg.metadata) {
					setMetadata(msg.metadata);
					clearCompatibilityPreview();
				}
				break;
			case 'preview-resolution':
				setPreviewLabel(msg.resolution.label);
				setPreviewSize({ width: msg.resolution.width, height: msg.resolution.height });
				break;
			case 'probe-result':
				setEncodeFps(msg.probe.encodeFps);
				break;
			case 'waveform-peaks':
				setWaveformPeaks((prev) => ({
					...prev,
					[`${msg.trackId}:${msg.clipId}`]: msg.peaks
				}));
				break;
			case 'export-codecs':
				setExportCodecs(msg.supported);
				setExportSettings(msg.settings);
				break;
			case 'export-progress':
				setExporting(true);
				setExportError(null);
				setExportResult(null);
				setExportProgress(msg.progress);
				setStatusLine(
					`Exporting ${msg.progress.codec.toUpperCase()} ${msg.progress.container.toUpperCase()} · ${Math.round(msg.progress.percent * 100)}%`
				);
				break;
			case 'export-complete':
				setExporting(false);
				setExportProgress(null);
				setExportError(null);
				setExportResult(`Exported ${msg.fileName}`);
				setStatusLine(`Export complete · ${msg.mimeType}`);
				break;
			case 'export-download-ready': {
				const url = URL.createObjectURL(msg.blob);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = msg.fileName;
				anchor.rel = 'noopener';
				document.body.append(anchor);
				anchor.click();
				anchor.remove();
				setTimeout(() => URL.revokeObjectURL(url), 10_000);
				setExporting(false);
				setExportProgress(null);
				setExportError(null);
				setExportResult(`Exported ${msg.fileName}`);
				setStatusLine(`Export ready · ${msg.mimeType}`);
				break;
			}
			case 'export-warning':
				setExportWarnings((warnings) => [...warnings, msg.message]);
				setStatusLine(`Export warning: ${msg.message}`);
				break;
			case 'export-canceled':
				setExporting(false);
				setExportProgress(null);
				setExportError(null);
				setExportWarnings([]);
				setExportResult('Export canceled');
				setStatusLine('Export canceled');
				break;
			case 'export-error':
				setExporting(false);
				setExportProgress(null);
				setExportResult(null);
				setExportError(msg.message);
				setExportWarnings([]);
				setStatusLine(`Export failed: ${msg.message}`);
				break;
			case 'presets-state':
				setExportPresets(msg.presets);
				break;
			case 'queue-state':
				setRenderQueue(msg.queue);
				break;
			case 'queue-job-destination':
				void handleQueueJobDestination(msg.jobId, msg.suggestedName);
				break;
			case 'queue-job-progress':
				setRenderQueue((prev) => ({
					...prev,
					jobs: prev.jobs.map((j) => (j.id === msg.jobId ? { ...j, progress: msg.progress } : j))
				}));
				setStatusLine(`Queue: ${Math.round(msg.progress.percent * 100)}%`);
				break;
			case 'queue-job-complete':
				setStatusLine(`Queue: ${msg.fileName} done (${Math.round(msg.elapsedSeconds)}s)`);
				break;
			case 'queue-job-failed':
				setStatusLine(`Queue job failed: ${msg.error}`);
				break;
			case 'queue-job-canceled':
				break;
			case 'queue-complete':
				setStatusLine(
					`Queue done: ${msg.completedCount} completed, ${msg.failedCount} failed, ${msg.canceledCount} canceled`
				);
				break;
			case 'diagnostic-snapshot': {
				setRecentErrorLog((prev) => {
					const workerEntries = msg.snapshot.recentErrors.entries;
					// Worker entries are authoritative for shared subsystem:code pairs — they
					// carry the fresh occurrenceCount/timestamp. Keep only UI-originated
					// entries the worker doesn't report; otherwise the panel would pin stale
					// worker counts from an earlier snapshot.
					const workerCodes = new Set(workerEntries.map((e) => `${e.subsystem}:${e.code}`));
					const uiOnly = prev.entries.filter((e) => !workerCodes.has(`${e.subsystem}:${e.code}`));
					const merged = [...workerEntries, ...uiOnly].slice(0, prev.capacity);
					return { ...prev, entries: merged };
				});
				void refreshDiagnostics(msg.snapshot);
				break;
			}
			case 'recent-error':
				setRecentErrorLog((prev) => addRecentError(prev, msg.error));
				break;
			case 'recovery-state':
				if (msg.state === 'recovering') {
					setWebgpuAvailable(false);
					setPreviewBackend('none');
					setExportBackend('none');
					setPreviewReady(false);
					setExportReady(false);
					setStatusLine('GPU recovery in progress…');
				} else if (msg.state === 'failed') {
					setWebgpuAvailable(false);
					setPreviewBackend('none');
					setExportBackend('none');
					setPreviewReady(false);
					setExportReady(false);
					setRuntimeIssue('GPU recovery failed. Accelerated features are unavailable.');
					setStatusLine('GPU recovery failed · limited mode');
				} else {
					setStatusLine('Recovery state updated.');
				}
				break;
			case 'source-health': {
				setLatestHealthReport(msg.report.status === 'ok' ? null : msg.report);
				const first = msg.report.warnings[0];
				if (first) setStatusLine(first.message);
				break;
			}
			case 'bundle-replace-prompt': {
				// Queue the prompt for the in-app modal. The worker waits on the
				// `bundle-replace-decision` reply, which is sent from the modal's
				// click handlers (see the BundleReplaceModal markup below).
				setBundleReplacePrompt({ jobId: msg.jobId, message: msg.message });
				break;
			}
			case 'bundle-job-progress':
				if (bundleJobId()) {
					setBundleBusy(true);
					setBundlePhase(msg.phase);
				}
				break;
			case 'bundle-integrity-report':
				setBundleReport(msg.report);
				break;
			case 'bundle-import-result':
				setBundleBusy(false);
				setBundlePhase(null);
				setBundleJobId(null);
				setBundleMessage(msg.reason ?? (msg.ok ? 'Bundle job complete.' : 'Bundle job failed.'));
				if (msg.ok && msg.projectId) {
					setRestoreOffer(null);
					setStatusLine(msg.reason ?? 'Bundle job complete.');
				}
				break;
			case 'dispose-complete':
				break;
			case 'import-error':
				setImporting(false);
				setStatusLine(msg.message);
				break;
			case 'project-warning':
				setStatusLine(msg.message);
				break;
			case 'program-status':
				setProgramSessionState(msg.state);
				setProgramActiveSceneId(msg.activeSceneId);
				setProgramSourceStatus([...msg.sources]);
				break;
			case 'program-scenes':
				setProgramScenes([...msg.scenes]);
				break;
			case 'program-error':
				setProgramError(msg.detail);
				setProgramSessionState('idle');
				setProgramActiveSceneId(null);
				releaseActiveProgramMonitorTracks();
				stopProgramWriter();
				setStatusLine(`Program Mode: ${msg.detail}`);
				break;
			case 'program-landed':
				setProgramSessionState('idle');
				setProgramActiveSceneId(null);
				setProgramSourceStatus([]);
				releaseActiveProgramMonitorTracks();
				stopProgramWriter();
				setStatusLine(
					`Program landed · ${msg.isoTrackIds.length} ISO track${msg.isoTrackIds.length === 1 ? '' : 's'} + layout`
				);
				setActiveSideRailTab('inspector');
				break;
			// Phase 46: Replay Buffer + Live Audio Chain
			case 'replay-capture-state':
				setCaptureSession(msg.state);
				if (!msg.state.active) releaseReplayCaptureStream();
				break;
			case 'replay-capture-error':
				releaseReplayCaptureStream();
				setStatusLine(`Capture: ${msg.message}`);
				break;
			case 'replay-buffer-state':
				setReplayBufferState(msg.state);
				break;
			case 'replay-save-progress':
				setReplaySaveInProgress(true);
				setStatusLine(`Saving replay… ${msg.chunksWritten}/${msg.totalChunks} chunks`);
				break;
			case 'replay-save-complete':
				setReplaySaveInProgress(false);
				setStatusLine(`Replay saved · ${msg.fileName}`);
				break;
			case 'replay-save-error':
				setReplaySaveInProgress(false);
				setStatusLine(`Replay save failed: ${msg.message}`);
				break;
			case 'replay-save-canceled':
				setReplaySaveInProgress(false);
				setStatusLine('Replay save canceled');
				break;
			case 'live-chain-config':
				setLiveChainConfig(msg.config);
				break;
			case 'live-chain-latency':
				setLiveChainLatencyMs(msg.latencyMs);
				break;
			case 'live-chain-error':
				setStatusLine(`Live audio chain: ${msg.message}`);
				break;
			case 'capture-status':
				setRecorderStatus({
					state: msg.state,
					elapsedUs: msg.elapsedUs,
					bytesWritten: msg.bytesWritten,
					remainingSeconds: msg.remainingSeconds,
					sources: msg.sources
				});
				break;
			case 'capture-error':
				setStatusLine(`Recorder: ${msg.detail}`);
				break;
			case 'capture-landed':
				setRecorderLandedSessionId(msg.sessionId);
				setStatusLine(
					`Recorder landed ${msg.trackIds.length} track${msg.trackIds.length === 1 ? '' : 's'}.`
				);
				break;
			case 'capture-dom-tap-init':
				captureDomTap.start(msg.sessionId, msg.ring, msg.epochMs);
				setSidecarReadySessionId(null);
				break;
			case 'capture-dom-tap-stop':
				// Idempotent: tap.stop() is a no-op if no session is bound, so a
				// duplicate stop (e.g. from both the internal-stop and the capture-stop
				// path) cleans up cleanly.
				captureDomTap.stop();
				break;
			case 'capture-dom-tap-pause':
				captureDomTap.pause();
				break;
			case 'capture-dom-tap-resume':
				captureDomTap.resume();
				break;
			case 'capture-events-sidecar-ready':
				setSidecarReadySessionId(msg.sessionId);
				break;
			// Phase 36: Voice Cleanup
			case 'voice-cleanup-analysis-progress':
				setVoiceCleanupAnalysisState('running');
				setVoiceCleanupAnalysisProgress(msg.fraction);
				break;
			case 'voice-cleanup-analysis-result':
				setVoiceCleanupAnalysisState('done');
				setVoiceCleanupMeasuredLufs(msg.measuredLufs);
				setVoiceCleanupProposedGainDb(msg.normalisationGainDb);
				setVoiceCleanupNormalisedLufs(msg.normalisedLufs);
				break;
			case 'voice-cleanup-analysis-cancelled':
				setVoiceCleanupAnalysisState('idle');
				break;
			case 'voice-cleanup-analysis-error':
				setVoiceCleanupAnalysisState('error');
				setVoiceCleanupAnalysisError(msg.message);
				break;
			case 'voice-cleanup-applied':
				setVoiceCleanupSettings((s) => ({ ...s, normaliseGainDb: msg.normalisationGainDb }));
				break;
			case 'voice-cleanup-settings':
				setVoiceCleanupSettings(msg.settings);
				break;
			case 'error':
				setImporting(false);
				setRuntimeIssue(msg.message);
				setStatusLine(msg.message);
				break;
			// Phase 34: Beat Detection
			case 'beat-analysis-progress':
				setBeatProgress((prev) => {
					const next = new Map(prev);
					next.set(msg.sourceId, msg.fraction);
					return next;
				});
				break;
			case 'beat-analysis-result':
				setBeatResults((prev) => {
					const next = new Map(prev);
					next.set(msg.sourceId, {
						tempoBpm: msg.tempoBpm,
						beatTimesMs: msg.beatTimesMs
					});
					return next;
				});
				setBeatProgress((prev) => {
					const next = new Map(prev);
					next.delete(msg.sourceId);
					return next;
				});
				setStatusLine(
					`Beat analysis complete: ${msg.tempoBpm.toFixed(0)} BPM, ${msg.beatTimesMs.length} beats`
				);
				break;
			case 'beat-analysis-error':
				setBeatProgress((prev) => {
					const next = new Map(prev);
					next.delete(msg.sourceId);
					return next;
				});
				setStatusLine(`Beat analysis failed: ${msg.message}`);
				break;
			case 'beat-settings':
				// Worker is the source of truth on restore/import -- adopt the
				// persisted settings without echoing back to avoid a feedback loop.
				setBeatSettings({
					enabledSourceIds: [...msg.enabledSourceIds],
					globalOffsetMs: msg.globalOffsetMs
				});
				break;
			// Phase 39: Vertical and Platform Finishing
			case 'project-format-changed':
				setProjectAspect(msg.aspect);
				{
					const cp = selectedPlatform();
					if (cp && cp.aspect !== msg.aspect) setSelectedPlatformId('');
				}
				break;
			case 'cover-frame-changed':
				setCoverFrame(msg.cover);
				setCoverTitleClipId(msg.cover?.titleClipId ?? '');
				break;
			case 'cover-thumbnail':
				{
					const currentCover = coverFrame();
					if (
						currentCover &&
						currentCover.timeS === msg.cover.timeS &&
						(currentCover.titleClipId ?? null) === (msg.cover.titleClipId ?? null)
					) {
						const nextUrl = URL.createObjectURL(msg.blob);
						setCoverThumbnailUrl((current) => {
							if (current) URL.revokeObjectURL(current);
							return nextUrl;
						});
						setCoverThumbnailError(null);
					}
				}
				break;
			case 'cover-thumbnail-error':
				if (
					coverFrame()?.timeS === msg.cover.timeS &&
					(coverFrame()?.titleClipId ?? null) === (msg.cover.titleClipId ?? null)
				) {
					setCoverThumbnailError(msg.error);
				}
				break;
			case 'cover-export-warning':
				setCoverExportError(msg.error);
				setStatusLine(msg.error);
				break;
		}
	}

	function ensureWorker() {
		if (worker && bridge) return { worker, bridge };
		worker = new PipelineWorker();
		bridge = createWorkerBridge(worker, handleState);
		worker.addEventListener('error', handleWorkerCrash);
		return { worker, bridge };
	}

	function handleWorkerCrash(event?: ErrorEvent) {
		if (event) event.preventDefault();
		if (awaitingRestartReady) {
			recoveryMachine.recordRestartFailure();
			awaitingRestartReady = false;
		}
		const crashState = recoveryMachine.recordCrash();
		setWorkerRecoveryState(crashState);
		setWorkerReady(false);
		// Phase 41: the crashed worker can no longer send `capture-dom-tap-stop`,
		// so the tap would keep writing into a SAB nobody reads. Tear it down here
		// so DOM listeners are removed synchronously.
		captureDomTap.stop();
		setSidecarReadySessionId(null);
		// The crashed worker no longer owns a WebGPU device; reflect that until the
		// restarted worker re-publishes its `ready` (with the true webgpu flag).
		setWebgpuAvailable(false);
		setPreviewBackend('none');
		setExportBackend('none');
		setPreviewReady(false);
		setExportReady(false);
		setExporting(false);
		setExportProgress(null);
		setImporting(false);
		setInterpolationAvailability(INITIAL_INTERPOLATION_AVAILABILITY);
		setInterpolationModelStatus('not-loaded');
		setInterpolationModelCacheSource(null);
		setInterpolationEstimateMs(null);
		// Do NOT zero the transport-clock SAB from the main thread: the worker is the
		// sole writer of the transport clock. Instead detach the read-side so the UI
		// stops surfacing the dead worker's stale (possibly playing) values. This also
		// covers the throttled path, where no restarted worker will republish a reset.
		// A restarted worker republishes its authoritative reset (writeClockFull) on
		// init, and `ready` re-attaches the reader below.
		clock.setActive(false);
		const message = event?.message ?? 'Worker terminated unexpectedly';
		setRecentErrorLog((prev) =>
			addRecentError(
				prev,
				createRecentError({
					code: 'worker.crashed',
					subsystem: 'worker',
					severity: 'error',
					message,
					recoveryActionIds: crashState === 'throttled' ? [] : ['restart-worker']
				})
			)
		);
		setStatusLine(
			crashState === 'throttled'
				? 'Worker crashed · restart limit reached. Reload the page to recover.'
				: 'Worker crashed · restart available'
		);
		if (crashState !== 'throttled') {
			void restartWorker();
		}
	}

	async function restartWorker() {
		if (!recoveryMachine.canRestart()) return;

		const oldWorker = worker;
		const oldBridge = bridge;
		worker = null;
		bridge = null;
		initSent = false;

		if (oldWorker) {
			oldWorker.removeEventListener('error', handleWorkerCrash);
			if (oldBridge) {
				try {
					oldBridge.dispose();
					oldBridge.send({ type: 'dispose' });
				} catch {
					// Worker may already be dead
				}
			}
			setTimeout(() => oldWorker.terminate(), 500);
		}

		awaitingRestartReady = true;
		setStatusLine('Restarting worker…');
		setPreviewKey((k) => k + 1);
	}

	async function sendInit(canvas: OffscreenCanvas) {
		if (initSent) return;
		const probe = capabilityProbeV2();
		if (!probe) {
			pendingInitCanvas = canvas;
			return;
		}
		if (probe.tier === 'shell-only') {
			setPreviewBackend('none');
			setExportBackend('none');
			setPreviewReady(false);
			setExportReady(false);
			setRuntimeIssue(
				'Preview unavailable: this browser exposes neither WebGPU nor WebCodecs decode support.'
			);
			setStatusLine('Shell-only · preview and export unavailable');
			return;
		}
		initSent = true;
		const { bridge: b } = ensureWorker();
		let audioSab: SharedArrayBuffer | null = null;
		let meterBuffer: SharedArrayBuffer | null = null;
		if (sab && !audioReady) {
			audioReady = audioEngine.init(sab);
		}
		if (audioReady) {
			try {
				const audioInit = await audioReady;
				audioSab = audioInit.audioSab;
				meterBuffer = audioInit.meterSab;
				setMeterSab(meterBuffer);
				setAudioSabReady(audioSab !== null);
				setVoiceCleanupMonitorSampleRate(audioEngine.getSampleRate());
				setVoiceCleanupMonitorLatencyMs(voiceCleanupLatencyMs(audioEngine.getSampleRate()));
				setAudioWarning(null);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setAudioWarning(`Audio disabled: ${message}`);
				setAudioSabReady(false);
				setStatusLine('Audio disabled · starting video pipeline');
				setRecentErrorLog((prev) =>
					addRecentError(
						prev,
						createRecentError({
							code: 'audio.init_failed',
							subsystem: 'audio',
							severity: 'warning',
							message: `Audio init failed: ${message}`,
							recoveryActionIds: ['retry-audio']
						})
					)
				);
			}
		}
		b.send({ type: 'init', canvas, sab, audioSab, scopeSab, probeResult: probe }, [canvas]);
	}

	async function importCompatibilityMedia(file: File) {
		if (importing()) return;
		const generation = ++compatibilityImportGeneration;
		setImporting(true);
		setStatusLine('Loading compatibility preview…');
		try {
			const preview = await extractCompatibilityPreview(file);
			if (generation !== compatibilityImportGeneration) {
				preview.thumbnail.revoke();
				return;
			}
			clearCompatibilityPreview();
			setCompatibilityPreview({
				url: preview.thumbnail.url,
				width: preview.thumbnail.width,
				height: preview.thumbnail.height,
				fileName: preview.fileName,
				duration: preview.duration,
				revoke: preview.thumbnail.revoke
			});
			setMetadata({
				fileName: preview.fileName,
				duration: preview.duration,
				mimeType: preview.mimeType,
				video: {
					codec: null,
					width: preview.sourceWidth,
					height: preview.sourceHeight,
					frameRate: null,
					canDecode: false
				},
				audio: null,
				trackCount: 1
			});
			setTimeline([]);
			setMarkers([]);
			setSessionEventLogs([]);
			setSelectedClipRefs([]);
			setStatusLine(`Loaded ${preview.fileName} · compatibility preview`);
		} catch (error) {
			if (generation !== compatibilityImportGeneration) return;
			const message = error instanceof Error ? error.message : String(error);
			setStatusLine(`Compatibility import failed: ${message}`);
		} finally {
			if (generation === compatibilityImportGeneration) {
				setImporting(false);
			}
		}
	}

	function resetProjectUiState() {
		setRestoreOffer(null);
		setUnresolvedSources([]);
		setMetadata(null);
		setTimeline([]);
		setMarkers([]);
		setCaptionTracks([]);
		setSessionEventLogs([]);
		setCaptionDiagnostics([]);
		setCustomAnimCaptionPresets([]);
		setSelectedCaptionTrackId(null);
		setSelectedCaptionSegmentIds([]);
		setSelectedClipRefs([]);
		setTimelineClipboard([]);
		setWaveformPeaks({});
		setAssets([]);
		setLatestHealthReport(null);
		thumbnailStore.clear();
		setThumbnailVersion((v) => v + 1);
		setHistoryState({ canUndo: false, canRedo: false });
		// Phase 34: clear any stale beat results / progress / grid settings
		// from the prior project so a new import doesn't inherit the BPM,
		// grid, or in-flight progress of an unrelated source.
		setBeatResults(new Map());
		setBeatProgress(new Map());
		setBeatSettings({ enabledSourceIds: [], globalOffsetMs: 0 });
	}

	function startNewProject() {
		resetProjectUiState();
		clearCompatibilityPreview();
		bridge?.send({ type: 'new-project' });
	}

	function discardRestoreBeforeImport() {
		if (!restoreOffer() && unresolvedSources().length === 0) return;
		startNewProject();
	}

	function importMedia(file: File, fileHandle?: FileSystemFileHandle | null) {
		discardRestoreBeforeImport();
		if (previewSurfaceAvailable()) {
			// The worker queues imports independently, so a batch (multi-file picker
			// or drop) must not be gated on `importing()` — that would silently drop
			// every file after the first once the first import flips the flag.
			const { bridge: b } = ensureWorker();
			b.send({ type: 'import', file, fileHandle });
			return;
		}
		// The limited compatibility path renders a single preview at a time.
		if (importing()) return;
		if (compatibilityImportEnabled()) {
			void importCompatibilityMedia(file);
			return;
		}
		setStatusLine(importHint() ?? 'Import unavailable in limited mode');
	}

	async function pickImportMedia(): Promise<boolean> {
		if (typeof window.showOpenFilePicker !== 'function') return false;
		try {
			const handles = await window.showOpenFilePicker({
				types: VIDEO_PICKER_TYPES,
				multiple: true
			});
			for (const handle of handles) {
				const file = await handle.getFile();
				importMedia(file, handle);
			}
			return true;
		} catch (error) {
			if (isAbortError(error)) return true;
			setStatusLine(
				`Import picker failed: ${error instanceof Error ? error.message : String(error)}`
			);
			return false;
		}
	}

	async function openDockImport() {
		if (importBlocked()) return;
		const handled = await pickImportMedia();
		if (!handled) dockImportInput?.click();
	}

	async function pickRelinkFile(sourceId: string) {
		if (typeof window.showOpenFilePicker === 'function') {
			try {
				const [handle] = await window.showOpenFilePicker({
					types: VIDEO_PICKER_TYPES,
					multiple: false
				});
				if (!handle) return;
				const file = await handle.getFile();
				bridge?.send({ type: 'relink-source', sourceId, file, fileHandle: handle });
				return;
			} catch (error) {
				if (isAbortError(error)) return;
				setStatusLine(
					`Re-link picker failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
		pendingRelinkSourceId = sourceId;
		relinkInput?.click();
	}

	function handleRelinkInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';
		const sourceId = pendingRelinkSourceId;
		pendingRelinkSourceId = null;
		if (!file || !sourceId) return;
		bridge?.send({ type: 'relink-source', sourceId, file });
	}

	function handleImportInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		for (const file of files) importMedia(file);
	}

	function exportFileName(settings: ExportSettings): string {
		const sourceName = metadata()?.fileName.replace(/\.[^.]+$/, '') || 'export';
		const extension = settings.container === 'webm' ? '.webm' : '.mp4';
		return `${sourceName}${extension}`;
	}

	async function pickOutputHandle(settings: ExportSettings): Promise<FileSystemFileHandle | null> {
		if (typeof window.showSaveFilePicker !== 'function') {
			throw new Error('Export requires the File System Access API in a Chromium desktop browser.');
		}
		const isWebm = settings.container === 'webm';
		try {
			return await window.showSaveFilePicker({
				suggestedName: exportFileName(settings),
				types: [
					isWebm
						? {
								description: 'WebM video',
								accept: { 'video/webm': ['.webm'] }
							}
						: {
								description: 'MP4 video',
								accept: { 'video/mp4': ['.mp4'] }
							}
				]
			});
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return null;
			throw e;
		}
	}

	function probeExportCodecs() {
		bridge?.send({ type: 'export-probe' });
	}

	async function handleQueueJobDestination(jobId: string, suggestedName: string) {
		if (typeof window.showSaveFilePicker !== 'function') {
			bridge?.send({ type: 'queue-job-skip', jobId });
			return;
		}
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName,
				types: [
					suggestedName.endsWith('.webm')
						? { description: 'WebM video', accept: { 'video/webm': ['.webm'] } }
						: { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }
				]
			});
			bridge?.send({ type: 'queue-job-output', jobId, handle });
		} catch (error) {
			// `showSaveFilePicker` may reject with `SecurityError` when called
			// without an active user gesture — every queue job after the first
			// runs from a background completion callback, not a click, so the
			// activation has expired. Without a distinct signal, the worker
			// reads the skip as "user cancelled" and silently drops the job.
			if (error instanceof DOMException && error.name === 'SecurityError') {
				setStatusLine(
					'Queue paused: pre-select all output files via Run Queue before starting (job activation expired).'
				);
				bridge?.send({ type: 'queue-job-skip', jobId });
				bridge?.send({ type: 'queue-pause' });
				return;
			}
			bridge?.send({ type: 'queue-job-skip', jobId });
		}
	}

	function queuePickerTypes(suggestedName: string): QueuePickerType[] {
		return [
			suggestedName.endsWith('.webm')
				? { description: 'WebM video', accept: { 'video/webm': ['.webm'] } }
				: { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }
		];
	}

	function queueProjectDisplayName(): string {
		const sourceName = metadata()?.fileName.replace(/\.[^.]+$/, '');
		return sourceName || 'Untitled project';
	}

	function uniqueSuggestedName(name: string, used: Set<string>): string {
		if (!used.has(name)) {
			used.add(name);
			return name;
		}
		const match = /(\.[^.]+)$/.exec(name);
		const extension = match?.[1] ?? '';
		const base = extension ? name.slice(0, -extension.length) : name;
		let counter = 2;
		let candidate = `${base}-${counter}${extension}`;
		while (used.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter}${extension}`;
		}
		used.add(candidate);
		return candidate;
	}

	function pickerWasCanceled(error: unknown): boolean {
		return error instanceof DOMException && error.name === 'AbortError';
	}

	async function preselectQueueOutputHandles(): Promise<boolean> {
		const pendingJobs = renderQueue().jobs.filter((job) => job.status === 'pending');
		if (pendingJobs.length === 0 || typeof window.showSaveFilePicker !== 'function') return true;

		const allJobs = renderQueue().jobs;
		const usedNames = new Set<string>();
		const needsDirectory = pendingJobs.length > 1 || coverFrame() !== null;
		if (needsDirectory) {
			const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
			if (typeof directoryPicker !== 'function') {
				setStatusLine(
					coverFrame()
						? 'Cover export needs a directory picker so the cover JPEG can be saved beside the video.'
						: 'Queue needs a directory picker to run multiple pending exports.'
				);
				return false;
			}
			try {
				const directory = await directoryPicker({ mode: 'readwrite' });
				for (const job of pendingJobs) {
					const suggestedName = uniqueSuggestedName(
						suggestedFileNameForJob(
							job,
							exportPresets(),
							queueProjectDisplayName(),
							allJobs.findIndex((item) => item.id === job.id) + 1
						),
						usedNames
					);
					const handle = await directory.getFileHandle(suggestedName, { create: true });
					bridge?.send({ type: 'queue-job-output', jobId: job.id, handle, outputDir: directory });
				}
				return true;
			} catch (error) {
				if (!pickerWasCanceled(error)) {
					const message = error instanceof Error ? error.message : String(error);
					setStatusLine(`Queue destination failed: ${message}`);
				}
				return false;
			}
		}

		const job = pendingJobs[0]!;
		const suggestedName = suggestedFileNameForJob(
			job,
			exportPresets(),
			queueProjectDisplayName(),
			allJobs.findIndex((item) => item.id === job.id) + 1
		);
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName,
				types: queuePickerTypes(suggestedName)
			});
			bridge?.send({ type: 'queue-job-output', jobId: job.id, handle });
			return true;
		} catch (error) {
			if (!pickerWasCanceled(error)) {
				const message = error instanceof Error ? error.message : String(error);
				setStatusLine(`Queue destination failed: ${message}`);
			}
			return false;
		}
	}

	async function startRenderQueue() {
		if (!(await preselectQueueOutputHandles())) return;
		bridge?.send({ type: 'queue-start' });
	}

	function handleSavePreset(preset: ExportPresetDoc) {
		bridge?.send({ type: 'preset-save', preset });
	}

	function handleDeletePreset(presetId: string) {
		bridge?.send({ type: 'preset-delete', presetId });
	}

	function interpolationExportUnavailableMessage(): string {
		return INTERPOLATION_EXPORT_PIPELINE_WIRED
			? 'Frame interpolation export requires a loaded, validated ONNX model.'
			: 'Frame interpolation export is hidden until the ONNX model and export synthesis bridge are validated.';
	}

	function rejectUnavailableInterpolationExport(settings: ExportSettings): boolean {
		if (!settings.interpolation) return false;
		const message = interpolationExportUnavailableMessage();
		setStatusLine(message);
		return true;
	}

	function handleEnqueue(
		settings: ExportSettings,
		rangeMode: 'full' | 'range' | 'markers',
		presetId: string | null,
		outputTemplate: string | null
	) {
		if (exportBackend() !== 'core-webgpu') {
			setStatusLine(
				'Render queue requires the Core WebGPU export tier. Use direct export in this browser tier.'
			);
			return;
		}
		if (rejectUnavailableInterpolationExport(settings)) return;
		if (rangeMode === 'markers') {
			const jobs = createJobsFromMarkers(markers(), settings, presetId, outputTemplate);
			for (const job of jobs) {
				bridge?.send({ type: 'queue-enqueue', job });
			}
		} else {
			if (rangeMode === 'range' && !settings.range) {
				setStatusLine('Queue range must have Out greater than In.');
				return;
			}
			const jobRange =
				rangeMode === 'full'
					? { mode: 'full' as const }
					: settings.range
						? { mode: 'range' as const, startS: settings.range.startS, endS: settings.range.endS }
						: null;
			if (!jobRange) return;
			const job = createJob(settings, jobRange, presetId, outputTemplate);
			bridge?.send({ type: 'queue-enqueue', job });
		}
	}

	function captionBridge() {
		return ensureWorker().bridge;
	}

	function makeBundleJobId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `bundle-job-${Math.random().toString(36).slice(2)}`;
	}

	function startBundleExport(
		policy: BundleSourcePolicySnapshot,
		outputDir: FileSystemDirectoryHandle
	) {
		const jobId = makeBundleJobId();
		setBundleBusy(true);
		setBundleJobId(jobId);
		setBundlePhase('starting');
		setBundleReport(null);
		setBundleMessage(null);
		bridge?.send({ type: 'export-project-bundle', jobId, policy, outputDir });
	}

	function startBundleImport(bundleDir: FileSystemDirectoryHandle) {
		const jobId = makeBundleJobId();
		setBundleBusy(true);
		setBundleJobId(jobId);
		setBundlePhase('starting');
		setBundleReport(null);
		setBundleMessage(null);
		bridge?.send({ type: 'import-project-bundle', jobId, bundleDir });
	}

	function startCollectMedia(relocate: boolean, outputDir: FileSystemDirectoryHandle) {
		const jobId = makeBundleJobId();
		setBundleBusy(true);
		setBundleJobId(jobId);
		setBundlePhase('starting');
		setBundleReport(null);
		setBundleMessage(null);
		bridge?.send({ type: 'collect-project-media', jobId, relocate, outputDir });
	}

	function cancelBundleJob() {
		const jobId = bundleJobId();
		if (jobId) bridge?.send({ type: 'cancel-bundle-job', jobId });
		setBundleBusy(false);
		setBundlePhase(null);
		setBundleJobId(null);
		setBundleMessage('Bundle job canceled.');
	}

	async function startExport(settings: ExportSettings) {
		// Title-only projects have no source metadata but are still exportable.
		if ((!metadata() && !hasTimeline()) || exporting()) return;
		if (!exportSurfaceAvailable()) {
			setExportError(
				pipelineMode() === 'limited'
					? 'Export is unavailable because this browser tier has no export backend.'
					: 'Waiting for preview canvas before export can start.'
			);
			return;
		}
		if (rejectUnavailableInterpolationExport(settings)) {
			setExportError(interpolationExportUnavailableMessage());
			return;
		}
		setExporting(true);
		setExportProgress(null);
		setExportResult(null);
		setExportError(null);
		setExportWarnings([]);
		setStatusLine('Choosing export destination…');
		try {
			let output: FileSystemFileHandle | null = null;
			if (typeof window.showSaveFilePicker === 'function') {
				output = await pickOutputHandle(settings);
				if (!output) {
					setExporting(false);
					setStatusLine('Export canceled');
					return;
				}
			} else if (exportBackend() !== 'canvas2d') {
				throw new Error('Export requires the File System Access API in this browser tier.');
			}
			const { bridge: b } = ensureWorker();
			setStatusLine('Starting export…');
			b.send({ type: 'export-start', settings, output });
		} catch (e) {
			setExporting(false);
			const message = e instanceof Error ? e.message : String(e);
			setExportError(message);
			setStatusLine(`Export failed: ${message}`);
		}
	}

	function onFileDrop(file: File) {
		setIsDraggingFile(false);
		importMedia(file);
	}

	function selectClip(
		trackId: string,
		clipId: string,
		_effects: TimelineClipSnapshot['effects'],
		additive: boolean,
		exclusive = false
	) {
		const next = { trackId, clipId };
		const key = `${trackId}:${clipId}`;
		if (exclusive) {
			// Collapse any multi-selection down to just this clip (a plain click).
			setSelectedClipRefs([next]);
			return;
		}
		if (!additive) {
			setSelectedClipRefs((prev) =>
				prev.some((ref) => `${ref.trackId}:${ref.clipId}` === key) ? prev : [next]
			);
			return;
		}
		setSelectedClipRefs((prev) => {
			if (prev.some((ref) => `${ref.trackId}:${ref.clipId}` === key)) {
				return prev.filter((ref) => `${ref.trackId}:${ref.clipId}` !== key);
			}
			return [...prev, next];
		});
	}

	function selectedClipboardClips(): TimelineClipboardClip[] {
		const clips: TimelineClipboardClip[] = [];
		for (const ref of selectedClipRefs()) {
			const clip = findTimelineClip(ref);
			if (!clip) continue;
			clips.push({
				trackId: ref.trackId,
				clip: {
					...clip,
					effects: { ...clip.effects }
				}
			});
		}
		return clips;
	}

	function copySelectedClips() {
		const clips = selectedClipboardClips();
		if (clips.length === 0) return;
		setTimelineClipboard(clips);
		bridge?.send({ type: 'cache-clipboard-luts', clips: selectedClipRefs() });
		setStatusLine(`Copied ${clips.length} clip${clips.length === 1 ? '' : 's'}`);
	}

	function pasteClipboardClips() {
		const clips = timelineClipboard();
		if (clips.length === 0) return;
		bridge?.send({ type: 'paste-clips', clips, atTime: clock.currentTime() });
	}

	function splitKeyframedTransformChange(
		transform: Partial<TimelineClipSnapshot['transform']>
	): Partial<TimelineClipSnapshot['transform']> {
		const sel = selectedClip();
		if (!sel) return transform;
		const staticPatch: Partial<TimelineClipSnapshot['transform']> = {};
		const staticNumbers = staticPatch as Partial<
			Record<Exclude<keyof TimelineClipSnapshot['transform'], 'fit'>, number>
		>;
		const keyedUpdates: Array<{
			key: ClipKeyframeParamSnapshot;
			value: number;
			easing: 'linear';
		}> = [];
		for (const [rawKey, value] of Object.entries(transform)) {
			if (rawKey === 'fit') {
				staticPatch.fit = value as TimelineClipSnapshot['transform']['fit'];
				continue;
			}
			if (typeof value !== 'number') {
				continue;
			}
			const key = rawKey as ClipKeyframeParamSnapshot;
			if (!hasKeyframeTrack(sel.keyframes, key)) {
				staticNumbers[key as Exclude<keyof TimelineClipSnapshot['transform'], 'fit'>] = value;
				continue;
			}
			keyedUpdates.push({ key, value, easing: 'linear' });
		}
		if (keyedUpdates.length > 0) {
			bridge?.send({
				type: 'set-keyframes',
				trackId: sel.trackId,
				clipId: sel.clipId,
				t: clock.currentTime(),
				keyframes: keyedUpdates
			});
		}
		return staticPatch;
	}

	function deleteSelectedClips() {
		const clips = selectedClipRefs();
		if (clips.length === 0) return;
		// Matte sessions/caches are owned by the pipeline worker's matte engine,
		// which releases them inside the delete handlers.
		if (clips.length === 1) {
			const clip = clips[0]!;
			bridge?.send({ type: 'delete-clip', trackId: clip.trackId, clipId: clip.clipId });
		} else {
			bridge?.send({ type: 'delete-clips', clips });
		}
		setSelectedClipRefs([]);
	}

	function duplicateSelectedClips() {
		const clips = selectedClipRefs();
		if (clips.length === 0) return;
		bridge?.send({ type: 'duplicate-clip', clips });
	}

	function splitSelectedClip() {
		const clip = selectedClip();
		if (!clip) return;
		bridge?.send({ type: 'split', trackId: clip.trackId, time: clock.currentTime() });
	}

	function playFromKeyboard() {
		if (!previewSurfaceAvailable()) return;
		const t = clock.currentTime();
		if (audioSabReady()) void audioEngine.play(t);
		bridge?.send({ type: 'play' });
	}

	function pauseFromKeyboard() {
		bridge?.send({ type: 'pause' });
		audioEngine.pause();
	}

	function zoomTimeline(direction: 1 | -1) {
		window.dispatchEvent(new CustomEvent('localcut-timeline-zoom', { detail: { direction } }));
	}

	onMount(() => {
		void (async () => {
			const probe = await probeCapabilitiesV2();
			setCapabilityProbeV2(probe);
			setExportCodecs([...exportConstraintsForProbe(probe)]);
			cleanupController.setCleanupProbe(probe.cleanup ?? null);
			asrController.setProbe();
			if (pendingInitCanvas) {
				const canvas = pendingInitCanvas;
				pendingInitCanvas = null;
				await sendInit(canvas);
			}
			setIsIsolated(probe.crossOriginIsolated);
			setCapabilities(
				probeCapabilities({
					crossOriginIsolated: probe.crossOriginIsolated,
					sharedArrayBuffer: probe.sharedArrayBuffer === 'supported',
					webgpu: probe.webGPUCore === 'supported' || probe.webGPUCompat === 'supported',
					webCodecs: probe.webCodecsDecode === 'supported',
					offscreenCanvas: probe.offscreenCanvas === 'supported',
					fileSystemAccess: probe.fileSystemAccess === 'supported',
					audioWorklet: probe.audioWorklet === 'supported'
				})
			);
			switch (probe.tier) {
				case 'core-webgpu':
					ensureWorker();
					setStatusLine('Starting pipeline worker…');
					break;
				case 'compatibility-webgpu':
					ensureWorker();
					setRuntimeIssue(
						probe.sharedArrayBuffer === 'supported'
							? 'Compatibility GPU tier active. Preview remains client-side with reduced effects and export constraints.'
							: 'Compatibility GPU tier active without SharedArrayBuffer. Clock updates use reduced rAF messages.'
					);
					setStatusLine('Compatibility GPU tier · reduced effects');
					break;
				case 'limited-webcodecs':
					ensureWorker();
					setRuntimeIssue(
						'Limited WebCodecs tier active. Preview uses client-side compatibility rendering and export is codec constrained.'
					);
					setStatusLine('Limited WebCodecs tier · GPU effects unavailable');
					break;
				case 'shell-only':
					setRuntimeIssue(
						'Preview unavailable: this browser exposes neither WebGPU nor WebCodecs decode support.'
					);
					setStatusLine('Shell-only · preview and export unavailable');
					break;
			}
		})();

		// Phase 39: Fetch platform safe-zone data.
		void fetch(`${import.meta.env.BASE_URL}safe-zones/safe-zones.v1.json`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((json) => {
				const file = validateSafeZoneFile(json);
				if (file) setSafeZoneFile(file);
				else console.error('[safe-zones] Validation failed.');
			})
			.catch((err: unknown) => {
				console.error('[safe-zones] Failed to load:', err);
			});

		const handlePopState = () => setDocsSlug(parseDocsPath(window.location.pathname));
		window.addEventListener('popstate', handlePopState);

		const unregisterKeyboard = registerKeyboardShortcuts({
			enabled: () => docsSlug() === null,
			onUndo: () => bridge?.send({ type: 'undo' }),
			onRedo: () => bridge?.send({ type: 'redo' }),
			onSplit: splitSelectedClip,
			onDelete: deleteSelectedClips,
			onPlay: playFromKeyboard,
			onPause: pauseFromKeyboard,
			onStep: (direction) => bridge?.send({ type: 'step', direction }),
			onZoom: zoomTimeline,
			onCopy: copySelectedClips,
			onPaste: pasteClipboardClips,
			onDuplicate: duplicateSelectedClips
		});
		const unsubscribePublish = publishController.onUpdate(() => {
			setPublishState(publishController.state);
			setPublishTapStats(publishController.tapStats);
			setPublishErrorDetail(publishController.lastError);
		});
		const handleOffline = () => setIsOffline(true);
		const handleOnline = () => setIsOffline(false);
		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);

		if ('serviceWorker' in navigator) {
			setHasActiveSW(!!navigator.serviceWorker.controller);
		}

		let dragDepth = 0;
		const onDragEnter = (e: DragEvent) => {
			// Only count external file drags so internal drags (e.g. media-bin to track)
			// never increment the counter and cause it to desync from dragOver/drop.
			if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
				dragDepth++;
			}
		};
		const onDragOver = (e: DragEvent) => {
			// Ignore internal drags (e.g. a media-bin asset onto a track); only OS file
			// drops carry the "Files" type and should raise the import overlay.
			if (!e.dataTransfer?.types || !Array.from(e.dataTransfer.types).includes('Files')) return;
			e.preventDefault();
			setIsDraggingFile(true);
		};
		const onDragLeave = (e: DragEvent) => {
			if (!e.dataTransfer?.types || !Array.from(e.dataTransfer.types).includes('Files')) return;
			dragDepth--;
			if (dragDepth <= 0) {
				dragDepth = 0;
				setIsDraggingFile(false);
			}
		};
		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			dragDepth = 0;
			setIsDraggingFile(false);
			const files = e.dataTransfer?.files;
			if (files && files.length > 0) {
				for (const file of files) {
					if (isImportableFile(file)) onFileDrop(file);
				}
			}
		};
		window.addEventListener('dragenter', onDragEnter);
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);
		onCleanup(() => {
			unregisterKeyboard();
			releaseReplayCaptureStream();
			if (programSessionState() !== 'idle') {
				bridge?.send({ type: 'program-stop' });
			}
			releasePendingProgramSources(true);
			releaseActiveProgramMonitorTracks();
			stopProgramWriter();
			unsubscribePublish();
			publishController.dispose();
			window.removeEventListener('popstate', handlePopState);
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('dragenter', onDragEnter);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
			compatibilityImportGeneration++;
			pendingRelinkSourceId = null;
			clearCompatibilityPreview();
			thumbnailStore.clear();
			cleanupController.dispose();
			asrController.dispose();
			reframeController.dispose();
			drainPendingSourceFileRequests('Smart Reframe was torn down.');
			translationController.dispose();
			draftController.dispose();
			if (worker && bridge) {
				const workerToDispose = worker;
				workerToDispose.removeEventListener('error', handleWorkerCrash);
				const cleanup = {
					terminateFallback: undefined as ReturnType<typeof setTimeout> | undefined
				};
				const onDisposeComplete = (event: MessageEvent<WorkerStateMessage>) => {
					if (event.data.type !== 'dispose-complete') return;
					clearTimeout(cleanup.terminateFallback);
					workerToDispose.removeEventListener('message', onDisposeComplete);
					workerToDispose.terminate();
				};
				workerToDispose.addEventListener('message', onDisposeComplete);
				cleanup.terminateFallback = setTimeout(() => {
					workerToDispose.removeEventListener('message', onDisposeComplete);
					workerToDispose.terminate();
				}, 1500);
				bridge.dispose();
				bridge.send({ type: 'dispose' });
			} else if (worker) {
				worker.removeEventListener('error', handleWorkerCrash);
				worker.terminate();
			}
			audioEngine.dispose();
		});
	});

	return (
		<>
			<div
				classList={{
					app: true,
					'is-dragging-file': isDraggingFile()
				}}
				inert={docsSlug() !== null}
			>
				<Toolbar
					metadata={metadata()}
					playing={clock.playing}
					currentTime={clock.currentTime}
					duration={clock.duration}
					importAccept={VIDEO_ACCEPT}
					onImportFile={importMedia}
					onPickImport={pickImportMedia}
					onPlay={() => {
						const t = clock.currentTime();
						if (audioSabReady()) void audioEngine.play(t);
						bridge?.send({ type: 'play' });
					}}
					onPause={() => {
						bridge?.send({ type: 'pause' });
						audioEngine.pause();
					}}
					onStep={(direction) => bridge?.send({ type: 'step', direction })}
					canUndo={historyState().canUndo}
					canRedo={historyState().canRedo}
					onUndo={() => bridge?.send({ type: 'undo' })}
					onRedo={() => bridge?.send({ type: 'redo' })}
					transportDisabled={!previewSurfaceAvailable()}
					importBlocked={importBlocked()}
					importHint={importHint()}
					crossOriginIsolated={isIsolated()}
					pipelineMode={pipelineMode()}
					pipelineLabel={pipelineLabel()}
					previewLabel={previewLabel()}
					encodeFps={encodeFps()}
					onOpenCapabilities={() => setCapabilityPanelOpen(true)}
					onOpenHelp={() => openDocs()}
					onOpenAudioCleanup={() => setAudioCleanupOpen(true)}
					onOpenAutoCaptions={() => setAsrPanelOpen(true)}
					onOpenSmartReframe={() => setSmartReframeOpen(true)}
					onOpenSilenceReview={() => setSilenceReviewOpen(true)}
					onImportKeystrokeOverlay={() => setKeystrokeOverlayOpen(true)}
					keystrokeOverlayAvailable={true}
					onOpenLanguageTools={
						capabilityProbeV2()?.languageTools &&
						languageToolsSurfaceVisible(capabilityProbeV2()!.languageTools!)
							? () => {
									setLanguageToolsPanelOpen(true);
									// Re-probe on open so states refresh as models finish downloading.
									void refreshLanguageToolsProbe();
								}
							: undefined
					}
					onOpenPublish={() => setPublishPanelOpen(true)}
					publishLive={publishBusy()}
					calloutTool={
						<CalloutTool
							active={calloutToolActive()}
							capabilityTier={capabilityProbeV2()?.tier ?? 'shell-only'}
							onActivate={() => setCalloutToolActive(true)}
							onDeactivate={endCalloutPlacement}
							onBeginPlacement={beginCalloutPlacement}
						/>
					}
					masterGain={masterGain()}
					meterSab={meterSab()}
					onMasterGain={(gain) => {
						audioEngine.setMasterGain(gain);
						bridge?.send({ type: 'set-master-gain', gain });
					}}
					exportControl={
						<>
							<InterchangeMenu
								hasTimeline={hasTimeline()}
								videoTracks={timeline()
									.filter((track) => track.type === 'video')
									.map((track, index) => ({
										id: track.id,
										name: `V${index + 1}`,
										clipCount: track.clips.length
									}))}
								warnings={interchangeWarnings()}
								lastMessage={interchangeMessage()}
								onExport={(format, trackId) => {
									// Clear the previous export's outcome so stale warnings don't
									// show against the in-flight one.
									setInterchangeWarnings([]);
									setInterchangeMessage(null);
									bridge?.send({ type: 'export-interchange', format, trackId });
								}}
							/>
							<BundleDialog
								disabled={!accelerated()}
								directoryPickerAvailable={'showDirectoryPicker' in window}
								busy={bundleBusy()}
								progressPhase={bundlePhase()}
								integrityReport={bundleReport()}
								lastMessage={bundleMessage()}
								onExport={startBundleExport}
								onImport={startBundleImport}
								onCollect={startCollectMedia}
								onCancelJob={cancelBundleJob}
							/>
							<ExportDialog
								hasMedia={(metadata() !== null || hasTimeline()) && exportSurfaceAvailable()}
								exporting={exporting()}
								progress={exportProgress()}
								lastResult={exportResult()}
								error={exportError()}
								warnings={exportWarnings()}
								timelineDuration={clock.duration()}
								supportedCodecs={exportCodecs()}
								capabilityProbeV2={capabilityProbeV2()}
								interpolationExportAvailable={
									INTERPOLATION_EXPORT_PIPELINE_WIRED &&
									interpolationAvailability().state !== 'unavailable' &&
									interpolationModelStatus() === 'loaded'
								}
								initialSettings={exportSettings()}
								presets={exportPresets()}
								markers={markers()}
								projectAspect={projectAspect()}
								onProbe={probeExportCodecs}
								onStart={startExport}
								onCancel={() => bridge?.send({ type: 'export-cancel' })}
								onWhyConstraints={() => setCapabilityPanelOpen(true)}
								onOpenGuide={() => openDocs('exporting')}
								onSavePreset={handleSavePreset}
								onDeletePreset={handleDeletePreset}
								onEnqueue={handleEnqueue}
							/>
						</>
					}
				/>
				<Show keyed when={bundleReplacePrompt()}>
					{(prompt) => {
						let modalRef: HTMLDivElement | undefined;
						let replaceButtonRef: HTMLButtonElement | undefined;
						const previouslyFocused = document.activeElement as HTMLElement | null;
						const cancel = () => {
							bridge?.send({
								type: 'bundle-replace-decision',
								jobId: prompt.jobId,
								action: 'cancel'
							});
							setBundleReplacePrompt(null);
						};
						const replace = () => {
							bridge?.send({
								type: 'bundle-replace-decision',
								jobId: prompt.jobId,
								action: 'replace'
							});
							setBundleReplacePrompt(null);
						};
						const handleKeyDown = (e: KeyboardEvent) => {
							if (e.key === 'Escape') {
								e.preventDefault();
								cancel();
								return;
							}
							if (e.key !== 'Tab' || !modalRef) return;
							const focusables = modalRef.querySelectorAll<HTMLElement>(
								'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
							);
							if (focusables.length === 0) return;
							const first = focusables[0];
							const last = focusables[focusables.length - 1];
							const active = document.activeElement as HTMLElement | null;
							if (e.shiftKey && active === first) {
								e.preventDefault();
								last.focus();
							} else if (!e.shiftKey && active === last) {
								e.preventDefault();
								first.focus();
							}
						};
						onMount(() => {
							replaceButtonRef?.focus();
						});
						onCleanup(() => {
							previouslyFocused?.focus?.();
						});
						return (
							<div
								ref={modalRef}
								class="modal-backdrop bundle-replace-modal-backdrop"
								role="dialog"
								aria-modal="true"
								aria-labelledby="bundle-replace-title"
								aria-describedby="bundle-replace-message"
								onKeyDown={handleKeyDown}
							>
								<div class="bundle-replace-modal">
									<p id="bundle-replace-title" class="bundle-replace-modal-title">
										Replace current project?
									</p>
									<p id="bundle-replace-message" class="bundle-replace-modal-message">
										{prompt.message}
									</p>
									<div class="bundle-replace-modal-actions">
										<Button variant="outline" onClick={cancel}>
											Cancel
										</Button>
										<Button ref={replaceButtonRef} onClick={replace}>
											Replace
										</Button>
									</div>
								</div>
							</div>
						);
					}}
				</Show>
				<Show when={restoreOffer() || unresolvedSources().length > 0}>
					<section
						class="restore-banner"
						role={unresolvedSources().length > 0 ? 'alert' : undefined}
					>
						<div class="restore-banner-copy">
							<Show
								when={restoreOffer()}
								fallback={
									<>
										<p class="restore-banner-title">Offline media</p>
										<p class="restore-banner-detail">
											{unresolvedSources().length} source
											{unresolvedSources().length === 1 ? '' : 's'} need re-linking.
										</p>
									</>
								}
							>
								{(offer) => (
									<>
										<p class="restore-banner-title">
											Autosave from {formatSavedAt(offer().savedAt)}
										</p>
										<p class="restore-banner-detail">
											{offer().sources.length} source{offer().sources.length === 1 ? '' : 's'} in
											the saved project.
										</p>
									</>
								)}
							</Show>
						</div>
						<Show when={unresolvedSources().length > 0}>
							<ul class="restore-source-list">
								<For each={unresolvedSources()}>
									{(source) => (
										<li class="restore-source-item">
											<span title={formatSourceSummary(source)}>{formatSourceSummary(source)}</span>
											<Button
												size="sm"
												onClick={() => void pickRelinkFile(source.sourceId)}
												title={`Re-link ${source.fileName}`}
											>
												<Link2 size={13} aria-hidden="true" />
												Re-link
											</Button>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={restoreOffer()}>
							<div class="restore-actions">
								<Button onClick={() => bridge?.send({ type: 'restore-project' })}>
									<RotateCcw size={14} aria-hidden="true" />
									Restore
								</Button>
								<Button variant="outline" onClick={startNewProject}>
									<Plus size={14} aria-hidden="true" />
									New
								</Button>
							</div>
						</Show>
						<input
							ref={(el) => {
								relinkInput = el;
							}}
							type="file"
							accept={VIDEO_ACCEPT}
							onChange={handleRelinkInput}
							hidden
						/>
					</section>
				</Show>
				<Show when={latestHealthReport()}>
					{(report) => (
						<section
							class="source-health-banner"
							role={report().status === 'blocked' ? 'alert' : undefined}
						>
							<div class="restore-banner-copy">
								<p class="restore-banner-title">Media health · {report().fileName}</p>
								<p class="restore-banner-detail">
									{report().warnings.length} issue{report().warnings.length === 1 ? '' : 's'}{' '}
									detected.
								</p>
							</div>
							<ul class="source-health-list">
								<For each={report().warnings}>
									{(warning) => (
										<li class={`source-health-item is-${warning.severity}`}>
											<span>{warning.message}</span>
										</li>
									)}
								</For>
							</ul>
							<button
								type="button"
								class="export-why-link"
								onClick={() => openDocs('importing-media')}
							>
								What these warnings mean
							</button>
						</section>
					)}
				</Show>
				<AppErrorBoundary>
					<main
						class={`workspace${previewSurfaceAvailable() ? ' has-bin' : ''}${sideRailCollapsed() ? ' rail-collapsed' : ''}`}
					>
						<Show when={previewSurfaceAvailable()}>
							<aside class="dock-left" aria-label="Library">
								<nav class="dock-rail" aria-label="Workspace sections">
									<button
										type="button"
										onClick={() => void openDockImport()}
										disabled={importBlocked()}
										title={importHint() ?? 'Import media'}
									>
										Project
									</button>
									<button type="button" aria-current="page">
										Media
									</button>
									<button type="button" onClick={() => openSideRailTab('record')}>
										Record
									</button>
									<button type="button" onClick={() => setScopePanelCollapsed((open) => !open)}>
										Scopes
									</button>
									<button type="button" onClick={() => setAsrPanelOpen(true)}>
										AI
									</button>
									<button type="button" onClick={() => openSideRailTab('captions')}>
										Captions
									</button>
									<button type="button" onClick={() => setSmartReframeOpen(true)}>
										Reframe
									</button>
									<button
										type="button"
										onClick={() =>
											document
												.querySelector<HTMLElement>('.render-queue-panel')
												?.scrollIntoView({ block: 'nearest' })
										}
									>
										Output
									</button>
								</nav>
								<input
									ref={(el) => {
										dockImportInput = el;
									}}
									type="file"
									accept={VIDEO_ACCEPT}
									multiple
									onChange={handleImportInput}
									disabled={importBlocked()}
									aria-label="Import media from workspace dock"
									hidden
								/>
								<div class="dock-library">
									<MediaBin
										assets={assets}
										unresolvedIds={unresolvedIds}
										getThumbnail={(sourceId, timestamp) => thumbnailStore.get(sourceId, timestamp)}
										thumbnailVersion={thumbnailVersion}
										requestThumbnails={(sourceId, timestamps) =>
											bridge?.send({ type: 'request-thumbnails', sourceId, timestamps })
										}
										onPlace={(sourceId) => bridge?.send({ type: 'place-clip', sourceId })}
										onRemove={(sourceId) => bridge?.send({ type: 'remove-asset', sourceId })}
									/>
									<BeatPanel
										assets={assets}
										beatResults={beatResults}
										beatSettings={beatSettings}
										analysisProgress={beatProgress}
										onAnalyse={(sourceId) => bridge?.send({ type: 'analyze-beats', sourceId })}
										onCancel={(sourceId) => {
											bridge?.send({ type: 'cancel-beat-analysis', sourceId });
											// The worker intentionally sends no terminal message for an
											// explicit cancel (cancellation isn't an error). Clear the
											// progress entry optimistically so the BeatPanel row exits
											// the analysing state immediately.
											setBeatProgress((prev) => {
												if (!prev.has(sourceId)) return prev;
												const next = new Map(prev);
												next.delete(sourceId);
												return next;
											});
										}}
										onToggleSource={(sourceId, enabled) => {
											const current = beatSettings();
											const ids = enabled
												? [...current.enabledSourceIds, sourceId]
												: current.enabledSourceIds.filter((id) => id !== sourceId);
											bridge?.send({
												type: 'set-beat-settings',
												enabledSourceIds: ids,
												globalOffsetMs: current.globalOffsetMs
											});
											setBeatSettings({ ...current, enabledSourceIds: ids });
										}}
										onOffsetChange={(offsetMs) => {
											const current = beatSettings();
											bridge?.send({
												type: 'set-beat-settings',
												enabledSourceIds: current.enabledSourceIds,
												globalOffsetMs: offsetMs
											});
											setBeatSettings({ ...current, globalOffsetMs: offsetMs });
										}}
										onAutoCut={(mode) => {
											const selected = selectedClipRefs();
											if (selected.length === 0) return;
											bridge?.send({
												type: 'beat-auto-cut',
												mode,
												clipRefs: selected.map((r) => ({ trackId: r.trackId, clipId: r.clipId }))
											});
										}}
										selectedClipCount={() => selectedClipRefs().length}
									/>
								</div>
							</aside>
						</Show>
						<section
							class="preview panel"
							style={{
								'--preview-aspect': previewAspectStyle(),
								'--preview-aspect-num': previewAspectNum(),
								...previewCanvasBoxStyle()
							}}
						>
							<Show when={previewKey() + 1} keyed>
								{(_k) => (
									<PreviewCanvas onOffscreenReady={sendInit} onCanvasEl={setPreviewCanvasEl} />
								)}
							</Show>
							<Show when={previewSurfaceAvailable() && selectedClipTransform() && previewSize()}>
								<PreviewGizmo
									transform={selectedClipTransform()!.transform}
									sourceWidth={selectedClipTransform()!.sourceWidth}
									sourceHeight={selectedClipTransform()!.sourceHeight}
									outputWidth={previewSize()!.width}
									outputHeight={previewSize()!.height}
									canvasEl={previewCanvasEl}
									onChange={(transform) => {
										const sel = selectedClipTransform();
										if (!sel) return;
										const staticPatch = splitKeyframedTransformChange(transform);
										if (Object.keys(staticPatch).length > 0) {
											bridge?.send({
												type: 'set-transform',
												trackId: sel.trackId,
												clipId: sel.clipId,
												transform: staticPatch
											});
										}
									}}
								/>
							</Show>
							<Show when={previewSurfaceAvailable() && safeAreaGuides()}>
								<div class="safe-area-overlay" aria-hidden="true">
									<div class="safe-area-rect safe-area-action" />
									<div class="safe-area-rect safe-area-title" />
								</div>
							</Show>
							{/* Phase 39: Platform safe-zone overlay */}
							<Show when={previewSurfaceAvailable() && selectedPlatform()}>
								<SafeZoneOverlay
									platform={selectedPlatform()}
									outputWidth={projectOutputSize().width}
									outputHeight={projectOutputSize().height}
								/>
							</Show>
							<ReframeOverlay
								visible={
									smartReframeOpen() &&
									reframeState().status === 'review' &&
									reframeState().result !== null
								}
								keyframes={reframeState().result}
								currentTime={reframeOverlayTime()}
								sourceAspect={reframeState().context?.sourceAspect ?? 1}
								targetAspect={reframeState().context?.targetAspectValue ?? 1}
							/>
							<Show when={previewSurfaceAvailable() && previewRegionPickHandler() !== null}>
								<div
									class="region-pick-overlay"
									role="application"
									aria-label="Drag to set zoom region"
									tabIndex={0}
									onPointerUp={(e) => {
										const rect = e.currentTarget.getBoundingClientRect();
										const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
										const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
										const onPick = previewRegionPickHandler();
										setPreviewRegionPickHandler(null);
										onPick?.(nx, ny);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Escape') setPreviewRegionPickHandler(null);
									}}
								>
									<p>Drag on the preview to set the zoom region. Press Escape to cancel.</p>
								</div>
							</Show>
							<Show when={previewSurfaceAvailable() && calloutPlacementActive()}>
								<div
									class="callout-placement-overlay"
									role="application"
									aria-label="Draw callout"
									tabIndex={0}
									onKeyDown={(e) => {
										if (e.key === 'Escape') endCalloutPlacement();
									}}
									onPointerDown={(e) => {
										const target = e.currentTarget;
										const rect = target.getBoundingClientRect();
										const clamp = (value: number) => Math.max(0, Math.min(1, value));
										const startX = clamp((e.clientX - rect.left) / rect.width);
										const startY = clamp((e.clientY - rect.top) / rect.height);
										target.setPointerCapture(e.pointerId);

										const onPointerUp = (upEvent: PointerEvent) => {
											const endX = clamp((upEvent.clientX - rect.left) / rect.width);
											const endY = clamp((upEvent.clientY - rect.top) / rect.height);
											try {
												target.releasePointerCapture(upEvent.pointerId);
											} catch {
												// Pointer capture may already be gone after browser cancellation.
											}
											target.removeEventListener('pointerup', onPointerUp);
											completeCalloutPlacement(calloutPlacementKind(), startX, startY, endX, endY);
										};

										target.addEventListener('pointerup', onPointerUp);
									}}
								>
									<p>Drag to place {calloutPlacementKind()} callout. Press Escape to cancel.</p>
								</div>
							</Show>
							<Show when={previewSurfaceAvailable()}>
								<button
									type="button"
									class={`safe-area-toggle${safeAreaGuides() ? ' is-active' : ''}`}
									aria-pressed={safeAreaGuides()}
									onClick={() => setSafeAreaGuides((on) => !on)}
									title="Toggle title/action safe-area guides"
								>
									Safe areas
								</button>
							</Show>
							{/* Phase 39: format picker, platform picker, cover button */}
							<Show when={previewSurfaceAvailable()}>
								<div class="phase39-controls">
									<fieldset
										role="group"
										aria-label="Project format"
										style={{ display: 'flex', gap: '2px', 'flex-wrap': 'wrap' }}
									>
										<For each={['16:9', '9:16', '1:1', '4:5'] as const}>
											{(aspect) => (
												<button
													type="button"
													class={cn(
														buttonVariants({
															variant: projectAspect() === aspect ? 'default' : 'ghost',
															size: 'sm'
														}),
														'text-xs'
													)}
													aria-label={`Set project format to ${aspect} (${aspectLabel(aspect)})`}
													onClick={() => bridge?.send({ type: 'set-project-format', aspect })}
												>
													{aspect}
												</button>
											)}
										</For>
									</fieldset>
									<Show when={matchingPlatforms().length > 0}>
										<select
											aria-label="Safe zone platform"
											value={selectedPlatformId()}
											onChange={(e) => setSelectedPlatformId(e.currentTarget.value)}
											style={{
												'font-size': '11px',
												padding: '2px 4px',
												background: 'var(--input-bg, #1a1d24)',
												color: 'inherit',
												border: '1px solid rgb(255 255 255 / 14%)',
												'border-radius': 'var(--radius-sm)'
											}}
										>
											<option value="">Off</option>
											<For each={matchingPlatforms()}>
												{(p) => <option value={p.id}>{p.label}</option>}
											</For>
										</select>
									</Show>
									<button
										type="button"
										class={cn(
											buttonVariants({ variant: coverFrame() ? 'default' : 'ghost', size: 'sm' }),
											'text-xs'
										)}
										onClick={() =>
											bridge?.send({
												type: 'set-cover-frame',
												timeS: clock.currentTime(),
												titleClipId: coverTitleClipId() || null
											})
										}
										title="Set cover frame at current playhead position"
									>
										Cover
									</button>
									<Show when={coverTitleOptions().length > 0}>
										<select
											aria-label="Cover title overlay"
											value={coverTitleClipId()}
											onChange={(e) => setCoverTitleClipId(e.currentTarget.value)}
											class="cover-title-select"
										>
											<option value="">No title</option>
											<For each={coverTitleOptions()}>
												{(option) => <option value={option.id}>{option.label}</option>}
											</For>
										</select>
									</Show>
									<Show when={coverThumbnailUrl()}>
										{(url) => (
											<img
												class="cover-thumb-preview"
												src={url()}
												alt=""
												aria-label="Cover frame preview"
											/>
										)}
									</Show>
									<Show when={coverThumbnailError()}>
										{(error) => <span class="cover-thumb-warning">{error()}</span>}
									</Show>
								</div>
							</Show>
							<Show when={compatibilityPreview() !== null}>
								<LimitedPreview
									thumbnailUrl={compatibilityPreview()!.url}
									fileName={compatibilityPreview()!.fileName}
									width={compatibilityPreview()!.width}
									height={compatibilityPreview()!.height}
									duration={compatibilityPreview()!.duration}
								/>
							</Show>
							<Show when={!metadata() && !importing() && !hasTimeline()}>
								<div class="preview-empty">
									<div>
										<p class="preview-empty-eyebrow">
											{pipelineMode() === 'limited' || pipelineMode() === 'blocked'
												? 'Compatibility'
												: 'Preview'}
										</p>
										<p class="preview-empty-title">
											{previewSurfaceAvailable()
												? 'No source loaded'
												: pipelineMode() === 'limited' || pipelineMode() === 'blocked'
													? 'Preview unavailable'
													: 'No source loaded'}
										</p>
										<p class="preview-empty-copy">
											{previewSurfaceAvailable()
												? 'Drop an MP4, MOV, or WebM here.'
												: pipelineMode() === 'limited' || pipelineMode() === 'blocked'
													? (limitedIssue() ??
														(compatibilityImportEnabled()
															? 'Import still loads a reduced compatibility thumbnail so you can inspect a local clip.'
															: 'This browser cannot run the accelerated pipeline yet.'))
													: 'Drop an MP4, MOV, or WebM here.'}
										</p>
									</div>
									<label
										class={cn(
											buttonVariants({ variant: 'default' }),
											'import-picker',
											importBlocked() && 'is-disabled pointer-events-none'
										)}
										title={importHint() ?? undefined}
									>
										Import
										<input
											class="import-picker-overlay-input"
											type="file"
											accept={VIDEO_ACCEPT}
											multiple
											onChange={handleImportInput}
											disabled={importBlocked()}
											aria-label="Import media"
											title={importHint() ?? undefined}
										/>
									</label>
									<p>
										<Show
											when={pipelineMode() === 'limited' || pipelineMode() === 'blocked'}
											fallback={
												<button
													type="button"
													class="export-why-link"
													onClick={() => openDocs('getting-started')}
												>
													New here? Read the getting started guide
												</button>
											}
										>
											<button
												type="button"
												class="export-why-link"
												onClick={() => openDocs('browser-limitations')}
											>
												Why is this browser limited?
											</button>
										</Show>
									</p>
								</div>
							</Show>
							<Show when={importing()}>
								<div class="preview-overlay">Importing…</div>
							</Show>
							<Show when={scopePanelAvailable()}>
								<ScopePanel
									scopeSab={scopeSab}
									framePixelCount={scopeFramePixelCount}
									collapsed={scopePanelCollapsed}
									setCollapsed={setScopePanelCollapsed}
								/>
							</Show>
						</section>
						<div id="side-rail" class="side-rail" role="region" aria-label="Side panel">
							<Show
								when={!sideRailCollapsed()}
								fallback={
									<button
										id="side-rail-expand-btn"
										class="side-rail-expand"
										aria-label="Expand side panel"
										aria-expanded="false"
										aria-controls="side-rail"
										title="Expand side panel"
										onClick={() => toggleSideRail(false)}
									>
										‹
									</button>
								}
							>
								<Tabs.Root
									class="side-rail-tabs"
									value={activeSideRailTab()}
									lazyMount
									unmountOnExit
									onValueChange={(details) => {
										if (isSideRailTab(details.value)) setActiveSideRailTab(details.value);
									}}
								>
									<Tabs.List class="side-rail-tab-bar" aria-label="Side panel tabs">
										<For each={SIDE_RAIL_TABS}>
											{(tab) => (
												<Tabs.Trigger id={`tab-${tab.id}`} value={tab.id} class="side-rail-tab">
													{tab.label}
												</Tabs.Trigger>
											)}
										</For>
										<button
											class="side-rail-collapse"
											aria-label="Collapse side panel"
											aria-expanded="true"
											aria-controls="side-rail"
											title="Collapse side panel"
											onClick={() => toggleSideRail(true)}
										>
											›
										</button>
									</Tabs.List>
									<div class="side-rail-tab-content">
										<Tabs.Content
											value="inspector"
											id="panel-inspector"
											class="side-rail-tab-panel"
											aria-labelledby="tab-inspector"
										>
											<Inspector
												metadata={metadata()}
												selectedClip={selectedClip()}
												selectedTrackMix={selectedTrackMix()}
												selectedClipFades={selectedClipFades()}
												selectedClipTransform={selectedClipTransform()}
												selectedTitle={selectedTitle()}
												selectedTransition={selectedTransition()}
												capabilityTier={capabilityProbeV2()?.tier}
												sessionEventLogs={sessionEventLogs()}
												mediaAssets={assets()}
												onPickPreviewRegion={requestPreviewRegionPick}
												onSetTitle={(trackId, clipId, patch) =>
													bridge?.send({ type: 'set-title', trackId, clipId, ...patch })
												}
												onEffectParam={(trackId, clipId, key, value) =>
													bridge?.send({ type: 'set-effect-param', trackId, clipId, key, value })
												}
												onTransform={(trackId, clipId, transform) =>
													bridge?.send({ type: 'set-transform', trackId, clipId, transform })
												}
												playheadTime={clock.currentTime()}
												onSeek={(time) => bridge?.send({ type: 'seek', time })}
												onSetKeyframe={(trackId, clipId, key, t, value, easing) =>
													bridge?.send({
														type: 'set-keyframe',
														trackId,
														clipId,
														key,
														t,
														value,
														easing
													})
												}
												onDeleteKeyframe={(trackId, clipId, key, t) =>
													bridge?.send({ type: 'delete-keyframe', trackId, clipId, key, t })
												}
												onReplaceKeyframeTracks={(trackId, clipId, tracks) =>
													bridge?.send({
														type: 'replace-keyframe-tracks',
														trackId,
														clipId,
														tracks
													})
												}
												onSetCallout={(trackId, clipId, payload) =>
													bridge?.send({ type: 'set-callout', trackId, clipId, payload })
												}
												onSetPaddedBackground={(trackId, clipId, params) =>
													bridge?.send({
														type: 'set-padded-background',
														trackId,
														clipId,
														params
													})
												}
												onImportLut={(trackId, clipId, file) =>
													bridge?.send({ type: 'import-lut', trackId, clipId, file })
												}
												onLutStrength={(trackId, clipId, strength) =>
													bridge?.send({ type: 'set-lut-strength', trackId, clipId, strength })
												}
												onTrackGain={(trackId, gain) => {
													bridge?.send({ type: 'set-track-gain', trackId, gain });
												}}
												onTrackMute={(trackId, muted) => {
													bridge?.send({ type: 'set-track-mute', trackId, muted });
												}}
												onTrackSolo={(trackId, solo) => {
													bridge?.send({ type: 'set-track-solo', trackId, solo });
												}}
												onTrackPan={(trackId, pan) => {
													bridge?.send({ type: 'set-track-pan', trackId, pan });
												}}
												onClipFade={(trackId, clipId, edge, durationS) => {
													bridge?.send({
														type: 'set-clip-fade',
														trackId,
														clipId,
														edge,
														durationS
													});
												}}
												onTransitionKind={(transitionId, kind) => {
													bridge?.send({ type: 'set-transition', transitionId, kind });
												}}
												onTransitionDuration={(transitionId, durationS) => {
													bridge?.send({ type: 'set-transition', transitionId, durationS });
												}}
												onRemoveTransition={(transitionId) => {
													bridge?.send({ type: 'remove-transition', transitionId });
													transitionMeta.delete(transitionId);
													setSelectedTransitionId(null);
												}}
												onSkinMask={(trackId, clipId, mask) => {
													bridge?.send({ type: 'set-skin-mask', trackId, clipId, mask });
												}}
												onSkinSmoothBypass={(trackId, clipId, bypass) => {
													bridge?.send({
														type: 'set-skin-smooth-bypass',
														trackId,
														clipId,
														bypass
													});
												}}
												onSetMatteEnabled={(enabled) =>
													bridge?.send({
														type: 'set-matte-enabled',
														trackId: selectedClip()!.trackId,
														clipId: selectedClip()!.clipId,
														enabled
													})
												}
												onSetMatteStrength={(strength) =>
													bridge?.send({
														type: 'set-matte-strength',
														trackId: selectedClip()!.trackId,
														clipId: selectedClip()!.clipId,
														strength
													})
												}
												onSetMatteMode={(mode) =>
													bridge?.send({
														type: 'set-matte-mode',
														trackId: selectedClip()!.trackId,
														clipId: selectedClip()!.clipId,
														mode
													})
												}
												onSetMatteBlurRadius={(blurRadius) =>
													bridge?.send({
														type: 'set-matte-blur-radius',
														trackId: selectedClip()!.trackId,
														clipId: selectedClip()!.clipId,
														blurRadius
													})
												}
												matteStatus={matteStatus()}
												onSetTimeRemap={(trackId, clipId, remap) =>
													bridge?.send({ type: 'set-time-remap', trackId, clipId, remap })
												}
												onClearTimeRemap={(trackId, clipId) =>
													bridge?.send({ type: 'clear-time-remap', trackId, clipId })
												}
												onImportLookPreset={(trackId, clipId, presetFile, lutFile) =>
													bridge?.send({
														type: 'import-look-preset',
														trackId,
														clipId,
														presetFile,
														lutFile
													})
												}
												onExportLookPreset={(trackId, clipId) =>
													bridge?.send({ type: 'export-look-preset', trackId, clipId })
												}
												onBeautyEffect={(trackId, clipId, beauty) => {
													bridge?.send({ type: 'set-beauty-effect', trackId, clipId, beauty });
												}}
												beautyAvailable={beautyAvailable()}
												recorderSessionState={recorderStatus()?.state ?? 'idle'}
												onRetakeRequested={(clipId) => {
													setRetakeClipId(clipId);
													setActiveSideRailTab('record');
												}}
												beautyModelStatus={beautyModelStatus()}
												beautyModelSizeBytes={beautyModelSizeBytes() ?? undefined}
												beautyModelDownloadedBytes={beautyModelDownloadedBytes() ?? undefined}
												beautyModelError={beautyModelError() ?? undefined}
												onLoadBeautyModel={() =>
													bridge?.send({
														type: 'load-beauty-model',
														manifestUrl: '/models/beauty/manifest.json',
														preferredExecutionProvider: 'webgpu'
													})
												}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="captions"
											id="panel-captions"
											class="side-rail-tab-panel"
											aria-labelledby="tab-captions"
										>
											<TranscriptPanel
												captionTracks={captionTracks()}
												diagnostics={captionDiagnostics()}
												playheadTime={clock.currentTime()}
												selectedTrackId={selectedCaptionTrackId()}
												selectedSegmentIds={selectedCaptionSegmentIds()}
												onSelectTrack={setSelectedCaptionTrackId}
												onSelectSegmentIds={setSelectedCaptionSegmentIds}
												onImport={(file, trackId) =>
													captionBridge().send(
														trackId
															? { type: 'import-captions', file, trackId }
															: { type: 'import-captions', file }
													)
												}
												onExport={(settings: CaptionExportSettingsSnapshot) =>
													captionBridge().send({ type: 'export-captions', settings })
												}
												onSetTrack={(trackId, patch) =>
													captionBridge().send({ type: 'set-caption-track', trackId, ...patch })
												}
												onDeleteTrack={(trackId) =>
													captionBridge().send({ type: 'delete-caption-track', trackId })
												}
												onDeleteTracks={(trackIds) => {
													captionBridge().send({ type: 'delete-caption-tracks', trackIds });
												}}
												onSetSegmentText={(trackId, segmentId, text) =>
													captionBridge().send({
														type: 'set-caption-segment-text',
														trackId,
														segmentId,
														text
													})
												}
												onSetSegmentTiming={(trackId, segmentId, start, end) =>
													captionBridge().send({
														type: 'set-caption-segment-timing',
														trackId,
														segmentId,
														start,
														end
													})
												}
												onSetSegmentStyle={(trackId, segmentId, style) =>
													captionBridge().send({
														type: 'set-caption-segment-style',
														trackId,
														segmentId,
														style
													})
												}
												onSplit={(trackId, segmentId, time) =>
													captionBridge().send({
														type: 'split-caption-segment',
														trackId,
														segmentId,
														time
													})
												}
												onMerge={(trackId, segmentIds) =>
													captionBridge().send({
														type: 'merge-caption-segments',
														trackId,
														segmentIds
													})
												}
												onDelete={(trackId, segmentIds) =>
													captionBridge().send({
														type: 'delete-caption-segments',
														trackId,
														segmentIds
													})
												}
												onSnap={(trackId, segmentId, edge) =>
													captionBridge().send({
														type: 'snap-caption-segment',
														trackId,
														segmentId,
														edge
													})
												}
												customAnimCaptionPresets={customAnimCaptionPresets()}
												onSetAnimPreset={(trackId, segmentId, presetId) =>
													captionBridge().send({
														type: 'caption-set-anim-style',
														trackId,
														segmentId,
														presetId
													})
												}
												onImportCustomPreset={(preset) =>
													captionBridge().send({
														type: 'caption-import-custom-preset',
														preset
													})
												}
												onDeleteCustomPreset={(presetId) =>
													captionBridge().send({
														type: 'caption-delete-custom-preset',
														presetId
													})
												}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="record"
											id="panel-record"
											class="side-rail-tab-panel"
											aria-labelledby="tab-record"
										>
											<RecordPanel
												probe={capabilityProbeV2()}
												status={recorderStatus()}
												retakeClipId={retakeClipId()}
												retakeSourceKinds={retakeSourceKinds()}
												landedSessionId={recorderLandedSessionId()}
												onAddSource={(source, track, transfer) =>
													bridge?.send({ type: 'capture-add-source', source, track }, transfer)
												}
												onStart={(settings, writerPort, activeRetakeClipId, transfer) => {
													setRecorderLandedSessionId(null);
													bridge?.send(
														{
															type: 'capture-start',
															settings,
															writerPort,
															retakeClipId: activeRetakeClipId ?? undefined
														},
														transfer
													);
												}}
												onPause={() => bridge?.send({ type: 'capture-pause' })}
												onResume={() => bridge?.send({ type: 'capture-resume' })}
												onStop={() => bridge?.send({ type: 'capture-stop' })}
												onApplyRegion={(sourceId, mode) =>
													bridge?.send({ type: 'capture-apply-region', sourceId, mode })
												}
												onRetakeCleared={() => setRetakeClipId(null)}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="program"
											id="panel-program"
											class="side-rail-tab-panel"
											aria-labelledby="tab-program"
										>
											<ProgramPanel
												programMode={programModeSupport}
												scenes={programScenes}
												sessionState={programSessionState}
												activeSceneId={programActiveSceneId}
												sourceStatus={programSourceStatus}
												budgetUsage={programBudgetUsage}
												acquiredSources={programSources}
												error={programError}
												transitionMs={programTransitionMs}
												onAddScreen={() => void addProgramScreen()}
												onAddCamera={(deviceId) => void addProgramCamera(deviceId)}
												onAddMic={(deviceId) => void addProgramMic(deviceId)}
												onRemoveSource={removeProgramSource}
												onAddScene={addProgramScene}
												onRemoveScene={removeProgramScene}
												onRenameScene={renameProgramScene}
												onSetHotkey={setProgramSceneHotkey}
												onUpdateLayers={updateProgramSceneLayers}
												onSetTransitionMs={setProgramTransitionMs}
												onStart={startProgramSession}
												onStop={stopProgramSession}
												onSwitchScene={switchProgramScene}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="replay"
											id="panel-replay"
											class="side-rail-tab-panel"
											aria-labelledby="tab-replay"
										>
											<ReplayBufferPanel
												captureState={captureSession()}
												ringBufferState={replayBufferState()}
												onStartCapture={() => void startReplayCapture()}
												onStopCapture={stopReplayCapture}
												onSaveLastN={(nSeconds) => {
													if (!bridge) return;
													setReplaySaveInProgress(true);
													bridge.send({ type: 'replay-save-last-n', nSeconds });
												}}
												saveInProgress={replaySaveInProgress()}
												isSupported={replayCaptureSupported()}
												supportedReason={replayCaptureUnsupportedReason()}
												crossOriginIsolated={capabilities().crossOriginIsolated}
												initiallyExpanded={true}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="live-audio"
											id="panel-live-audio"
											class="side-rail-tab-panel"
											aria-labelledby="tab-live-audio"
										>
											<LiveAudioChainPanel
												config={liveChainConfig()}
												onConfigChange={(partial) =>
													bridge?.send({ type: 'update-live-chain-config', config: partial })
												}
												latencyMs={liveChainLatencyMs()}
												crossOriginIsolated={capabilities().crossOriginIsolated}
												isCapturing={captureSession()?.active ?? false}
												initiallyExpanded={true}
											/>
										</Tabs.Content>
										<Tabs.Content
											value="voice-cleanup"
											id="panel-voice-cleanup"
											class="side-rail-tab-panel"
											aria-labelledby="tab-voice-cleanup"
										>
											<VoiceCleanupPanel
												settings={voiceCleanupSettings()}
												trackNames={
													new Map(
														timeline()
															.filter((t) => t.type === 'audio')
															.map((t) => [t.id, `Audio ${t.id.slice(0, 8)}`])
													)
												}
												onSettingsChange={(settings) => {
													setVoiceCleanupSettings(settings);
													bridge?.send({ type: 'voice-cleanup-update-settings', settings });
												}}
												onAnalyseLoudness={(targetLufs) => {
													setVoiceCleanupAnalysisState('running');
													setVoiceCleanupAnalysisProgress(0);
													setVoiceCleanupMeasuredLufs(0);
													setVoiceCleanupProposedGainDb(0);
													setVoiceCleanupNormalisedLufs(0);
													bridge?.send({ type: 'voice-cleanup-analyse-loudness', targetLufs });
												}}
												onCancelAnalysis={() => {
													bridge?.send({ type: 'voice-cleanup-cancel-analysis' });
												}}
												onApplyNormalisation={(gainDb) => {
													setVoiceCleanupSettings((s) => ({ ...s, normaliseGainDb: gainDb }));
													bridge?.send({
														type: 'voice-cleanup-apply-normalisation',
														normalisationGainDb: gainDb
													});
												}}
												analysisState={voiceCleanupAnalysisState()}
												analysisProgress={voiceCleanupAnalysisProgress()}
												measuredLufs={voiceCleanupMeasuredLufs()}
												proposedGainDb={voiceCleanupProposedGainDb()}
												normalisedLufs={voiceCleanupNormalisedLufs()}
												analysisError={voiceCleanupAnalysisError()}
												latencyMs={voiceCleanupMonitorLatencyMs()}
												sampleRate={voiceCleanupMonitorSampleRate()}
												timelineEmpty={timeline().length === 0}
												denoiserStatus={voiceCleanupDenoiserStatus()}
												denoiserUnavailableReason={voiceCleanupDenoiserUnavailableReason()}
												initiallyExpanded={true}
											/>
										</Tabs.Content>
									</div>
								</Tabs.Root>
							</Show>
						</div>
					</main>
					<Timeline
						currentTime={clock.currentTime}
						duration={clock.duration}
						frameRate={() => metadata()?.video?.frameRate ?? null}
						hasMedia={
							(metadata() !== null ||
								hasTimeline() ||
								transitions().length > 0 ||
								markers().length > 0 ||
								assets().length > 0) &&
							previewSurfaceAvailable()
						}
						timeline={timeline}
						markers={markers}
						selectedClipRefs={selectedClipRefs}
						waveformPeaks={() => waveformPeaks()}
						transitions={transitions}
						selectedTransition={selectedTransition}
						beatResults={beatResults}
						beatSettings={beatSettings}
						onSelectTransition={(transitionId, fromClipId, toClipId, trackId) => {
							const transition = transitions().find((t) => t.id === transitionId);
							if (transition) {
								transitionMeta.set(transitionId, { trackId, fromClipId, toClipId });
								setSelectedTransitionId(transitionId);
							}
						}}
						onTransitionDuration={(transitionId, durationS) => {
							bridge?.send({ type: 'set-transition', transitionId, durationS });
						}}
						onSeek={(t) => {
							if (audioSabReady()) void audioEngine.seek(t);
							bridge?.send({ type: 'seek', time: t });
						}}
						onSplit={(trackId, _clipId, time) => bridge?.send({ type: 'split', trackId, time })}
						onDelete={(trackId, clipId) => bridge?.send({ type: 'delete-clip', trackId, clipId })}
						onTrim={(trackId, clipId, edge, time) =>
							bridge?.send({ type: 'trim-clip', trackId, clipId, edge, time })
						}
						onMoveClips={(moves) => bridge?.send({ type: 'move-clips', moves })}
						onSelectClip={selectClip}
						onSelectClips={(clips) => setSelectedClipRefs(clips)}
						onAddTitle={(start) => bridge?.send({ type: 'add-title', start })}
						onAddMarker={(time, label) => bridge?.send({ type: 'add-marker', time, label })}
						onDeleteMarker={(markerId) => bridge?.send({ type: 'delete-marker', markerId })}
						onCloseGaps={(trackId) =>
							bridge?.send(trackId ? { type: 'close-gaps', trackId } : { type: 'close-gaps' })
						}
						onPlaceAsset={(sourceId, trackId, start) =>
							bridge?.send({ type: 'place-clip', sourceId, trackId, start })
						}
						onAddTrack={(trackType) => bridge?.send({ type: 'add-track', trackType })}
						onRemoveTrack={(trackId) => bridge?.send({ type: 'remove-track', trackId })}
						onReorderTrack={(trackId, toIndex) =>
							bridge?.send({ type: 'reorder-track', trackId, toIndex })
						}
						onSetTrackLock={(trackId, locked) =>
							bridge?.send({ type: 'set-track-lock', trackId, locked })
						}
						onSetTrackVisible={(trackId, visible) =>
							bridge?.send({ type: 'set-track-visible', trackId, visible })
						}
						onSetTrackSyncLock={(trackId, syncLocked) =>
							bridge?.send({ type: 'set-track-sync-lock', trackId, syncLocked })
						}
						onSetTrackEditTarget={(trackId, editTarget) =>
							bridge?.send({ type: 'set-track-edit-target', trackId, editTarget })
						}
						getThumbnail={(sourceId, timestamp) => thumbnailStore.get(sourceId, timestamp)}
						thumbnailVersion={thumbnailVersion}
						onRequestThumbnails={(sourceId, timestamps) =>
							bridge?.send({ type: 'request-thumbnails', sourceId, timestamps })
						}
					/>
					<RenderQueuePanel
						queue={renderQueue()}
						onStart={startRenderQueue}
						onCancelJob={(jobId) => bridge?.send({ type: 'queue-cancel-job', jobId })}
						onCancelAll={() => bridge?.send({ type: 'queue-cancel-all' })}
						onRetry={(jobId) => bridge?.send({ type: 'queue-retry', jobId })}
						onRemove={(jobId) => bridge?.send({ type: 'queue-remove', jobId })}
						onSetStopOnError={(stopOnError) =>
							bridge?.send({ type: 'queue-set-stop-on-error', stopOnError })
						}
					/>
					<footer class="status-bar">
						<span
							role="status"
							aria-live={exporting() ? 'off' : 'polite'}
							aria-atomic={exporting() ? 'false' : 'true'}
						>
							{statusLine()}
						</span>
						<span class="status-meta">
							<Show when={needRefresh()}>
								<button
									type="button"
									class="status-badge"
									onClick={() => updateServiceWorker(true)}
									title="Click to update app"
								>
									Update Available
								</button>
							</Show>
							<Show when={(offlineReady() || hasActiveSW()) && !isOffline()}>
								<span class="status-badge" title="App ready to work offline">
									Ready Offline
								</span>
							</Show>
							<Show when={isOffline()}>
								<span class="status-badge status-warn" title="No internet connection">
									Offline
								</span>
							</Show>
							<Show when={workerRecoveryState() !== 'running'}>
								<span class="status-badge status-warn" title={`Worker: ${workerRecoveryState()}`}>
									{workerRecoveryState() === 'throttled' ? 'Worker Failed' : 'Worker Recovering'}
								</span>
							</Show>
							<Show when={audioWarning()}>
								<span class="status-badge status-warn" title={audioWarning()!}>
									Audio Disabled
								</span>
							</Show>
							<Show when={capabilityTierV2Label(capabilityProbeV2())}>
								{(label) => (
									<span
										class={`status-badge${capabilityProbeV2()?.tier === 'core-webgpu' ? '' : ' status-warn'}`}
										title={
											capabilityProbeV2()
												? (compatibilityReadiness(capabilityProbeV2()!.tier).note ??
													'CapabilityTierV2')
												: 'CapabilityTierV2'
										}
									>
										{label()}
									</span>
								)}
							</Show>
							<button
								type="button"
								class="status-badge"
								onClick={openDiagnostics}
								title="Open diagnostics"
							>
								Diagnostics
							</button>
							<Show when={isIsolated()}>
								<span class="status-ok">COOP/COEP OK</span>
							</Show>
						</span>
					</footer>
					<AudioCleanupPanel
						open={audioCleanupOpen()}
						state={cleanupState()}
						selectedClip={selectedAudioCleanupClip()}
						appliedCleanup={appliedCleanupInfo()}
						onLoadModel={() => void cleanupController.loadModel()}
						onPreview={() => {
							const clip = selectedAudioCleanupClip();
							if (!clip) return;
							pauseFromKeyboard();
							void cleanupController.previewCleanup(clip);
						}}
						onApply={() => {
							const clip = selectedAudioCleanupClip();
							if (!clip) return;
							pauseFromKeyboard();
							void cleanupController.applyCleanup(clip);
						}}
						onCancel={() => cleanupController.cancel()}
						onRemoveCleanup={() => {
							const applied = appliedCleanupInfo();
							if (!applied) return;
							bridge?.send({
								type: 'remove-audio-cleanup',
								trackId: applied.trackId,
								clipId: applied.clipId
							});
						}}
						onClose={() => setAudioCleanupOpen(false)}
					/>
					<AutoCaptionsPanel
						open={asrPanelOpen()}
						state={asrState()}
						selectedClip={selectedAsrClip()}
						onLoadModel={() => void asrController.loadModel()}
						onSelectModel={(id) => asrController.selectModel(id)}
						onTranscribeClip={(language) => {
							const clip = selectedAsrClip();
							if (!clip) return;
							pauseFromKeyboard();
							void asrController.transcribeClip(clip, language);
						}}
						onTranscribeRange={(language) => {
							pauseFromKeyboard();
							const startS = clock.currentTime();
							const durationS = Math.min(
								ASR_PREVIEW_SECONDS,
								Math.max(0, clock.duration() - startS)
							);
							if (durationS <= 0) return;
							void asrController.transcribeRange({ startS, durationS }, language);
						}}
						onCancel={() => asrController.cancel()}
						onClose={() => setAsrPanelOpen(false)}
					/>
					<SmartReframePanel
						open={smartReframeOpen()}
						state={reframeState()}
						selectedClip={reframePanelClip()}
						faceDetectionSupported={
							capabilityProbeV2()?.smartReframe?.faceDetection === 'supported'
						}
						workerAvailable={capabilityProbeV2()?.smartReframe?.analysisWorker !== 'unsupported'}
						onLoadFaceModel={() =>
							void reframeController.loadFaceModel(REFRAME_FACE_ONNX_MANIFEST_URL)
						}
						onAnalyse={(settings) => void handleReframeAnalyse(settings)}
						onCancel={() => reframeController.cancel()}
						onApply={handleReframeApply}
						onDiscard={() => reframeController.discard()}
						onClose={() => {
							// Closing while busy stops the worker rather than leaving it
							// scanning the whole clip with no visible UI.
							const status = reframeController.getState().status;
							if (status === 'resolving' || status === 'analysing') reframeController.cancel();
							setSmartReframeOpen(false);
						}}
					/>
					<Show when={silenceReviewOpen()}>
						{(() => {
							// Prefer the audio tracks of currently-selected clips so dead-air
							// detection respects the user's targeting; fall back to every
							// audio track only when nothing is selected. The worker
							// intersects per-track results, so even the fallback only
							// proposes ranges silent on every selected track.
							const selectedAudioTrackIds = () => {
								const selectedTracks = new Set<string>();
								for (const ref of selectedClipRefs()) selectedTracks.add(ref.trackId);
								return timeline()
									.filter((t) => t.type === 'audio' && selectedTracks.has(t.id))
									.map((t) => t.id);
							};
							const silenceTrackIds = () => {
								const sel = selectedAudioTrackIds();
								if (sel.length > 0) return sel;
								return timeline()
									.filter((track) => track.type === 'audio')
									.map((track) => track.id);
							};
							return (
								<SilenceReviewPanel
									trackIds={silenceTrackIds()}
									selectionScope={selectedAudioTrackIds().length > 0 ? 'selection' : 'all-audio'}
									sendCommand={(cmd) => bridge?.send(cmd)}
									onWorkerMessage={(handler) => {
										const wrapped = (msg: import('../protocol').WorkerStateMessage) => {
											if (
												msg.type === 'silence-progress' ||
												msg.type === 'silence-result' ||
												msg.type === 'silence-error'
											) {
												handler(msg);
											}
										};
										const worker = ensureWorker().worker;
										const listener = (e: MessageEvent) => wrapped(e.data);
										worker.addEventListener('message', listener);
										return () => worker.removeEventListener('message', listener);
									}}
									onApplyRegion={(region) => {
										bridge?.send({
											type: 'apply-silence-cuts',
											regions: [region],
											trackIds: silenceTrackIds()
										});
									}}
									onApplyAll={(regions) => {
										bridge?.send({
											type: 'apply-silence-cuts',
											regions,
											trackIds: silenceTrackIds()
										});
									}}
									onClose={() => setSilenceReviewOpen(false)}
								/>
							);
						})()}
					</Show>
					<Show when={keystrokeOverlayOpen()}>
						<KeystrokeOverlayPanel
							sendCommand={(cmd) => bridge?.send(cmd)}
							onClose={() => setKeystrokeOverlayOpen(false)}
							landedSessionId={recorderLandedSessionId()}
							captureRecording={
								recorderStatus()?.state === 'recording' || recorderStatus()?.state === 'paused'
							}
							sidecarReady={sidecarReadySessionId() === recorderLandedSessionId()}
							resolveSessionStartS={resolveSessionStartS}
						/>
					</Show>
					<LanguageToolsPanel
						open={languageToolsPanelOpen()}
						translationState={translationState()}
						draftState={draftState()}
						captionTracks={captionTracks()}
						onTranslate={(trackId, targetLang) => {
							const track = captionTracks().find((t) => t.id === trackId);
							if (!track) return;
							pauseFromKeyboard();
							void translationController.translateTrack(
								{
									id: track.id,
									name: track.name,
									language: track.language ?? undefined,
									segments: track.segments
								},
								targetLang
							);
						}}
						onCancelTranslate={() => translationController.cancel()}
						onGenerateDraft={(trackId) => {
							const track = captionTracks().find((t) => t.id === trackId);
							if (!track) return;
							pauseFromKeyboard();
							void draftController.generateDraft(track.segments);
						}}
						onCancelDraft={() => draftController.cancel()}
						onExportBilingual={(sourceTrackId, translatedTrackId) => {
							const tracks = captionTracks();
							const source = tracks.find((t) => t.id === sourceTrackId);
							const translated = tracks.find((t) => t.id === translatedTrackId);
							if (!source || !translated) return;
							const baseStem = source.name || 'captions';
							// Reuse the Phase 22 sidecar path: one export per track, with a
							// language-suffixed stem so the pair drops out as e.g. clip.en.srt
							// and clip.zh.srt.
							for (const [track, fallback] of [
								[source, 'source'],
								[translated, 'translated']
							] as const) {
								captionBridge().send({
									type: 'export-captions',
									settings: {
										trackId: track.id,
										formats: ['srt', 'webvtt'],
										range: { mode: 'full-track' },
										fileStem: languageSuffixedStem(baseStem, track.language, fallback)
									}
								});
							}
							setStatusLine('Exporting bilingual captions…');
						}}
						onOpenGuide={() => openDocs('language-tools')}
						onClose={() => setLanguageToolsPanelOpen(false)}
					/>
					<PublishPanel
						open={publishPanelOpen()}
						probe={capabilityProbeV2()}
						state={publishState()}
						tapStats={publishTapStats()}
						errorDetail={publishErrorDetail()}
						recordWhileStreamingAvailable={recordWhileStreaming()}
						onGoLive={(settings) => void publishController.goLive(settings)}
						onStop={() => void publishController.stop()}
						onClose={() => setPublishPanelOpen(false)}
						onOpenGuide={() => {
							setPublishPanelOpen(false);
							openDocs('live-streaming');
						}}
					/>
					<CapabilityPanel
						open={capabilityPanelOpen()}
						tier={pipelineMode()}
						tierLabel={pipelineLabel()}
						features={listCapabilityFeatures(capabilities(), matteStatus().probe)}
						primaryIssue={limitedIssue()}
						compatibilityPreviewAvailable={canCompatibilityPreview(capabilities())}
						previewReady={previewReady()}
						exportReady={exportReady()}
						capabilityProbeV2={capabilityProbeV2()}
						onOpenGuide={() => {
							setCapabilityPanelOpen(false);
							openDocs('browser-limitations');
						}}
						onClose={() => setCapabilityPanelOpen(false)}
					/>
					<DiagnosticsPanel
						open={diagnosticsPanelOpen()}
						snapshot={diagnosticSnapshot()}
						sources={diagnosticSources()}
						onRefresh={openDiagnostics}
						onOpenGuide={() => {
							setDiagnosticsPanelOpen(false);
							openDocs('performance');
						}}
						onClose={() => setDiagnosticsPanelOpen(false)}
						onRecoveryAction={(actionId) => {
							switch (actionId) {
								case 'restart-worker':
									void restartWorker();
									break;
								case 'reload-app':
									window.location.reload();
									break;
								case 'retry-audio':
									audioReady = null;
									setAudioWarning(null);
									if (sab) {
										audioReady = audioEngine.init(sab);
										audioReady.then(
											(result) => {
												setMeterSab(result.meterSab);
												setVoiceCleanupMonitorSampleRate(audioEngine.getSampleRate());
												setVoiceCleanupMonitorLatencyMs(
													voiceCleanupLatencyMs(audioEngine.getSampleRate())
												);
												setAudioWarning(null);
											},
											(err) => {
												setAudioWarning(
													`Audio disabled: ${err instanceof Error ? err.message : String(err)}`
												);
											}
										);
									}
									break;
								default:
									bridge?.send({ type: 'run-recovery-action', actionId });
									break;
							}
						}}
					/>
				</AppErrorBoundary>
			</div>
			<Show when={docsSlug() !== null}>
				<DocsPage
					// Guarded by the Show: docsSlug is non-null while the guide is open.
					slug={docsSlug()!}
					onNavigate={openDocs}
					onClose={closeDocs}
				/>
			</Show>
		</>
	);
}
