import { createMemo, createSignal, Show, onMount, onCleanup } from 'solid-js';
import { useRegisterSW } from 'virtual:pwa-register/solid';
import {
  assertCrossOriginIsolated,
  CLOCK_BUFFER_BYTES,
  type ExportPreset,
  type ExportProgress,
  type MediaMetadata,
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
import { buttonVariants } from './components/button';
import { cn } from '../lib/utils';
import PipelineWorker from '../engine/worker.ts?worker';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

function initialOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function App() {
  const [fatalError, setFatalError] = createSignal<string | null>(null);
  const [workerReady, setWorkerReady] = createSignal(false);
  const [metadata, setMetadata] = createSignal<MediaMetadata | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [statusLine, setStatusLine] = createSignal('Checking environment…');
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

  const clock = createSharedClock(sab);

  function handleState(msg: import('../protocol').WorkerStateMessage) {
    switch (msg.type) {
      case 'ready':
        setWorkerReady(true);
        setStatusLine(
          msg.webgpu
            ? `Pipeline ready · WebGPU (${msg.features.join(', ') || 'default'})`
            : `Pipeline ready · ${msg.gpuUnavailableReason ?? 'WebGPU unavailable'}`,
        );
        break;
      case 'import-progress':
        setImporting(true);
        setStatusLine(msg.stage === 'reading' ? 'Reading file…' : 'Extracting metadata…');
        break;
      case 'import-complete':
        setImporting(false);
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
      case 'error':
        setImporting(false);
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
    if (!sab) {
      setFatalError(
        'Main thread: SharedArrayBuffer is unavailable. SharedArrayBuffer requires a secure, cross-origin-isolated origin with COOP/COEP headers.',
      );
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

  function importMedia(file: File) {
    const { bridge: b } = ensureWorker();
    if (!initSent) {
      setStatusLine('Waiting for preview canvas…');
      return;
    }
    b.send({ type: 'import', file });
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
    if (!initSent) {
      setExportError('Waiting for preview canvas before export can start.');
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
    const { bridge: b } = ensureWorker();
    if (!initSent) {
      setStatusLine('Drop again after preview is ready');
      return;
    }
    b.send({ type: 'import', file });
  }

  onMount(() => {
    try {
      assertCrossOriginIsolated('Main thread');
      ensureWorker();
      setStatusLine('Starting pipeline worker…');
    } catch (e) {
      setFatalError(e instanceof Error ? e.message : String(e));
    }

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
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
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      bridge?.send({ type: 'dispose' });
      audioEngine.dispose();
      worker?.terminate();
    });
  });

  return (
    <div class={`app${isDraggingFile() ? ' is-dragging-file' : ''}`}>
      <Show when={fatalError()}>
        <div class="fatal-banner" role="alert">
          <strong>Cannot start editor</strong>
          <p>{fatalError()}</p>
        </div>
      </Show>
      <Show when={!fatalError()}>
        <Toolbar
          metadata={metadata()}
          playing={clock.playing}
          importAccept={VIDEO_ACCEPT}
          onImportFile={importMedia}
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
          disabled={!workerReady()}
          workerReady={workerReady()}
          previewLabel={previewLabel()}
          encodeFps={encodeFps()}
          exportControl={
            <ExportDialog
              hasMedia={metadata() !== null}
              exporting={exporting()}
              progress={exportProgress()}
              lastResult={exportResult()}
              error={exportError()}
              onStart={startExport}
              onCancel={() => bridge?.send({ type: 'export-cancel' })}
            />
          }
        />
        <main class="workspace">
          <section class="preview panel">
            <PreviewCanvas onOffscreenReady={sendInit} />
            <Show when={!metadata() && !importing()}>
              <div class="preview-empty">
                <div>
                  <p class="preview-empty-eyebrow">Preview</p>
                  <p class="preview-empty-title">No source loaded</p>
                  <p class="preview-empty-copy">Drop an MP4, MOV, or WebM here.</p>
                </div>
                <label
                  class={cn(
                    buttonVariants({ variant: 'default' }),
                    'import-picker',
                    !workerReady() && 'is-disabled pointer-events-none',
                  )}
                >
                  Import
                  <input
                    class="import-picker-input"
                    type="file"
                    accept={VIDEO_ACCEPT}
                    onChange={handleImportInput}
                    disabled={!workerReady()}
                    aria-label="Import media"
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
          hasMedia={metadata() !== null}
          timeline={timeline}
          waveformPeaks={() => waveformPeaks()}
          onSeek={(t) => {
            void audioEngine.seek(t);
            bridge?.send({ type: 'seek', time: t });
          }}
          onSplit={(trackId, _clipId, time) => bridge?.send({ type: 'split', trackId, time })}
          onDelete={(trackId, clipId) => bridge?.send({ type: 'delete-clip', trackId, clipId })}
          onMoveClip={(fromTrackId, clipId, toTrackId, toIndex) =>
            bridge?.send({ type: 'move-clip', fromTrackId, clipId, toTrackId, toIndex })
          }
          onTrim={(trackId, clipId, edge, time) =>
            bridge?.send({ type: 'trim-clip', trackId, clipId, edge, time })
          }
          selectedClipId={selectedClip()?.clipId ?? null}
          onSelectClip={(trackId, clipId, effects) =>
            setSelectedClip({ trackId, clipId, effects: { ...effects } })
          }
        />
        <footer class="status-bar">
          <span>{statusLine()}</span>
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
            <Show when={previewLabel()}>
              <span class="status-badge" title="Adaptive preview resolution">
                Preview: {previewLabel()}
              </span>
            </Show>
            <Show when={encodeFps()}>
              <span class="status-badge" title="Estimated encode throughput (session)">
                Encode: {Math.round(encodeFps()!)} fps
              </span>
            </Show>
            <Show when={audioWarning()}>
              <span class="status-badge status-warn" title={audioWarning()!}>
                Audio Disabled
              </span>
            </Show>
            <Show when={workerReady()}>
              <span class="status-ok">crossOriginIsolated</span>
            </Show>
          </span>
        </footer>
      </Show>
    </div>
  );
}
