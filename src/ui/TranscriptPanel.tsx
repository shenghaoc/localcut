import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type {
  CaptionDiagnosticSnapshot,
  CaptionExportSettingsSnapshot,
  CaptionPresetIdSnapshot,
  CaptionTrackSnapshot,
  CaptionStyleSnapshot,
} from '../protocol';

interface TranscriptPanelProps {
  captionTracks: CaptionTrackSnapshot[];
  diagnostics: readonly CaptionDiagnosticSnapshot[];
  playheadTime: number;
  disabledReason?: string | null;
  selectedTrackId: string | null;
  selectedSegmentIds: readonly string[];
  onSelectTrack: (trackId: string | null) => void;
  onSelectSegmentIds: (segmentIds: string[]) => void;
  onImport: (file: File, trackId?: string) => void;
  onExport: (settings: CaptionExportSettingsSnapshot) => void;
  onSetTrack: (
    trackId: string,
    patch: {
      name?: string;
      language?: string | null;
      burnedIn?: boolean;
      visible?: boolean;
      defaultStyle?: Partial<CaptionStyleSnapshot>;
    },
  ) => void;
  onSetSegmentText: (trackId: string, segmentId: string, text: string) => void;
  onSetSegmentTiming: (trackId: string, segmentId: string, start: number, end: number) => void;
  onSetSegmentStyle: (trackId: string, segmentId: string, style: Partial<CaptionStyleSnapshot>) => void;
  onSplit: (trackId: string, segmentId: string, time: number) => void;
  onMerge: (trackId: string, segmentIds: readonly string[]) => void;
  onDelete: (trackId: string, segmentIds: readonly string[]) => void;
  onSnap: (trackId: string, segmentId: string, edge: 'start' | 'end' | 'both') => void;
}

const PRESETS: { value: CaptionPresetIdSnapshot; label: string }[] = [
  { value: 'subtitle', label: 'Subtitle' },
  { value: 'lower-third', label: 'Lower Third' },
  { value: 'note', label: 'Note' },
];

function formatTime(value: number): string {
  return value.toFixed(2);
}

function parseTime(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  let importInput: HTMLInputElement | undefined;
  const activeTrack = createMemo(() => props.captionTracks.find((track) => track.id === props.selectedTrackId) ?? props.captionTracks[0] ?? null);
  const activeSegment = createMemo(() => {
    const track = activeTrack();
    if (!track) return null;
    return track.segments.find((segment) => segment.id === props.selectedSegmentIds[0]) ?? track.segments[0] ?? null;
  });
  const [draftText, setDraftText] = createSignal('');

  const exportStem = createMemo(() => {
    const track = activeTrack();
    if (!track) return 'captions';
    return track.name.trim().replace(/\s+/g, '-').toLowerCase() || 'captions';
  });

  createEffect(() => {
    setDraftText(activeSegment()?.text ?? '');
  });

  function toggleSegment(segmentId: string, checked: boolean): void {
    const next = new Set(props.selectedSegmentIds);
    if (checked) next.add(segmentId);
    else next.delete(segmentId);
    props.onSelectSegmentIds([...next]);
  }

  return (
    <section class="panel transcript-panel">
      <div class="transcript-header">
        <div>
          <h2 class="panel-title">Captions</h2>
          <p class="transcript-subtitle">
            Structured timed text with sidecar export and optional burn-in.
          </p>
        </div>
        <div class="transcript-actions">
          <button
            type="button"
            class="button secondary"
            disabled={Boolean(props.disabledReason)}
            onClick={() => importInput?.click()}
          >
            Import
          </button>
          <input
            ref={importInput}
            class="sr-only"
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) props.onImport(file, activeTrack()?.id);
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            class="button secondary"
            disabled={Boolean(props.disabledReason) || !activeTrack()}
            onClick={() =>
              activeTrack() &&
              props.onExport({
                trackId: activeTrack()!.id,
                formats: ['srt', 'webvtt'],
                range: { mode: 'full-track' },
                fileStem: exportStem(),
              })
            }
          >
            Export
          </button>
        </div>
      </div>

      <Show
        when={props.captionTracks.length > 0}
        fallback={<p class="placeholder-text">{props.disabledReason ?? 'Import SRT or WebVTT to start a caption track.'}</p>}
      >
        <div class="transcript-track-list">
          <For each={props.captionTracks}>
            {(track) => (
              <button
                type="button"
                class={`transcript-track-chip${activeTrack()?.id === track.id ? ' is-active' : ''}`}
                onClick={() => {
                  props.onSelectTrack(track.id);
                  props.onSelectSegmentIds(track.segments[0] ? [track.segments[0].id] : []);
                }}
              >
                <span>{track.name}</span>
                <span>{track.segments.length}</span>
              </button>
            )}
          </For>
        </div>

        <Show when={activeTrack()}>
          {(track) => (
            <>
              <div class="transcript-track-controls">
                <label>
                  <span>Name</span>
                  <input
                    value={track().name}
                    onChange={(event) => props.onSetTrack(track().id, { name: event.currentTarget.value })}
                  />
                </label>
                <label>
                  <span>Language</span>
                  <input
                    value={track().language ?? ''}
                    placeholder="en"
                    onChange={(event) => props.onSetTrack(track().id, { language: event.currentTarget.value || null })}
                  />
                </label>
                <label class="transcript-inline-check">
                  <input
                    type="checkbox"
                    checked={track().burnedIn}
                    onChange={(event) => props.onSetTrack(track().id, { burnedIn: event.currentTarget.checked })}
                  />
                  <span>Burn in</span>
                </label>
                <label class="transcript-inline-check">
                  <input
                    type="checkbox"
                    checked={track().visible}
                    onChange={(event) => props.onSetTrack(track().id, { visible: event.currentTarget.checked })}
                  />
                  <span>Visible</span>
                </label>
                <label>
                  <span>Preset</span>
                  <select
                    value={track().defaultStyle.presetId ?? 'subtitle'}
                    onChange={(event) =>
                      props.onSetTrack(track().id, { defaultStyle: { presetId: event.currentTarget.value as CaptionPresetIdSnapshot } })
                    }
                  >
                    <For each={PRESETS}>{(preset) => <option value={preset.value}>{preset.label}</option>}</For>
                  </select>
                </label>
                <label>
                  <span>Font size</span>
                  <input
                    type="number"
                    min="16"
                    max="160"
                    value={track().defaultStyle.overrides?.fontSizePx ?? 64}
                    onChange={(event) =>
                      props.onSetTrack(track().id, {
                        defaultStyle: {
                          overrides: {
                            ...(track().defaultStyle.overrides ?? {}),
                            fontSizePx: Number(event.currentTarget.value),
                          },
                        },
                      })
                    }
                  />
                </label>
              </div>

              <div class="transcript-segment-list">
                <For each={track().segments}>
                  {(segment) => (
                    <div class={`transcript-row${props.selectedSegmentIds.includes(segment.id) ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        aria-label={`Select caption segment ${segment.id}`}
                        checked={props.selectedSegmentIds.includes(segment.id)}
                        onChange={(event) => toggleSegment(segment.id, event.currentTarget.checked)}
                      />
                      <button
                        type="button"
                        class="transcript-row-main"
                        onClick={() => {
                          props.onSelectTrack(track().id);
                          props.onSelectSegmentIds([segment.id]);
                          setDraftText(segment.text);
                        }}
                      >
                        <span class="transcript-time">
                          {formatTime(segment.start)} - {formatTime(segment.start + segment.duration)}
                        </span>
                        <span class="transcript-text">{segment.text}</span>
                      </button>
                    </div>
                  )}
                </For>
              </div>

              <Show when={activeSegment()}>
                {(segment) => (
                  <div class="transcript-editor">
                    <label>
                      <span>Text</span>
                      <textarea
                        value={draftText()}
                        rows={5}
                        onInput={(event) => setDraftText(event.currentTarget.value)}
                        onBlur={() => props.onSetSegmentText(track().id, segment().id, draftText())}
                      />
                    </label>
                    <div class="transcript-timing-grid">
                      <label>
                        <span>Start</span>
                        <input
                          value={formatTime(segment().start)}
                          onChange={(event) =>
                            props.onSetSegmentTiming(
                              track().id,
                              segment().id,
                              parseTime(event.currentTarget.value, segment().start),
                              segment().start + segment().duration,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          value={formatTime(segment().start + segment().duration)}
                          onChange={(event) =>
                            props.onSetSegmentTiming(
                              track().id,
                              segment().id,
                              segment().start,
                              parseTime(event.currentTarget.value, segment().start + segment().duration),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Color</span>
                        <input
                          type="color"
                          value={segment().style?.overrides?.color ?? track().defaultStyle.overrides?.color ?? '#ffffff'}
                          onChange={(event) => props.onSetSegmentStyle(track().id, segment().id, { overrides: { color: event.currentTarget.value } })}
                        />
                      </label>
                      <label>
                        <span>Background</span>
                        <input
                          type="color"
                          value={segment().style?.overrides?.backgroundColor ?? track().defaultStyle.overrides?.backgroundColor ?? '#000000'}
                          onChange={(event) =>
                            props.onSetSegmentStyle(track().id, segment().id, { overrides: { backgroundColor: event.currentTarget.value } })
                          }
                        />
                      </label>
                    </div>
                    <div class="transcript-editor-actions">
                      <button type="button" class="button secondary" onClick={() => props.onSplit(track().id, segment().id, props.playheadTime)}>
                        Split at playhead
                      </button>
                      <button
                        type="button"
                        class="button secondary"
                        disabled={props.selectedSegmentIds.length < 2}
                        onClick={() => props.onMerge(track().id, props.selectedSegmentIds)}
                      >
                        Merge selected
                      </button>
                      <button type="button" class="button secondary" onClick={() => props.onSnap(track().id, segment().id, 'start')}>
                        Snap start
                      </button>
                      <button type="button" class="button secondary" onClick={() => props.onSnap(track().id, segment().id, 'end')}>
                        Snap end
                      </button>
                      <button type="button" class="button secondary" onClick={() => props.onSnap(track().id, segment().id, 'both')}>
                        Snap both
                      </button>
                      <button
                        type="button"
                        class="button danger"
                        onClick={() => props.onDelete(track().id, props.selectedSegmentIds.length > 0 ? props.selectedSegmentIds : [segment().id])}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>

      <Show when={props.diagnostics.length > 0}>
        <div class="transcript-diagnostics" role="status" aria-live="polite">
          <For each={props.diagnostics.slice(0, 6)}>
            {(diag) => (
              <p class={`transcript-diagnostic is-${diag.severity}`}>
                {diag.message}
              </p>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
