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
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface SelectedClipFades {
  trackId: string;
  clipId: string;
  duration: number;
  audioFadeIn: number;
  audioFadeOut: number;
}

interface InspectorProps {
  metadata: MediaMetadata | null;
  selectedClip: SelectedClip | null;
  selectedTrackMix: SelectedTrackMix | null;
  selectedClipFades: SelectedClipFades | null;
  onEffectParam: (
    trackId: string,
    clipId: string,
    key: keyof ClipEffectParamsSnapshot,
    value: number,
  ) => void;
  onTrackGain: (trackId: string, gain: number) => void;
  onTrackMute: (trackId: string, muted: boolean) => void;
  onTrackSolo: (trackId: string, solo: boolean) => void;
  onTrackPan: (trackId: string, pan: number) => void;
  onClipFade: (trackId: string, clipId: string, edge: 'in' | 'out', durationS: number) => void;
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

type MixDraft = Pick<SelectedTrackMix, 'gain' | 'pan'>;
type FadeDraft = Pick<SelectedClipFades, 'audioFadeIn' | 'audioFadeOut'>;

export function Inspector(props: InspectorProps) {
  const [draft, setDraft] = createSignal<ClipEffectParamsSnapshot | null>(null);
  const [mixDraft, setMixDraft] = createSignal<MixDraft | null>(null);
  const [fadeDraft, setFadeDraft] = createSignal<FadeDraft | null>(null);
  const pending = new Map<keyof ClipEffectParamsSnapshot, number>();
  const debouncers = new Map<keyof ClipEffectParamsSnapshot, ReturnType<typeof setTimeout>>();
  const mixPending = new Map<keyof MixDraft, number>();
  const mixDebouncers = new Map<keyof MixDraft, ReturnType<typeof setTimeout>>();
  const fadePending = new Map<keyof FadeDraft, number>();
  const fadeDebouncers = new Map<keyof FadeDraft, ReturnType<typeof setTimeout>>();
  const pendingTarget = { trackId: '', clipId: '' };
  const mixTarget = { trackId: '' };
  const fadeTarget = { trackId: '', clipId: '' };

  function flushPending() {
    if (!pendingTarget.clipId || pending.size === 0) return;
    for (const handle of debouncers.values()) clearTimeout(handle);
    debouncers.clear();
    for (const [key, value] of pending) {
      props.onEffectParam(pendingTarget.trackId, pendingTarget.clipId, key, value);
    }
    pending.clear();
  }

  function flushMixPending() {
    if (!mixTarget.trackId || mixPending.size === 0) return;
    for (const handle of mixDebouncers.values()) clearTimeout(handle);
    mixDebouncers.clear();
    for (const [key, value] of mixPending) {
      if (key === 'gain') props.onTrackGain(mixTarget.trackId, value);
      if (key === 'pan') props.onTrackPan(mixTarget.trackId, value);
    }
    mixPending.clear();
  }

  function flushFadePending() {
    if (!fadeTarget.clipId || fadePending.size === 0) return;
    for (const handle of fadeDebouncers.values()) clearTimeout(handle);
    fadeDebouncers.clear();
    for (const [key, value] of fadePending) {
      props.onClipFade(
        fadeTarget.trackId,
        fadeTarget.clipId,
        key === 'audioFadeIn' ? 'in' : 'out',
        value,
      );
    }
    fadePending.clear();
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

  function scheduleMixParam(key: keyof MixDraft, value: number) {
    const mix = props.selectedTrackMix;
    if (!mix) return;
    mixTarget.trackId = mix.trackId;
    setMixDraft((prev) => ({ gain: mix.gain, pan: mix.pan, ...prev, [key]: value }));
    mixPending.set(key, value);
    const existing = mixDebouncers.get(key);
    if (existing) clearTimeout(existing);
    mixDebouncers.set(
      key,
      setTimeout(() => {
        mixDebouncers.delete(key);
        const latest = mixPending.get(key);
        mixPending.delete(key);
        if (latest !== undefined) {
          if (key === 'gain') props.onTrackGain(mix.trackId, latest);
          if (key === 'pan') props.onTrackPan(mix.trackId, latest);
        }
      }, PARAM_DEBOUNCE_MS),
    );
  }

  function scheduleFadeParam(key: keyof FadeDraft, value: number) {
    const fades = props.selectedClipFades;
    if (!fades) return;
    fadeTarget.trackId = fades.trackId;
    fadeTarget.clipId = fades.clipId;
    setFadeDraft((prev) => ({
      audioFadeIn: fades.audioFadeIn,
      audioFadeOut: fades.audioFadeOut,
      ...prev,
      [key]: value,
    }));
    fadePending.set(key, value);
    const existing = fadeDebouncers.get(key);
    if (existing) clearTimeout(existing);
    fadeDebouncers.set(
      key,
      setTimeout(() => {
        fadeDebouncers.delete(key);
        const latest = fadePending.get(key);
        fadePending.delete(key);
        if (latest !== undefined) {
          props.onClipFade(
            fades.trackId,
            fades.clipId,
            key === 'audioFadeIn' ? 'in' : 'out',
            latest,
          );
        }
      }, PARAM_DEBOUNCE_MS),
    );
  }

  createEffect(() => {
    const clip = props.selectedClip;
    if (!clip) {
      flushPending();
      flushMixPending();
      flushFadePending();
      pendingTarget.trackId = '';
      pendingTarget.clipId = '';
      mixTarget.trackId = '';
      fadeTarget.trackId = '';
      fadeTarget.clipId = '';
      setDraft(null);
      setMixDraft(null);
      setFadeDraft(null);
      return;
    }
    if (pendingTarget.clipId && pendingTarget.clipId !== clip.clipId) {
      flushPending();
    }
    pendingTarget.trackId = clip.trackId;
    pendingTarget.clipId = clip.clipId;
    syncDraftFromClip(clip);
  });

  createEffect(() => {
    const mix = props.selectedTrackMix;
    if (!mix) {
      flushMixPending();
      mixTarget.trackId = '';
      setMixDraft(null);
      return;
    }
    if (mixTarget.trackId && mixTarget.trackId !== mix.trackId) {
      flushMixPending();
    }
    mixTarget.trackId = mix.trackId;
    setMixDraft((prev) => {
      const base = { gain: mix.gain, pan: mix.pan };
      if (!prev) return base;
      return {
        gain: mixPending.has('gain') || mixDebouncers.has('gain') ? prev.gain : mix.gain,
        pan: mixPending.has('pan') || mixDebouncers.has('pan') ? prev.pan : mix.pan,
      };
    });
  });

  createEffect(() => {
    const fades = props.selectedClipFades;
    if (!fades) {
      flushFadePending();
      fadeTarget.trackId = '';
      fadeTarget.clipId = '';
      setFadeDraft(null);
      return;
    }
    if (fadeTarget.clipId && fadeTarget.clipId !== fades.clipId) {
      flushFadePending();
    }
    fadeTarget.trackId = fades.trackId;
    fadeTarget.clipId = fades.clipId;
    setFadeDraft((prev) => {
      const base = { audioFadeIn: fades.audioFadeIn, audioFadeOut: fades.audioFadeOut };
      if (!prev) return base;
      return {
        audioFadeIn:
          fadePending.has('audioFadeIn') || fadeDebouncers.has('audioFadeIn')
            ? prev.audioFadeIn
            : fades.audioFadeIn,
        audioFadeOut:
          fadePending.has('audioFadeOut') || fadeDebouncers.has('audioFadeOut')
            ? prev.audioFadeOut
            : fades.audioFadeOut,
      };
    });
  });

  onCleanup(() => {
    flushPending();
    flushMixPending();
    flushFadePending();
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
            <Show when={mixDraft()}>
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
                        scheduleMixParam('gain', Number((e.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                  <label class="effect-slider">
                    <span class="effect-slider-label">
                      Pan
                      <span class="effect-slider-value tabular-nums">{mix().pan.toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={mix().pan}
                      onInput={(e) =>
                        scheduleMixParam('pan', Number((e.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                  <Show when={props.selectedTrackMix}>
                    {(trackMix) => (
                      <>
                        <label class="mix-toggle">
                          <input
                            type="checkbox"
                            checked={trackMix().muted}
                            onChange={(e) =>
                              props.onTrackMute(
                                trackMix().trackId,
                                (e.currentTarget as HTMLInputElement).checked,
                              )
                            }
                          />
                          Mute
                        </label>
                        <label class="mix-toggle">
                          <input
                            type="checkbox"
                            checked={trackMix().solo}
                            onChange={(e) =>
                              props.onTrackSolo(
                                trackMix().trackId,
                                (e.currentTarget as HTMLInputElement).checked,
                              )
                            }
                          />
                          Solo
                        </label>
                      </>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={fadeDraft()}>
              {(fades) => (
                <div class="track-mix-controls">
                  <h3 class="panel-subtitle">Audio fades</h3>
                  <label class="effect-slider">
                    <span class="effect-slider-label">
                      Fade in
                      <span class="effect-slider-value tabular-nums">{fades().audioFadeIn.toFixed(2)}s</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={props.selectedClipFades?.duration ?? 0}
                      step={0.01}
                      value={fades().audioFadeIn}
                      onInput={(e) =>
                        scheduleFadeParam('audioFadeIn', Number((e.currentTarget as HTMLInputElement).value))
                      }
                    />
                  </label>
                  <label class="effect-slider">
                    <span class="effect-slider-label">
                      Fade out
                      <span class="effect-slider-value tabular-nums">{fades().audioFadeOut.toFixed(2)}s</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={props.selectedClipFades?.duration ?? 0}
                      step={0.01}
                      value={fades().audioFadeOut}
                      onInput={(e) =>
                        scheduleFadeParam('audioFadeOut', Number((e.currentTarget as HTMLInputElement).value))
                      }
                    />
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
