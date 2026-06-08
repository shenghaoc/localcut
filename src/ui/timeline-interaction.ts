import type { TimelineMarkerSnapshot, TimelineTrackSnapshot } from '../protocol';

export type SnapTargetKind = 'zero' | 'playhead' | 'marker' | 'clip-start' | 'clip-end';

export interface SnapTarget {
	kind: SnapTargetKind;
	time: number;
	id: string;
	label: string;
}

export interface SnapResult {
	time: number;
	snapped: boolean;
	target: SnapTarget | null;
}

export interface ClipSelectionRef {
	trackId: string;
	clipId: string;
}

export interface MarqueeTimeRange {
	startTime: number;
	endTime: number;
	trackIds: readonly string[];
}

function finite(value: number): boolean {
	return Number.isFinite(value);
}

function pushTarget(targets: SnapTarget[], target: SnapTarget): void {
	if (!finite(target.time) || target.time < 0) return;
	targets.push(target);
}

export function buildSnapTargets(
	timeline: readonly TimelineTrackSnapshot[],
	markers: readonly TimelineMarkerSnapshot[],
	playheadTime: number
): SnapTarget[] {
	const targets: SnapTarget[] = [];
	pushTarget(targets, { kind: 'zero', time: 0, id: 'zero', label: 'Start' });
	pushTarget(targets, {
		kind: 'playhead',
		time: playheadTime,
		id: 'playhead',
		label: 'Playhead'
	});
	for (const marker of markers) {
		pushTarget(targets, {
			kind: 'marker',
			time: marker.time,
			id: marker.id,
			label: marker.label
		});
	}
	for (const track of timeline) {
		for (const clip of track.clips) {
			pushTarget(targets, {
				kind: 'clip-start',
				time: clip.start,
				id: `${track.id}:${clip.id}:start`,
				label: clip.id
			});
			pushTarget(targets, {
				kind: 'clip-end',
				time: clip.start + clip.duration,
				id: `${track.id}:${clip.id}:end`,
				label: clip.id
			});
		}
	}
	return targets;
}

export function resolveSnap(
	time: number,
	pxPerSecond: number,
	targets: readonly SnapTarget[],
	thresholdPx = 8
): SnapResult {
	if (!finite(time) || !finite(pxPerSecond) || pxPerSecond <= 0 || thresholdPx <= 0) {
		return { time, snapped: false, target: null };
	}
	const thresholdSeconds = thresholdPx / pxPerSecond;
	let best: SnapTarget | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const target of targets) {
		const distance = Math.abs(target.time - time);
		if (distance > thresholdSeconds || distance >= bestDistance) continue;
		best = target;
		bestDistance = distance;
	}
	return best
		? { time: best.time, snapped: true, target: best }
		: { time, snapped: false, target: null };
}

export function timelineTimeAtClientX(
	clientX: number,
	contentLeft: number,
	pxPerSecond: number
): number | null {
	if (!finite(clientX) || !finite(contentLeft) || !finite(pxPerSecond) || pxPerSecond <= 0) {
		return null;
	}
	return Math.max(0, (clientX - contentLeft) / pxPerSecond);
}

export function selectClipsInMarquee(
	timeline: readonly TimelineTrackSnapshot[],
	range: MarqueeTimeRange
): ClipSelectionRef[] {
	const start = Math.min(range.startTime, range.endTime);
	const end = Math.max(range.startTime, range.endTime);
	const trackIds = new Set(range.trackIds);
	if (!finite(start) || !finite(end) || end <= start || trackIds.size === 0) return [];

	const selected: ClipSelectionRef[] = [];
	for (const track of timeline) {
		if (!trackIds.has(track.id)) continue;
		for (const clip of track.clips) {
			const clipStart = clip.start;
			const clipEnd = clip.start + clip.duration;
			if (clipStart < end && clipEnd > start) {
				selected.push({ trackId: track.id, clipId: clip.id });
			}
		}
	}
	return selected;
}
