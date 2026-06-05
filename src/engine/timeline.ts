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

function withTimelineDefaults(timeline: Timeline, trackId: string): { trackIndex: number } | null {
  const trackIndex = timeline.findIndex((track) => track.id === trackId);
  if (trackIndex >= 0) {
    return { trackIndex };
  }
  return null;
}

function trackWithClip(timeline: Timeline, trackId: string, clipId: string) {
  const t = withTimelineDefaults(timeline, trackId);
  if (!t) return null;
  const { trackIndex } = t;
  const clipIndex = timeline[trackIndex]?.clips.findIndex((clip) => clip.id === clipId);
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
  if (!hit || hit.trackId !== trackId) return cloneTimeline(timeline);

  const trackIndex = timeline.findIndex((track) => track.id === trackId);
  const track = timeline[trackIndex];
  if (!track) return cloneTimeline(timeline);
  const clipIndex = track.clips.findIndex((clip) => clip.id === hit.clip.id);
  if (clipIndex < 0) return cloneTimeline(timeline);

  const clip = track.clips[clipIndex];
  const splitOffset = time - clip.start;
  if (splitOffset <= 0 || splitOffset >= clip.duration) return cloneTimeline(timeline);

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
  const nextTrack = next[trackIndex];
  if (!nextTrack) return next;
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
  if (!loc) return cloneTimeline(timeline);

  const next = cloneTimeline(timeline);
  const track = next[loc.trackIndex];
  if (!track) return next;
  track.clips = track.clips.filter((clip) => clip.id !== clipId);
  return next;
}

/** Reorders a clip across compatible tracks and recalculates the destination start position. */
export function reorderClip(
  timeline: Timeline,
  fromTrackId: string,
  clipId: string,
  toTrackId: string,
  toIndex: number,
): Timeline {
  const source = trackWithClip(timeline, fromTrackId, clipId);
  if (!source) return cloneTimeline(timeline);
  const destinationIndex = timeline.findIndex((track) => track.id === toTrackId);
  if (destinationIndex < 0) return cloneTimeline(timeline);

  const sourceTrack = timeline[source.trackIndex];
  const targetTrack = timeline[destinationIndex];
  if (!sourceTrack || !targetTrack) return cloneTimeline(timeline);
  if (sourceTrack.type !== targetTrack.type) return cloneTimeline(timeline);

  const moving = sourceTrack.clips[source.clipIndex];
  if (!moving) return cloneTimeline(timeline);

  const next = cloneTimeline(timeline);
  const nextSource = next[source.trackIndex];
  const nextTarget = next[destinationIndex];
  if (!nextSource || !nextTarget) return next;

  const moved = moving;
  nextSource.clips = nextSource.clips.filter((clip) => clip.id !== clipId);

  const targetClips = nextTarget.clips;
  const upper = targetClips.length;
  const destination = Math.min(Math.max(toIndex, 0), upper);

  let normalizedDestination = destination;
  if (source.trackIndex === destinationIndex && source.clipIndex < destination) {
    normalizedDestination = Math.max(0, destination - 1);
  }

  let computedStart = 0;
  if (normalizedDestination > 0) {
    const previous = targetClips[normalizedDestination - 1];
    if (previous) {
      computedStart = previous.start + previous.duration;
    }
  }

  const inserted = {
    ...moved,
    start: computedStart,
  };
  nextTarget.clips = [
    ...targetClips.slice(0, normalizedDestination),
    inserted,
    ...targetClips.slice(normalizedDestination),
  ];

  return next;
}

export interface TrimClipOptions {
  edge: 'in' | 'out';
  time: number;
}

/** Trims a clip boundary to an absolute timeline time. */
export function trimClip(timeline: Timeline, trackId: string, clipId: string, options: TrimClipOptions): Timeline {
  if (!finite(options.time)) return cloneTimeline(timeline);
  const loc = trackWithClip(timeline, trackId, clipId);
  if (!loc) return cloneTimeline(timeline);

  const next = cloneTimeline(timeline);
  const track = next[loc.trackIndex];
  if (!track) return next;
  const clip = track.clips[loc.clipIndex];
  if (!clip || clip.duration <= 0) return next;

  if (options.time <= clip.start || options.time >= clip.start + clip.duration) return next;

  if (options.edge === 'in') {
    const offset = options.time - clip.start;
    track.clips[loc.clipIndex] = {
      ...clip,
      start: options.time,
      duration: clip.duration - offset,
      inPoint: clip.inPoint + offset,
    };
    return next;
  }

  track.clips[loc.clipIndex] = {
    ...clip,
    duration: options.time - clip.start,
  };
  return next;
}
