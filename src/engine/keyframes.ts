import type {
  ClipEffectParamsSnapshot,
  ClipKeyframeParamSnapshot,
  ClipKeyframesSnapshot,
  KeyframeEasingSnapshot,
  KeyframeSnapshot,
  TransformParamsSnapshot,
} from '../protocol';
import { DEFAULT_CLIP_EFFECTS, normalizeClipEffects, type ClipEffectParams } from './effects';
import { DEFAULT_TRANSFORM, normalizeTransform, type TransformParams } from './transform';

const KEYFRAME_EPSILON = 1e-4;

export type KeyframeEasing = KeyframeEasingSnapshot;
export type Keyframe = KeyframeSnapshot;
export type ClipKeyframeParam = ClipKeyframeParamSnapshot;
export type ClipKeyframes = ClipKeyframesSnapshot;

export interface SampledClipParams {
  effects: ClipEffectParams;
  transform: TransformParams;
}

export interface KeyframedClip {
  start: number;
  duration: number;
  effects: ClipEffectParamsSnapshot;
  transform: TransformParamsSnapshot;
  keyframes?: ClipKeyframes;
}

const EFFECT_PARAM_KEYS = new Set<ClipKeyframeParam>([
  'brightness',
  'contrast',
  'saturation',
  'temperature',
  'temperatureStrength',
  'lutStrength',
]);

const TRANSFORM_PARAM_KEYS = new Set<ClipKeyframeParam>([
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'anchorX',
  'anchorY',
]);

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) <= KEYFRAME_EPSILON;
}

function normalizeEasing(value: unknown): KeyframeEasing {
  return value === 'ease' || value === 'hold' || value === 'linear' ? value : 'linear';
}

function isKeyframeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEffectKeyframeParam(key: ClipKeyframeParam): key is keyof ClipEffectParamsSnapshot {
  return EFFECT_PARAM_KEYS.has(key);
}

export function isTransformKeyframeParam(key: ClipKeyframeParam): key is Exclude<keyof TransformParamsSnapshot, 'fit'> {
  return TRANSFORM_PARAM_KEYS.has(key);
}

export function isClipKeyframeParam(key: unknown): key is ClipKeyframeParam {
  return typeof key === 'string' && (EFFECT_PARAM_KEYS.has(key as ClipKeyframeParam) || TRANSFORM_PARAM_KEYS.has(key as ClipKeyframeParam));
}

export function normalizeKeyframeTrack(track: readonly Keyframe[] | undefined, maxT = Number.POSITIVE_INFINITY): Keyframe[] {
  if (!track) return [];
  const byTime = new Map<number, Keyframe>();
  for (const frame of track) {
    if (!finite(frame.t) || !finite(frame.value) || frame.t < 0 || frame.t > maxT) continue;
    const existingKey = [...byTime.keys()].find((t) => sameTime(t, frame.t));
    const normalized: Keyframe = {
      t: Math.max(0, frame.t),
      value: frame.value,
      easing: normalizeEasing(frame.easing),
    };
    if (existingKey !== undefined) {
      byTime.delete(existingKey);
    }
    byTime.set(normalized.t, normalized);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function normalizeClipKeyframes(
  keyframes: ClipKeyframes | undefined,
  maxT = Number.POSITIVE_INFINITY,
): ClipKeyframes | undefined {
  if (!keyframes) return undefined;
  const normalized: ClipKeyframes = {};
  for (const [rawKey, rawTrack] of Object.entries(keyframes)) {
    if (!isClipKeyframeParam(rawKey) || !Array.isArray(rawTrack)) continue;
    const track = normalizeKeyframeTrack(rawTrack, maxT);
    if (track.length > 0) {
      normalized[rawKey] = track;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseClipKeyframes(
  value: unknown,
  maxT = Number.POSITIVE_INFINITY,
): ClipKeyframes | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isKeyframeRecord(value)) return null;
  const parsed: ClipKeyframes = {};
  for (const [rawKey, rawTrack] of Object.entries(value)) {
    if (!isClipKeyframeParam(rawKey) || !Array.isArray(rawTrack)) return null;
    const frames: Keyframe[] = [];
    for (const rawFrame of rawTrack) {
      if (!isKeyframeRecord(rawFrame)) return null;
      const t = rawFrame.t;
      const frameValue = rawFrame.value;
      if (typeof t !== 'number' || typeof frameValue !== 'number') return null;
      if (!finite(t) || !finite(frameValue) || t < 0 || t > maxT) return null;
      frames.push({
        t,
        value: frameValue,
        easing: normalizeEasing(rawFrame.easing),
      });
    }
    const normalized = normalizeKeyframeTrack(frames, maxT);
    if (normalized.length > 0) parsed[rawKey] = normalized;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function cloneClipKeyframes(keyframes: ClipKeyframes | undefined): ClipKeyframes | undefined {
  const normalized = normalizeClipKeyframes(keyframes);
  if (!normalized) return undefined;
  const cloned: ClipKeyframes = {};
  for (const [rawKey, track] of Object.entries(normalized)) {
    if (isClipKeyframeParam(rawKey)) {
      cloned[rawKey] = track.map((frame) => ({ ...frame }));
    }
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

export function insertKeyframe(track: readonly Keyframe[] | undefined, keyframe: Keyframe): Keyframe[] {
  if (!finite(keyframe.t) || !finite(keyframe.value) || keyframe.t < 0) {
    return normalizeKeyframeTrack(track);
  }
  return normalizeKeyframeTrack([...(track ?? []), { ...keyframe, easing: normalizeEasing(keyframe.easing) }]);
}

export function deleteKeyframe(track: readonly Keyframe[] | undefined, t: number): Keyframe[] {
  if (!finite(t) || t < 0) return normalizeKeyframeTrack(track);
  return normalizeKeyframeTrack(track).filter((frame) => !sameTime(frame.t, t));
}

export function moveKeyframe(track: readonly Keyframe[] | undefined, fromT: number, toT: number): Keyframe[] {
  if (!finite(fromT) || !finite(toT) || fromT < 0 || toT < 0) return normalizeKeyframeTrack(track);
  const normalized = normalizeKeyframeTrack(track);
  const found = normalized.find((frame) => sameTime(frame.t, fromT));
  if (!found) return normalized;
  const without = normalized.filter((frame) => !sameTime(frame.t, fromT));
  return insertKeyframe(without, { ...found, t: toT });
}

function easeAmount(easing: KeyframeEasing, amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  if (easing === 'hold') return 0;
  if (easing === 'ease') return t * t * (3 - 2 * t);
  return t;
}

export function sampleKeyframes(track: readonly Keyframe[] | undefined, t: number, fallback: number): number {
  if (!finite(t)) return fallback;
  const normalized = normalizeKeyframeTrack(track);
  if (normalized.length === 0) return fallback;
  if (t <= normalized[0]!.t) return normalized[0]!.value;
  const last = normalized[normalized.length - 1]!;
  if (t >= last.t) return last.value;

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const left = normalized[index]!;
    const right = normalized[index + 1]!;
    if (t < left.t || t > right.t) continue;
    if (sameTime(t, right.t)) return right.value;
    const span = Math.max(KEYFRAME_EPSILON, right.t - left.t);
    const amount = easeAmount(left.easing, (t - left.t) / span);
    return left.value + (right.value - left.value) * amount;
  }
  return fallback;
}

function clipLocalTime(clip: KeyframedClip, timelineTime: number): number {
  if (!finite(timelineTime)) return 0;
  return Math.min(Math.max(0, timelineTime - clip.start), Math.max(0, clip.duration));
}

export function sampleClipParamsAt(clip: KeyframedClip, timelineTime: number): SampledClipParams {
  const localTime = clipLocalTime(clip, timelineTime);
  const effects = normalizeClipEffects(clip.effects);
  const transform = normalizeTransform(clip.transform);
  const keyframes = normalizeClipKeyframes(clip.keyframes, Math.max(0, clip.duration));
  if (!keyframes) {
    return { effects, transform };
  }

  for (const [rawKey, track] of Object.entries(keyframes)) {
    if (!isClipKeyframeParam(rawKey)) continue;
    if (isEffectKeyframeParam(rawKey)) {
      effects[rawKey] = sampleKeyframes(track, localTime, effects[rawKey] ?? DEFAULT_CLIP_EFFECTS[rawKey]);
    } else if (isTransformKeyframeParam(rawKey)) {
      transform[rawKey] = sampleKeyframes(track, localTime, transform[rawKey] ?? DEFAULT_TRANSFORM[rawKey]);
    }
  }

  return {
    effects: normalizeClipEffects(effects),
    transform: normalizeTransform(transform),
  };
}
