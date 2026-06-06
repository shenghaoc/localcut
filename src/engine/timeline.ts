import {
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
  type ClipEffectParams,
} from './effects';

/** Authoritative timeline model — Phase 3+. */
export interface TimelineClip {
  id: string;
  sourceId: string;
  start: number;
  duration: number;
  inPoint: number;
  effects: ClipEffectParams;
  audioFadeIn: number;
  audioFadeOut: number;
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio';
  clips: TimelineClip[];
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export const DEFAULT_TRACK_MIX = {
  gain: 1,
  pan: 0,
  muted: false,
  solo: false,
} as const;

export const DEFAULT_CLIP_AUDIO_FADES = {
  audioFadeIn: 0,
  audioFadeOut: 0,
} as const;

export const DEFAULT_MASTER_GAIN = 1;

export type Timeline = TimelineTrack[];

export interface ResolveResult {
  clip: TimelineClip;
  sourceTime: number;
  trackId: string;
}

function cloneTimeline(timeline: Timeline): Timeline {
  return timeline.map((track) => ({
    ...track,
    gain: track.gain,
    pan: track.pan,
    muted: track.muted,
    solo: track.solo,
    clips: track.clips.map((clip) => ({
      ...clip,
      effects: { ...clip.effects },
      audioFadeIn: clip.audioFadeIn,
      audioFadeOut: clip.audioFadeOut,
    })),
  }));
}

function findTrack(timeline: Timeline, trackId: string): TimelineTrack | null {
  return timeline.find((track) => track.id === trackId) ?? null;
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

function resolveOnTrackType(
  timeline: Timeline,
  time: number,
  type: TimelineTrack['type'],
): ResolveResult | null {
  if (!finite(time) || time < 0) return null;
  for (const track of timeline) {
    if (track.type !== type) continue;
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

/** Finds the owning clip and its source offset for a timeline timestamp. */
export function resolveAt(timeline: Timeline, time: number): ResolveResult | null {
  return resolveOnTrackType(timeline, time, 'video');
}

/** Finds the owning audio clip at a timeline timestamp. */
export function resolveAudioAt(timeline: Timeline, time: number): ResolveResult | null {
  return resolveOnTrackType(timeline, time, 'audio');
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
    // The new source-side in-point can't be negative.
    if (candidateInPoint < 0) return timeline;
    nextStartOut = time;
    nextDuration = clip.duration - offset;
    nextInPoint = candidateInPoint;
  } else {
    if (time <= clip.start) return timeline;
    // Must not overlap the next neighbor.
    if (time > nextStart) return timeline;
    if (sourceDuration !== undefined && finite(sourceDuration)) {
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
  next[loc.trackIndex]!.clips[loc.clipIndex] = {
    ...clip,
    start: nextStartOut,
    duration: nextDuration,
    inPoint: nextInPoint,
  };
  return next;
}

/** Updates one effect scalar on a clip; returns the original timeline on no-op. */
export function setClipEffectParam(
  timeline: Timeline,
  trackId: string,
  clipId: string,
  key: keyof ClipEffectParams,
  value: number,
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

export function defaultClipEffects(): ClipEffectParams {
  return { ...DEFAULT_CLIP_EFFECTS };
}

export function defaultTimelineClip(
  partial: Omit<TimelineClip, 'effects' | 'audioFadeIn' | 'audioFadeOut'> &
    Partial<Pick<TimelineClip, 'effects' | 'audioFadeIn' | 'audioFadeOut'>>,
): TimelineClip {
  return {
    effects: defaultClipEffects(),
    ...DEFAULT_CLIP_AUDIO_FADES,
    ...partial,
  };
}

function applyTrackMix(
  timeline: Timeline,
  trackId: string,
  patch: Partial<Pick<TimelineTrack, 'gain' | 'pan' | 'muted' | 'solo'>>,
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
  durationS: number,
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

export { normalizeClipEffects, type ClipEffectParams };
