import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import { assertCrossOriginIsolated, CLOCK_BUFFER_BYTES, type MediaMetadata } from '../protocol';
import { createSharedClock } from './clock';
import { createWorkerBridge } from './worker-bridge';
import { PreviewCanvas } from './PreviewCanvas';
import { Toolbar } from './Toolbar';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import PipelineWorker from '../engine/worker.ts?worker';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

export function App() {
  const [fatalError, setFatalError] = createSignal<string | null>(null);
  const [workerReady, setWorkerReady] = createSignal(false);
  const [metadata, setMetadata] = createSignal<MediaMetadata | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [statusLine, setStatusLine] = createSignal('Checking environment…');

  let sab: SharedArrayBuffer;
  let bridge: ReturnType<typeof createWorkerBridge> | null = null;
  let worker: Worker | null = null;
  let initSent = false;

  const clock = createSharedClock(
    (sab = new SharedArrayBuffer(CLOCK_BUFFER_BYTES)),
  );

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
        // Duration is written to the shared clock by the worker; the rAF reader
        // in createSharedClock() surfaces it. Main thread never writes the SAB.
        setStatusLine(`Loaded ${msg.metadata.fileName}`);
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

  function sendInit(canvas: OffscreenCanvas) {
    if (initSent) return;
    const { bridge: b } = ensureWorker();
    initSent = true;
    b.send({ type: 'init', canvas, sab }, [canvas]);
  }

  async function pickFile(): Promise<File | null> {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker!({
          types: [
            {
              description: 'Video',
              accept: { 'video/*': ['.mp4', '.mov', '.webm', '.m4v'] },
            },
          ],
          multiple: false,
        });
        return await handle.getFile();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = VIDEO_ACCEPT;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      // Without this, cancelling the dialog never settles the promise and
      // importMedia() would await forever, wedging all future imports.
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function importMedia() {
    const file = await pickFile();
    if (!file) return;
    const { bridge: b } = ensureWorker();
    if (!initSent) {
      setStatusLine('Waiting for preview canvas…');
      return;
    }
    b.send({ type: 'import', file });
  }

  function onFileDrop(file: File) {
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

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (
        file &&
        (file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name))
      ) {
        onFileDrop(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    onCleanup(() => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      bridge?.send({ type: 'dispose' });
      worker?.terminate();
    });
  });

  return (
    <div class="app">
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
          onImport={importMedia}
          onPlay={() => bridge?.send({ type: 'play' })}
          onPause={() => bridge?.send({ type: 'pause' })}
        />
        <main class="workspace">
          <section class="preview panel">
            <PreviewCanvas onOffscreenReady={sendInit} />
            <Show when={importing()}>
              <div class="preview-overlay">Importing…</div>
            </Show>
          </section>
          <Inspector metadata={metadata()} />
        </main>
        <Timeline
          currentTime={clock.currentTime}
          duration={clock.duration}
          frameRate={() => metadata()?.video?.frameRate ?? null}
          hasMedia={metadata() !== null}
          onSeek={(t) => bridge?.send({ type: 'seek', time: t })}
        />
        <footer class="status-bar">
          <span>{statusLine()}</span>
          <Show when={workerReady()}>
            <span class="status-ok">crossOriginIsolated</span>
          </Show>
        </footer>
      </Show>
    </div>
  );
}
