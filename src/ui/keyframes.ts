import { KEYFRAME_EPSILON, TIMELINE_EPSILON } from '../protocol';
import type {
	ClipEffectParamsSnapshot,
	ClipKeyframeParamSnapshot,
	ClipKeyframesSnapshot,
	KeyframeSnapshot,
	TimelineClipSnapshot,
	TransformParamsSnapshot
} from '../protocol';
import { clamp, clamp01 } from '../lib/math';

function sameTime(a: number, b: number): boolean {
	return Math.abs(a - b) <= KEYFRAME_EPSILON;
}

function amountFor(easing: KeyframeSnapshot['easing'], amount: number): number {
	const t = clamp01(amount);
	if (easing === 'hold') return 0;
	if (easing === 'ease') return t * t * (3 - 2 * t);
	return t;
}

export function clipLocalTime(
	clip: Pick<TimelineClipSnapshot, 'start' | 'duration'>,
	timelineTime: number
): number | null {
	if (!Number.isFinite(timelineTime)) return null;
	const local = timelineTime - clip.start;
	if (local < -TIMELINE_EPSILON || local > clip.duration + TIMELINE_EPSILON) return null;
	return clamp(local, 0, clip.duration);
}

export function sortedKeyframes(
	track: readonly KeyframeSnapshot[] | undefined
): KeyframeSnapshot[] {
	return [...(track ?? [])].sort((a, b) => a.t - b.t);
}

export function keyframeAt(
	track: readonly KeyframeSnapshot[] | undefined,
	localTime: number | null
): KeyframeSnapshot | null {
	if (localTime === null) return null;
	return sortedKeyframes(track).find((frame) => sameTime(frame.t, localTime)) ?? null;
}

export function sampleKeyframes(
	track: readonly KeyframeSnapshot[] | undefined,
	localTime: number | null,
	fallback: number
): number {
	if (localTime === null) return fallback;
	const frames = sortedKeyframes(track);
	if (frames.length === 0) return fallback;
	if (localTime <= frames[0]!.t) return frames[0]!.value;
	const last = frames[frames.length - 1]!;
	if (localTime >= last.t) return last.value;
	for (let index = 0; index < frames.length - 1; index += 1) {
		const left = frames[index]!;
		const right = frames[index + 1]!;
		if (localTime < left.t || localTime > right.t) continue;
		if (sameTime(localTime, right.t)) return right.value;
		const span = Math.max(KEYFRAME_EPSILON, right.t - left.t);
		const amount = amountFor(left.easing, (localTime - left.t) / span);
		return left.value + (right.value - left.value) * amount;
	}
	return fallback;
}

export function sampleEffectsAt(
	effects: ClipEffectParamsSnapshot,
	keyframes: ClipKeyframesSnapshot | undefined,
	localTime: number | null
): ClipEffectParamsSnapshot {
	return {
		brightness: sampleKeyframes(keyframes?.brightness, localTime, effects.brightness),
		contrast: sampleKeyframes(keyframes?.contrast, localTime, effects.contrast),
		saturation: sampleKeyframes(keyframes?.saturation, localTime, effects.saturation),
		temperature: sampleKeyframes(keyframes?.temperature, localTime, effects.temperature),
		temperatureStrength: sampleKeyframes(
			keyframes?.temperatureStrength,
			localTime,
			effects.temperatureStrength
		),
		lutStrength: sampleKeyframes(keyframes?.lutStrength, localTime, effects.lutStrength),
		skinSmoothStrength: sampleKeyframes(
			keyframes?.skinSmoothStrength,
			localTime,
			effects.skinSmoothStrength
		)
	};
}

export function sampleTransformAt(
	transform: TransformParamsSnapshot,
	keyframes: ClipKeyframesSnapshot | undefined,
	localTime: number | null
): TransformParamsSnapshot {
	return {
		x: sampleKeyframes(keyframes?.x, localTime, transform.x),
		y: sampleKeyframes(keyframes?.y, localTime, transform.y),
		scale: sampleKeyframes(keyframes?.scale, localTime, transform.scale),
		rotation: sampleKeyframes(keyframes?.rotation, localTime, transform.rotation),
		opacity: sampleKeyframes(keyframes?.opacity, localTime, transform.opacity),
		anchorX: sampleKeyframes(keyframes?.anchorX, localTime, transform.anchorX),
		anchorY: sampleKeyframes(keyframes?.anchorY, localTime, transform.anchorY),
		fit: transform.fit
	};
}

export function hasKeyframeTrack(
	keyframes: ClipKeyframesSnapshot | undefined,
	key: ClipKeyframeParamSnapshot
): boolean {
	return Boolean(keyframes?.[key]?.length);
}
