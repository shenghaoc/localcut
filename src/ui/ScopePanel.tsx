/** Scope diagnostics panel — Phase 21.
 *
 *  Renders histogram, luma waveform, RGB parade, and vectorscope on small
 *  canvases via Canvas2D from a SharedArrayBuffer ring-buffer filled by the
 *  pipeline worker. No getImageData / CPU pixel readback — the worker writes
 *  to the SAB via WebGPU compute; the main thread only paints.
 */

import { createSignal } from 'solid-js';

export interface ScopePanelProps {
  /** Collapsed state signal (read+write). */
  collapsed: () => boolean;
  setCollapsed: (v: boolean) => void;
}

export default function ScopePanel(props: ScopePanelProps) {
  const [fullscreenScope, setFullscreenScope] = createSignal<string | null>(null);

  const canvasIds = {
    histogram: 'scope-histogram-canvas',
    waveform: 'scope-waveform-canvas',
    parade: 'scope-parade-canvas',
    vectorscope: 'scope-vectorscope-canvas',
  };

  return (
    <section
      class="scope-panel"
      classList={{ 'scope-panel--collapsed': props.collapsed() }}
      role="region"
      aria-label="Video scopes"
    >
      <header class="scope-panel__header">
        <button
          class="scope-panel__toggle"
          onClick={() => props.setCollapsed(!props.collapsed())}
          aria-expanded={!props.collapsed()}
        >
          Scopes <span class="text-xs text-[#9898a4] font-normal">(Experimental)</span> {props.collapsed() ? '▸' : '▾'}
        </button>
        {/* Clipping badge placeholder — wired when scope SAB is available */}
      </header>

      {!props.collapsed() && (
        <div class="scope-panel__grid">
          <ScopeView
            label="Histogram"
            canvasId={canvasIds.histogram}
            width={256}
            height={128}
            fullscreen={fullscreenScope() === 'histogram'}
            onToggleFullscreen={() =>
              setFullscreenScope(fullscreenScope() === 'histogram' ? null : 'histogram')
            }
          />
          <ScopeView
            label="Waveform"
            canvasId={canvasIds.waveform}
            width={256}
            height={128}
            fullscreen={fullscreenScope() === 'waveform'}
            onToggleFullscreen={() =>
              setFullscreenScope(fullscreenScope() === 'waveform' ? null : 'waveform')
            }
          />
          <ScopeView
            label="Parade"
            canvasId={canvasIds.parade}
            width={256}
            height={128}
            fullscreen={fullscreenScope() === 'parade'}
            onToggleFullscreen={() =>
              setFullscreenScope(fullscreenScope() === 'parade' ? null : 'parade')
            }
          />
          <ScopeView
            label="Vectorscope"
            canvasId={canvasIds.vectorscope}
            width={128}
            height={128}
            fullscreen={fullscreenScope() === 'vectorscope'}
            onToggleFullscreen={() =>
              setFullscreenScope(fullscreenScope() === 'vectorscope' ? null : 'vectorscope')
            }
          />
        </div>
      )}
    </section>
  );
}

interface ScopeViewProps {
  label: string;
  canvasId: string;
  width: number;
  height: number;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

function ScopeView(props: ScopeViewProps) {
  return (
    <div
      class="scope-view"
      classList={{ 'scope-view--fullscreen': props.fullscreen }}
    >
      <div class="scope-view__header">
        <span class="scope-view__label">{props.label}</span>
        <button
          class="scope-view__fullscreen-btn"
          onClick={props.onToggleFullscreen}
          aria-label={`Toggle ${props.label} fullscreen`}
        >
          ⛶
        </button>
      </div>
      <canvas
        id={props.canvasId}
        class="scope-view__canvas"
        width={props.width}
        height={props.height}
      />
    </div>
  );
}
