import { isFiniteNumber as finite } from '../lib/math';
import type { TimeRange } from './cache-types';
import { stableStringify } from './cache-key';
import {
	getTimelineDuration,
	isTitleClip,
	type Timeline,
	type TimelineClip,
	type TimelineTransition
} from './timeline';

export interface CacheInvalidation {
	readonly ranges: readonly TimeRange[];
	readonly sourceIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly trackIds: readonly string[];
	readonly fullTimeline: boolean;
	readonly reasons: readonly string[];
}

const EMPTY_INVALIDATION: CacheInvalidation = {
	ranges: [],
	sourceIds: [],
	clipIds: [],
	trackIds: [],
	fullTimeline: false,
	reasons: []
};

export function normalizeRange(range: TimeRange): TimeRange | null {
	if (!finite(range.startS) || !finite(range.endS)) return null;
	const startS = Math.max(0, Math.min(range.startS, range.endS));
	const endS = Math.max(0, Math.max(range.startS, range.endS));
	return endS > startS ? { startS, endS } : null;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
	const left = normalizeRange(a);
	const right = normalizeRange(b);
	if (!left || !right) return false;
	return left.startS < right.endS && left.endS > right.startS;
}

export function clipRange(clip: Pick<TimelineClip, 'start' | 'duration'>): TimeRange | null {
	return normalizeRange({ startS: clip.start, endS: clip.start + clip.duration });
}

function clipSignature(clip: TimelineClip): string {
	return stableStringify({
		kind: clip.kind ?? 'video',
		sourceId: clip.sourceId,
		start: clip.start,
		duration: clip.duration,
		inPoint: clip.inPoint,
		effects: clip.effects,
		transform: clip.transform,
		keyframes: clip.keyframes,
		lut: clip.lut
			? {
					key: clip.lut.key,
					fileName: clip.lut.fileName,
					title: clip.lut.title,
					size: clip.lut.size
				}
			: undefined,
		title: isTitleClip(clip) ? clip.title : undefined,
		audioFadeIn: clip.audioFadeIn,
		audioFadeOut: clip.audioFadeOut
	});
}

function transitionSignature(transition: TimelineTransition): string {
	return stableStringify({
		trackId: transition.trackId,
		fromClipId: transition.fromClipId,
		toClipId: transition.toClipId,
		durationS: transition.durationS,
		kind: transition.kind,
		params: transition.params
	});
}

function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
	const sorted = ranges
		.map(normalizeRange)
		.filter((range): range is TimeRange => range !== null)
		.sort((a, b) => a.startS - b.startS || a.endS - b.endS);
	const merged: TimeRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (!last || range.startS > last.endS) {
			merged.push({ ...range });
			continue;
		}
		merged[merged.length - 1] = { startS: last.startS, endS: Math.max(last.endS, range.endS) };
	}
	return merged;
}

function mergeStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

export function mergeInvalidations(
	...invalidations: readonly CacheInvalidation[]
): CacheInvalidation {
	return {
		ranges: mergeRanges(invalidations.flatMap((item) => item.ranges)),
		sourceIds: mergeStrings(invalidations.flatMap((item) => item.sourceIds)),
		clipIds: mergeStrings(invalidations.flatMap((item) => item.clipIds)),
		trackIds: mergeStrings(invalidations.flatMap((item) => item.trackIds)),
		fullTimeline: invalidations.some((item) => item.fullTimeline),
		reasons: mergeStrings(invalidations.flatMap((item) => item.reasons))
	};
}

function invalidation(partial: Partial<CacheInvalidation>): CacheInvalidation {
	return mergeInvalidations({
		ranges: partial.ranges ?? [],
		sourceIds: partial.sourceIds ?? [],
		clipIds: partial.clipIds ?? [],
		trackIds: partial.trackIds ?? [],
		fullTimeline: partial.fullTimeline ?? false,
		reasons: partial.reasons ?? []
	});
}

function indexClips(timeline: Timeline): Map<string, { trackId: string; clip: TimelineClip }> {
	const clips = new Map<string, { trackId: string; clip: TimelineClip }>();
	for (const track of timeline) {
		for (const clip of track.clips) {
			clips.set(clip.id, { trackId: track.id, clip });
		}
	}
	return clips;
}

function trackOrderSignature(timeline: Timeline): string {
	return timeline.map((track) => `${track.id}:${track.type}`).join('|');
}

function trackStateSignature(timeline: Timeline): string {
	return stableStringify(
		timeline.map((track) => ({
			id: track.id,
			type: track.type,
			gain: track.gain,
			pan: track.pan,
			muted: track.muted,
			solo: track.solo
		}))
	);
}

export function invalidateTimelineEdit(before: Timeline, after: Timeline): CacheInvalidation {
	if (before === after) return EMPTY_INVALIDATION;
	const beforeClips = indexClips(before);
	const afterClips = indexClips(after);
	const ranges: TimeRange[] = [];
	const clipIds: string[] = [];
	const trackIds: string[] = [];
	const sourceIds: string[] = [];
	const reasons: string[] = [];

	for (const [clipId, beforeEntry] of beforeClips) {
		const afterEntry = afterClips.get(clipId);
		if (!afterEntry) {
			const range = clipRange(beforeEntry.clip);
			if (range) ranges.push(range);
			clipIds.push(clipId);
			trackIds.push(beforeEntry.trackId);
			if (beforeEntry.clip.sourceId) sourceIds.push(beforeEntry.clip.sourceId);
			reasons.push('clip-deleted');
			continue;
		}
		if (
			beforeEntry.trackId !== afterEntry.trackId ||
			clipSignature(beforeEntry.clip) !== clipSignature(afterEntry.clip)
		) {
			const beforeRange = clipRange(beforeEntry.clip);
			const afterRange = clipRange(afterEntry.clip);
			if (beforeRange) ranges.push(beforeRange);
			if (afterRange) ranges.push(afterRange);
			clipIds.push(clipId);
			trackIds.push(beforeEntry.trackId, afterEntry.trackId);
			if (beforeEntry.clip.sourceId) sourceIds.push(beforeEntry.clip.sourceId);
			if (afterEntry.clip.sourceId) sourceIds.push(afterEntry.clip.sourceId);
			reasons.push(beforeEntry.trackId !== afterEntry.trackId ? 'clip-moved' : 'clip-edited');
		}
	}

	for (const [clipId, afterEntry] of afterClips) {
		if (beforeClips.has(clipId)) continue;
		const range = clipRange(afterEntry.clip);
		if (range) ranges.push(range);
		clipIds.push(clipId);
		trackIds.push(afterEntry.trackId);
		if (afterEntry.clip.sourceId) sourceIds.push(afterEntry.clip.sourceId);
		reasons.push('clip-added');
	}

	const trackOrderChanged = trackOrderSignature(before) !== trackOrderSignature(after);
	const trackStateChanged = trackStateSignature(before) !== trackStateSignature(after);
	if (trackOrderChanged || trackStateChanged) {
		const endS = Math.max(getTimelineDuration(before), getTimelineDuration(after));
		if (endS > 0) ranges.push({ startS: 0, endS });
		reasons.push(trackOrderChanged ? 'track-order' : 'track-state');
	}

	return invalidation({
		ranges,
		clipIds,
		trackIds,
		sourceIds,
		reasons,
		fullTimeline: trackOrderChanged || trackStateChanged
	});
}

function clipById(timeline: Timeline, clipId: string): TimelineClip | null {
	for (const track of timeline) {
		const clip = track.clips.find((item) => item.id === clipId);
		if (clip) return clip;
	}
	return null;
}

export function transitionRange(
	timeline: Timeline,
	transition: TimelineTransition
): TimeRange | null {
	const from = clipById(timeline, transition.fromClipId);
	const to = clipById(timeline, transition.toClipId);
	if (!from || !to) return null;
	const cut = from.start + from.duration;
	const half = transition.durationS * 0.5;
	return normalizeRange({
		startS: Math.min(cut - half, to.start),
		endS: Math.max(cut + half, to.start)
	});
}

export function invalidateTransitionEdit(
	beforeTimeline: Timeline,
	before: readonly TimelineTransition[],
	after: readonly TimelineTransition[],
	afterTimeline: Timeline = beforeTimeline
): CacheInvalidation {
	const beforeById = new Map(before.map((transition) => [transition.id, transition]));
	const afterById = new Map(after.map((transition) => [transition.id, transition]));
	const ranges: TimeRange[] = [];
	const clipIds: string[] = [];
	const trackIds: string[] = [];
	const reasons: string[] = [];

	for (const [id, previous] of beforeById) {
		const next = afterById.get(id);
		if (!next || transitionSignature(previous) !== transitionSignature(next)) {
			const range = transitionRange(beforeTimeline, previous);
			if (range) ranges.push(range);
			clipIds.push(previous.fromClipId, previous.toClipId);
			trackIds.push(previous.trackId);
			reasons.push(next ? 'transition-edited' : 'transition-deleted');
		}
	}
	for (const [id, next] of afterById) {
		const previous = beforeById.get(id);
		if (!previous || transitionSignature(previous) !== transitionSignature(next)) {
			const range = transitionRange(afterTimeline, next);
			if (range) ranges.push(range);
			clipIds.push(next.fromClipId, next.toClipId);
			trackIds.push(next.trackId);
			reasons.push(previous ? 'transition-edited' : 'transition-added');
		}
	}

	return invalidation({ ranges, clipIds, trackIds, reasons });
}

export function invalidateSourceChange(timeline: Timeline, sourceId: string): CacheInvalidation {
	const ranges: TimeRange[] = [];
	const clipIds: string[] = [];
	const trackIds: string[] = [];
	for (const track of timeline) {
		for (const clip of track.clips) {
			if (clip.sourceId !== sourceId) continue;
			const range = clipRange(clip);
			if (range) ranges.push(range);
			clipIds.push(clip.id);
			trackIds.push(track.id);
		}
	}
	return invalidation({
		ranges,
		sourceIds: [sourceId],
		clipIds,
		trackIds,
		reasons: ['source-changed']
	});
}
