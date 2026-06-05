/** Authoritative timeline model — Phase 3. */
export interface TimelineClip {
  id: string;
  sourceId: string;
  start: number;
  duration: number;
  inPoint: number;
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio';
  clips: TimelineClip[];
}

export type Timeline = TimelineTrack[];

export interface ResolveResult {
  clip: TimelineClip;
  sourceTime: number;
  trackId: string;
}

function cloneTimeline(timeline: Timeline): Timeline {
  return timeline.map((track) => ({ ...track, clips: [...track.clips] }));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function isInClip(time: number, clip: TimelineClip): boolean {
  return finite(clip.start) && finite(clip.duration) && clip.duration > 0 && time >= clip.start && time < clip.start + clip.duration;
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

/** Finds the owning clip and its source offset for a timeline timestamp. */
export function resolveAt(timeline: Timeline, time: number): ResolveResult | null {
  if (!finite(time) || time < 0) return null;

  for (const track of timeline) {
    if (track.type !== 'video') continue;
    for (const clip of track.clips) {
      if (!isInClip(time, clip)) continue;
      return {
        clip,
        trackId: track.id,
        sourceTime: clip.inPoint + (time - clip.start),
      };
    }
  }
  return null;
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

/** Splits one clip at an absolute timeline time, preserving source continuity. */
export function splitClipAt(
  timeline: Timeline,
  trackId: string,
  time: number,
): Timeline {
  if (!finite(time)) return timeline;
  const hit = resolveAt(timeline, time);
  if (!hit || hit.trackId !== trackId) return timeline;

  const trackIndex = timeline.findIndex((track) => track.id === trackId);
  const track = timeline[trackIndex];
  if (!track) return timeline;
  const clipIndex = track.clips.findIndex((clip) => clip.id === hit.clip.id);
  if (clipIndex < 0) return timeline;

  const clip = track.clips[clipIndex]!;
  const splitOffset = time - clip.start;
  if (splitOffset <= 0 || splitOffset >= clip.duration) return timeline;

  const left: TimelineClip = {
    ...clip,
    duration: splitOffset,
  };
  const right: TimelineClip = {
    ...clip,
    id: newId(clip.id),
    start: clip.start + splitOffset,
    duration: clip.duration - splitOffset,
    inPoint: clip.inPoint + splitOffset,
  };

  const next = cloneTimeline(timeline);
  const nextTrack = next[trackIndex]!;
  nextTrack.clips = [
    ...nextTrack.clips.slice(0, clipIndex),
    left,
    right,
    ...nextTrack.clips.slice(clipIndex + 1),
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

/**
 * Reorders a clip within or across compatible tracks, inserting it at `toIndex`
 * (an index into the destination track's *current* clip array, as produced by the
 * UI drop handler). The destination track is re-laid gaplessly so the move can
 * never overlap clips and the moved clip slots cleanly after its new predecessor;
 * the source track keeps its remaining clips' positions (a gap, like delete).
 */
export function reorderClip(
  timeline: Timeline,
  fromTrackId: string,
  clipId: string,
  toTrackId: string,
  toIndex: number,
): Timeline {
  const source = trackWithClip(timeline, fromTrackId, clipId);
  if (!source) return timeline;
  const destinationIndex = timeline.findIndex((track) => track.id === toTrackId);
  if (destinationIndex < 0) return timeline;

  const sourceTrack = timeline[source.trackIndex]!;
  const targetTrack = timeline[destinationIndex]!;
  if (sourceTrack.type !== targetTrack.type) return timeline;

  const moving = sourceTrack.clips[source.clipIndex];
  if (!moving) return timeline;

  const sameTrack = source.trackIndex === destinationIndex;

  // Build the destination order. For a same-track move the clip is still present
  // in `targetTrack.clips`, so drop it first and shift the requested index down by
  // one when the insertion point sits after the original slot.
  const baseClips = sameTrack
    ? targetTrack.clips.filter((clip) => clip.id !== clipId)
    : targetTrack.clips.slice();

  let insertAt = toIndex;
  if (sameTrack && toIndex > source.clipIndex) insertAt -= 1;
  insertAt = Math.min(Math.max(insertAt, 0), baseClips.length);

  const reordered = [
    ...baseClips.slice(0, insertAt),
    moving,
    ...baseClips.slice(insertAt),
  ];

  const next = cloneTimeline(timeline);
  next[destinationIndex] = { ...targetTrack, clips: relayoutSequential(reordered) };
  if (!sameTrack) {
    next[source.trackIndex] = {
      ...sourceTrack,
      clips: sourceTrack.clips.filter((clip) => clip.id !== clipId),
    };
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
export function trimClip(timeline: Timeline, trackId: string, clipId: string, options: TrimClipOptions): Timeline {
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

  let nextStart: number;
  let nextDuration: number;
  let nextInPoint: number;

  if (edge === 'in') {
    // Must not collapse or cross the out-edge.
    if (time >= clipEnd) return timeline;
    // Timeline times can't go negative.
    if (time < 0) return timeline;
    const offset = time - clip.start;
    const candidateInPoint = clip.inPoint + offset;
    // The new source-side in-point can't be negative.
    if (candidateInPoint < 0) return timeline;
    nextStart = time;
    nextDuration = clip.duration - offset;
    nextInPoint = candidateInPoint;
  } else {
    if (time <= clip.start) return timeline;
    if (sourceDuration !== undefined && finite(sourceDuration)) {
      // Out-edge extension is bounded by available source content.
      const maxOutTime = clip.start + (sourceDuration - clip.inPoint);
      if (time > maxOutTime) return timeline;
    } else if (time > clipEnd) {
      // Without source-duration knowledge, refuse to extend past the current end.
      return timeline;
    }
    nextStart = clip.start;
    nextDuration = time - clip.start;
    nextInPoint = clip.inPoint;
  }

  if (nextDuration <= 0) return timeline;

  const next = cloneTimeline(timeline);
  next[loc.trackIndex]!.clips[loc.clipIndex] = {
    ...clip,
    start: nextStart,
    duration: nextDuration,
    inPoint: nextInPoint,
  };
  return next;
}
