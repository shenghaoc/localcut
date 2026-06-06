import { Show, For, createEffect, createSignal, onCleanup } from 'solid-js';
import type { ClipEffectParamsSnapshot, MediaMetadata } from '../protocol';

export interface SelectedClip {
  trackId: string;
  clipId: string;
  effects: ClipEffectParamsSnapshot;
}

export interface SelectedTrackMix {
  trackId: string;
  gain: number;
  muted: boolean;
  solo: boolean;
}

interface InspectorProps {
  metadata: MediaMetadata | null;
  selectedClip: SelectedClip | null;
  selectedTrackMix: SelectedTrackMix | null;
  onEffectParam: (
    trackId: string,
    clipId: string,
    key: keyof ClipEffectParamsSnapshot,
    value: number,
  ) => void;
  onTrackGain: (trackId: string, gain: number) => void;
  onTrackMute: (trackId: string, muted: boolean) => void;
  onTrackSolo: (trackId: string, solo: boolean) => void;
}

const PARAM_DEBOUNCE_MS = 80;

interface SliderSpec {
  key: keyof ClipEffectParamsSnapshot;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2) },
  {
    key: 'temperature',
    label: 'Temperature',
    min: 2000,
    max: 10000,
    step: 50,
    format: (v) => `${Math.round(v)} K`,
  },
  {
    key: 'temperatureStrength',
    label: 'Temp Strength',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => v.toFixed(2),
  },
];

export function Inspector(props: InspectorProps) {
  const [draft, setDraft] = createSignal<ClipEffectParamsSnapshot | null>(null);
  const pending = new Map<keyof ClipEffectParamsSnapshot, number>();
  const debouncers = new Map<keyof ClipEffectParamsSnapshot, ReturnType<typeof setTimeout>>();
  const pendingTarget = { trackId: '', clipId: '' };

  function flushPending() {
    if (!pendingTarget.clipId || pending.size === 0) return;
    for (const handle of debouncers.values()) clearTimeout(handle);
    debouncers.clear();
    for (const [key, value] of pending) {
      props.onEffectParam(pendingTarget.trackId, pendingTarget.clipId, key, value);
    }
    pending.clear();
  }

  function syncDraftFromClip(clip: SelectedClip) {
    setDraft((prev) => {
      const base = { ...clip.effects };
      if (!prev) return base;
      const next = { ...base };
      for (const spec of SLIDERS) {
        if (pending.has(spec.key) || debouncers.has(spec.key)) {
          next[spec.key] = prev[spec.key];
        }
      }
      return next;
    });
  }

  createEffect(() => {
    const clip = props.selectedClip;
    if (!clip) {
      flushPending();
      pendingTarget.trackId = '';
      pendingTarget.clipId = '';
      setDraft(null);
      return;
    }
    if (pendingTarget.clipId && pendingTarget.clipId !== clip.clipId) {
      flushPending();
    }
    pendingTarget.trackId = clip.trackId;
    pendingTarget.clipId = clip.clipId;
    syncDraftFromClip(clip);
  });

  onCleanup(() => {
    flushPending();
  });

  function scheduleParam(key: keyof ClipEffectParamsSnapshot, value: number) {
    const clip = props.selectedClip;
    if (!clip) return;
    pendingTarget.trackId = clip.trackId;
    pendingTarget.clipId = clip.clipId;
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    pending.set(key, value);
    const existing = debouncers.get(key);
    if (existing) clearTimeout(existing);
    debouncers.set(
      key,
      setTimeout(() => {
        debouncers.delete(key);
        const latest = pending.get(key);
        pending.delete(key);
        if (latest !== undefined) {
          props.onEffectParam(clip.trackId, clip.clipId, key, latest);
        }
      }, PARAM_DEBOUNCE_MS),
    );
  }

  return (
    <aside class="inspector panel">
      <h2 class="panel-title">Inspector</h2>
      <Show
        when={props.selectedClip}
        fallback={
          <div class="inspector-empty">
            <p class="inspector-empty-title">No clip selected</p>
            <p class="placeholder-text">Select a timeline clip to adjust colour and track mix.</p>
          </div>
        }
      >
        {(clip) => (
          <div class="inspector-section">
            <dl class="clip-summary">
              <div>
                <dt>Track</dt>
                <dd>{clip().trackId}</dd>
              </div>
              <div>
                <dt>Clip</dt>
                <dd>{clip().clipId}</dd>
              </div>
            </dl>
            <Show when={props.selectedTrackMix}>
              {(mix) => (
                <div class="track-mix-controls">
                  <h3 class="panel-subtitle">Track mix</h3>
                  <label class="effect-slider">
                    <span class="effect-slider-label">
                      Gain
                      <span class="effect-slider-value tabular-nums">{mix().gain.toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={mix().gain}
                      onInput={(e) =>
                        props.onTrackGain(mix().trackId, Number((e.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                  <label class="mix-toggle">
                    <input
                      type="checkbox"
                      checked={mix().muted}
                      onChange={(e) =>
                        props.onTrackMute(mix().trackId, (e.currentTarget as HTMLInputElement).checked)
                      }
                    />
                    Mute
                  </label>
                  <label class="mix-toggle">
                    <input
                      type="checkbox"
                      checked={mix().solo}
                      onChange={(e) =>
                        props.onTrackSolo(mix().trackId, (e.currentTarget as HTMLInputElement).checked)
                      }
                    />
                    Solo
                  </label>
                </div>
              )}
            </Show>
            <Show when={draft()}>
              {(effects) => (
                <div class="effect-sliders">
                  <h3 class="panel-subtitle">Effects</h3>
                  <For each={SLIDERS}>
                    {(spec) => (
                      <label class="effect-slider">
                        <span class="effect-slider-label">
                          {spec.label}
                          <span class="effect-slider-value tabular-nums">{spec.format(effects()[spec.key])}</span>
                        </span>
                        <input
                          type="range"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          value={effects()[spec.key]}
                          onInput={(e) =>
                            scheduleParam(spec.key, Number((e.currentTarget as HTMLInputElement).value))
                          }
                        />
                      </label>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.metadata} keyed>
        {(meta) => (
          <>
            <h3 class="panel-subtitle">Source</h3>
            <dl class="metadata-list">
              <dt>Duration</dt>
              <dd class="tabular-nums">{meta.duration.toFixed(2)}s</dd>
              <dt>Tracks</dt>
              <dd>{meta.trackCount}</dd>
              <Show when={meta.video} keyed>
                {(video) => (
                  <>
                    <dt>Video</dt>
                    <dd>
                      {video.width}×{video.height}
                      {video.codec ? ` · ${video.codec}` : ''}
                      {video.frameRate != null ? ` · ${video.frameRate.toFixed(2)} fps` : ''}
                    </dd>
                  </>
                )}
              </Show>
              <Show when={meta.audio} keyed>
                {(audio) => (
                  <>
                    <dt>Audio</dt>
                    <dd>
                      {audio.channels} ch · {audio.sampleRate} Hz
                      {audio.codec ? ` · ${audio.codec}` : ''}
                    </dd>
                  </>
                )}
              </Show>
            </dl>
          </>
        )}
      </Show>
    </aside>
  );
}
