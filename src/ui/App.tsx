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
	type RenderQueueState,
	type BundleIntegrityReportSnapshot,
	type BundleSourcePolicySnapshot,
	type MediaAssetSnapshot,
	type MediaMetadata,
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
	DEFAULT_LIVE_AUDIO_CHAIN_CONFIG,
	type CaptureSessionState,
	type LiveAudioChainConfig,
	type RingBufferState
} from '../protocol';
import type { DiagnosticSnapshot, DiagnosticSourceInput } from '../diagnostics/types';
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
import { Timeline } from './Timeline';
import { Inspector, type SelectedClip, type SelectedTransition } from './Inspector';
import { MediaBin } from './MediaBin';
import { TranscriptPanel } from './TranscriptPanel';
import { ThumbnailStore } from './thumbnail-store';
import { AudioEngine } from './audio-engine';
import { ExportDialog } from './ExportDialog';
import { RenderQueuePanel } from './RenderQueuePanel';
import { ReplayBufferPanel } from './ReplayBufferPanel';
import { LiveAudioChainPanel } from './LiveAudioChainPanel';
import { probeMediaStreamTrackProcessor, startCapture, stopCaptureStreams } from './capture-bridge';
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
import { clipLocalTime, hasKeyframeTrack, sampleEffectsAt, sampleTransformAt } from './keyframes';
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
import { compatibilityReadiness } from '../engine/compatibility/compat-status';
import { extractCompatibilityPreview } from '../compatibility/thumbnail';
import {
	createJob,
	createJobsFromMarkers,
	createEmptyQueueState,
	suggestedFileNameForJob
} from '../engine/render-queue';
import { BUILT_IN_PRESETS } from '../engine/export-presets';
import { createRecoveryMachine, type WorkerRecoveryState } from '../engine/recovery';
import { AppErrorBoundary } from './ErrorBoundary';
import { AudioCleanupPanel, type AppliedCleanupInfo } from './AudioCleanupPanel';
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
import PipelineWorker from '../engine/worker.ts?worker';

const VIDEO_ACCEPT =
	'video/mp4,video/quicktime,video/webm,image/*,audio/*,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.ogg';
const VIDEO_PICKER_TYPES = [
	{
		description: 'Media files',
		accept: {
			'video/mp4': ['.mp4'],
			'video/quicktime': ['.mov'],
			'video/webm': ['.webm'],
			'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
			'audio/*': ['.mp3', '.m4a', '.wav', '.ogg']
		}
	}
];

const MEDIA_FILE_PATTERN = /\.(mp4|mov|webm|png|jpe?g|webp|gif|bmp|avif|mp3|m4a|wav|ogg)$/i;

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

function formatSourceSummary(source: SourceDescriptorSnapshot): string {
	const mb = source.byteSize / 1_000_000;
	return `${source.fileName} · ${mb.toFixed(mb >= 10 ? 0 : 1)} MB · ${source.durationS.toFixed(2)}s`;
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
	{ id: 'replay', label: 'Replay' },
	{ id: 'live-audio', label: 'Audio' }
] as const;
type SideRailTab = (typeof SIDE_RAIL_TABS)[number]['id'];

const SIDE_RAIL_COLLAPSED_KEY = 'side-rail-collapsed';

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
	const [safeAreaGuides, setSafeAreaGuides] = createSignal(false);
	const [encodeFps, setEncodeFps] = createSignal<number | null>(null);
	const [timeline, setTimeline] = createSignal<TimelineTrackSnapshot[]>([]);
	const [captionTracks, setCaptionTracks] = createSignal<CaptionTrackSnapshot[]>([]);
	const [captionDiagnostics, setCaptionDiagnostics] = createSignal<CaptionDiagnosticSnapshot[]>([]);
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
	const [exportPresets, setExportPresets] = createSignal<ExportPresetDoc[]>(
		BUILT_IN_PRESETS.map((preset) => ({ ...preset }))
	);
	const [renderQueue, setRenderQueue] = createSignal<RenderQueueState>(createEmptyQueueState());
	// Phase 46: Replay Buffer + Live Audio Chain
	const [captureSession, setCaptureSession] = createSignal<CaptureSessionState | null>(null);
	const [replayBufferState, setReplayBufferState] = createSignal<RingBufferState | null>(null);
	const [replaySaveInProgress, setReplaySaveInProgress] = createSignal(false);
	const [liveChainConfig, setLiveChainConfig] = createSignal<LiveAudioChainConfig>(
		DEFAULT_LIVE_AUDIO_CHAIN_CONFIG
	);
	const [liveChainLatencyMs, setLiveChainLatencyMs] = createSignal(0);
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
		queueMicrotask(() => {
			if (collapsed) {
				document.getElementById('side-rail-expand-btn')?.focus();
			} else {
				document.getElementById(`tab-${activeSideRailTab()}`)?.focus();
			}
		});
	};
	const handleSideRailTabKeyDown = (event: KeyboardEvent) => {
		// WAI-ARIA APG tabs pattern: Arrow keys wrap, Home/End jump to ends.
		let next: (typeof SIDE_RAIL_TABS)[number] | undefined;
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			const index = SIDE_RAIL_TABS.findIndex((tab) => tab.id === activeSideRailTab());
			const direction = event.key === 'ArrowRight' ? 1 : -1;
			next = SIDE_RAIL_TABS[(index + direction + SIDE_RAIL_TABS.length) % SIDE_RAIL_TABS.length];
		} else if (event.key === 'Home') {
			next = SIDE_RAIL_TABS[0];
		} else if (event.key === 'End') {
			next = SIDE_RAIL_TABS[SIDE_RAIL_TABS.length - 1];
		} else {
			return;
		}
		setActiveSideRailTab(next.id);
		queueMicrotask(() => document.getElementById(`tab-${next.id}`)?.focus());
		event.preventDefault();
	};
	const [bundleMessage, setBundleMessage] = createSignal<string | null>(null);
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
	let relinkInput: HTMLInputElement | undefined;
	let pendingRelinkSourceId: string | null = null;
	const audioEngine = new AudioEngine();
	let audioReady: Promise<{
		audioSab: SharedArrayBuffer | null;
		meterSab: SharedArrayBuffer | null;
	}> | null = null;
	const [meterSab, setMeterSab] = createSignal<SharedArrayBuffer | null>(null);
	const [audioSabReady, setAudioSabReady] = createSignal(false);

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

	// ── Phase 28: Local Audio Cleanup (WebNN RNNoise, experimental) ──
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
		fetchManifest: async () => {
			const response = await fetch(`${import.meta.env.BASE_URL}models/rnnoise/manifest.json`);
			if (!response.ok) throw new Error(`Model manifest unavailable (HTTP ${response.status}).`);
			return response.json();
		},
		weightsUrl: `${import.meta.env.BASE_URL}models/rnnoise/weights.bin`,
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

	function findTimelineClip(ref: TimelineClipReference): TimelineClipSnapshot | null {
		const track = timeline().find((item) => item.id === ref.trackId);
		return track?.clips.find((clip) => clip.id === ref.clipId) ?? null;
	}

	const selectedClip = createMemo<SelectedClip | null>(() => {
		for (const ref of selectedClipRefs()) {
			const clip = findTimelineClip(ref);
			if (clip) {
				const localTime = clipLocalTime(clip, clock.currentTime());
				return {
					trackId: ref.trackId,
					clipId: clip.id,
					start: clip.start,
					duration: clip.duration,
					effects: sampleEffectsAt(clip.effects, clip.keyframes, localTime),
					transform: sampleTransformAt(clip.transform, clip.keyframes, localTime),
					keyframes: clip.keyframes,
					lut: clip.lut
				};
			}
		}
		return null;
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
		// Title clips are source-less: their raster is a fixed 1920×1080 (16:9) card,
		// so the gizmo/inspector size against that rather than a media asset.
		if (timelineClip.kind === 'title') {
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

	async function refreshDiagnostics(workerSnapshot?: DiagnosticSnapshot | null) {
		const snapshot = await buildUiDiagnosticSnapshot({
			capabilities: capabilities(),
			tier: pipelineMode(),
			runtimeIssue: runtimeIssue() ?? audioWarning(),
			webgpuReady: webgpuAvailable(),
			exportSettings: exportSettings(),
			assets: assets(),
			recentErrors: workerSnapshot?.recentErrors ?? recentErrorLog(),
			workerSnapshot
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

	function handleState(msg: WorkerStateMessage) {
		// Publish tap messages route to the controller (it owns the track/frames).
		if (publishController.handleWorkerMessage(msg)) return;
		switch (msg.type) {
			case 'capability-probe-v2':
				setCapabilityProbeV2(msg.result);
				setExportCodecs([...exportConstraintsForProbe(msg.result)]);
				cleanupController.setWebNNProbe(msg.result.webnn ?? null);
				asrController.setProbe();
				break;
			case 'clip-audio':
			case 'clip-audio-error':
				cleanupController.handlePipelineMessage(msg);
				asrController.handlePipelineMessage(msg);
				break;
			case 'audio-cleanup-applied':
				cleanupController.handlePipelineMessage(msg);
				setStatusLine(
					msg.ok
						? 'Cleaned audio asset applied'
						: `Audio cleanup failed: ${msg.message ?? 'unknown error'}`
				);
				break;
			case 'asr-caption-track-created':
				asrController.handlePipelineMessage(msg);
				setStatusLine(`Auto-caption track "${msg.track.name}" created`);
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
				const replace = window.confirm(msg.message);
				bridge?.send({
					type: 'bundle-replace-decision',
					jobId: msg.jobId,
					action: replace ? 'replace' : 'cancel'
				});
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
			case 'error':
				setImporting(false);
				setRuntimeIssue(msg.message);
				setStatusLine(msg.message);
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
		b.send({ type: 'init', canvas, sab, audioSab, probeResult: probe }, [canvas]);
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
		setCaptionDiagnostics([]);
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
		} catch {
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
		if (pendingJobs.length > 1) {
			const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
			if (typeof directoryPicker !== 'function') {
				setStatusLine('Queue needs a directory picker to run multiple pending exports.');
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
					bridge?.send({ type: 'queue-job-output', jobId: job.id, handle });
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
			cleanupController.setWebNNProbe(probe.webnn ?? null);
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
					onOpenPublish={() => setPublishPanelOpen(true)}
					publishLive={publishBusy()}
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
								initialSettings={exportSettings()}
								presets={exportPresets()}
								markers={markers()}
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
						</Show>
						<section class="preview panel">
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
								<div class="side-rail-tabs">
									<div class="side-rail-tab-bar" role="tablist" aria-label="Side panel tabs">
										<For each={SIDE_RAIL_TABS}>
											{(tab) => (
												<button
													id={`tab-${tab.id}`}
													classList={{
														'side-rail-tab': true,
														active: activeSideRailTab() === tab.id
													}}
													role="tab"
													tabIndex={activeSideRailTab() === tab.id ? 0 : -1}
													aria-selected={activeSideRailTab() === tab.id}
													aria-controls={`panel-${tab.id}`}
													onClick={() => setActiveSideRailTab(tab.id)}
													onKeyDown={handleSideRailTabKeyDown}
												>
													{tab.label}
												</button>
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
									</div>
									<div class="side-rail-tab-content">
										<Show when={activeSideRailTab() === 'inspector'}>
											<div
												id="panel-inspector"
												class="side-rail-tab-panel"
												role="tabpanel"
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
												/>
											</div>
										</Show>
										<Show when={activeSideRailTab() === 'captions'}>
											<div
												id="panel-captions"
												class="side-rail-tab-panel"
												role="tabpanel"
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
												/>
											</div>
										</Show>
										<Show when={activeSideRailTab() === 'replay'}>
											<div
												id="panel-replay"
												class="side-rail-tab-panel"
												role="tabpanel"
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
											</div>
										</Show>
										<Show when={activeSideRailTab() === 'live-audio'}>
											<div
												id="panel-live-audio"
												class="side-rail-tab-panel"
												role="tabpanel"
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
											</div>
										</Show>
									</div>
								</div>
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
						features={listCapabilityFeatures(capabilities())}
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
