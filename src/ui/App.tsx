import { createMemo, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { useRegisterSW } from 'virtual:pwa-register/solid';
import { Link2, RotateCcw, Plus } from 'lucide-solid';
import {
  CLOCK_BUFFER_BYTES,
  type ExportPreset,
  type ExportProgress,
  type MediaMetadata,
  type SourceDescriptorSnapshot,
  type TimelineTrackSnapshot,
  type WaveformPeaks,
} from '../protocol';
import { createSharedClock } from './clock';
import { createWorkerBridge } from './worker-bridge';
import { PreviewCanvas } from './PreviewCanvas';
import { Toolbar } from './Toolbar';
import { Timeline } from './Timeline';
import { Inspector, type SelectedClip } from './Inspector';
import { AudioEngine } from './audio-engine';
import { ExportDialog } from './ExportDialog';
import { Button, buttonVariants } from './components/button';
import { cn } from '../lib/utils';
import { CapabilityPanel } from './CapabilityPanel';
import { LimitedPreview } from './LimitedPreview';
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
import PipelineWorker from '../engine/worker.ts?worker';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
const VIDEO_PICKER_TYPES = [
  {
    description: 'Video files',
    accept: {
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'video/webm': ['.webm'],
    },
  },
];

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
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
  const [encodeFps, setEncodeFps] = createSignal<number | null>(null);
  const [timeline, setTimeline] = createSignal<TimelineTrackSnapshot[]>([]);
  const [selectedClip, setSelectedClip] = createSignal<SelectedClip | null>(null);
  const [waveformPeaks, setWaveformPeaks] = createSignal<Record<string, WaveformPeaks>>({});
  const [exporting, setExporting] = createSignal(false);
  const [exportProgress, setExportProgress] = createSignal<ExportProgress | null>(null);
  const [exportResult, setExportResult] = createSignal<string | null>(null);
  const [exportError, setExportError] = createSignal<string | null>(null);
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
  let audioReady: Promise<SharedArrayBuffer | null> | null = null;

  const selectedTrackMix = createMemo(() => {
    const clip = selectedClip();
    if (!clip) return null;
    const track = timeline().find((t) => t.id === clip.trackId);
    if (!track || track.type !== 'audio') return null;
    return {
      trackId: track.id,
      gain: track.gain,
      muted: track.muted,
      solo: track.solo,
    };
  });
  const hasTimeline = createMemo(() => timeline().some((track) => track.clips.length > 0));

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

  function handleState(msg: import('../protocol').WorkerStateMessage) {
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
        setSelectedClip((prev) => {
          if (!prev) return prev;
          for (const track of msg.timeline) {
            const clip = track.clips.find((c) => c.id === prev.clipId);
            if (clip) {
              return { trackId: track.id, clipId: clip.id, effects: { ...clip.effects } };
            }
          }
          return null;
        });
        break;
      case 'history-state':
        setHistoryState({ canUndo: msg.canUndo, canRedo: msg.canRedo });
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
        setUnresolvedSources(msg.unresolvedSources);
        setStatusLine(msg.message);
        if (msg.metadata) {
          clearCompatibilityPreview();
          setMetadata(msg.metadata);
        } else if (!msg.restored) {
          setMetadata(null);
          setSelectedClip(null);
          setWaveformPeaks({});
        }
        break;
      case 'relink-result':
        setUnresolvedSources(msg.unresolvedSources);
        setStatusLine(msg.message);
        if (msg.ok && msg.metadata) {
          setMetadata(msg.metadata);
          clearCompatibilityPreview();
        }
        break;
      case 'preview-resolution':
        setPreviewLabel(msg.resolution.label);
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
      case 'export-progress':
        setExporting(true);
        setExportError(null);
        setExportResult(null);
        setExportProgress(msg.progress);
        setStatusLine(`Exporting MP4 · ${Math.round(msg.progress.percent * 100)}%`);
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
    if (!audioReady) {
      audioReady = audioEngine.init(sab);
    }
    try {
      audioSab = await audioReady;
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
      setSelectedClip(null);
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
    setSelectedClip(null);
    setWaveformPeaks({});
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
    if (importing()) return;
    discardRestoreBeforeImport();
    if (accelerated()) {
      const { bridge: b } = ensureWorker();
      b.send({ type: 'import', file, fileHandle });
      return;
    }
    if (compatibilityImportEnabled()) {
      void importCompatibilityMedia(file);
      return;
    }
    setStatusLine(importHint() ?? 'Import unavailable in limited mode');
  }

  async function pickImportMedia(): Promise<boolean> {
    if (typeof window.showOpenFilePicker !== 'function') return false;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: VIDEO_PICKER_TYPES,
        multiple: false,
      });
      if (!handle) return true;
      const file = await handle.getFile();
      importMedia(file, handle);
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
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) importMedia(file);
  }

  function exportFileName(): string {
    const sourceName = metadata()?.fileName.replace(/\.[^.]+$/, '') || 'export';
    return `${sourceName}.mp4`;
  }

  async function pickOutputHandle(): Promise<FileSystemFileHandle | null> {
    if (typeof window.showSaveFilePicker !== 'function') {
      throw new Error('Export requires the File System Access API in a Chromium desktop browser.');
    }
    try {
      return await window.showSaveFilePicker({
        suggestedName: exportFileName(),
        types: [
          {
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

  async function startExport(preset: ExportPreset) {
    if (!metadata() || exporting()) return;
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
      const output = await pickOutputHandle();
      if (!output) {
        setExporting(false);
        setStatusLine('Export canceled');
        return;
      }
      const { bridge: b } = ensureWorker();
      setStatusLine('Starting export…');
      b.send({ type: 'export-start', preset, output });
    } catch (e) {
      setExporting(false);
      const message = e instanceof Error ? e.message : String(e);
      setExportError(message);
      setStatusLine(`Export failed: ${message}`);
    }
  }

  function onFileDrop(file: File) {
    setIsDraggingFile(false);
    if (importing()) return;
    importMedia(file);
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        bridge?.send({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (key === 'y') {
        event.preventDefault();
        bridge?.send({ type: 'redo' });
      }
    };
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    if ('serviceWorker' in navigator) {
      setHasActiveSW(!!navigator.serviceWorker.controller);
    }

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setIsDraggingFile(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const file = e.dataTransfer?.files[0];
      if (
        file &&
        (file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name))
      ) {
        onFileDrop(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      compatibilityImportGeneration++;
      pendingRelinkSourceId = null;
      clearCompatibilityPreview();
      bridge?.send({ type: 'dispose' });
      audioEngine.dispose();
      worker?.terminate();
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
        exportControl={
          <ExportDialog
            hasMedia={metadata() !== null && accelerated()}
            exporting={exporting()}
            progress={exportProgress()}
            lastResult={exportResult()}
            error={exportError()}
            onStart={startExport}
            onCancel={() => bridge?.send({ type: 'export-cancel' })}
          />
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
      <main class="workspace">
        <section class="preview panel">
          <PreviewCanvas onOffscreenReady={sendInit} />
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
        <Inspector
          metadata={metadata()}
          selectedClip={selectedClip()}
          selectedTrackMix={selectedTrackMix()}
          onEffectParam={(trackId, clipId, key, value) =>
            bridge?.send({ type: 'set-effect-param', trackId, clipId, key, value })
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
        />
      </main>
      <Timeline
        currentTime={clock.currentTime}
        duration={clock.duration}
        frameRate={() => metadata()?.video?.frameRate ?? null}
        hasMedia={(metadata() !== null || hasTimeline()) && accelerated()}
        timeline={timeline}
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
        selectedClipId={selectedClip()?.clipId ?? null}
        onSelectClip={(trackId, clipId, effects) =>
          setSelectedClip({ trackId, clipId, effects: { ...effects } })
        }
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
