import { Show, For, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { ChevronLeft, ChevronRight, Diamond, Upload } from 'lucide-solid';
import { DEFAULT_SKIN_MASK } from '../protocol';
import type {
	ClipEffectParamsSnapshot,
	ClipKeyframeParamSnapshot,
	ClipKeyframesSnapshot,
	ClipLutSnapshot,
	FitModeSnapshot,
	KeyframeEasingSnapshot,
	MediaMetadata,
	SkinMaskSnapshot,
	TitleAlignSnapshot,
	TitleContentSnapshot,
	TitleStyleSnapshot,
	TransformParamsSnapshot
} from '../protocol';
import { clipLocalTime, hasKeyframeTrack, keyframeAt, sortedKeyframes } from './keyframes';

export interface SelectedTitle {
	trackId: string;
	clipId: string;
	title: TitleContentSnapshot;
}

export interface SelectedClip {
	trackId: string;
	clipId: string;
	start: number;
	duration: number;
	effects: ClipEffectParamsSnapshot;
	transform: TransformParamsSnapshot;
	keyframes?: ClipKeyframesSnapshot;
	lut?: ClipLutSnapshot;
	skinMask?: SkinMaskSnapshot;
}

export interface SelectedClipTransform {
	trackId: string;
	clipId: string;
	transform: TransformParamsSnapshot;
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

/** Phase 13: selected transition metadata for the Inspector panel. */
export interface SelectedTransition {
	transitionId: string;
	trackId: string;
	fromClipId: string;
	toClipId: string;
	durationS: number;
	/** Maximum achievable duration in seconds based on source clip headroom. */
	maxDurationS?: number;
	kind: import('../protocol').TransitionKindSnapshot;
}

interface InspectorProps {
	metadata: MediaMetadata | null;
	selectedClip: SelectedClip | null;
	selectedTrackMix: SelectedTrackMix | null;
	selectedClipFades: SelectedClipFades | null;
	selectedClipTransform: SelectedClipTransform | null;
	selectedTitle: SelectedTitle | null;
	/** Phase 13: selected transition data. */
	selectedTransition: SelectedTransition | null;
	playheadTime: number;
	onSetTitle: (
		trackId: string,
		clipId: string,
		patch: { text?: string; style?: Partial<TitleStyleSnapshot> }
	) => void;
	onEffectParam: (
		trackId: string,
		clipId: string,
		key: keyof ClipEffectParamsSnapshot,
		value: number
	) => void;
	onTransform: (
		trackId: string,
		clipId: string,
		transform: Partial<TransformParamsSnapshot>
	) => void;
	onSeek: (time: number) => void;
	onSetKeyframe: (
		trackId: string,
		clipId: string,
		key: ClipKeyframeParamSnapshot,
		t: number,
		value: number,
		easing: KeyframeEasingSnapshot
	) => void;
	onDeleteKeyframe: (
		trackId: string,
		clipId: string,
		key: ClipKeyframeParamSnapshot,
		t: number
	) => void;
	onImportLut: (trackId: string, clipId: string, file: File) => void;
	onLutStrength: (trackId: string, clipId: string, strength: number) => void;
	onTrackGain: (trackId: string, gain: number) => void;
	onTrackMute: (trackId: string, muted: boolean) => void;
	onTrackSolo: (trackId: string, solo: boolean) => void;
	onTrackPan: (trackId: string, pan: number) => void;
	onClipFade: (trackId: string, clipId: string, edge: 'in' | 'out', durationS: number) => void;
	/** Phase 13: transition editing callbacks. */
	onTransitionKind?: (
		transitionId: string,
		kind: import('../protocol').TransitionKindSnapshot
	) => void;
	onTransitionDuration?: (transitionId: string, durationS: number) => void;
	onRemoveTransition?: (transitionId: string) => void;
	/** Phase 32a: skin-mask sidecar editing. */
	onSkinMask?: (trackId: string, clipId: string, mask: SkinMaskSnapshot) => void;
	/** Phase 32a: session-only A/B bypass toggle. */
	onSkinSmoothBypass?: (trackId: string, clipId: string, bypass: boolean) => void;
}

type TransformSliderKey = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

interface TransformSliderSpec {
	key: TransformSliderKey;
	label: string;
	min: number;
	max: number;
	step: number;
	format: (value: number) => string;
}

const TRANSFORM_SLIDERS: TransformSliderSpec[] = [
	{ key: 'x', label: 'Position X', min: -1, max: 1, step: 0.005, format: (v) => v.toFixed(3) },
	{ key: 'y', label: 'Position Y', min: -1, max: 1, step: 0.005, format: (v) => v.toFixed(3) },
	{ key: 'scale', label: 'Scale', min: 0.1, max: 3, step: 0.01, format: (v) => `${v.toFixed(2)}×` },
	{
		key: 'rotation',
		label: 'Rotation',
		min: -180,
		max: 180,
		step: 1,
		format: (v) => `${Math.round(v)}°`
	},
	{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) }
];

const FIT_OPTIONS: { value: FitModeSnapshot; label: string }[] = [
	{ value: 'fill', label: 'Fill' },
	{ value: 'fit', label: 'Fit' },
	{ value: 'letterbox', label: 'Letterbox' }
];

type TitleNumberKey =
	| 'fontSizePx'
	| 'backgroundOpacity'
	| 'outlineWidthPx'
	| 'shadowBlurPx'
	| 'shadowOffsetXPx'
	| 'shadowOffsetYPx';
type TitleColorKey = 'color' | 'backgroundColor' | 'outlineColor' | 'shadowColor';

interface TitleSliderSpec {
	key: TitleNumberKey;
	label: string;
	min: number;
	max: number;
	step: number;
	format: (value: number) => string;
}

const TITLE_SLIDERS: TitleSliderSpec[] = [
	{
		key: 'fontSizePx',
		label: 'Font size',
		min: 8,
		max: 256,
		step: 1,
		format: (v) => `${Math.round(v)} px`
	},
	{
		key: 'backgroundOpacity',
		label: 'Background',
		min: 0,
		max: 1,
		step: 0.01,
		format: (v) => v.toFixed(2)
	},
	{
		key: 'outlineWidthPx',
		label: 'Outline',
		min: 0,
		max: 32,
		step: 0.5,
		format: (v) => `${v.toFixed(1)} px`
	},
	{
		key: 'shadowBlurPx',
		label: 'Shadow blur',
		min: 0,
		max: 64,
		step: 1,
		format: (v) => `${Math.round(v)} px`
	},
	{
		key: 'shadowOffsetXPx',
		label: 'Shadow X',
		min: -64,
		max: 64,
		step: 1,
		format: (v) => `${Math.round(v)} px`
	},
	{
		key: 'shadowOffsetYPx',
		label: 'Shadow Y',
		min: -64,
		max: 64,
		step: 1,
		format: (v) => `${Math.round(v)} px`
	}
];

const TITLE_COLORS: { key: TitleColorKey; label: string }[] = [
	{ key: 'color', label: 'Text' },
	{ key: 'backgroundColor', label: 'Background' },
	{ key: 'outlineColor', label: 'Outline' },
	{ key: 'shadowColor', label: 'Shadow' }
];

const TITLE_ALIGN_OPTIONS: { value: TitleAlignSnapshot; label: string }[] = [
	{ value: 'left', label: 'Left' },
	{ value: 'center', label: 'Center' },
	{ value: 'right', label: 'Right' }
];

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
	{
		key: 'brightness',
		label: 'Brightness',
		min: -1,
		max: 1,
		step: 0.01,
		format: (v) => v.toFixed(2)
	},
	{ key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, format: (v) => v.toFixed(2) },
	{
		key: 'saturation',
		label: 'Saturation',
		min: 0,
		max: 2,
		step: 0.01,
		format: (v) => v.toFixed(2)
	},
	{
		key: 'temperature',
		label: 'Temperature',
		min: 2000,
		max: 10000,
		step: 50,
		format: (v) => `${Math.round(v)} K`
	},
	{
		key: 'temperatureStrength',
		label: 'Temp Strength',
		min: 0,
		max: 1,
		step: 0.01,
		format: (v) => v.toFixed(2)
	}
];

const SKIN_SMOOTH_STRENGTH_SLIDER: SliderSpec = {
	key: 'skinSmoothStrength',
	label: 'Strength',
	min: 0,
	max: 1,
	step: 0.01,
	format: (v) => v.toFixed(2)
};

const LUT_STRENGTH_SLIDER: SliderSpec = {
	key: 'lutStrength',
	label: 'Strength',
	min: 0,
	max: 1,
	step: 0.01,
	format: (v) => v.toFixed(2)
};

interface SkinMaskSliderSpec {
	key: keyof SkinMaskSnapshot;
	label: string;
	min: number;
	max: number;
	step: number;
	format: (v: number) => string;
}

const SKIN_MASK_SLIDERS: SkinMaskSliderSpec[] = [
	{ key: 'cbMin', label: 'Cb min', min: -0.5, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
	{ key: 'cbMax', label: 'Cb max', min: -0.5, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
	{ key: 'crMin', label: 'Cr min', min: -0.5, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
	{ key: 'crMax', label: 'Cr max', min: -0.5, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
	{
		key: 'softness',
		label: 'Softness',
		min: 0.005,
		max: 0.15,
		step: 0.005,
		format: (v) => v.toFixed(3)
	}
];

const SKIN_SMOOTH_NATURAL_MAX = 0.45;

type MixDraft = Pick<SelectedTrackMix, 'gain' | 'pan'>;
type FadeDraft = Pick<SelectedClipFades, 'audioFadeIn' | 'audioFadeOut'>;
type TransformDraft = TransformParamsSnapshot;

export function Inspector(props: InspectorProps) {
	const [draft, setDraft] = createSignal<ClipEffectParamsSnapshot | null>(null);
	const [mixDraft, setMixDraft] = createSignal<MixDraft | null>(null);
	const [fadeDraft, setFadeDraft] = createSignal<FadeDraft | null>(null);
	const [transformDraft, setTransformDraft] = createSignal<TransformDraft | null>(null);
	const [titleDraft, setTitleDraft] = createSignal<TitleContentSnapshot | null>(null);
	const titleTarget = { trackId: '', clipId: '' };
	let titleTimer: ReturnType<typeof setTimeout> | undefined;
	let titlePatch: { text?: string; style?: Partial<TitleStyleSnapshot> } = {};
	const transformPending = new Map<TransformSliderKey, number>();
	const transformDebouncers = new Map<TransformSliderKey, ReturnType<typeof setTimeout>>();
	const transformTarget = { trackId: '', clipId: '' };
	const pending = new Map<keyof ClipEffectParamsSnapshot, number>();
	const debouncers = new Map<keyof ClipEffectParamsSnapshot, ReturnType<typeof setTimeout>>();
	const keyframeTimes = new Map<ClipKeyframeParamSnapshot, number>();
	const mixPending = new Map<keyof MixDraft, number>();
	const mixDebouncers = new Map<keyof MixDraft, ReturnType<typeof setTimeout>>();
	const fadePending = new Map<keyof FadeDraft, number>();
	const fadeDebouncers = new Map<keyof FadeDraft, ReturnType<typeof setTimeout>>();
	const pendingTarget = { trackId: '', clipId: '' };
	const mixTarget = { trackId: '' };
	const fadeTarget = { trackId: '', clipId: '' };
	let lutInput: HTMLInputElement | undefined;

	const [skinSmoothBypass, setSkinSmoothBypass] = createSignal(false);
	const skinMaskPending = new Map<string, number>();
	const skinMaskDebouncers = new Map<string, ReturnType<typeof setTimeout>>();
	const skinMaskTarget = { trackId: '', clipId: '' };
	const skinSmoothStrength = createMemo(
		() => draft()?.skinSmoothStrength ?? props.selectedClip?.effects.skinSmoothStrength ?? 0
	);
	const skinSmoothKeyframed = createMemo(() =>
		Boolean(props.selectedClip?.keyframes?.skinSmoothStrength?.length)
	);
	const skinMaskControlsEnabled = createMemo(
		() => skinSmoothStrength() > 0 || skinSmoothKeyframed()
	);
	const skinSmoothIsStrong = createMemo(() => skinSmoothStrength() > SKIN_SMOOTH_NATURAL_MAX);
	const skinSmoothStatus = createMemo(() => {
		if (skinSmoothIsStrong()) return 'Strong smoothing';
		if (skinSmoothStrength() > 0) return 'Preview active';
		if (skinSmoothKeyframed()) return 'Keyframed';
		return 'Inactive at 0.00 strength';
	});
	const skinSmoothNote = createMemo(() => {
		if (!skinMaskControlsEnabled())
			return 'Raise Skin Smoothing above 0.00 before tuning the mask.';
		if (skinSmoothIsStrong()) {
			return 'High strength can make faces look synthetic; start under 0.45 and A/B the result.';
		}
		if (skinSmoothKeyframed() && skinSmoothStrength() === 0) {
			return 'Keyframed strength uses this mask wherever smoothing is active.';
		}
		return 'Natural range; mask edits update this clip.';
	});

	function currentSkinMask() {
		const clip = props.selectedClip;
		const mask = clip?.skinMask;
		return {
			cbMin: mask?.cbMin ?? DEFAULT_SKIN_MASK.cbMin,
			cbMax: mask?.cbMax ?? DEFAULT_SKIN_MASK.cbMax,
			crMin: mask?.crMin ?? DEFAULT_SKIN_MASK.crMin,
			crMax: mask?.crMax ?? DEFAULT_SKIN_MASK.crMax,
			softness: mask?.softness ?? DEFAULT_SKIN_MASK.softness
		};
	}

	function flushSkinMaskPending() {
		if (!skinMaskTarget.clipId || skinMaskPending.size === 0) return;
		for (const handle of skinMaskDebouncers.values()) clearTimeout(handle);
		skinMaskDebouncers.clear();
		const mask = currentSkinMask();
		for (const [k, v] of skinMaskPending) mask[k as keyof typeof mask] = v;
		skinMaskPending.clear();
		props.onSkinMask?.(skinMaskTarget.trackId, skinMaskTarget.clipId, {
			cbMin: mask.cbMin,
			cbMax: mask.cbMax,
			crMin: mask.crMin,
			crMax: mask.crMax,
			softness: mask.softness
		});
	}

	function scheduleSkinMaskParam(key: string, value: number) {
		const clip = props.selectedClip;
		if (!clip || !props.onSkinMask) return;
		if (!skinMaskControlsEnabled()) return;
		skinMaskTarget.trackId = clip.trackId;
		skinMaskTarget.clipId = clip.clipId;
		skinMaskPending.set(key, value);
		const existing = skinMaskDebouncers.get(key);
		if (existing) clearTimeout(existing);
		const base = currentSkinMask();
		skinMaskDebouncers.set(
			key,
			setTimeout(() => {
				skinMaskDebouncers.delete(key);
				for (const [k, v] of skinMaskPending) base[k as keyof typeof base] = v;
				skinMaskPending.clear();
				for (const [, timer] of skinMaskDebouncers) clearTimeout(timer);
				skinMaskDebouncers.clear();
				props.onSkinMask!(skinMaskTarget.trackId, skinMaskTarget.clipId, {
					cbMin: base.cbMin,
					cbMax: base.cbMax,
					crMin: base.crMin,
					crMax: base.crMax,
					softness: base.softness
				});
			}, PARAM_DEBOUNCE_MS)
		);
	}

	function currentLocalTime(): number | null {
		const clip = props.selectedClip;
		return clip ? clipLocalTime(clip, props.playheadTime) : null;
	}

	function shouldEditKeyframe(key: ClipKeyframeParamSnapshot): boolean {
		const clip = props.selectedClip;
		return Boolean(clip && currentLocalTime() !== null && hasKeyframeTrack(clip.keyframes, key));
	}

	function hasKeyframeAtPlayhead(key: ClipKeyframeParamSnapshot): boolean {
		const clip = props.selectedClip;
		return Boolean(clip && keyframeAt(clip.keyframes?.[key], currentLocalTime()));
	}

	function toggleKeyframe(key: ClipKeyframeParamSnapshot, value: number): void {
		const clip = props.selectedClip;
		if (!clip) return;
		if (currentLocalTime() === null) return;
		if (hasKeyframeAtPlayhead(key)) {
			props.onDeleteKeyframe(clip.trackId, clip.clipId, key, props.playheadTime);
		} else {
			props.onSetKeyframe(clip.trackId, clip.clipId, key, props.playheadTime, value, 'linear');
		}
	}

	function seekKeyframe(key: ClipKeyframeParamSnapshot, direction: -1 | 1): void {
		const clip = props.selectedClip;
		if (!clip) return;
		const localTime = currentLocalTime();
		if (localTime === null) return;
		const frames = sortedKeyframes(clip.keyframes?.[key]);
		const next =
			direction < 0
				? [...frames].reverse().find((frame) => frame.t < localTime - 1e-3)
				: frames.find((frame) => frame.t > localTime + 1e-3);
		if (next) props.onSeek(clip.start + next.t);
	}

	function handleLutFile(file: File | undefined): void {
		const clip = props.selectedClip;
		if (!clip || !file) return;
		props.onImportLut(clip.trackId, clip.clipId, file);
	}

	function flushPending() {
		if (!pendingTarget.clipId || pending.size === 0) return;
		for (const handle of debouncers.values()) clearTimeout(handle);
		debouncers.clear();
		for (const [key, value] of pending) {
			const keyframeTime = keyframeTimes.get(key);
			if (keyframeTime !== undefined) {
				props.onSetKeyframe(
					pendingTarget.trackId,
					pendingTarget.clipId,
					key,
					keyframeTime,
					value,
					'linear'
				);
				keyframeTimes.delete(key);
			} else if (key === 'lutStrength') {
				props.onLutStrength(pendingTarget.trackId, pendingTarget.clipId, value);
			} else {
				props.onEffectParam(pendingTarget.trackId, pendingTarget.clipId, key, value);
			}
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
				value
			);
		}
		fadePending.clear();
	}

	function flushTransformPending() {
		if (!transformTarget.clipId || transformPending.size === 0) return;
		for (const handle of transformDebouncers.values()) clearTimeout(handle);
		transformDebouncers.clear();
		const patch: Partial<TransformParamsSnapshot> = {};
		for (const [key, value] of transformPending) {
			const keyframeTime = keyframeTimes.get(key);
			if (keyframeTime !== undefined) {
				props.onSetKeyframe(
					transformTarget.trackId,
					transformTarget.clipId,
					key,
					keyframeTime,
					value,
					'linear'
				);
				keyframeTimes.delete(key);
			} else {
				patch[key] = value;
			}
		}
		if (Object.keys(patch).length > 0) {
			props.onTransform(transformTarget.trackId, transformTarget.clipId, patch);
		}
		transformPending.clear();
	}

	function scheduleTransformParam(key: TransformSliderKey, value: number) {
		const transform = props.selectedClipTransform;
		if (!transform) return;
		transformTarget.trackId = transform.trackId;
		transformTarget.clipId = transform.clipId;
		setTransformDraft((prev) => {
			const base = prev ?? transform.transform;
			return { ...base, [key]: value };
		});
		transformPending.set(key, value);
		if (shouldEditKeyframe(key)) keyframeTimes.set(key, props.playheadTime);
		const existing = transformDebouncers.get(key);
		if (existing) clearTimeout(existing);
		transformDebouncers.set(
			key,
			setTimeout(() => {
				transformDebouncers.delete(key);
				const latest = transformPending.get(key);
				transformPending.delete(key);
				if (latest !== undefined) {
					const keyframeTime = keyframeTimes.get(key);
					if (keyframeTime !== undefined) {
						keyframeTimes.delete(key);
						props.onSetKeyframe(
							transform.trackId,
							transform.clipId,
							key,
							keyframeTime,
							latest,
							'linear'
						);
					} else {
						props.onTransform(transform.trackId, transform.clipId, { [key]: latest });
					}
				}
			}, PARAM_DEBOUNCE_MS)
		);
	}

	function setFitMode(fit: FitModeSnapshot) {
		const transform = props.selectedClipTransform;
		if (!transform) return;
		setTransformDraft((prev) => {
			const base = prev ?? transform.transform;
			return { ...base, fit };
		});
		props.onTransform(transform.trackId, transform.clipId, { fit });
	}

	function flushTitle() {
		if (titleTimer) {
			clearTimeout(titleTimer);
			titleTimer = undefined;
		}
		if (!titleTarget.clipId) return;
		if (titlePatch.text === undefined && !titlePatch.style) return;
		props.onSetTitle(titleTarget.trackId, titleTarget.clipId, titlePatch);
		titlePatch = {};
	}

	function scheduleTitle(patch: { text?: string; style?: Partial<TitleStyleSnapshot> }) {
		const title = props.selectedTitle;
		if (!title) return;
		titleTarget.trackId = title.trackId;
		titleTarget.clipId = title.clipId;
		setTitleDraft((prev) =>
			prev
				? {
						text: patch.text ?? prev.text,
						style: patch.style ? { ...prev.style, ...patch.style } : prev.style
					}
				: prev
		);
		if (patch.text !== undefined) titlePatch.text = patch.text;
		if (patch.style) titlePatch.style = { ...titlePatch.style, ...patch.style };
		if (titleTimer) clearTimeout(titleTimer);
		titleTimer = setTimeout(flushTitle, PARAM_DEBOUNCE_MS);
	}

	function syncDraftFromClip(clip: SelectedClip) {
		setDraft((prev) => {
			const base = { ...clip.effects };
			if (!prev) return base;
			const next = { ...base };
			for (const key of new Set([...pending.keys(), ...debouncers.keys()])) {
				next[key] = prev[key];
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
			}, PARAM_DEBOUNCE_MS)
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
			[key]: value
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
						latest
					);
				}
			}, PARAM_DEBOUNCE_MS)
		);
	}

	createEffect(() => {
		const clip = props.selectedClip;
		if (!clip) {
			flushPending();
			flushMixPending();
			flushFadePending();
			flushSkinMaskPending();
			pendingTarget.trackId = '';
			pendingTarget.clipId = '';
			mixTarget.trackId = '';
			fadeTarget.trackId = '';
			fadeTarget.clipId = '';
			skinMaskTarget.trackId = '';
			skinMaskTarget.clipId = '';
			setDraft(null);
			setMixDraft(null);
			setFadeDraft(null);
			setSkinSmoothBypass(false);
			return;
		}
		if (pendingTarget.clipId && pendingTarget.clipId !== clip.clipId) {
			flushPending();
		}
		if (skinMaskTarget.clipId && skinMaskTarget.clipId !== clip.clipId) {
			flushSkinMaskPending();
			setSkinSmoothBypass(false);
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
				pan: mixPending.has('pan') || mixDebouncers.has('pan') ? prev.pan : mix.pan
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
						: fades.audioFadeOut
			};
		});
	});

	createEffect(() => {
		const transform = props.selectedClipTransform;
		if (!transform) {
			flushTransformPending();
			transformTarget.trackId = '';
			transformTarget.clipId = '';
			setTransformDraft(null);
			return;
		}
		if (transformTarget.clipId && transformTarget.clipId !== transform.clipId) {
			flushTransformPending();
		}
		transformTarget.trackId = transform.trackId;
		transformTarget.clipId = transform.clipId;
		setTransformDraft((prev) => {
			const base = { ...transform.transform };
			if (!prev) return base;
			const next = { ...base };
			for (const spec of TRANSFORM_SLIDERS) {
				if (transformPending.has(spec.key) || transformDebouncers.has(spec.key)) {
					next[spec.key] = prev[spec.key];
				}
			}
			return next;
		});
	});

	createEffect(() => {
		const title = props.selectedTitle;
		if (!title) {
			flushTitle();
			titleTarget.trackId = '';
			titleTarget.clipId = '';
			setTitleDraft(null);
			return;
		}
		if (titleTarget.clipId && titleTarget.clipId !== title.clipId) {
			flushTitle();
		}
		titleTarget.trackId = title.trackId;
		titleTarget.clipId = title.clipId;
		// Mirror the authoritative content unless a local edit is still pending for
		// this clip (debounce in flight), so the worker echo doesn't clobber typing.
		setTitleDraft((prev) =>
			prev && titleTimer !== undefined && titleTarget.clipId === title.clipId
				? prev
				: { text: title.title.text, style: { ...title.title.style } }
		);
	});

	onCleanup(() => {
		flushPending();
		flushMixPending();
		flushFadePending();
		flushTransformPending();
		flushSkinMaskPending();
		flushTitle();
	});

	function scheduleParam(key: keyof ClipEffectParamsSnapshot, value: number) {
		const clip = props.selectedClip;
		if (!clip) return;
		pendingTarget.trackId = clip.trackId;
		pendingTarget.clipId = clip.clipId;
		setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
		pending.set(key, value);
		if (shouldEditKeyframe(key)) keyframeTimes.set(key, props.playheadTime);
		const existing = debouncers.get(key);
		if (existing) clearTimeout(existing);
		debouncers.set(
			key,
			setTimeout(() => {
				debouncers.delete(key);
				const latest = pending.get(key);
				pending.delete(key);
				if (latest !== undefined) {
					const keyframeTime = keyframeTimes.get(key);
					if (keyframeTime !== undefined) {
						keyframeTimes.delete(key);
						props.onSetKeyframe(clip.trackId, clip.clipId, key, keyframeTime, latest, 'linear');
					} else if (key === 'lutStrength') {
						props.onLutStrength(clip.trackId, clip.clipId, latest);
					} else {
						props.onEffectParam(clip.trackId, clip.clipId, key, latest);
					}
				}
			}, PARAM_DEBOUNCE_MS)
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
						<Show when={titleDraft()}>
							{(title) => (
								<div class="title-controls">
									<h3 class="panel-subtitle">Title</h3>
									<label class="title-text-label">
										<span class="effect-slider-label">Text</span>
										<textarea
											class="title-text-input"
											rows={2}
											value={title().text}
											onInput={(e) =>
												scheduleTitle({ text: (e.currentTarget as HTMLTextAreaElement).value })
											}
										/>
									</label>
									<For each={TITLE_SLIDERS}>
										{(spec) => (
											<label class="effect-slider">
												<span class="effect-slider-label">
													{spec.label}
													<span class="effect-slider-value tabular-nums">
														{spec.format(title().style[spec.key])}
													</span>
												</span>
												<input
													type="range"
													min={spec.min}
													max={spec.max}
													step={spec.step}
													value={title().style[spec.key]}
													onInput={(e) =>
														scheduleTitle({
															style: {
																[spec.key]: Number((e.currentTarget as HTMLInputElement).value)
															} as Partial<TitleStyleSnapshot>
														})
													}
												/>
											</label>
										)}
									</For>
									<div class="title-colors">
										<For each={TITLE_COLORS}>
											{(spec) => (
												<label class="title-color">
													<span class="effect-slider-label">{spec.label}</span>
													<input
														type="color"
														value={title().style[spec.key]}
														onInput={(e) =>
															scheduleTitle({
																style: {
																	[spec.key]: (e.currentTarget as HTMLInputElement).value
																} as Partial<TitleStyleSnapshot>
															})
														}
													/>
												</label>
											)}
										</For>
									</div>
									<label class="effect-slider transform-fit">
										<span class="effect-slider-label">Align</span>
										<select
											value={title().style.align}
											onChange={(e) =>
												scheduleTitle({
													style: {
														align: (e.currentTarget as HTMLSelectElement)
															.value as TitleAlignSnapshot
													}
												})
											}
										>
											<For each={TITLE_ALIGN_OPTIONS}>
												{(option) => <option value={option.value}>{option.label}</option>}
											</For>
										</select>
									</label>
								</div>
							)}
						</Show>
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
												scheduleMixParam(
													'gain',
													Number((e.currentTarget as HTMLInputElement).value)
												)
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
																(e.currentTarget as HTMLInputElement).checked
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
																(e.currentTarget as HTMLInputElement).checked
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
											<span class="effect-slider-value tabular-nums">
												{fades().audioFadeIn.toFixed(2)}s
											</span>
										</span>
										<input
											type="range"
											min={0}
											max={props.selectedClipFades?.duration ?? 0}
											step={0.01}
											value={fades().audioFadeIn}
											onInput={(e) =>
												scheduleFadeParam(
													'audioFadeIn',
													Number((e.currentTarget as HTMLInputElement).value)
												)
											}
										/>
									</label>
									<label class="effect-slider">
										<span class="effect-slider-label">
											Fade out
											<span class="effect-slider-value tabular-nums">
												{fades().audioFadeOut.toFixed(2)}s
											</span>
										</span>
										<input
											type="range"
											min={0}
											max={props.selectedClipFades?.duration ?? 0}
											step={0.01}
											value={fades().audioFadeOut}
											onInput={(e) =>
												scheduleFadeParam(
													'audioFadeOut',
													Number((e.currentTarget as HTMLInputElement).value)
												)
											}
										/>
									</label>
								</div>
							)}
						</Show>
						<Show when={transformDraft()}>
							{(transform) => (
								<div class="effect-sliders transform-controls">
									<h3 class="panel-subtitle">Transform</h3>
									<For each={TRANSFORM_SLIDERS}>
										{(spec) => (
											<div class="effect-slider">
												<div class="effect-slider-label">
													<span>{spec.label}</span>
													<span class="effect-slider-value tabular-nums">
														{spec.format(transform()[spec.key])}
													</span>
												</div>
												<div class="keyframe-slider-row">
													<button
														type="button"
														class="keyframe-nav"
														aria-label={`Previous ${spec.label} keyframe`}
														onClick={() => seekKeyframe(spec.key, -1)}
														disabled={!props.selectedClip?.keyframes?.[spec.key]?.length}
													>
														<ChevronLeft size={14} />
													</button>
													<button
														type="button"
														class={`keyframe-toggle${hasKeyframeAtPlayhead(spec.key) ? ' is-active' : ''}`}
														aria-label={`Toggle ${spec.label} keyframe`}
														aria-pressed={hasKeyframeAtPlayhead(spec.key)}
														onClick={() => toggleKeyframe(spec.key, transform()[spec.key])}
														disabled={currentLocalTime() === null}
													>
														<Diamond size={13} />
													</button>
													<input
														type="range"
														min={spec.min}
														max={spec.max}
														step={spec.step}
														value={transform()[spec.key]}
														onInput={(e) =>
															scheduleTransformParam(
																spec.key,
																Number((e.currentTarget as HTMLInputElement).value)
															)
														}
													/>
													<button
														type="button"
														class="keyframe-nav"
														aria-label={`Next ${spec.label} keyframe`}
														onClick={() => seekKeyframe(spec.key, 1)}
														disabled={!props.selectedClip?.keyframes?.[spec.key]?.length}
													>
														<ChevronRight size={14} />
													</button>
												</div>
											</div>
										)}
									</For>
									<label class="effect-slider transform-fit">
										<span class="effect-slider-label">Fit</span>
										<select
											value={transform().fit}
											onChange={(e) =>
												setFitMode((e.currentTarget as HTMLSelectElement).value as FitModeSnapshot)
											}
										>
											<For each={FIT_OPTIONS}>
												{(option) => <option value={option.value}>{option.label}</option>}
											</For>
										</select>
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
											<div class="effect-slider">
												<div class="effect-slider-label">
													<span>{spec.label}</span>
													<span class="effect-slider-value tabular-nums">
														{spec.format(effects()[spec.key])}
													</span>
												</div>
												<div class="keyframe-slider-row">
													<button
														type="button"
														class="keyframe-nav"
														aria-label={`Previous ${spec.label} keyframe`}
														onClick={() => seekKeyframe(spec.key, -1)}
														disabled={!props.selectedClip?.keyframes?.[spec.key]?.length}
													>
														<ChevronLeft size={14} />
													</button>
													<button
														type="button"
														class={`keyframe-toggle${hasKeyframeAtPlayhead(spec.key) ? ' is-active' : ''}`}
														aria-label={`Toggle ${spec.label} keyframe`}
														aria-pressed={hasKeyframeAtPlayhead(spec.key)}
														onClick={() => toggleKeyframe(spec.key, effects()[spec.key])}
														disabled={currentLocalTime() === null}
													>
														<Diamond size={13} />
													</button>
													<input
														type="range"
														min={spec.min}
														max={spec.max}
														step={spec.step}
														value={effects()[spec.key]}
														onInput={(e) =>
															scheduleParam(
																spec.key,
																Number((e.currentTarget as HTMLInputElement).value)
															)
														}
													/>
													<button
														type="button"
														class="keyframe-nav"
														aria-label={`Next ${spec.label} keyframe`}
														onClick={() => seekKeyframe(spec.key, 1)}
														disabled={!props.selectedClip?.keyframes?.[spec.key]?.length}
													>
														<ChevronRight size={14} />
													</button>
												</div>
											</div>
										)}
									</For>
									<div
										class={`skin-smooth-panel${skinMaskControlsEnabled() ? ' is-active' : ' is-inactive'}${skinSmoothIsStrong() ? ' is-strong' : ''}`}
										aria-disabled={skinMaskControlsEnabled() ? undefined : 'true'}
									>
										<div class="skin-smooth-status">
											<span class="skin-smooth-status-copy">
												<span class="skin-smooth-title">Skin Smoothing</span>
												<span class="skin-smooth-status-text">{skinSmoothStatus()}</span>
											</span>
											<span
												class={`skin-smooth-status-pill${skinMaskControlsEnabled() ? ' is-active' : ' is-inactive'}${skinSmoothIsStrong() ? ' is-warning' : ''}`}
											>
												{skinSmoothIsStrong()
													? 'Strong'
													: skinSmoothStrength() > 0
														? 'On'
														: skinSmoothKeyframed()
															? 'Animated'
															: 'Off'}
											</span>
										</div>
										<div class="effect-slider skin-smooth-strength">
											<div class="effect-slider-label">
												<span>{SKIN_SMOOTH_STRENGTH_SLIDER.label}</span>
												<span class="effect-slider-value tabular-nums">
													{SKIN_SMOOTH_STRENGTH_SLIDER.format(effects().skinSmoothStrength)}
												</span>
											</div>
											<div class="keyframe-slider-row">
												<button
													type="button"
													class="keyframe-nav"
													aria-label="Previous Skin Smoothing keyframe"
													onClick={() => seekKeyframe(SKIN_SMOOTH_STRENGTH_SLIDER.key, -1)}
													disabled={!props.selectedClip?.keyframes?.skinSmoothStrength?.length}
												>
													<ChevronLeft size={14} />
												</button>
												<button
													type="button"
													class={`keyframe-toggle${hasKeyframeAtPlayhead(SKIN_SMOOTH_STRENGTH_SLIDER.key) ? ' is-active' : ''}`}
													aria-label="Toggle Skin Smoothing keyframe"
													aria-pressed={hasKeyframeAtPlayhead(SKIN_SMOOTH_STRENGTH_SLIDER.key)}
													onClick={() =>
														toggleKeyframe(
															SKIN_SMOOTH_STRENGTH_SLIDER.key,
															effects().skinSmoothStrength
														)
													}
													disabled={currentLocalTime() === null}
												>
													<Diamond size={13} />
												</button>
												<input
													type="range"
													min={SKIN_SMOOTH_STRENGTH_SLIDER.min}
													max={SKIN_SMOOTH_STRENGTH_SLIDER.max}
													step={SKIN_SMOOTH_STRENGTH_SLIDER.step}
													value={effects().skinSmoothStrength}
													onInput={(e) =>
														scheduleParam(
															SKIN_SMOOTH_STRENGTH_SLIDER.key,
															Number((e.currentTarget as HTMLInputElement).value)
														)
													}
												/>
												<button
													type="button"
													class="keyframe-nav"
													aria-label="Next Skin Smoothing keyframe"
													onClick={() => seekKeyframe(SKIN_SMOOTH_STRENGTH_SLIDER.key, 1)}
													disabled={!props.selectedClip?.keyframes?.skinSmoothStrength?.length}
												>
													<ChevronRight size={14} />
												</button>
											</div>
										</div>
										<p class={`skin-smooth-note${skinSmoothIsStrong() ? ' is-warning' : ''}`}>
											{skinSmoothNote()}
										</p>
										<Show when={skinMaskControlsEnabled()}>
											<div class="skin-smooth-bypass">
												<button
													type="button"
													class={`bypass-toggle${skinSmoothBypass() ? ' is-active' : ''}`}
													aria-pressed={skinSmoothBypass()}
													aria-label="Bypass skin smoothing (A/B)"
													onClick={() => {
														const clip = props.selectedClip;
														if (clip && props.onSkinSmoothBypass) {
															const next = !skinSmoothBypass();
															setSkinSmoothBypass(next);
															props.onSkinSmoothBypass(clip.trackId, clip.clipId, next);
														}
													}}
												>
													A/B Bypass
												</button>
												<span>Preview only; export uses stored strength.</span>
											</div>
										</Show>
										<details
											class={`skin-mask-disclosure${skinMaskControlsEnabled() ? '' : ' is-disabled'}`}
										>
											<summary>
												<span>Skin mask</span>
												<span class="skin-mask-summary">Advanced</span>
											</summary>
											<div class="skin-mask-sliders">
												<For each={SKIN_MASK_SLIDERS}>
													{(spec) => (
														<div class="effect-slider">
															<div class="effect-slider-label">
																<span>{spec.label}</span>
																<span class="effect-slider-value tabular-nums">
																	{spec.format(currentSkinMask()[spec.key])}
																</span>
															</div>
															<input
																type="range"
																aria-label={spec.label}
																min={spec.min}
																max={spec.max}
																step={spec.step}
																value={currentSkinMask()[spec.key]}
																disabled={!skinMaskControlsEnabled()}
																onInput={(e) =>
																	scheduleSkinMaskParam(
																		spec.key,
																		Number((e.currentTarget as HTMLInputElement).value)
																	)
																}
															/>
														</div>
													)}
												</For>
												<button
													type="button"
													class="skin-mask-reset"
													disabled={!skinMaskControlsEnabled()}
													onClick={() => {
														const clip = props.selectedClip;
														if (clip && props.onSkinMask && skinMaskControlsEnabled()) {
															props.onSkinMask(clip.trackId, clip.clipId, {
																...DEFAULT_SKIN_MASK
															});
														}
													}}
												>
													Reset mask
												</button>
											</div>
										</details>
									</div>
									<div class="lut-controls">
										<div class="lut-header">
											<span class="effect-slider-label">
												LUT{' '}
												<span class="text-xs text-muted-foreground font-normal">
													(Experimental)
												</span>
											</span>
											<button
												type="button"
												class="lut-import-button"
												aria-label="Import LUT"
												onClick={() => lutInput?.click()}
											>
												<Upload size={14} />
											</button>
											<input
												ref={(el) => {
													lutInput = el;
												}}
												class="sr-only"
												type="file"
												accept=".cube,application/octet-stream,text/plain"
												onChange={(event) => {
													const input = event.currentTarget as HTMLInputElement;
													handleLutFile(input.files?.[0]);
													input.value = '';
												}}
											/>
										</div>
										<Show
											when={props.selectedClip?.lut}
											fallback={<p class="lut-empty">No LUT loaded</p>}
										>
											{(lut) => (
												<p class="lut-name">
													{lut().title || lut().fileName}
													<span>{lut().size}³</span>
												</p>
											)}
										</Show>
										<div class="effect-slider">
											<div class="effect-slider-label">
												<span>{LUT_STRENGTH_SLIDER.label}</span>
												<span class="effect-slider-value tabular-nums">
													{LUT_STRENGTH_SLIDER.format(effects().lutStrength)}
												</span>
											</div>
											<div class="keyframe-slider-row">
												<button
													type="button"
													class="keyframe-nav"
													aria-label="Previous LUT strength keyframe"
													onClick={() => seekKeyframe(LUT_STRENGTH_SLIDER.key, -1)}
													disabled={!props.selectedClip?.keyframes?.lutStrength?.length}
												>
													<ChevronLeft size={14} />
												</button>
												<button
													type="button"
													class={`keyframe-toggle${hasKeyframeAtPlayhead(LUT_STRENGTH_SLIDER.key) ? ' is-active' : ''}`}
													aria-label="Toggle LUT strength keyframe"
													aria-pressed={hasKeyframeAtPlayhead(LUT_STRENGTH_SLIDER.key)}
													onClick={() =>
														toggleKeyframe(LUT_STRENGTH_SLIDER.key, effects().lutStrength)
													}
													disabled={currentLocalTime() === null}
												>
													<Diamond size={13} />
												</button>
												<input
													type="range"
													min={LUT_STRENGTH_SLIDER.min}
													max={LUT_STRENGTH_SLIDER.max}
													step={LUT_STRENGTH_SLIDER.step}
													value={effects().lutStrength}
													disabled={!props.selectedClip?.lut}
													onInput={(e) =>
														scheduleParam(
															LUT_STRENGTH_SLIDER.key,
															Number((e.currentTarget as HTMLInputElement).value)
														)
													}
												/>
												<button
													type="button"
													class="keyframe-nav"
													aria-label="Next LUT strength keyframe"
													onClick={() => seekKeyframe(LUT_STRENGTH_SLIDER.key, 1)}
													disabled={!props.selectedClip?.keyframes?.lutStrength?.length}
												>
													<ChevronRight size={14} />
												</button>
											</div>
										</div>
									</div>
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
			{/* Phase 13: transition editor */}
			<Show when={props.selectedTransition} keyed>
				{(transition) => (
					<>
						<h3 class="panel-subtitle">Transition</h3>
						<div class="inspector-section">
							<label class="inspector-label">
								<span>Kind</span>
								<select
									class="inspector-select"
									value={transition.kind}
									onChange={(e) =>
										props.onTransitionKind?.(
											transition.transitionId,
											e.currentTarget.value as import('../protocol').TransitionKindSnapshot
										)
									}
								>
									<option value="cross-dissolve">Cross Dissolve</option>
									<option value="dip-to-black">Dip to Black</option>
									<option value="wipe">Wipe</option>
									<option value="slide">Slide</option>
								</select>
							</label>
							<label class="inspector-label">
								<span>Duration</span>
								<div class="inspector-slider-row">
									<input
										type="range"
										min={0.1}
										max={Math.max(0.1, transition.maxDurationS ?? 5)}
										step={0.1}
										value={transition.durationS}
										onInput={(e) =>
											props.onTransitionDuration?.(
												transition.transitionId,
												Number((e.currentTarget as HTMLInputElement).value)
											)
										}
									/>
									<span class="tabular-nums inspector-value">
										{transition.durationS.toFixed(2)}s
									</span>
								</div>
							</label>
							<button
								type="button"
								class="inspector-button is-danger"
								onClick={() => props.onRemoveTransition?.(transition.transitionId)}
							>
								Remove Transition
							</button>
						</div>
					</>
				)}
			</Show>
		</aside>
	);
}
