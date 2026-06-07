import { createMemo, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { useRegisterSW } from 'virtual:pwa-register/solid';
import { Link2, RotateCcw, Plus } from 'lucide-solid';
import {
  CLOCK_BUFFER_BYTES,
  type CaptionDiagnosticSnapshot,
  type CaptionExportSettingsSnapshot,
  type CaptionTrackSnapshot,
  type ClipKeyframeParamSnapshot,
  type ExportCodecSupport,
  type ExportPresetDoc,
  type ExportProgress,
  type ExportSettings,
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
  type WorkerStateMessage,
  type WaveformPeaks,
} from '../protocol';
import { createSharedClock } from './clock';
import { createWorkerBridge } from './worker-bridge';
import { PreviewCanvas } from './PreviewCanvas';
import { PreviewGizmo } from './PreviewGizmo';
import { Toolbar } from './Toolbar';
import { Timeline } from './Timeline';
import { Inspector, type SelectedClip } from './Inspector';
import { MediaBin } from './MediaBin';
import { TranscriptPanel } from './TranscriptPanel';
import { ThumbnailStore } from './thumbnail-store';
import { AudioEngine } from './audio-engine';
import { ExportDialog } from './ExportDialog';
import { RenderQueuePanel } from './RenderQueuePanel';
import { BundleDialog } from './BundleDialog';
import { Button, buttonVariants } from './components/button';
import { cn } from '../lib/utils';
import { CapabilityPanel } from './CapabilityPanel';
import { LimitedPreview } from './LimitedPreview';
import { registerKeyboardShortcuts } from './keyboard';
import {
  clipLocalTime,
  hasKeyframeTrack,
  sampleEffectsAt,
  sampleTransformAt,
} from './keyframes';
import {
  canCompatibilityPreview,
  deriveCapabilityTier,
  importUnavailableReason,
  listCapabilityFeatures,
  primaryLimitedIssue,
  probeCapabilities,
  type CapabilitySnapshot,
  type CapabilityTier,
} from './capabilities';
import { extractCompatibilityPreview } from '../compatibility/thumbnail';
import {
  createJob,
  createJobsFromMarkers,
  createEmptyQueueState,
  suggestedFileNameForJob,
} from '../engine/render-queue';
import { BUILT_IN_PRESETS } from '../engine/export-presets';
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
      'audio/*': ['.mp3', '.m4a', '.wav', '.ogg'],
    },
  },
];

const MEDIA_FILE_PATTERN = /\.(mp4|mov|webm|png|jpe?g|webp|gif|bmp|avif|mp3|m4a|wav|ogg)$/i;

type QueuePickerType = {
  description?: string;
  accept: Record<string, string[]>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
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
    minute: '2-digit',
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

export function App() {
  const [capabilities, setCapabilities] = createSignal<CapabilitySnapshot>(probeCapabilities());
  const [runtimeIssue, setRuntimeIssue] = createSignal<string | null>(null);
  const [isIsolated, setIsIsolated] = createSignal(
    typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false,
  );
  const [workerReady, setWorkerReady] = createSignal(false);
  const [webgpuAvailable, setWebgpuAvailable] = createSignal(false);
  const [capabilityPanelOpen, setCapabilityPanelOpen] = createSignal(false);
  const [compatibilityPreview, setCompatibilityPreview] =
    createSignal<CompatibilityPreviewState | null>(null);
  const [metadata, setMetadata] = createSignal<MediaMetadata | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [statusLine, setStatusLine] = createSignal('Checking client capabilities…');
  const [previewLabel, setPreviewLabel] = createSignal<string | null>(null);
  const [previewSize, setPreviewSize] = createSignal<{ width: number; height: number } | null>(null);
  const [previewCanvasEl, setPreviewCanvasEl] = createSignal<HTMLCanvasElement | undefined>(undefined);
  const [safeAreaGuides, setSafeAreaGuides] = createSignal(false);
  const [encodeFps, setEncodeFps] = createSignal<number | null>(null);
  const [timeline, setTimeline] = createSignal<TimelineTrackSnapshot[]>([]);
  const [captionTracks, setCaptionTracks] = createSignal<CaptionTrackSnapshot[]>([]);
  const [captionDiagnostics, setCaptionDiagnostics] = createSignal<CaptionDiagnosticSnapshot[]>([]);
  const [markers, setMarkers] = createSignal<TimelineMarkerSnapshot[]>([]);
  const [transitions, setTransitions] = createSignal<TimelineTransitionSnapshot[]>([]);
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
  const [exportCodecs, setExportCodecs] = createSignal<ExportCodecSupport[]>([]);
  const [exportSettings, setExportSettings] = createSignal<ExportSettings | null>(null);
  const [exportPresets, setExportPresets] = createSignal<ExportPresetDoc[]>(
    BUILT_IN_PRESETS.map((preset) => ({ ...preset })),
  );
  const [renderQueue, setRenderQueue] = createSignal<RenderQueueState>(createEmptyQueueState());
  const [isOffline, setIsOffline] = createSignal(!initialOnlineStatus());
  const [hasActiveSW, setHasActiveSW] = createSignal(false);
  const [audioWarning, setAudioWarning] = createSignal<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = createSignal(false);
  const [historyState, setHistoryState] = createSignal<HistoryUiState>({
    canUndo: false,
    canRedo: false,
  });
  const [restoreOffer, setRestoreOffer] = createSignal<RestoreOfferState | null>(null);
  const [unresolvedSources, setUnresolvedSources] = createSignal<SourceDescriptorSnapshot[]>([]);
  const [assets, setAssets] = createSignal<MediaAssetSnapshot[]>([]);
  const [latestHealthReport, setLatestHealthReport] = createSignal<SourceHealthReportSnapshot | null>(null);
  const [bundleBusy, setBundleBusy] = createSignal(false);
  const [bundleJobId, setBundleJobId] = createSignal<string | null>(null);
  const [bundlePhase, setBundlePhase] = createSignal<string | null>(null);
  const [bundleReport, setBundleReport] = createSignal<BundleIntegrityReportSnapshot | null>(null);
  const [bundleMessage, setBundleMessage] = createSignal<string | null>(null);
  const [thumbnailVersion, setThumbnailVersion] = createSignal(0);
  const thumbnailStore = new ThumbnailStore();

  const unresolvedIds = createMemo(() => new Set(unresolvedSources().map((s) => s.sourceId)));

  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  const sab =
    typeof SharedArrayBuffer === 'function'
      ? new SharedArrayBuffer(CLOCK_BUFFER_BYTES)
      : null;
  let bridge: ReturnType<typeof createWorkerBridge> | null = null;
  let worker: Worker | null = null;
  let initSent = false;
  let compatibilityImportGeneration = 0;
  let relinkInput: HTMLInputElement | undefined;
  let pendingRelinkSourceId: string | null = null;
  const audioEngine = new AudioEngine();
  let audioReady: Promise<{ audioSab: SharedArrayBuffer | null; meterSab: SharedArrayBuffer | null }> | null =
    null;
  const [meterSab, setMeterSab] = createSignal<SharedArrayBuffer | null>(null);

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
          lut: clip.lut,
        };
      }
    }
    return null;
  });

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
      audioFadeOut: timelineClip.audioFadeOut,
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
      solo: track.solo,
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
        sourceHeight: 1080,
      };
    }
    const asset = assets().find((a) => a.sourceId === timelineClip.sourceId);
    return {
      trackId: track.id,
      clipId: timelineClip.id,
      transform: sampleTransformAt(timelineClip.transform, timelineClip.keyframes, localTime),
      sourceWidth: asset?.video?.width ?? metadata()?.video?.width ?? 16,
      sourceHeight: asset?.video?.height ?? metadata()?.video?.height ?? 9,
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
      title: timelineClip.title,
    };
  });

  const hasTimeline = createMemo(
    () => timeline().some((track) => track.clips.length > 0) || captionTracks().some((track) => track.segments.length > 0),
  );

  const clock = createSharedClock(sab);

  const pipelineMode = createMemo<CapabilityTier>(() =>
    deriveCapabilityTier(capabilities(), {
      workerReady: workerReady(),
      webgpuReady: webgpuAvailable(),
      runtimeIssue: runtimeIssue(),
    }),
  );

  const accelerated = () => pipelineMode() === 'accelerated';
  const compatibilityImportEnabled = () =>
    pipelineMode() === 'limited' && canCompatibilityPreview(capabilities());
  const importBlocked = () =>
    importing() ||
    pipelineMode() === 'blocked' ||
    pipelineMode() === 'starting' ||
    (pipelineMode() === 'limited' && !canCompatibilityPreview(capabilities()));
  const importHint = () =>
    importBlocked() ? importUnavailableReason(pipelineMode(), capabilities(), {
      workerReady: workerReady(),
      webgpuReady: webgpuAvailable(),
      runtimeIssue: runtimeIssue(),
    }) : compatibilityImportEnabled()
      ? 'Loads a reduced compatibility thumbnail only. Accelerated editing requires the full pipeline.'
      : null;
  const limitedIssue = () => primaryLimitedIssue(capabilities(), {
    workerReady: workerReady(),
    webgpuReady: webgpuAvailable(),
    runtimeIssue: runtimeIssue(),
  });

  function clearCompatibilityPreview() {
    const preview = compatibilityPreview();
    if (preview) preview.revoke();
    setCompatibilityPreview(null);
  }

  function handleState(msg: WorkerStateMessage) {
    switch (msg.type) {
      case 'ready':
        setWorkerReady(true);
        setWebgpuAvailable(msg.webgpu);
        if (!msg.webgpu) {
          setRuntimeIssue(
            msg.gpuUnavailableReason ??
              'WebGPU is unavailable in this browser. Accelerated import, playback, effects, and export require a WebGPU-capable Chromium browser.',
          );
        }
        setStatusLine(
          msg.webgpu
            ? `Pipeline ready · WebGPU (${msg.features.join(', ') || 'default'})`
            : `Limited shell · ${msg.gpuUnavailableReason ?? 'WebGPU unavailable'}`,
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
      case 'timeline-state':
        setTimeline(msg.timeline);
        setCaptionTracks(msg.captionTracks);
        setTransitions(msg.transitions);
        setMarkers(msg.markers);
        setMasterGain(msg.masterGain);
        audioEngine.setMasterGain(msg.masterGain);
        const nextCaptionTrackId = msg.captionTracks.some((track) => track.id === selectedCaptionTrackId())
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
              .flatMap((track) => track.segments.map((segment) => segment.id)),
          );
          const next = prev.filter((id) => live.has(id));
          const first = live.values().next().value as string | undefined;
          return next.length > 0 ? next : (first ? [first] : []);
        });
        break;
      case 'caption-import-result':
        setCaptionDiagnostics([...msg.result.diagnostics]);
        setSelectedCaptionTrackId(msg.result.track.id);
        setSelectedCaptionSegmentIds(msg.result.track.segments[0] ? [msg.result.track.segments[0].id] : []);
        setStatusLine(
          msg.result.diagnostics.length > 0
            ? `Imported captions with ${msg.result.diagnostics.length} diagnostic${msg.result.diagnostics.length === 1 ? '' : 's'}`
            : 'Imported captions',
        );
        break;
      case 'caption-export-result':
        for (const file of msg.files) {
          downloadTextFile(file.fileName, file.mimeType, file.content);
        }
        setStatusLine(`Exported ${msg.files.length} caption file${msg.files.length === 1 ? '' : 's'}`);
        break;
      case 'history-state':
        setHistoryState({ canUndo: msg.canUndo, canRedo: msg.canRedo });
        break;
      case 'media-assets': {
        setAssets(msg.assets);
        setLatestHealthReport((prev) =>
          prev && msg.assets.some((asset) => asset.sourceId === prev.sourceId) ? null : prev,
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
          height: msg.height,
        });
        setThumbnailVersion((v) => v + 1);
        break;
      case 'restore-available':
        setRestoreOffer({
          projectId: msg.projectId,
          savedAt: msg.savedAt,
          sources: msg.sources,
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
          [`${msg.trackId}:${msg.clipId}`]: msg.peaks,
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
          `Exporting ${msg.progress.codec.toUpperCase()} ${msg.progress.container.toUpperCase()} · ${Math.round(msg.progress.percent * 100)}%`,
        );
        break;
      case 'export-complete':
        setExporting(false);
        setExportProgress(null);
        setExportError(null);
        setExportResult(`Exported ${msg.fileName}`);
        setStatusLine(`Export complete · ${msg.mimeType}`);
        break;
      case 'export-canceled':
        setExporting(false);
        setExportProgress(null);
        setExportError(null);
        setExportResult('Export canceled');
        setStatusLine('Export canceled');
        break;
      case 'export-error':
        setExporting(false);
        setExportProgress(null);
        setExportResult(null);
        setExportError(msg.message);
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
          jobs: prev.jobs.map((j) => j.id === msg.jobId ? { ...j, progress: msg.progress } : j),
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
        setStatusLine(`Queue done: ${msg.completedCount} completed, ${msg.failedCount} failed, ${msg.canceledCount} canceled`);
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
          action: replace ? 'replace' : 'cancel',
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
    return { worker, bridge };
  }

  async function sendInit(canvas: OffscreenCanvas) {
    if (initSent) return;
    if (!isIsolated() || !sab) {
      setRuntimeIssue(
        'This browser or origin cannot expose SharedArrayBuffer. The app shell stays client-side, but accelerated import, playback, effects, and export need SAB plus COOP/COEP headers so the local CPU/GPU path can run safely.',
      );
      setStatusLine('Limited shell · COOP/COEP needed for accelerated client compute');
      return;
    }
    initSent = true;
    const { bridge: b } = ensureWorker();
    let audioSab: SharedArrayBuffer | null = null;
    let meterBuffer: SharedArrayBuffer | null = null;
    if (!audioReady) {
      audioReady = audioEngine.init(sab);
    }
    try {
      const audioInit = await audioReady;
      audioSab = audioInit.audioSab;
      meterBuffer = audioInit.meterSab;
      setMeterSab(meterBuffer);
      setAudioWarning(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAudioWarning(`Audio disabled: ${message}`);
      setStatusLine('Audio disabled · starting video pipeline');
    }
    b.send({ type: 'init', canvas, sab, audioSab }, [canvas]);
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
        revoke: preview.thumbnail.revoke,
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
          canDecode: false,
        },
        audio: null,
        trackCount: 1,
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
    if (accelerated()) {
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
        multiple: true,
      });
      for (const handle of handles) {
        const file = await handle.getFile();
        importMedia(file, handle);
      }
      return true;
    } catch (error) {
      if (isAbortError(error)) return true;
      setStatusLine(`Import picker failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function pickRelinkFile(sourceId: string) {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: VIDEO_PICKER_TYPES,
          multiple: false,
        });
        if (!handle) return;
        const file = await handle.getFile();
        bridge?.send({ type: 'relink-source', sourceId, file, fileHandle: handle });
        return;
      } catch (error) {
        if (isAbortError(error)) return;
        setStatusLine(`Re-link picker failed: ${error instanceof Error ? error.message : String(error)}`);
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
                accept: { 'video/webm': ['.webm'] },
              }
            : {
                description: 'MP4 video',
                accept: { 'video/mp4': ['.mp4'] },
              },
        ],
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
            : { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
        ],
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
        : { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
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
              allJobs.findIndex((item) => item.id === job.id) + 1,
            ),
            usedNames,
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
      allJobs.findIndex((item) => item.id === job.id) + 1,
    );
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: queuePickerTypes(suggestedName),
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
    outputTemplate: string | null,
  ) {
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
      const jobRange = rangeMode === 'full'
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

  function startBundleExport(policy: BundleSourcePolicySnapshot, outputDir: FileSystemDirectoryHandle) {
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
    if (!accelerated()) {
      setExportError(
        pipelineMode() === 'limited'
          ? 'Export is unavailable because the accelerated engine is not running.'
          : 'Waiting for preview canvas before export can start.',
      );
      return;
    }
    setExporting(true);
    setExportProgress(null);
    setExportResult(null);
    setExportError(null);
    setStatusLine('Choosing export destination…');
    try {
      const output = await pickOutputHandle(settings);
      if (!output) {
        setExporting(false);
        setStatusLine('Export canceled');
        return;
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
    exclusive = false,
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
        prev.some((ref) => `${ref.trackId}:${ref.clipId}` === key) ? prev : [next],
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
          effects: { ...clip.effects },
        },
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
    transform: Partial<TimelineClipSnapshot['transform']>,
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
        keyframes: keyedUpdates,
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
    if (!accelerated()) return;
    const t = clock.currentTime();
    void audioEngine.play(t);
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
    const isolated = globalThis.crossOriginIsolated === true;
    setIsIsolated(isolated);
    setCapabilities(probeCapabilities({ crossOriginIsolated: isolated, sharedArrayBuffer: sab != null }));
    if (isolated && sab) {
      ensureWorker();
      setStatusLine('Starting pipeline worker…');
    } else {
      setRuntimeIssue(
        !isolated
          ? 'This page is missing COOP/COEP headers. LocalCut still runs as a client-side shell, but accelerated import, playback, effects, and export need those headers so the browser can expose SharedArrayBuffer for local CPU/GPU work.'
          : 'This browser or origin cannot expose SharedArrayBuffer. The app shell stays client-side, but accelerated import, playback, effects, and export need SAB plus COOP/COEP headers so the local CPU/GPU path can run safely.',
      );
      setStatusLine('Limited shell · COOP/COEP needed for accelerated client compute');
    }

    const unregisterKeyboard = registerKeyboardShortcuts({
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
      onDuplicate: duplicateSelectedClips,
    });
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    if ('serviceWorker' in navigator) {
      setHasActiveSW(!!navigator.serviceWorker.controller);
    }

    const onDragOver = (e: DragEvent) => {
      // Ignore internal drags (e.g. a media-bin asset onto a track); only OS file
      // drops carry the "Files" type and should raise the import overlay.
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      setIsDraggingFile(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setIsDraggingFile(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        for (const file of files) {
          if (isImportableFile(file)) onFileDrop(file);
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    onCleanup(() => {
      unregisterKeyboard();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      compatibilityImportGeneration++;
      pendingRelinkSourceId = null;
      clearCompatibilityPreview();
      thumbnailStore.clear();
      if (worker && bridge) {
        const workerToDispose = worker;
        let terminateFallback: ReturnType<typeof setTimeout>;
        const onDisposeComplete = (event: MessageEvent<WorkerStateMessage>) => {
          if (event.data.type !== 'dispose-complete') return;
          clearTimeout(terminateFallback);
          workerToDispose.removeEventListener('message', onDisposeComplete);
          workerToDispose.terminate();
        };
        workerToDispose.addEventListener('message', onDisposeComplete);
        terminateFallback = setTimeout(() => {
          workerToDispose.removeEventListener('message', onDisposeComplete);
          workerToDispose.terminate();
        }, 1500);
        bridge.send({ type: 'dispose' });
      } else {
        worker?.terminate();
      }
      audioEngine.dispose();
    });
  });

  return (
    <div class={`app${isDraggingFile() ? ' is-dragging-file' : ''}`}>
      <Toolbar
        metadata={metadata()}
        playing={clock.playing}
        importAccept={VIDEO_ACCEPT}
        onImportFile={importMedia}
        onPickImport={pickImportMedia}
        onPlay={() => {
          const t = clock.currentTime();
          void audioEngine.play(t);
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
        transportDisabled={!accelerated()}
        importBlocked={importBlocked()}
        importHint={importHint()}
        crossOriginIsolated={isIsolated()}
        pipelineMode={pipelineMode()}
        previewLabel={previewLabel()}
        encodeFps={encodeFps()}
        onOpenCapabilities={() => setCapabilityPanelOpen(true)}
        masterGain={masterGain()}
        meterSab={meterSab()}
        onMasterGain={(gain) => {
          audioEngine.setMasterGain(gain);
          bridge?.send({ type: 'set-master-gain', gain });
        }}
        exportControl={
          <>
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
            hasMedia={(metadata() !== null || hasTimeline()) && accelerated()}
            exporting={exporting()}
            progress={exportProgress()}
            lastResult={exportResult()}
            error={exportError()}
            timelineDuration={clock.duration()}
            supportedCodecs={exportCodecs()}
            initialSettings={exportSettings()}
            presets={exportPresets()}
            markers={markers()}
            onProbe={probeExportCodecs}
            onStart={startExport}
            onCancel={() => bridge?.send({ type: 'export-cancel' })}
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
                    {unresolvedSources().length} source{unresolvedSources().length === 1 ? '' : 's'} need re-linking.
                  </p>
                </>
              }
            >
              {(offer) => (
                <>
                  <p class="restore-banner-title">Autosave from {formatSavedAt(offer().savedAt)}</p>
                  <p class="restore-banner-detail">
                    {offer().sources.length} source{offer().sources.length === 1 ? '' : 's'} in the saved project.
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
                {report().warnings.length} issue{report().warnings.length === 1 ? '' : 's'} detected.
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
          </section>
        )}
      </Show>
      <main class={`workspace${accelerated() ? ' has-bin' : ''}`}>
        <Show when={accelerated()}>
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
          <PreviewCanvas onOffscreenReady={sendInit} onCanvasEl={setPreviewCanvasEl} />
          <Show when={accelerated() && selectedClipTransform() && previewSize()}>
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
                  bridge?.send({ type: 'set-transform', trackId: sel.trackId, clipId: sel.clipId, transform: staticPatch });
                }
              }}
            />
          </Show>
          <Show when={accelerated() && safeAreaGuides()}>
            <div class="safe-area-overlay" aria-hidden="true">
              <div class="safe-area-rect safe-area-action" />
              <div class="safe-area-rect safe-area-title" />
            </div>
          </Show>
          <Show when={accelerated()}>
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
                  {pipelineMode() === 'limited' || pipelineMode() === 'blocked'
                    ? 'Accelerated engine unavailable'
                    : 'No source loaded'}
                </p>
                <p class="preview-empty-copy">
                  {pipelineMode() === 'limited' || pipelineMode() === 'blocked'
                    ? limitedIssue() ??
                      (compatibilityImportEnabled()
                        ? 'Import still loads a reduced compatibility thumbnail so you can inspect a local clip.'
                        : 'This browser cannot run the accelerated pipeline yet.')
                    : 'Drop an MP4, MOV, or WebM here.'}
                </p>
              </div>
              <label
                class={cn(
                  buttonVariants({ variant: 'default' }),
                  'import-picker',
                  importBlocked() && 'is-disabled pointer-events-none',
                )}
                title={importHint() ?? undefined}
              >
                Import
                <input
                  class="import-picker-input"
                  type="file"
                  accept={VIDEO_ACCEPT}
                  multiple
                  onChange={handleImportInput}
                  disabled={importBlocked()}
                  aria-label="Import media"
                  title={importHint() ?? undefined}
                />
              </label>
            </div>
          </Show>
          <Show when={importing()}>
            <div class="preview-overlay">Importing…</div>
          </Show>
        </section>
        <div class="side-rail">
          <Inspector
            metadata={metadata()}
            selectedClip={selectedClip()}
            selectedTrackMix={selectedTrackMix()}
            selectedClipFades={selectedClipFades()}
            selectedClipTransform={selectedClipTransform()}
            selectedTitle={selectedTitle()}
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
              bridge?.send({ type: 'set-keyframe', trackId, clipId, key, t, value, easing })
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
              bridge?.send({ type: 'set-clip-fade', trackId, clipId, edge, durationS });
            }}
          />
          <TranscriptPanel
            captionTracks={captionTracks()}
            diagnostics={captionDiagnostics()}
            playheadTime={clock.currentTime()}
            selectedTrackId={selectedCaptionTrackId()}
            selectedSegmentIds={selectedCaptionSegmentIds()}
            onSelectTrack={setSelectedCaptionTrackId}
            onSelectSegmentIds={setSelectedCaptionSegmentIds}
            onImport={(file, trackId) => captionBridge().send(trackId ? { type: 'import-captions', file, trackId } : { type: 'import-captions', file })}
            onExport={(settings: CaptionExportSettingsSnapshot) => captionBridge().send({ type: 'export-captions', settings })}
            onSetTrack={(trackId, patch) => captionBridge().send({ type: 'set-caption-track', trackId, ...patch })}
            onSetSegmentText={(trackId, segmentId, text) =>
              captionBridge().send({ type: 'set-caption-segment-text', trackId, segmentId, text })
            }
            onSetSegmentTiming={(trackId, segmentId, start, end) =>
              captionBridge().send({ type: 'set-caption-segment-timing', trackId, segmentId, start, end })
            }
            onSetSegmentStyle={(trackId, segmentId, style) =>
              captionBridge().send({ type: 'set-caption-segment-style', trackId, segmentId, style })
            }
            onSplit={(trackId, segmentId, time) =>
              captionBridge().send({ type: 'split-caption-segment', trackId, segmentId, time })
            }
            onMerge={(trackId, segmentIds) =>
              captionBridge().send({ type: 'merge-caption-segments', trackId, segmentIds })
            }
            onDelete={(trackId, segmentIds) =>
              captionBridge().send({ type: 'delete-caption-segments', trackId, segmentIds })
            }
            onSnap={(trackId, segmentId, edge) =>
              captionBridge().send({ type: 'snap-caption-segment', trackId, segmentId, edge })
            }
          />
        </div>
      </main>
      <Timeline
        currentTime={clock.currentTime}
        duration={clock.duration}
        frameRate={() => metadata()?.video?.frameRate ?? null}
        hasMedia={(metadata() !== null || hasTimeline() || transitions().length > 0 || markers().length > 0 || assets().length > 0) && accelerated()}
        timeline={timeline}
        markers={markers}
        selectedClipRefs={selectedClipRefs}
        waveformPeaks={() => waveformPeaks()}
        onSeek={(t) => {
          void audioEngine.seek(t);
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
        onCloseGaps={(trackId) => bridge?.send(trackId ? { type: 'close-gaps', trackId } : { type: 'close-gaps' })}
        onPlaceAsset={(sourceId, trackId, start) => bridge?.send({ type: 'place-clip', sourceId, trackId, start })}
        onAddTrack={(trackType) => bridge?.send({ type: 'add-track', trackType })}
        onRemoveTrack={(trackId) => bridge?.send({ type: 'remove-track', trackId })}
        onReorderTrack={(trackId, toIndex) => bridge?.send({ type: 'reorder-track', trackId, toIndex })}
        onSetTrackLock={(trackId, locked) => bridge?.send({ type: 'set-track-lock', trackId, locked })}
        onSetTrackVisible={(trackId, visible) => bridge?.send({ type: 'set-track-visible', trackId, visible })}
        onSetTrackSyncLock={(trackId, syncLocked) => bridge?.send({ type: 'set-track-sync-lock', trackId, syncLocked })}
        onSetTrackEditTarget={(trackId, editTarget) => bridge?.send({ type: 'set-track-edit-target', trackId, editTarget })}
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
        onSetStopOnError={(stopOnError) => bridge?.send({ type: 'queue-set-stop-on-error', stopOnError })}
      />
      <footer class="status-bar">
        <span role="status" aria-live={exporting() ? 'off' : 'polite'} aria-atomic={exporting() ? 'false' : 'true'}>{statusLine()}</span>
        <span class="status-meta">
          <Show when={needRefresh()}>
            <button type="button" class="status-badge" onClick={() => updateServiceWorker(true)} title="Click to update app">
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
          <Show when={audioWarning()}>
            <span class="status-badge status-warn" title={audioWarning()!}>
              Audio Disabled
            </span>
          </Show>
          <Show when={isIsolated()}>
            <span class="status-ok">COOP/COEP OK</span>
          </Show>
        </span>
      </footer>
      <CapabilityPanel
        open={capabilityPanelOpen()}
        tier={pipelineMode()}
        features={listCapabilityFeatures(capabilities())}
        primaryIssue={limitedIssue()}
        compatibilityPreviewAvailable={canCompatibilityPreview(capabilities())}
        onClose={() => setCapabilityPanelOpen(false)}
      />
    </div>
  );
}
