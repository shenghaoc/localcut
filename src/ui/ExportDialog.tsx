import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import type { ExportPreset, ExportProgress } from '../protocol';

interface ExportDialogProps {
  hasMedia: boolean;
  exporting: boolean;
  progress: ExportProgress | null;
  lastResult: string | null;
  error: string | null;
  onStart: (preset: ExportPreset) => void;
  onCancel: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'ETA pending';
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (minutes <= 0) return `${secs}s`;
  return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
}

/** Export UI — wired in Phase 6. */
export function ExportDialog(props: ExportDialogProps) {
  const [open, setOpen] = createSignal(false);
  const [preset, setPreset] = createSignal<ExportPreset>('quality');
  const percent = createMemo(() => Math.round((props.progress?.percent ?? 0) * 100));

  createEffect(() => {
    if (props.exporting || props.error || props.lastResult) setOpen(true);
  });

  return (
    <div class="export-control">
      <button
        type="button"
        class="btn"
        disabled={!props.hasMedia}
        onClick={() => setOpen((value) => !value)}
      >
        Export
      </button>
      <Show when={open()}>
        <div class="export-popover panel" role="dialog" aria-label="Export">
          <div class="export-presets" role="group" aria-label="Export preset">
            <button
              type="button"
              class={`segmented-btn${preset() === 'quality' ? ' is-active' : ''}`}
              disabled={props.exporting}
              onClick={() => setPreset('quality')}
            >
              Quality
            </button>
            <button
              type="button"
              class={`segmented-btn${preset() === 'fast' ? ' is-active' : ''}`}
              disabled={props.exporting}
              onClick={() => setPreset('fast')}
            >
              Fast
            </button>
          </div>

          <Show when={props.progress}>
            {(progress) => (
              <div class="export-progress">
                <div class="export-progress-row">
                  <span>{progress().phase}</span>
                  <span class="tabular-nums">{percent()}%</span>
                </div>
                <progress max="1" value={progress().percent} />
                <div class="export-estimate">
                  <span>{formatDuration(progress().etaSeconds)}</span>
                  <Show when={progress().subRealtime && progress().etaSeconds !== null}>
                    <span>Sub-real-time on this hardware</span>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={props.lastResult}>
            <p class="export-note">{props.lastResult}</p>
          </Show>
          <Show when={props.error}>
            <p class="export-error">{props.error}</p>
          </Show>

          <div class="export-actions">
            <button
              type="button"
              class="btn"
              disabled={props.exporting || !props.hasMedia}
              onClick={() => props.onStart(preset())}
            >
              Start
            </button>
            <Show when={props.exporting}>
              <button type="button" class="btn" onClick={() => props.onCancel()}>
                Cancel
              </button>
            </Show>
            <button type="button" class="btn" disabled={props.exporting} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
