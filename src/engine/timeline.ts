import { clamp, clamp01, isFiniteNumber as finite } from '../lib/math';
import { DEFAULT_CLIP_EFFECTS, normalizeClipEffects, type ClipEffectParams } from './effects';
import {
	DEFAULT_TRANSFORM,
	normalizeTransform,
	transformsEqual,
	type FitMode,
	type TransformParams
} from './transform';
import {
	cloneTitleContent,
	normalizeTitleContent,
	titleContentsEqual,
	type TitleContent,
	type TitleContentInput,
	type TitleStyle
} from './title';
import {
	cloneClipKeyframes,
	deleteKeyframe,
	insertKeyframe,
	isClipKeyframeParam,
	isEffectKeyframeParam,
	isTransformKeyframeParam,
	normalizeClipKeyframes,
	sampleKeyframes,
	type ClipKeyframeParam,
	type ClipKeyframes,
	type KeyframeEasing
} from './keyframes';
import { cloneClipLut, type ClipLut } from './lut';
import { TIMELINE_EPSILON, type CleanedAudioRefSnapshot } from '../protocol';

/** Denoised-audio routing for a clip (Phase 28 local audio cleanup). */
export type CleanedAudioRef = CleanedAudioRefSnapshot;

/** Source clips decode media; title clips are source-less text overlays (Phase 14). */
export type ClipKind = 'video' | 'title';

/** Authoritative timeline model — Phase 3+. */
export interface TimelineClip {
	id: string;
	/** `undefined`/`'video'` for source clips; `'title'` for source-less titles (Phase 14). */
	kind?: ClipKind;
	/** Empty string for title clips (they decode no media). */
	sourceId: string;
	start: number;
	duration: number;
	inPoint: number;
	effects: ClipEffectParams;
	/** Per-clip position/scale/rotation/opacity/fit — Phase 12 compositing. */
	transform: TransformParams;
	keyframes?: ClipKeyframes;
	lut?: ClipLut;
	/** Phase 32a: optional skin-mask sidecar (per-clip chroma mask params). */
	skinMask?: import('./skin-smooth').SkinMaskParams;
	audioFadeIn: number;
	audioFadeOut: number;
	/** Text + style for `kind: 'title'` clips; absent otherwise (Phase 14). */
	title?: TitleContent;
	/** Shared group id linking A/V clips from the same source (Phase 20). */
	linkedGroupId?: string;
	/** Denoised derived-asset routing; absent = original audio (Phase 27). */
	cleanedAudio?: CleanedAudioRef;
}

/** A title clip carries source-less text; it composites as a cached texture. */
export function isTitleClip(clip: TimelineClip): boolean {
	return clip.kind === 'title';
}

export interface TimelineTrack {
	id: string;
	type: 'video' | 'audio';
	clips: TimelineClip[];
	gain: number;
	pan: number;
	muted: boolean;
	solo: boolean;
	locked: boolean;
	visible: boolean;
	syncLocked: boolean;
	editTarget: boolean;
}

export interface TimelineMarker {
	id: string;
	time: number;
	label: string;
}

export type TransitionKind = 'cross-dissolve' | 'dip-to-black' | 'wipe' | 'slide';

export interface TransitionParams {
	direction?: 'left' | 'right' | 'up' | 'down';
}

export interface TimelineTransition {
	id: string;
	trackId: string;
	fromClipId: string;
	toClipId: string;
	durationS: number;
	kind: TransitionKind;
	params: TransitionParams;
}

export interface ClipReference {
	trackId: string;
	clipId: string;
}

export interface MoveClipTarget extends ClipReference {
	toTrackId: string;
	toStart: number;
}

export interface ClipboardTimelineClip {
	trackId: string;
	clip: TimelineClip;
}

export const DEFAULT_TRACK_MIX = {
	gain: 1,
	pan: 0,
	muted: false,
	solo: false,
	locked: false,
	visible: true,
	syncLocked: false,
	editTarget: true
} as const;

export const DEFAULT_CLIP_AUDIO_FADES = {
	audioFadeIn: 0,
	audioFadeOut: 0
} as const;

export const DEFAULT_MASTER_GAIN = 1;

export type Timeline = TimelineTrack[];

export interface TransitionSourceDurations {
	durationForSource: (sourceId: string) => number | undefined;
}

/** Phase 13: per-layer metadata describing its role in a transition blend. */
export interface TransitionResolveMeta {
	/** 0→1 progression through the transition (0 = outgoing fully visible, 1 = incoming fully visible). */
	mixT: number;
	kind: TransitionKind;
	params: TransitionParams;
	/** Which side of the cut this layer represents. */
	role: 'outgoing' | 'incoming';
	transitionId: string;
	durationS: number;
}

export interface ResolveResult {
	clip: TimelineClip;
	sourceTime: number;
	trackId: string;
	/** Set when this layer participates in an active transition window (Phase 13). */
	transition?: TransitionResolveMeta;
}

function cloneTimeline(timeline: Timeline): Timeline {
	return timeline.map((track) => ({
		...track,
		gain: track.gain,
		pan: track.pan,
		muted: track.muted,
		solo: track.solo,
		locked: track.locked,
		visible: track.visible,
		syncLocked: track.syncLocked,
		editTarget: track.editTarget,
		clips: track.clips.map(cloneClip)
	}));
}

function findTrack(timeline: Timeline, trackId: string): TimelineTrack | null {
	return timeline.find((track) => track.id === trackId) ?? null;
}

function isInClip(time: number, clip: TimelineClip): boolean {
	return (
		finite(clip.start) &&
		finite(clip.duration) &&
		clip.duration > 0 &&
		time >= clip.start &&
		time < clip.start + clip.duration
	);
}

/** Lays clips out gaplessly from 0, preserving order, duration, and source in-points. */
function relayoutSequential(clips: TimelineClip[]): TimelineClip[] {
	let cursor = 0;
	return clips.map((clip) => {
		const laid = { ...clip, start: cursor };
		cursor += finite(clip.duration) && clip.duration > 0 ? clip.duration : 0;
		return laid;
	});
}

export function createEmptyTimeline(): Timeline {
	return [];
}

export function getTimelineDuration(timeline: Timeline): number {
	let end = 0;
	for (const track of timeline) {
		for (const clip of track.clips) {
			const clipEnd = clip.start + clip.duration;
			if (finite(clipEnd) && clipEnd > end) {
				end = clipEnd;
			}
		}
	}
	return Math.max(0, end);
}

function resolveOnTrackType(
	timeline: Timeline,
	time: number,
	type: TimelineTrack['type']
): ResolveResult | null {
	if (!finite(time) || time < 0) return null;
	for (const track of timeline) {
		if (track.type !== type) continue;
		for (const clip of track.clips) {
			if (!isInClip(time, clip)) continue;
			return {
				clip,
				trackId: track.id,
				sourceTime: clip.inPoint + (time - clip.start)
			};
		}
	}
	return null;
}

/** Finds the owning clip and its source offset for a timeline timestamp. */
export function resolveAt(timeline: Timeline, time: number): ResolveResult | null {
	return resolveOnTrackType(timeline, time, 'video');
}

/**
 * Every video clip overlapping `time`, ordered bottom-to-top by track array
 * position (the last track is topmost / drawn last). Phase 12 compositing
 * consumes this so preview and export render the full layer stack rather than
 * just the first hit.
 *
 * When `transitions` is provided, cut-point transitions may emit **two** layers
 * for a single track (outgoing + incoming) with per-layer {@link ResolveResult.transition}
 * metadata. The compositor detects the pair and substitutes the transition
 * shader for the regular over-blend on that pair.
 */
export function resolveAllAt(
	timeline: Timeline,
	time: number,
	transitions?: readonly TimelineTransition[]
): ResolveResult[] {
	const layers: ResolveResult[] = [];
	if (!finite(time) || time < 0) return layers;
	for (const track of timeline) {
		if (track.type !== 'video') continue;
		if (!track.visible) continue;
		for (const clip of track.clips) {
			if (!isInClip(time, clip)) continue;
			layers.push({
				clip,
				trackId: track.id,
				sourceTime: clip.inPoint + (time - clip.start)
			});
			break; // one clip per track at any timestamp (unless transition)
		}
	}

	// Phase 13: inject transition layers when time falls inside a transition window.
	if (transitions && transitions.length > 0) {
		for (const transition of transitions) {
			const track = timeline.find((t) => t.id === transition.trackId);
			if (!track || track.type !== 'video') continue;

			const sorted = track.clips.toSorted((a, b) => a.start - b.start);
			const fromIdx = sorted.findIndex((c) => c.id === transition.fromClipId);
			if (fromIdx < 0 || fromIdx + 1 >= sorted.length) continue;
			const toIdx = fromIdx + 1;
			const fromClip = sorted[fromIdx]!;
			const toClip = sorted[toIdx]!;
			if (toClip.id !== transition.toClipId) continue;

			const cutPoint = clipEnd(fromClip);
			const half = transition.durationS / 2;
			const windowStart = cutPoint - half;
			const windowEnd = cutPoint + half;
			if (time < windowStart || time >= windowEnd) continue;

			const mixT = clamp01((time - windowStart) / transition.durationS);

			// Find and mark the existing layer (if any) for this track.
			const layerIdx = layers.findIndex((l) => l.trackId === transition.trackId);
			const outgoingSourceTime = fromClip.inPoint + (time - fromClip.start);
			const incomingSourceTime = toClip.inPoint + (time - toClip.start);

			const outgoingLayer: ResolveResult = {
				clip: fromClip,
				trackId: transition.trackId,
				sourceTime: outgoingSourceTime,
				transition: {
					mixT,
					kind: transition.kind,
					params: transition.params,
					role: 'outgoing',
					transitionId: transition.id,
					durationS: transition.durationS
				}
			};
			const incomingLayer: ResolveResult = {
				clip: toClip,
				trackId: transition.trackId,
				sourceTime: incomingSourceTime,
				transition: {
					mixT,
					kind: transition.kind,
					params: transition.params,
					role: 'incoming',
					transitionId: transition.id,
					durationS: transition.durationS
				}
			};

			if (layerIdx >= 0) {
				// Replace the existing layer with two transition layers.
				layers.splice(layerIdx, 1, outgoingLayer, incomingLayer);
			} else {
				// This track had no visible clip at this time, but the transition
				// window still covers it. Insert both layers at the correct z-order
				// so the transition does not render on top of later tracks.
				const transitionTrackIdx = timeline.findIndex((t) => t.id === transition.trackId);
				const insertIdx = layers.findIndex(
					(l) => timeline.findIndex((t) => t.id === l.trackId) > transitionTrackIdx
				);
				const insertionIndex = insertIdx === -1 ? layers.length : insertIdx;
				layers.splice(insertionIndex, 0, outgoingLayer, incomingLayer);
			}
		}
	}

	return layers;
}

/**
 * Incoming-role transition layers whose outgoing partner reads the *same*
 * source (Phase 13 T2.2). These must decode through a secondary sink: the two
 * sides of the cut sit far apart in the file, so sharing one sequential sink
 * would force a keyframe re-seek on every frame of the window.
 */
export function sharedSourceIncomingLayers(
	layers: readonly ResolveResult[]
): ReadonlySet<ResolveResult> {
	const shared = new Set<ResolveResult>();
	const outgoingSourceByTransition = new Map<string, string>();
	for (const layer of layers) {
		if (layer.transition?.role === 'outgoing') {
			outgoingSourceByTransition.set(layer.transition.transitionId, layer.clip.sourceId);
		}
	}
	for (const layer of layers) {
		if (layer.transition?.role !== 'incoming') continue;
		if (outgoingSourceByTransition.get(layer.transition.transitionId) === layer.clip.sourceId) {
			shared.add(layer);
		}
	}
	return shared;
}

/** Finds the owning audio clip at a timeline timestamp. */
export function resolveAudioAt(timeline: Timeline, time: number): ResolveResult | null {
	return resolveOnTrackType(timeline, time, 'audio');
}

function transitionsEqual(a: TimelineTransition, b: TimelineTransition): boolean {
	return (
		a.id === b.id &&
		a.trackId === b.trackId &&
		a.fromClipId === b.fromClipId &&
		a.toClipId === b.toClipId &&
		a.durationS === b.durationS &&
		a.kind === b.kind &&
		a.params.direction === b.params.direction
	);
}

function cloneTransition(transition: TimelineTransition): TimelineTransition {
	return {
		...transition,
		params: { ...transition.params }
	};
}

function isTransitionKind(value: unknown): value is TransitionKind {
	return (
		value === 'cross-dissolve' || value === 'dip-to-black' || value === 'wipe' || value === 'slide'
	);
}

export function normalizeTransitionKind(kind: unknown): TransitionKind {
	return isTransitionKind(kind) ? kind : 'cross-dissolve';
}

export function normalizeTransitionParams(
	params: Partial<TransitionParams> | undefined
): TransitionParams {
	const direction = params?.direction;
	return direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down'
		? { direction }
		: {};
}

function transitionBoundary(
	timeline: Timeline,
	trackId: string,
	fromClipId: string,
	toClipId: string
): { fromClip: TimelineClip; toClip: TimelineClip } | null {
	const track = timeline.find((item) => item.id === trackId);
	if (!track || track.type !== 'video') return null;
	const sorted = sortByStart(track.clips);
	const fromIndex = sorted.findIndex((clip) => clip.id === fromClipId);
	if (fromIndex < 0) return null;
	const fromClip = sorted[fromIndex]!;
	const toClip = sorted[fromIndex + 1];
	if (!toClip || toClip.id !== toClipId) return null;
	if (Math.abs(clipEnd(fromClip) - toClip.start) > TIMELINE_EPSILON) return null;
	return { fromClip, toClip };
}

function sourceTailHandle(clip: TimelineClip, sourceDurations: TransitionSourceDurations): number {
	const sourceDuration = sourceDurations.durationForSource(clip.sourceId);
	if (sourceDuration === undefined || !finite(sourceDuration)) return 0;
	return Math.max(0, sourceDuration - (clip.inPoint + clip.duration));
}

function sourceHeadHandle(clip: TimelineClip): number {
	return Math.max(0, clip.inPoint);
}

export function maxTransitionDurationS(
	timeline: Timeline,
	sourceDurations: TransitionSourceDurations,
	trackId: string,
	fromClipId: string,
	toClipId: string
): number {
	const boundary = transitionBoundary(timeline, trackId, fromClipId, toClipId);
	if (!boundary) return 0;
	const handle = Math.min(
		boundary.fromClip.duration,
		boundary.toClip.duration,
		sourceTailHandle(boundary.fromClip, sourceDurations),
		sourceHeadHandle(boundary.toClip)
	);
	return Math.max(0, handle * 2);
}

export function clampTransitionDurationS(
	timeline: Timeline,
	sourceDurations: TransitionSourceDurations,
	trackId: string,
	fromClipId: string,
	toClipId: string,
	durationS: number
): number {
	if (!finite(durationS) || durationS <= 0) return 0;
	const maxDuration = maxTransitionDurationS(
		timeline,
		sourceDurations,
		trackId,
		fromClipId,
		toClipId
	);
	return Math.min(durationS, maxDuration);
}

export function addTransition(
	timeline: Timeline,
	transitions: readonly TimelineTransition[],
	sourceDurations: TransitionSourceDurations,
	transition: Omit<TimelineTransition, 'durationS' | 'kind' | 'params'> & {
		durationS: number;
		kind?: TransitionKind;
		params?: Partial<TransitionParams>;
	}
): TimelineTransition[] {
	const durationS = clampTransitionDurationS(
		timeline,
		sourceDurations,
		transition.trackId,
		transition.fromClipId,
		transition.toClipId,
		transition.durationS
	);
	if (durationS <= 0) return transitions as TimelineTransition[];
	const nextTransition: TimelineTransition = {
		id: transition.id,
		trackId: transition.trackId,
		fromClipId: transition.fromClipId,
		toClipId: transition.toClipId,
		durationS,
		kind: normalizeTransitionKind(transition.kind),
		params: normalizeTransitionParams(transition.params)
	};
	const withoutBoundary = transitions.filter(
		(item) =>
			item.trackId !== nextTransition.trackId ||
			item.fromClipId !== nextTransition.fromClipId ||
			item.toClipId !== nextTransition.toClipId
	);
	return [...withoutBoundary.map(cloneTransition), nextTransition];
}

export function removeTransition(
	transitions: readonly TimelineTransition[],
	transitionId: string
): TimelineTransition[] {
	const next = transitions
		.filter((transition) => transition.id !== transitionId)
		.map(cloneTransition);
	return next.length === transitions.length ? (transitions as TimelineTransition[]) : next;
}

export function setTransition(
	timeline: Timeline,
	transitions: readonly TimelineTransition[],
	sourceDurations: TransitionSourceDurations,
	transitionId: string,
	patch: Partial<Pick<TimelineTransition, 'durationS' | 'kind' | 'params'>>
): TimelineTransition[] {
	let changed = false;
	const next = transitions.map((transition) => {
		if (transition.id !== transitionId) return cloneTransition(transition);
		const durationS =
			patch.durationS === undefined
				? transition.durationS
				: clampTransitionDurationS(
						timeline,
						sourceDurations,
						transition.trackId,
						transition.fromClipId,
						transition.toClipId,
						patch.durationS
					);
		if (durationS <= 0) {
			changed = true;
			return null;
		}
		const updated: TimelineTransition = {
			...transition,
			durationS,
			kind: patch.kind ? normalizeTransitionKind(patch.kind) : transition.kind,
			params: patch.params ? normalizeTransitionParams(patch.params) : { ...transition.params }
		};
		changed ||= !transitionsEqual(transition, updated);
		return updated;
	});
	const filtered = next.filter(
		(transition): transition is TimelineTransition => transition !== null
	);
	return changed ? filtered : (transitions as TimelineTransition[]);
}

export function revalidateTransitions(
	timeline: Timeline,
	transitions: readonly TimelineTransition[],
	sourceDurations: TransitionSourceDurations
): TimelineTransition[] {
	let changed = false;
	const next: TimelineTransition[] = [];
	for (const transition of transitions) {
		const durationS = clampTransitionDurationS(
			timeline,
			sourceDurations,
			transition.trackId,
			transition.fromClipId,
			transition.toClipId,
			transition.durationS
		);
		if (durationS <= 0) {
			changed = true;
			continue;
		}
		const normalized: TimelineTransition = {
			...cloneTransition(transition),
			durationS,
			kind: normalizeTransitionKind(transition.kind),
			params: normalizeTransitionParams(transition.params)
		};
		changed ||= !transitionsEqual(transition, normalized);
		next.push(normalized);
	}
	return changed ? next : (transitions as TimelineTransition[]);
}

function newId(prefix: string): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function trackWithClip(timeline: Timeline, trackId: string, clipId: string) {
	const trackIndex = timeline.findIndex((track) => track.id === trackId);
	if (trackIndex < 0) return null;
	const clipIndex = timeline[trackIndex]!.clips.findIndex((clip) => clip.id === clipId);
	if (clipIndex < 0) return null;
	return { trackIndex, clipIndex };
}

function clipEnd(clip: TimelineClip): number {
	return clip.start + clip.duration;
}

function cloneClip(clip: TimelineClip): TimelineClip {
	const cloned: TimelineClip = {
		...clip,
		effects: { ...clip.effects },
		transform: { ...clip.transform },
		audioFadeIn: clip.audioFadeIn,
		audioFadeOut: clip.audioFadeOut,
		title: clip.title ? cloneTitleContent(clip.title) : undefined,
		linkedGroupId: clip.linkedGroupId,
		cleanedAudio: clip.cleanedAudio ? { ...clip.cleanedAudio } : undefined,
		skinMask: clip.skinMask ? { ...clip.skinMask } : undefined
	};
	const keyframes = cloneClipKeyframes(clip.keyframes);
	if (keyframes) cloned.keyframes = keyframes;
	const lut = cloneClipLut(clip.lut);
	if (lut) cloned.lut = lut;
	return cloned;
}

function cloneWithNewId(clip: TimelineClip): TimelineClip {
	return {
		...cloneClip(clip),
		id: newId(clip.id),
		linkedGroupId: undefined
	};
}

function sortByStart(clips: readonly TimelineClip[]): TimelineClip[] {
	return clips.toSorted((a, b) => {
		const startDiff = a.start - b.start;
		if (startDiff !== 0) return startDiff;
		return a.id.localeCompare(b.id);
	});
}

function trackHasOverlaps(clips: readonly TimelineClip[]): boolean {
	const sorted = sortByStart(clips);
	let lastEnd = 0;
	for (const clip of sorted) {
		if (!finite(clip.start) || !finite(clip.duration) || clip.start < 0 || clip.duration <= 0) {
			return true;
		}
		if (clip.start < lastEnd) return true;
		lastEnd = clipEnd(clip);
	}
	return false;
}

function normalizeMoveStart(toStart: number): number | null {
	if (!finite(toStart)) return null;
	return Math.max(0, toStart);
}

/** Splits one clip at an absolute timeline time, preserving source continuity. */
function clipKeyframeFallback(clip: TimelineClip, key: ClipKeyframeParam): number {
	if (isEffectKeyframeParam(key)) return clip.effects[key];
	if (isTransformKeyframeParam(key)) return clip.transform[key];
	return 0;
}

function splitClipKeyframes(
	clip: TimelineClip,
	splitOffset: number
): { left?: ClipKeyframes; right?: ClipKeyframes } {
	const keyframes = normalizeClipKeyframes(clip.keyframes, clip.duration);
	if (!keyframes) return {};
	const left: ClipKeyframes = {};
	const right: ClipKeyframes = {};
	const rightDuration = clip.duration - splitOffset;

	for (const [rawKey, track] of Object.entries(keyframes)) {
		const key = rawKey as ClipKeyframeParam;
		const splitValue = sampleKeyframes(track, splitOffset, clipKeyframeFallback(clip, key));
		const leftTrack = insertKeyframe(
			track.filter((frame) => frame.t <= splitOffset),
			{ t: splitOffset, value: splitValue, easing: 'linear' }
		);
		const rightTrack = insertKeyframe(
			track
				.filter((frame) => frame.t >= splitOffset)
				.map((frame) => ({ ...frame, t: frame.t - splitOffset })),
			{ t: 0, value: splitValue, easing: 'linear' }
		);
		const normalizedLeft = normalizeClipKeyframes({ [key]: leftTrack }, splitOffset);
		const normalizedRight = normalizeClipKeyframes({ [key]: rightTrack }, rightDuration);
		const normalizedLeftTrack = normalizedLeft?.[key];
		const normalizedRightTrack = normalizedRight?.[key];
		if (normalizedLeftTrack?.length) left[key] = normalizedLeftTrack;
		if (normalizedRightTrack?.length) right[key] = normalizedRightTrack;
	}

	return {
		left: Object.keys(left).length > 0 ? left : undefined,
		right: Object.keys(right).length > 0 ? right : undefined
	};
}

function rebaseTrimmedKeyframes(
	clip: TimelineClip,
	trimOffset: number,
	nextDuration: number
): ClipKeyframes | undefined {
	const keyframes = normalizeClipKeyframes(clip.keyframes, clip.duration);
	if (!keyframes) return undefined;
	const rebased: ClipKeyframes = {};

	for (const [rawKey, track] of Object.entries(keyframes)) {
		const key = rawKey as ClipKeyframeParam;
		const boundaryValue = sampleKeyframes(track, trimOffset, clipKeyframeFallback(clip, key));
		const shiftedTrack = track
			.map((frame) => ({ ...frame, t: frame.t - trimOffset }))
			.filter((frame) => frame.t >= 0 && frame.t <= nextDuration);
		const nextTrack = insertKeyframe(shiftedTrack, {
			t: 0,
			value: boundaryValue,
			easing: 'linear'
		});
		const normalized = normalizeClipKeyframes({ [key]: nextTrack }, nextDuration);
		const normalizedTrack = normalized?.[key];
		if (normalizedTrack?.length) rebased[key] = normalizedTrack;
	}

	return Object.keys(rebased).length > 0 ? rebased : undefined;
}

export function splitClipAt(timeline: Timeline, trackId: string, time: number): Timeline {
	if (!finite(time)) return timeline;

	// Resolve the clip on the requested track directly: with multi-track
	// compositing (Phase 12) a lower track can overlap the same timestamp, so a
	// single-layer resolveAt would split the wrong (bottom) clip.
	const trackIndex = timeline.findIndex((track) => track.id === trackId);
	const track = timeline[trackIndex];
	if (!track) return timeline;
	const clipIndex = track.clips.findIndex((clip) => isInClip(time, clip));
	if (clipIndex < 0) return timeline;

	const clip = track.clips[clipIndex]!;
	const splitOffset = time - clip.start;
	if (splitOffset <= 0 || splitOffset >= clip.duration) return timeline;
	const splitKeyframes = splitClipKeyframes(clip, splitOffset);

	const left: TimelineClip = {
		...clip,
		duration: splitOffset,
		keyframes: splitKeyframes.left,
		linkedGroupId: undefined
	};
	const right: TimelineClip = {
		...clip,
		id: newId(clip.id),
		start: clip.start + splitOffset,
		duration: clip.duration - splitOffset,
		inPoint: clip.inPoint + splitOffset,
		keyframes: splitKeyframes.right,
		linkedGroupId: undefined
	};

	const next = cloneTimeline(timeline);
	const nextTrack = next[trackIndex]!;
	nextTrack.clips = [
		...nextTrack.clips.slice(0, clipIndex),
		left,
		right,
		...nextTrack.clips.slice(clipIndex + 1)
	];
	return next;
}

/** Deletes a clip while keeping all neighboring clip positions intact. */
export function removeClip(timeline: Timeline, trackId: string, clipId: string): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const next = cloneTimeline(timeline);
	const track = next[loc.trackIndex]!;
	track.clips = track.clips.filter((clip) => clip.id !== clipId);
	return next;
}

export function moveClips(timeline: Timeline, moves: readonly MoveClipTarget[]): Timeline {
	if (moves.length === 0) return timeline;

	const next = cloneTimeline(timeline);
	const movingKeys = new Set<string>();
	const movingByKey = new Map<string, TimelineClip>();

	for (const move of moves) {
		const source = trackWithClip(timeline, move.trackId, move.clipId);
		if (!source) return timeline;
		const sourceTrack = timeline[source.trackIndex]!;
		const targetTrack = timeline.find((track) => track.id === move.toTrackId);
		if (!targetTrack || sourceTrack.type !== targetTrack.type) return timeline;
		const toStart = normalizeMoveStart(move.toStart);
		if (toStart === null) return timeline;
		const key = `${move.trackId}:${move.clipId}`;
		if (movingKeys.has(key)) return timeline;
		movingKeys.add(key);
		movingByKey.set(key, {
			...cloneClip(sourceTrack.clips[source.clipIndex]!),
			start: toStart
		});
	}

	for (const track of next) {
		track.clips = track.clips.filter((clip) => !movingKeys.has(`${track.id}:${clip.id}`));
	}

	for (const move of moves) {
		const moving = movingByKey.get(`${move.trackId}:${move.clipId}`);
		if (!moving) return timeline;
		const destination = next.find((track) => track.id === move.toTrackId);
		if (!destination) return timeline;
		destination.clips = sortByStart([...destination.clips, moving]);
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}

	return next;
}

/** Moves a clip to an absolute timeline start while preserving all gaps. */
export function moveClipTo(
	timeline: Timeline,
	fromTrackId: string,
	clipId: string,
	toTrackId: string,
	toStart: number
): Timeline {
	const loc = trackWithClip(timeline, fromTrackId, clipId);
	const normalizedStart = normalizeMoveStart(toStart);
	if (!loc || normalizedStart === null) return timeline;
	const current = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (fromTrackId === toTrackId && current.start === normalizedStart) return timeline;
	return moveClips(timeline, [
		{ trackId: fromTrackId, clipId, toTrackId, toStart: normalizedStart }
	]);
}

export function closeGaps(timeline: Timeline, trackId?: string): Timeline {
	let changed = false;
	const next = cloneTimeline(timeline);
	for (const track of next) {
		if (trackId && track.id !== trackId) continue;
		const laidOut = relayoutSequential(sortByStart(track.clips));
		changed ||= laidOut.some(
			(clip, index) =>
				clip.start !== track.clips[index]?.start || clip.id !== track.clips[index]?.id
		);
		track.clips = laidOut;
	}
	return changed ? next : timeline;
}

export function duplicateClips(
	timeline: Timeline,
	refs: readonly ClipReference[],
	atTime?: number
): Timeline {
	if (refs.length === 0) return timeline;
	const clips: ClipboardTimelineClip[] = [];
	let earliestStart = Number.POSITIVE_INFINITY;
	let latestEnd = 0;

	for (const ref of refs) {
		const loc = trackWithClip(timeline, ref.trackId, ref.clipId);
		if (!loc) return timeline;
		const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
		earliestStart = Math.min(earliestStart, clip.start);
		latestEnd = Math.max(latestEnd, clipEnd(clip));
		// Use cloneClip (not cloneWithNewId): pasteClips assigns the single fresh
		// id below, so cloning with a new id here too would compound the id on every
		// duplicate (clip-<orig>-<uuid1>-<uuid2>...).
		clips.push({ trackId: ref.trackId, clip: cloneClip(clip) });
	}

	const pasteAt = atTime !== undefined ? normalizeMoveStart(atTime) : latestEnd;
	if (pasteAt === null || !finite(earliestStart)) return timeline;
	return pasteClips(timeline, clips, pasteAt, earliestStart);
}

export function pasteClips(
	timeline: Timeline,
	clips: readonly ClipboardTimelineClip[],
	atTime: number,
	sourceBaseStart?: number
): Timeline {
	if (clips.length === 0) return timeline;
	const pasteAt = normalizeMoveStart(atTime);
	if (pasteAt === null) return timeline;

	const baseStart =
		sourceBaseStart ??
		clips.reduce((earliest, item) => Math.min(earliest, item.clip.start), Number.POSITIVE_INFINITY);
	if (!finite(baseStart)) return timeline;

	const next = cloneTimeline(timeline);
	for (const item of clips) {
		const destination = next.find((track) => track.id === item.trackId);
		if (!destination) return timeline;
		const clip = {
			...cloneWithNewId(item.clip),
			start: pasteAt + (item.clip.start - baseStart)
		};
		if (clip.start < 0) return timeline;
		destination.clips = sortByStart([...destination.clips, clip]);
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}

	return next;
}

export interface TrimClipOptions {
	edge: 'in' | 'out';
	time: number;
	/**
	 * Source media duration in seconds. Optional but required to extend a clip's
	 * out-edge past its current end, and to know how far in-edge extension is
	 * safe. When omitted, the trim is restricted to the clip's current bounds —
	 * i.e. inward only.
	 */
	sourceDuration?: number;
}

/**
 * Trims a clip boundary to an absolute timeline time. Supports inward shrinking
 * (always) and outward extension up to the source media bounds (when
 * `sourceDuration` is known). Returns the original timeline reference on no-op
 * or out-of-bounds requests so the UI mirror doesn't churn.
 */
export function trimClip(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	options: TrimClipOptions
): Timeline {
	if (!finite(options.time)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (clip.duration <= 0) return timeline;

	const { edge, time, sourceDuration } = options;
	const clipEnd = clip.start + clip.duration;

	// No-op: trim to the edge that's already there.
	if ((edge === 'in' && time === clip.start) || (edge === 'out' && time === clipEnd)) {
		return timeline;
	}

	// Bound against same-track neighbors: outward extension must not overlap them
	// (resolveAt walks clips in order; an overlap would shadow the later clip).
	let prevEnd = 0;
	let nextStart = Number.POSITIVE_INFINITY;
	for (const other of timeline[loc.trackIndex]!.clips) {
		if (other.id === clip.id) continue;
		const otherEnd = other.start + other.duration;
		if (otherEnd <= clip.start && otherEnd > prevEnd) prevEnd = otherEnd;
		if (other.start >= clipEnd && other.start < nextStart) nextStart = other.start;
	}

	// Title clips are source-less and still-like: no decoded media bounds them, so
	// both edges move freely (neighbor-bounded only) and the in-point stays 0.
	const title = isTitleClip(clip);

	let nextStartOut: number;
	let nextDuration: number;
	let nextInPoint: number;

	if (edge === 'in') {
		// Must not collapse or cross the out-edge.
		if (time >= clipEnd) return timeline;
		// Timeline times can't go negative.
		if (time < 0) return timeline;
		// Must not overlap the previous neighbor.
		if (time < prevEnd) return timeline;
		const offset = time - clip.start;
		const candidateInPoint = clip.inPoint + offset;
		// The new source-side in-point can't be negative (titles have none).
		if (!title && candidateInPoint < 0) return timeline;
		nextStartOut = time;
		nextDuration = clip.duration - offset;
		nextInPoint = title ? 0 : candidateInPoint;
	} else {
		if (time <= clip.start) return timeline;
		// Must not overlap the next neighbor.
		if (time > nextStart) return timeline;
		if (title) {
			// Still-like: out-edge bounded only by the next neighbor (checked above).
		} else if (sourceDuration !== undefined && finite(sourceDuration)) {
			// Out-edge extension is bounded by available source content.
			const maxOutTime = clip.start + (sourceDuration - clip.inPoint);
			if (time > maxOutTime) return timeline;
		} else if (time > clipEnd) {
			// Without source-duration knowledge, refuse to extend past the current end.
			return timeline;
		}
		nextStartOut = clip.start;
		nextDuration = time - clip.start;
		nextInPoint = clip.inPoint;
	}

	if (nextDuration <= 0) return timeline;

	const next = cloneTimeline(timeline);
	const nextClip: TimelineClip = {
		...clip,
		start: nextStartOut,
		duration: nextDuration,
		inPoint: nextInPoint
	};
	const keyframes =
		edge === 'in'
			? rebaseTrimmedKeyframes(clip, nextStartOut - clip.start, nextDuration)
			: normalizeClipKeyframes(nextClip.keyframes, nextDuration);
	if (keyframes) {
		nextClip.keyframes = keyframes;
	} else {
		delete nextClip.keyframes;
	}
	next[loc.trackIndex]!.clips[loc.clipIndex] = nextClip;
	return next;
}

/** Updates one effect scalar on a clip; returns the original timeline on no-op. */
export function setClipEffectParam(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	key: keyof ClipEffectParams,
	value: number
): Timeline {
	if (!finite(value)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (clip.effects[key] === value) return timeline;

	const next = cloneTimeline(timeline);
	const nextClip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	nextClip.effects = { ...nextClip.effects, [key]: value };
	return next;
}

function localKeyframeTime(clip: TimelineClip, timelineTime: number): number | null {
	if (!finite(timelineTime)) return null;
	const local = timelineTime - clip.start;
	if (local < -TIMELINE_EPSILON || local > clip.duration + TIMELINE_EPSILON) return null;
	return clamp(local, 0, clip.duration);
}

function stripEmptyKeyframes(keyframes: ClipKeyframes): ClipKeyframes | undefined {
	const next: ClipKeyframes = {};
	for (const [rawKey, track] of Object.entries(keyframes)) {
		if (track.length > 0) {
			next[rawKey as ClipKeyframeParam] = track;
		}
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function setClipKeyframe(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	key: ClipKeyframeParam,
	timelineTime: number,
	value: number,
	easing: KeyframeEasing = 'linear'
): Timeline {
	return setClipKeyframes(timeline, trackId, clipId, timelineTime, [{ key, value, easing }]);
}

export interface ClipKeyframeUpdate {
	key: ClipKeyframeParam;
	value: number;
	easing?: KeyframeEasing;
}

export function setClipKeyframes(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	timelineTime: number,
	updates: readonly ClipKeyframeUpdate[]
): Timeline {
	if (updates.length === 0) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const localTime = localKeyframeTime(clip, timelineTime);
	if (localTime === null) return timeline;

	const normalized = normalizeClipKeyframes(clip.keyframes, clip.duration) ?? {};
	const nextKeyframes: ClipKeyframes = { ...normalized };
	const effectPatch: Partial<ClipEffectParams> = {};
	const transformPatch: Partial<TransformParams> = {};
	let changed = false;

	for (const update of updates) {
		const { key, value, easing = 'linear' } = update;
		if (!finite(value) || (!isEffectKeyframeParam(key) && !isTransformKeyframeParam(key))) continue;
		const nextTrack = insertKeyframe(nextKeyframes[key], { t: localTime, value, easing });
		const previous = nextKeyframes[key] ?? [];
		const sameTrack =
			previous.length === nextTrack.length &&
			previous.every((frame, index) => {
				const next = nextTrack[index];
				return (
					next && frame.t === next.t && frame.value === next.value && frame.easing === next.easing
				);
			});
		if (sameTrack) continue;
		nextKeyframes[key] = nextTrack;
		changed = true;
		if (isEffectKeyframeParam(key)) {
			effectPatch[key] = value;
		} else if (isTransformKeyframeParam(key)) {
			transformPatch[key] = value;
		}
	}

	if (!changed) return timeline;

	const next = cloneTimeline(timeline);
	const nextClip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	nextClip.keyframes = stripEmptyKeyframes(nextKeyframes);
	if (Object.keys(effectPatch).length > 0) {
		nextClip.effects = { ...nextClip.effects, ...effectPatch };
	}
	if (Object.keys(transformPatch).length > 0) {
		nextClip.transform = normalizeTransform({ ...nextClip.transform, ...transformPatch });
	}
	return next;
}

export function deleteClipKeyframe(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	key: ClipKeyframeParam,
	timelineTime: number
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const localTime = localKeyframeTime(clip, timelineTime);
	if (localTime === null) return timeline;
	const normalized = normalizeClipKeyframes(clip.keyframes, clip.duration);
	const currentTrack = normalized?.[key];
	if (!normalized || !currentTrack || currentTrack.length === 0) return timeline;
	const nextTrack = deleteKeyframe(currentTrack, localTime);
	if (nextTrack.length === currentTrack.length) return timeline;

	const next = cloneTimeline(timeline);
	next[loc.trackIndex]!.clips[loc.clipIndex]!.keyframes = stripEmptyKeyframes({
		...normalized,
		[key]: nextTrack
	});
	return next;
}

/**
 * Replace whole keyframe tracks on a clip in one mutation (Phase 33 R7.5).
 * `tracks` carries **clip-local** keyframe times. Params present in `tracks`
 * overwrite the clip's existing tracks for those params (an explicitly-listed
 * param normalising to empty is cleared); params not listed are untouched. The
 * base transform/effect value for each replaced param is set to its value at
 * the clip start so a non-keyframed sample stays consistent. Returns the
 * original timeline on a no-op so it produces a single, coalescing-free undo
 * entry only when something actually changed.
 */
export function replaceClipKeyframeTracks(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	tracks: ClipKeyframes,
	fit?: FitMode
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const incoming = normalizeClipKeyframes(tracks, clip.duration) ?? {};
	const merged: ClipKeyframes = {
		...(normalizeClipKeyframes(clip.keyframes, clip.duration) ?? {})
	};
	const effectPatch: Partial<ClipEffectParams> = {};
	const transformPatch: Partial<TransformParams> = {};
	let changed = false;

	for (const rawKey of Object.keys(tracks)) {
		if (!isClipKeyframeParam(rawKey)) continue;
		const key = rawKey;
		const track = incoming[key];
		if (track && track.length > 0) {
			merged[key] = track;
			const baseValue = track[0]!.value;
			if (isEffectKeyframeParam(key)) effectPatch[key] = baseValue;
			else if (isTransformKeyframeParam(key)) transformPatch[key] = baseValue;
		} else if (merged[key]) {
			delete merged[key];
		} else {
			continue;
		}
		changed = true;
	}

	// A fit-mode change alone is also a meaningful mutation: the generated x/y
	// translations only crop correctly under the requested fit mode (R6.2a).
	const fitChanges = fit !== undefined && clip.transform.fit !== fit;
	if (!changed && !fitChanges) return timeline;

	const next = cloneTimeline(timeline);
	const nextClip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	nextClip.keyframes = stripEmptyKeyframes(merged);
	if (Object.keys(effectPatch).length > 0) {
		nextClip.effects = { ...nextClip.effects, ...effectPatch };
	}
	if (Object.keys(transformPatch).length > 0 || fit !== undefined) {
		nextClip.transform = normalizeTransform({
			...nextClip.transform,
			...transformPatch,
			...(fit !== undefined ? { fit } : {})
		});
	}
	return next;
}

export function setClipLut(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	lut: ClipLut
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const next = cloneTimeline(timeline);
	const clip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	clip.lut = cloneClipLut(lut);
	clip.effects = {
		...clip.effects,
		lutStrength: clip.effects.lutStrength > 0 ? clip.effects.lutStrength : 1
	};
	return next;
}

export function setClipLutStrength(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	strength: number
): Timeline {
	const clamped = finite(strength) ? clamp01(strength) : Number.NaN;
	if (!finite(clamped)) return timeline;
	return setClipEffectParam(timeline, trackId, clipId, 'lutStrength', clamped);
}

export function setSkinMask(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	mask: import('./skin-smooth').SkinMaskParams
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const next = cloneTimeline(timeline);
	const clip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	clip.skinMask = { ...mask };
	return next;
}

export function defaultClipEffects(): ClipEffectParams {
	return { ...DEFAULT_CLIP_EFFECTS };
}

export function defaultClipTransform(): TransformParams {
	return { ...DEFAULT_TRANSFORM };
}

/** Replaces a clip's transform; returns the original timeline on no-op. */
export function setClipTransform(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	transform: Partial<TransformParams>
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const next = normalizeTransform({ ...clip.transform, ...transform });
	if (transformsEqual(clip.transform, next)) return timeline;

	const cloned = cloneTimeline(timeline);
	cloned[loc.trackIndex]!.clips[loc.clipIndex]!.transform = next;
	return cloned;
}

/** Builds a source-less title clip with default colour/transform/fades. */
export function defaultTitleClip(partial: {
	id: string;
	start: number;
	duration: number;
	title?: TitleContentInput;
	transform?: Partial<TransformParams>;
}): TimelineClip {
	return {
		id: partial.id,
		kind: 'title',
		sourceId: '',
		start: partial.start,
		duration: partial.duration,
		inPoint: 0,
		effects: defaultClipEffects(),
		transform: normalizeTransform(partial.transform),
		...DEFAULT_CLIP_AUDIO_FADES,
		title: normalizeTitleContent(partial.title)
	};
}

/**
 * Updates a title clip's text and/or style; returns the original timeline on
 * no-op (unchanged content) or when the target is missing or not a title clip.
 * The style patch merges over the current style so a text-only edit preserves
 * styling — and still produces a new content hash so the raster is refreshed.
 */
export function setTitleContent(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	patch: { text?: string; style?: Partial<TitleStyle> }
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (!isTitleClip(clip) || !clip.title) return timeline;

	const next = normalizeTitleContent({
		text: patch.text ?? clip.title.text,
		style: { ...clip.title.style, ...patch.style }
	});
	if (titleContentsEqual(clip.title, next)) return timeline;

	const cloned = cloneTimeline(timeline);
	cloned[loc.trackIndex]!.clips[loc.clipIndex]!.title = next;
	return cloned;
}

export function defaultTimelineClip(
	partial: Omit<
		TimelineClip,
		'effects' | 'transform' | 'keyframes' | 'lut' | 'audioFadeIn' | 'audioFadeOut'
	> &
		Partial<
			Pick<
				TimelineClip,
				'effects' | 'transform' | 'keyframes' | 'lut' | 'audioFadeIn' | 'audioFadeOut'
			>
		>
): TimelineClip {
	const clip: TimelineClip = {
		effects: defaultClipEffects(),
		transform: defaultClipTransform(),
		...DEFAULT_CLIP_AUDIO_FADES,
		...partial
	};
	const keyframes = normalizeClipKeyframes(partial.keyframes, Math.max(0, clip.duration));
	if (keyframes) clip.keyframes = keyframes;
	const lut = cloneClipLut(partial.lut);
	if (lut) clip.lut = lut;
	return clip;
}

function applyTrackMix(
	timeline: Timeline,
	trackId: string,
	patch: Partial<Pick<TimelineTrack, 'gain' | 'pan' | 'muted' | 'solo'>>
): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track) return timeline;
	const next = cloneTimeline(timeline);
	const idx = next.findIndex((t) => t.id === trackId);
	const current = next[idx]!;
	const updated = { ...current, ...patch };
	if (patch.solo === true) {
		for (const t of next) {
			if (t.id !== trackId) t.solo = false;
		}
	}
	next[idx] = updated;
	return next;
}

export function setTrackGain(timeline: Timeline, trackId: string, gain: number): Timeline {
	if (!finite(gain) || gain < 0) return timeline;
	const track = findTrack(timeline, trackId);
	if (!track || track.gain === gain) return timeline;
	return applyTrackMix(timeline, trackId, { gain });
}

export function setTrackMute(timeline: Timeline, trackId: string, muted: boolean): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.muted === muted) return timeline;
	return applyTrackMix(timeline, trackId, { muted });
}

export function setTrackSolo(timeline: Timeline, trackId: string, solo: boolean): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.solo === solo) return timeline;
	return applyTrackMix(timeline, trackId, { solo });
}

export function setTrackPan(timeline: Timeline, trackId: string, pan: number): Timeline {
	if (!finite(pan) || pan < -1 || pan > 1) return timeline;
	const track = findTrack(timeline, trackId);
	if (!track || track.pan === pan) return timeline;
	return applyTrackMix(timeline, trackId, { pan });
}

export function setClipAudioFade(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	edge: 'in' | 'out',
	durationS: number
): Timeline {
	if (!finite(durationS) || durationS < 0) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const key = edge === 'in' ? 'audioFadeIn' : 'audioFadeOut';
	if (clip[key] === durationS) return timeline;
	if (durationS > clip.duration) return timeline;

	const next = cloneTimeline(timeline);
	const nextClip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	nextClip[key] = durationS;
	return next;
}

/**
 * Sets or clears a clip's denoised-audio routing (Phase 27). Pass `null` to
 * remove cleanup and return to the original source audio. Returns the
 * original timeline on no-op so undo history stays clean.
 */
export function setClipCleanedAudio(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	ref: CleanedAudioRef | null
): Timeline {
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (isTitleClip(clip)) return timeline;
	const current = clip.cleanedAudio ?? null;
	const sameRef =
		current === ref ||
		(current !== null &&
			ref !== null &&
			current.assetId === ref.assetId &&
			current.clipInPointS === ref.clipInPointS &&
			current.durationS === ref.durationS &&
			current.modelId === ref.modelId &&
			current.modelVersion === ref.modelVersion);
	if (sameRef) return timeline;
	const next = cloneTimeline(timeline);
	const nextClip = next[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (ref) nextClip.cleanedAudio = { ...ref };
	else delete nextClip.cleanedAudio;
	return next;
}

/** Appends a new empty track of the given type with default mix/state settings. */
export function addTrack(timeline: Timeline, type: TimelineTrack['type']): Timeline {
	return [
		...timeline,
		{
			id: newId(`track-${type}`),
			type,
			clips: [] as TimelineClip[],
			...DEFAULT_TRACK_MIX
		}
	];
}

/** Removes a track (and any clips it holds); returns the original on no-op. */
export function removeTrack(timeline: Timeline, trackId: string): Timeline {
	const next = timeline.filter((track) => track.id !== trackId);
	return next.length === timeline.length ? timeline : next;
}

/** Moves a track to `toIndex`, clamped to bounds; returns the original on no-op. */
export function reorderTrack(timeline: Timeline, trackId: string, toIndex: number): Timeline {
	if (!Number.isInteger(toIndex)) return timeline;
	const from = timeline.findIndex((track) => track.id === trackId);
	if (from < 0) return timeline;
	const clamped = clamp(toIndex, 0, timeline.length - 1);
	if (clamped === from) return timeline;
	const next = [...timeline];
	const [moved] = next.splice(from, 1);
	next.splice(clamped, 0, moved!);
	return next;
}

/**
 * Inserts a pre-built clip onto a track, keeping clips sorted by start. Rejects
 * (returns the original timeline) when the clip would overlap an existing clip or
 * the track is missing / of a mismatched discriminant.
 */
export function insertClip(timeline: Timeline, trackId: string, clip: TimelineClip): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track) return timeline;
	if (!finite(clip.start) || !finite(clip.duration) || clip.start < 0 || clip.duration <= 0) {
		return timeline;
	}
	const next = cloneTimeline(timeline);
	const destination = next.find((t) => t.id === trackId)!;
	destination.clips = sortByStart([...destination.clips, cloneClip(clip)]);
	if (trackHasOverlaps(destination.clips)) return timeline;
	return next;
}

/**
 * Sets a clip's on-timeline duration directly (used by still sources, whose
 * duration is clip-driven rather than bounded by decoded media). Bounded below by
 * a positive floor and above by the next same-track neighbor so clips never overlap.
 */
export function setClipDuration(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	durationS: number
): Timeline {
	if (!finite(durationS) || durationS <= 0) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (clip.duration === durationS) return timeline;

	let nextStart = Number.POSITIVE_INFINITY;
	for (const other of timeline[loc.trackIndex]!.clips) {
		if (other.id === clip.id) continue;
		if (other.start >= clip.start + clip.duration && other.start < nextStart) {
			nextStart = other.start;
		}
	}
	const maxDuration = nextStart === Number.POSITIVE_INFINITY ? durationS : nextStart - clip.start;
	const bounded = Math.min(durationS, maxDuration);
	if (bounded <= 0 || bounded === clip.duration) return timeline;

	const next = cloneTimeline(timeline);
	next[loc.trackIndex]!.clips[loc.clipIndex] = { ...cloneClip(clip), duration: bounded };
	return next;
}

export function addMarker(
	markers: readonly TimelineMarker[],
	time: number,
	label?: string
): TimelineMarker[] {
	if (!finite(time) || time < 0) return markers as TimelineMarker[];
	const safeLabel = label?.trim() || `Marker ${markers.length + 1}`;
	return sortMarkers([
		...markers,
		{
			id: newId('marker'),
			time,
			label: safeLabel
		}
	]);
}

export function deleteMarker(
	markers: readonly TimelineMarker[],
	markerId: string
): TimelineMarker[] {
	const next = markers.filter((marker) => marker.id !== markerId);
	return next.length === markers.length ? (markers as TimelineMarker[]) : next;
}

export function sortMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
	return markers.toSorted((a, b) => {
		const timeDiff = a.time - b.time;
		if (timeDiff !== 0) return timeDiff;
		return a.id.localeCompare(b.id);
	});
}

// --- Phase 20: Editing Tools V2 ---

export function setTrackLock(timeline: Timeline, trackId: string, locked: boolean): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.locked === locked) return timeline;
	const next = cloneTimeline(timeline);
	const idx = next.findIndex((t) => t.id === trackId);
	next[idx] = { ...next[idx]!, locked };
	return next;
}

export function setTrackVisible(timeline: Timeline, trackId: string, visible: boolean): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.visible === visible) return timeline;
	const next = cloneTimeline(timeline);
	const idx = next.findIndex((t) => t.id === trackId);
	next[idx] = { ...next[idx]!, visible };
	return next;
}

export function setTrackSyncLock(
	timeline: Timeline,
	trackId: string,
	syncLocked: boolean
): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.syncLocked === syncLocked) return timeline;
	const next = cloneTimeline(timeline);
	const idx = next.findIndex((t) => t.id === trackId);
	next[idx] = { ...next[idx]!, syncLocked };
	return next;
}

export function setTrackEditTarget(
	timeline: Timeline,
	trackId: string,
	editTarget: boolean
): Timeline {
	const track = findTrack(timeline, trackId);
	if (!track || track.editTarget === editTarget) return timeline;
	const next = cloneTimeline(timeline);
	const idx = next.findIndex((t) => t.id === trackId);
	next[idx] = { ...next[idx]!, editTarget };
	return next;
}

export function linkClips(timeline: Timeline, refs: readonly ClipReference[]): Timeline {
	if (refs.length < 2) return timeline;
	for (const ref of refs) {
		if (!trackWithClip(timeline, ref.trackId, ref.clipId)) return timeline;
	}
	const groupId = newId('link');
	const next = cloneTimeline(timeline);
	const refSet = new Set(refs.map((r) => `${r.trackId}:${r.clipId}`));
	for (const track of next) {
		for (let i = 0; i < track.clips.length; i++) {
			if (refSet.has(`${track.id}:${track.clips[i]!.id}`)) {
				track.clips[i] = { ...track.clips[i]!, linkedGroupId: groupId };
			}
		}
	}
	return next;
}

export function unlinkClips(timeline: Timeline, refs: readonly ClipReference[]): Timeline {
	if (refs.length === 0) return timeline;
	for (const ref of refs) {
		if (!trackWithClip(timeline, ref.trackId, ref.clipId)) return timeline;
	}
	const next = cloneTimeline(timeline);
	const refSet = new Set(refs.map((r) => `${r.trackId}:${r.clipId}`));
	const clearedGroupIds = new Set<string>();
	let changed = false;
	for (const track of next) {
		for (let i = 0; i < track.clips.length; i++) {
			if (refSet.has(`${track.id}:${track.clips[i]!.id}`) && track.clips[i]!.linkedGroupId) {
				clearedGroupIds.add(track.clips[i]!.linkedGroupId!);
				track.clips[i] = { ...track.clips[i]!, linkedGroupId: undefined };
				changed = true;
			}
		}
	}
	if (!changed) return timeline;
	// Clear orphaned sole members
	for (const gid of clearedGroupIds) {
		const members: { trackIdx: number; clipIdx: number }[] = [];
		for (let ti = 0; ti < next.length; ti++) {
			for (let ci = 0; ci < next[ti]!.clips.length; ci++) {
				if (next[ti]!.clips[ci]!.linkedGroupId === gid) members.push({ trackIdx: ti, clipIdx: ci });
			}
		}
		if (members.length < 2) {
			for (const m of members) {
				next[m.trackIdx]!.clips[m.clipIdx] = {
					...next[m.trackIdx]!.clips[m.clipIdx]!,
					linkedGroupId: undefined
				};
			}
		}
	}
	return next;
}

export function expandLinkedGroup(
	timeline: Timeline,
	refs: readonly ClipReference[]
): ClipReference[] {
	const groupIds = new Set<string>();
	const seen = new Set<string>();
	for (const ref of refs) {
		const key = `${ref.trackId}:${ref.clipId}`;
		seen.add(key);
		const loc = trackWithClip(timeline, ref.trackId, ref.clipId);
		if (!loc) continue;
		const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
		if (clip.linkedGroupId) groupIds.add(clip.linkedGroupId);
	}
	if (groupIds.size === 0) return refs as ClipReference[];
	const expanded: ClipReference[] = [...refs];
	for (const track of timeline) {
		for (const clip of track.clips) {
			const key = `${track.id}:${clip.id}`;
			if (!seen.has(key) && clip.linkedGroupId && groupIds.has(clip.linkedGroupId)) {
				expanded.push({ trackId: track.id, clipId: clip.id });
				seen.add(key);
			}
		}
	}
	return expanded;
}

function isTrackLocked(timeline: Timeline, trackId: string): boolean {
	return timeline.find((t) => t.id === trackId)?.locked === true;
}

function anyRefOnLockedTrack(timeline: Timeline, refs: readonly ClipReference[]): boolean {
	return refs.some((ref) => isTrackLocked(timeline, ref.trackId));
}

export function removeMarkersInRange(
	markers: readonly TimelineMarker[],
	startTime: number,
	endTime: number
): TimelineMarker[] {
	const filtered = markers.filter(
		(m) => m.time < startTime - TIMELINE_EPSILON || m.time >= endTime - TIMELINE_EPSILON
	);
	return filtered.length === markers.length ? (markers as TimelineMarker[]) : filtered;
}

export function shiftMarkers(
	markers: readonly TimelineMarker[],
	afterTime: number,
	deltaS: number
): TimelineMarker[] {
	if (deltaS === 0 || !finite(deltaS)) return markers as TimelineMarker[];
	let changed = false;
	const next = markers.map((marker) => {
		if (marker.time >= afterTime - TIMELINE_EPSILON) {
			const shifted = Math.max(0, marker.time + deltaS);
			if (shifted !== marker.time) {
				changed = true;
				return { ...marker, time: shifted };
			}
		}
		return marker;
	});
	return changed ? sortMarkers(next) : (markers as TimelineMarker[]);
}

function shiftClipsOnTrack(
	track: TimelineTrack,
	afterTime: number,
	deltaS: number
): TimelineClip[] {
	return track.clips.map((clip) => {
		if (clip.start >= afterTime - TIMELINE_EPSILON) {
			return { ...clip, start: Math.max(0, clip.start + deltaS) };
		}
		return clip;
	});
}

function clipSpansPoint(track: TimelineTrack, point: number): boolean {
	return track.clips.some(
		(c) => c.start < point - TIMELINE_EPSILON && clipEnd(c) > point + TIMELINE_EPSILON
	);
}

export function rippleDelete(
	timeline: Timeline,
	refs: readonly ClipReference[],
	syncLockedTrackIds: readonly string[]
): Timeline {
	if (refs.length === 0) return timeline;
	const expanded = expandLinkedGroup(timeline, refs);
	if (anyRefOnLockedTrack(timeline, expanded)) return timeline;
	for (const sid of syncLockedTrackIds) {
		if (isTrackLocked(timeline, sid)) return timeline;
	}

	const next = cloneTimeline(timeline);
	const syncSet = new Set(syncLockedTrackIds);
	const refsByTrack = new Map<string, Set<string>>();
	for (const ref of expanded) {
		let set = refsByTrack.get(ref.trackId);
		if (!set) {
			set = new Set();
			refsByTrack.set(ref.trackId, set);
		}
		set.add(ref.clipId);
	}

	const trackDeltas = new Map<string, { afterTime: number; delta: number }>();

	for (const track of next) {
		const clipIds = refsByTrack.get(track.id);
		if (!clipIds) continue;
		const removed = sortByStart(track.clips.filter((c) => clipIds.has(c.id)));
		if (removed.length === 0) continue;
		const remaining = track.clips.filter((c) => !clipIds.has(c.id));
		let totalDelta = 0;
		const earliestRemoved = removed[0]!.start;
		// Build sorted removal regions for cumulative shifting
		const regions = removed.map((c) => ({ start: c.start, duration: c.duration }));
		track.clips = sortByStart(remaining).map((clip) => {
			if (clip.start < earliestRemoved - TIMELINE_EPSILON) return clip;
			// Accumulate shift from all removed regions before/at this clip
			let shift = 0;
			for (const r of regions) {
				if (r.start <= clip.start + TIMELINE_EPSILON) shift += r.duration;
			}
			if (shift === 0) return clip;
			return { ...clip, start: Math.max(0, clip.start - shift) };
		});
		for (const r of regions) totalDelta += r.duration;
		trackDeltas.set(track.id, { afterTime: earliestRemoved, delta: -totalDelta });
	}

	// Shift sync-locked tracks — reject if any clip spans the ripple point
	for (const track of next) {
		if (!syncSet.has(track.id) || refsByTrack.has(track.id)) continue;
		let bestDelta = 0;
		let bestAfter = Number.POSITIVE_INFINITY;
		for (const [, d] of trackDeltas) {
			if (d.delta < bestDelta) {
				bestDelta = d.delta;
				bestAfter = d.afterTime;
			}
		}
		if (bestDelta !== 0) {
			if (clipSpansPoint(track, bestAfter)) return timeline;
			track.clips = shiftClipsOnTrack(track, bestAfter, bestDelta);
		}
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}
	return next;
}

export function rippleTrim(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	edge: 'in' | 'out',
	time: number,
	syncLockedTrackIds: readonly string[],
	sourceDuration?: number
): Timeline {
	if (!finite(time)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;
	if (isTrackLocked(timeline, trackId)) return timeline;
	for (const sid of syncLockedTrackIds) {
		if (isTrackLocked(timeline, sid)) return timeline;
	}

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	const oldEnd = clipEnd(clip);
	const trimmed = trimClip(timeline, trackId, clipId, { edge, time, sourceDuration });
	if (trimmed === timeline) return timeline;

	const trimmedClip = trimmed[loc.trackIndex]!.clips[loc.clipIndex]!;
	const newEnd = clipEnd(trimmedClip);
	const rawDelta = edge === 'out' ? newEnd - oldEnd : clip.start - trimmedClip.start;
	// In-edge outward extension (positive delta): out-edge stays put, no ripple needed.
	const delta = edge === 'in' && rawDelta > 0 ? 0 : rawDelta;
	if (delta === 0) return trimmed;

	const afterTime = edge === 'out' ? oldEnd : clip.start;
	const next = cloneTimeline(trimmed);
	const track = next[loc.trackIndex]!;
	track.clips = track.clips.map((c, i) => {
		if (edge === 'out' && i === loc.clipIndex) return c;
		if (c.start >= afterTime - TIMELINE_EPSILON) {
			return { ...c, start: Math.max(0, c.start + delta) };
		}
		return c;
	});

	const syncSet = new Set(syncLockedTrackIds);
	for (const t of next) {
		if (t.id === trackId || !syncSet.has(t.id)) continue;
		if (clipSpansPoint(t, afterTime)) return timeline;
		t.clips = shiftClipsOnTrack(t, afterTime, delta);
	}

	for (const t of next) {
		if (trackHasOverlaps(t.clips)) return timeline;
	}
	return next;
}

export function rollTrim(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	edge: 'in' | 'out',
	time: number,
	sourceDurations: { durationForSource: (sourceId: string) => number | undefined }
): Timeline {
	if (!finite(time)) return timeline;
	if (isTrackLocked(timeline, trackId)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const track = timeline[loc.trackIndex]!;
	const sorted = sortByStart(track.clips);
	const sortedIdx = sorted.findIndex((c) => c.id === clipId);
	if (sortedIdx < 0) return timeline;

	const clip = sorted[sortedIdx]!;
	let neighbor: TimelineClip;
	if (edge === 'in') {
		if (sortedIdx === 0) return timeline;
		neighbor = sorted[sortedIdx - 1]!;
		if (Math.abs(clipEnd(neighbor) - clip.start) > TIMELINE_EPSILON) return timeline;
	} else {
		if (sortedIdx >= sorted.length - 1) return timeline;
		neighbor = sorted[sortedIdx + 1]!;
		if (Math.abs(clipEnd(clip) - neighbor.start) > TIMELINE_EPSILON) return timeline;
	}

	const clipSourceDur = sourceDurations.durationForSource(clip.sourceId);
	const neighborSourceDur = sourceDurations.durationForSource(neighbor.sourceId);
	if (clipSourceDur === undefined || neighborSourceDur === undefined) return timeline;

	if (edge === 'in') {
		const cutPoint = time;
		if (cutPoint <= neighbor.start || cutPoint >= clipEnd(clip)) return timeline;
		const neighborNewDuration = cutPoint - neighbor.start;
		const neighborMaxOut = neighborSourceDur - neighbor.inPoint;
		if (neighborNewDuration > neighborMaxOut) return timeline;
		const clipDelta = cutPoint - clip.start;
		const clipNewInPoint = clip.inPoint + clipDelta;
		if (clipNewInPoint < 0) return timeline;

		const next = cloneTimeline(timeline);
		const nextTrack = next[loc.trackIndex]!;
		const nIdx = nextTrack.clips.findIndex((c) => c.id === neighbor.id);
		const cIdx = nextTrack.clips.findIndex((c) => c.id === clip.id);
		if (nIdx < 0 || cIdx < 0) return timeline;
		nextTrack.clips[nIdx] = { ...nextTrack.clips[nIdx]!, duration: neighborNewDuration };
		nextTrack.clips[cIdx] = {
			...nextTrack.clips[cIdx]!,
			start: cutPoint,
			duration: clip.duration - clipDelta,
			inPoint: clipNewInPoint
		};
		return next;
	} else {
		const cutPoint = time;
		if (cutPoint <= clip.start || cutPoint >= clipEnd(neighbor)) return timeline;
		const clipNewDuration = cutPoint - clip.start;
		const clipMaxOut = clipSourceDur - clip.inPoint;
		if (clipNewDuration > clipMaxOut) return timeline;
		const neighborDelta = cutPoint - neighbor.start;
		const neighborNewInPoint = neighbor.inPoint + neighborDelta;
		if (neighborNewInPoint < 0) return timeline;

		const next = cloneTimeline(timeline);
		const nextTrack = next[loc.trackIndex]!;
		const cIdx = nextTrack.clips.findIndex((c) => c.id === clip.id);
		const nIdx = nextTrack.clips.findIndex((c) => c.id === neighbor.id);
		if (cIdx < 0 || nIdx < 0) return timeline;
		nextTrack.clips[cIdx] = { ...nextTrack.clips[cIdx]!, duration: clipNewDuration };
		nextTrack.clips[nIdx] = {
			...nextTrack.clips[nIdx]!,
			start: cutPoint,
			duration: neighbor.duration - neighborDelta,
			inPoint: neighborNewInPoint
		};
		return next;
	}
}

export function slipEdit(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	deltaS: number,
	sourceDuration: number
): Timeline {
	if (!finite(deltaS) || deltaS === 0) return timeline;
	if (!finite(sourceDuration)) return timeline;
	if (isTrackLocked(timeline, trackId)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
	if (isTitleClip(clip)) return timeline;
	const newInPoint = clip.inPoint + deltaS;
	if (newInPoint < 0 || newInPoint + clip.duration > sourceDuration + TIMELINE_EPSILON)
		return timeline;
	if (newInPoint === clip.inPoint) return timeline;

	const next = cloneTimeline(timeline);
	next[loc.trackIndex]!.clips[loc.clipIndex] = {
		...next[loc.trackIndex]!.clips[loc.clipIndex]!,
		inPoint: newInPoint
	};
	return next;
}

export function slideEdit(
	timeline: Timeline,
	trackId: string,
	clipId: string,
	deltaS: number,
	sourceDurations: { durationForSource: (sourceId: string) => number | undefined }
): Timeline {
	if (!finite(deltaS) || deltaS === 0) return timeline;
	if (isTrackLocked(timeline, trackId)) return timeline;
	const loc = trackWithClip(timeline, trackId, clipId);
	if (!loc) return timeline;

	const track = timeline[loc.trackIndex]!;
	const sorted = sortByStart(track.clips);
	const sortedIdx = sorted.findIndex((c) => c.id === clipId);
	if (sortedIdx < 0) return timeline;

	const clip = sorted[sortedIdx]!;
	const predecessor = sortedIdx > 0 ? sorted[sortedIdx - 1]! : null;
	const successor = sortedIdx < sorted.length - 1 ? sorted[sortedIdx + 1]! : null;

	if (predecessor && Math.abs(clipEnd(predecessor) - clip.start) > TIMELINE_EPSILON)
		return timeline;
	if (successor && Math.abs(clipEnd(clip) - successor.start) > TIMELINE_EPSILON) return timeline;
	if (!predecessor && !successor) return timeline;

	let clampedDelta = deltaS;

	if (predecessor) {
		const predSourceDur = sourceDurations.durationForSource(predecessor.sourceId);
		if (predSourceDur === undefined) return timeline;
		const predMaxExtend = predSourceDur - (predecessor.inPoint + predecessor.duration);
		if (clampedDelta > 0) clampedDelta = Math.min(clampedDelta, predMaxExtend);
		const predMinShrink = -predecessor.duration + TIMELINE_EPSILON;
		if (clampedDelta < predMinShrink) return timeline;
	} else {
		if (clampedDelta < 0) {
			clampedDelta = Math.max(clampedDelta, -clip.start);
		}
	}

	if (successor) {
		const succSourceDur = sourceDurations.durationForSource(successor.sourceId);
		if (succSourceDur === undefined) return timeline;
		const succMaxExtend = successor.inPoint;
		if (clampedDelta < 0) clampedDelta = Math.max(clampedDelta, -succMaxExtend);
		const succMinShrink = successor.duration - TIMELINE_EPSILON;
		if (clampedDelta > succMinShrink) return timeline;
	}

	if (Math.abs(clampedDelta) < TIMELINE_EPSILON) return timeline;

	const next = cloneTimeline(timeline);
	const nextTrack = next[loc.trackIndex]!;
	const cIdx = nextTrack.clips.findIndex((c) => c.id === clipId);
	if (cIdx < 0) return timeline;
	nextTrack.clips[cIdx] = { ...nextTrack.clips[cIdx]!, start: clip.start + clampedDelta };

	if (predecessor) {
		const pIdx = nextTrack.clips.findIndex((c) => c.id === predecessor.id);
		if (pIdx >= 0) {
			nextTrack.clips[pIdx] = {
				...nextTrack.clips[pIdx]!,
				duration: predecessor.duration + clampedDelta
			};
		}
	}

	if (successor) {
		const sIdx = nextTrack.clips.findIndex((c) => c.id === successor.id);
		if (sIdx >= 0) {
			nextTrack.clips[sIdx] = {
				...nextTrack.clips[sIdx]!,
				start: successor.start + clampedDelta,
				duration: successor.duration - clampedDelta,
				inPoint: successor.inPoint + clampedDelta
			};
		}
	}

	nextTrack.clips = sortByStart(nextTrack.clips);
	if (trackHasOverlaps(nextTrack.clips)) return timeline;
	return next;
}

export function insertEdit(
	timeline: Timeline,
	targetTrackIds: readonly string[],
	clips: readonly ClipboardTimelineClip[],
	atTime: number,
	syncLockedTrackIds: readonly string[]
): Timeline {
	if (clips.length === 0 || !finite(atTime) || atTime < 0) return timeline;
	for (const tid of targetTrackIds) {
		if (isTrackLocked(timeline, tid)) return timeline;
	}
	for (const sid of syncLockedTrackIds) {
		if (isTrackLocked(timeline, sid)) return timeline;
	}

	const targetSet = new Set(targetTrackIds);
	const syncSet = new Set(syncLockedTrackIds);

	let insertDuration = 0;
	for (const item of clips) {
		if (targetSet.has(item.trackId)) {
			insertDuration = Math.max(insertDuration, item.clip.duration);
		}
	}
	if (insertDuration <= 0) return timeline;

	for (const track of timeline) {
		if (syncSet.has(track.id) && !targetSet.has(track.id)) {
			if (clipSpansPoint(track, atTime)) return timeline;
		}
	}

	const next = cloneTimeline(timeline);

	for (const track of next) {
		if (targetSet.has(track.id) || syncSet.has(track.id)) {
			track.clips = shiftClipsOnTrack(track, atTime, insertDuration);
		}
	}

	for (const item of clips) {
		const dest = next.find((t) => t.id === item.trackId);
		if (!dest || !targetSet.has(dest.id)) continue;
		const placed = {
			...cloneWithNewId(item.clip),
			start: atTime
		};
		dest.clips = sortByStart([...dest.clips, placed]);
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}
	return next;
}

export function overwriteEdit(
	timeline: Timeline,
	targetTrackIds: readonly string[],
	clips: readonly ClipboardTimelineClip[],
	atTime: number
): Timeline {
	if (clips.length === 0 || !finite(atTime) || atTime < 0) return timeline;
	for (const tid of targetTrackIds) {
		if (isTrackLocked(timeline, tid)) return timeline;
	}

	const targetSet = new Set(targetTrackIds);
	const next = cloneTimeline(timeline);

	for (const item of clips) {
		const dest = next.find((t) => t.id === item.trackId);
		if (!dest || !targetSet.has(dest.id)) continue;
		const regionStart = atTime;
		const regionEnd = atTime + item.clip.duration;
		const surviving: TimelineClip[] = [];

		for (const existing of dest.clips) {
			const eStart = existing.start;
			const eEnd = clipEnd(existing);
			if (eEnd <= regionStart + TIMELINE_EPSILON || eStart >= regionEnd - TIMELINE_EPSILON) {
				surviving.push(existing);
				continue;
			}
			if (eStart < regionStart - TIMELINE_EPSILON) {
				const leftDuration = regionStart - eStart;
				const leftKeyframes = normalizeClipKeyframes(existing.keyframes, leftDuration);
				surviving.push({
					...existing,
					duration: leftDuration,
					linkedGroupId: undefined,
					keyframes: leftKeyframes || undefined
				});
			}
			if (eEnd > regionEnd + TIMELINE_EPSILON) {
				const rightStart = regionEnd;
				const trimDelta = regionEnd - eStart;
				const rightDuration = eEnd - regionEnd;
				const rightKeyframes = rebaseTrimmedKeyframes(existing, trimDelta, rightDuration);
				surviving.push({
					...existing,
					id: newId(existing.id),
					start: rightStart,
					duration: rightDuration,
					inPoint: existing.inPoint + trimDelta,
					linkedGroupId: undefined,
					keyframes: rightKeyframes
				});
			}
		}

		const placed = {
			...cloneWithNewId(item.clip),
			start: atTime
		};
		dest.clips = sortByStart([...surviving, placed]);
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}
	return next;
}

export function liftRegion(
	timeline: Timeline,
	targetTrackIds: readonly string[],
	startTime: number,
	endTime: number
): Timeline {
	if (!finite(startTime) || !finite(endTime) || endTime <= startTime) return timeline;
	for (const tid of targetTrackIds) {
		if (isTrackLocked(timeline, tid)) return timeline;
	}

	const targetSet = new Set(targetTrackIds);
	const next = cloneTimeline(timeline);
	let changed = false;

	for (const track of next) {
		if (!targetSet.has(track.id)) continue;
		const surviving: TimelineClip[] = [];
		for (const clip of track.clips) {
			const cEnd = clipEnd(clip);
			if (cEnd <= startTime + TIMELINE_EPSILON || clip.start >= endTime - TIMELINE_EPSILON) {
				surviving.push(clip);
				continue;
			}
			changed = true;
			if (clip.start < startTime - TIMELINE_EPSILON) {
				const leftDuration = startTime - clip.start;
				const leftKeyframes = normalizeClipKeyframes(clip.keyframes, leftDuration);
				surviving.push({
					...clip,
					duration: leftDuration,
					linkedGroupId: undefined,
					keyframes: leftKeyframes || undefined
				});
			}
			if (cEnd > endTime + TIMELINE_EPSILON) {
				const trimDelta = endTime - clip.start;
				const rightDuration = cEnd - endTime;
				const rightKeyframes = rebaseTrimmedKeyframes(clip, trimDelta, rightDuration);
				surviving.push({
					...clip,
					id: newId(clip.id),
					start: endTime,
					duration: rightDuration,
					inPoint: clip.inPoint + trimDelta,
					linkedGroupId: undefined,
					keyframes: rightKeyframes
				});
			}
		}
		track.clips = surviving;
	}

	return changed ? next : timeline;
}

export function extractRegion(
	timeline: Timeline,
	targetTrackIds: readonly string[],
	startTime: number,
	endTime: number,
	syncLockedTrackIds: readonly string[]
): Timeline {
	if (!finite(startTime) || !finite(endTime) || endTime <= startTime) return timeline;
	for (const tid of targetTrackIds) {
		if (isTrackLocked(timeline, tid)) return timeline;
	}
	for (const sid of syncLockedTrackIds) {
		if (isTrackLocked(timeline, sid)) return timeline;
	}

	const targetSet = new Set(targetTrackIds);
	const syncSet = new Set(syncLockedTrackIds);

	for (const track of timeline) {
		if (syncSet.has(track.id) && !targetSet.has(track.id)) {
			for (const clip of track.clips) {
				const cEnd = clipEnd(clip);
				if (cEnd > startTime + TIMELINE_EPSILON && clip.start < endTime - TIMELINE_EPSILON) {
					return timeline;
				}
			}
		}
	}

	const lifted = liftRegion(timeline, targetTrackIds, startTime, endTime);
	if (lifted === timeline) return timeline;

	const regionDuration = endTime - startTime;
	const next = cloneTimeline(lifted);

	for (const track of next) {
		if (targetSet.has(track.id) || syncSet.has(track.id)) {
			track.clips = shiftClipsOnTrack(track, endTime, -regionDuration);
		}
	}

	for (const track of next) {
		if (trackHasOverlaps(track.clips)) return timeline;
	}
	return next;
}

export { normalizeClipEffects, type ClipEffectParams };
export {
	DEFAULT_TRANSFORM,
	normalizeTransform,
	transformsEqual,
	type FitMode,
	type TransformParams
} from './transform';
export {
	DEFAULT_TITLE_STYLE,
	DEFAULT_TITLE_TEXT,
	DEFAULT_TITLE_DURATION_S,
	normalizeTitleContent,
	normalizeTitleStyle,
	titleContentHash,
	titleContentsEqual,
	type TitleAlign,
	type TitleContent,
	type TitleStyle
} from './title';
