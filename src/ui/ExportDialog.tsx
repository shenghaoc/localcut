import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Popover } from '@kobalte/core/popover';
import { Download } from 'lucide-solid';
import { Button } from './components/button';
import type {
  ExportCodecSupport,
  ExportPreset,
  ExportProgress,
  ExportSettings,
  ExportVideoCodec,
} from '../protocol';

interface ExportDialogProps {
  hasMedia: boolean;
  exporting: boolean;
  progress: ExportProgress | null;
  lastResult: string | null;
  error: string | null;
  timelineDuration: number;
  supportedCodecs: ExportCodecSupport[];
  initialSettings: ExportSettings | null;
  onProbe: () => void;
  onStart: (settings: ExportSettings) => void;
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

function codecLabel(codec: ExportVideoCodec): string {
  switch (codec) {
    case 'h264':
      return 'H.264';
    case 'vp9':
      return 'VP9';
    case 'av1':
      return 'AV1';
  }
}

function defaultSettings(preset: ExportPreset): ExportSettings {
  return {
    preset,
    codec: 'h264',
    container: 'mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: preset === 'quality' ? 10_000_000 : 5_000_000,
  };
}

/** Export UI — Phase 6 shell, Phase 17 settings. */
export function ExportDialog(props: ExportDialogProps) {
  const [open, setOpen] = createSignal(false);
  const [settings, setSettings] = createSignal<ExportSettings>(defaultSettings('quality'));
  const [useRange, setUseRange] = createSignal(false);
  const [rangeStart, setRangeStart] = createSignal(0);
  const [rangeEnd, setRangeEnd] = createSignal(0);
  const percent = createMemo(() => Math.round((props.progress?.percent ?? 0) * 100));

  const supportedCodecSet = createMemo(
    () => new Set(props.supportedCodecs.map((entry) => `${entry.codec}:${entry.container}`)),
  );

  createEffect(() => {
    if (props.exporting || props.error || props.lastResult) setOpen(true);
  });

  createEffect(() => {
    if (!open()) return;
    props.onProbe();
  });

  createEffect(() => {
    const incoming = props.initialSettings;
    if (!incoming) return;
    setSettings(incoming);
    if (incoming.range) {
      setUseRange(true);
      setRangeStart(incoming.range.startS);
      setRangeEnd(incoming.range.endS);
    } else {
      setUseRange(false);
      setRangeStart(0);
      setRangeEnd(props.timelineDuration);
    }
  });

  createEffect(() => {
    const duration = props.timelineDuration;
    if (duration > 0 && rangeEnd() <= 0) {
      setRangeEnd(duration);
    }
  });

  const handleOpenChange = (next: boolean) => {
    if (!next && props.exporting) return;
    setOpen(next);
  };

  function applyPreset(preset: ExportPreset) {
    setSettings((current) => ({
      ...current,
      preset,
      videoBitrate: preset === 'quality' ? 10_000_000 : 5_000_000,
    }));
  }

  function setCodec(codec: ExportVideoCodec) {
    const container = codec === 'h264' ? 'mp4' : 'webm';
    if (!supportedCodecSet().has(`${codec}:${container}`)) return;
    setSettings((current) => ({ ...current, codec, container }));
  }

  function buildSettings(): ExportSettings {
    const current = settings();
    const duration = Math.max(0, props.timelineDuration);
    const range = useRange()
      ? {
          startS: Math.max(0, Math.min(rangeStart(), duration)),
          endS: Math.max(0, Math.min(rangeEnd(), duration)),
        }
      : undefined;
    return {
      ...current,
      width: Math.max(2, Math.round(current.width / 2) * 2),
      height: Math.max(2, Math.round(current.height / 2) * 2),
      fps: Math.max(1, current.fps),
      videoBitrate: Math.max(100_000, Math.round(current.videoBitrate)),
      range: range && range.endS > range.startS ? range : undefined,
    };
  }

  return (
    <Popover open={open()} onOpenChange={handleOpenChange} placement="bottom-end" gutter={7}>
      <Popover.Trigger as={Button} disabled={!props.hasMedia}>
        <Download size={14} aria-hidden="true" />
        Export
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="export-popover panel" aria-label="Export">
          <p class="export-eyebrow">Export preset</p>
          <div class="export-presets" role="group" aria-label="Export preset">
            <button
              type="button"
              class={`segmented-btn${settings().preset === 'quality' ? ' is-active' : ''}`}
              aria-pressed={settings().preset === 'quality'}
              disabled={props.exporting}
              onClick={() => applyPreset('quality')}
            >
              Quality
            </button>
            <button
              type="button"
              class={`segmented-btn${settings().preset === 'fast' ? ' is-active' : ''}`}
              aria-pressed={settings().preset === 'fast'}
              disabled={props.exporting}
              onClick={() => applyPreset('fast')}
            >
              Fast
            </button>
          </div>

          <Show when={props.supportedCodecs.length > 0}>
            <p class="export-eyebrow">Codec</p>
            <div class="export-codecs" role="group" aria-label="Export codec">
              <For each={props.supportedCodecs}>
                {(entry) => (
                  <button
                    type="button"
                    class={`segmented-btn${settings().codec === entry.codec ? ' is-active' : ''}`}
                    aria-pressed={settings().codec === entry.codec}
                    disabled={props.exporting}
                    onClick={() => setCodec(entry.codec)}
                  >
                    {codecLabel(entry.codec)} · {entry.container.toUpperCase()}
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="export-fields">
            <label class="export-field">
              <span>Width</span>
              <input
                type="number"
                min="2"
                step="2"
                value={settings().width}
                disabled={props.exporting}
                onInput={(event) =>
                  setSettings((current) => ({ ...current, width: Number(event.currentTarget.value) }))
                }
              />
            </label>
            <label class="export-field">
              <span>Height</span>
              <input
                type="number"
                min="2"
                step="2"
                value={settings().height}
                disabled={props.exporting}
                onInput={(event) =>
                  setSettings((current) => ({ ...current, height: Number(event.currentTarget.value) }))
                }
              />
            </label>
            <label class="export-field">
              <span>FPS</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={settings().fps}
                disabled={props.exporting}
                onInput={(event) =>
                  setSettings((current) => ({ ...current, fps: Number(event.currentTarget.value) }))
                }
              />
            </label>
            <label class="export-field">
              <span>Bitrate (Mbps)</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={(settings().videoBitrate / 1_000_000).toFixed(1)}
                disabled={props.exporting}
                onInput={(event) =>
                  setSettings((current) => ({
                    ...current,
                    videoBitrate: Number(event.currentTarget.value) * 1_000_000,
                  }))
                }
              />
            </label>
          </div>

          <label class="export-range-toggle">
            <input
              type="checkbox"
              checked={useRange()}
              disabled={props.exporting || props.timelineDuration <= 0}
              onChange={(event) => setUseRange(event.currentTarget.checked)}
            />
            <span>Export range</span>
          </label>
          <Show when={useRange()}>
            <div class="export-fields">
              <label class="export-field">
                <span>In (s)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={props.timelineDuration}
                  value={rangeStart()}
                  disabled={props.exporting}
                  onInput={(event) => setRangeStart(Number(event.currentTarget.value))}
                />
              </label>
              <label class="export-field">
                <span>Out (s)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={props.timelineDuration}
                  value={rangeEnd()}
                  disabled={props.exporting}
                  onInput={(event) => setRangeEnd(Number(event.currentTarget.value))}
                />
              </label>
            </div>
          </Show>

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
            <Button
              variant="default"
              disabled={props.exporting || !props.hasMedia || props.supportedCodecs.length === 0}
              onClick={() => props.onStart(buildSettings())}
            >
              Start
            </Button>
            <Show when={props.exporting}>
              <Button onClick={() => props.onCancel()}>Cancel</Button>
            </Show>
            <Popover.CloseButton as={Button} disabled={props.exporting}>
              Close
            </Popover.CloseButton>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
