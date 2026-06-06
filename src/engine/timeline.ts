import {
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
  type ClipEffectParams,
} from './effects';
import {
  DEFAULT_TRANSFORM,
  normalizeTransform,
  transformsEqual,
  type TransformParams,
} from './transform';
import {
  cloneTitleContent,
  normalizeTitleContent,
  titleContentsEqual,
  type TitleContent,
  type TitleContentInput,
  type TitleStyle,
} from './title';

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
  audioFadeIn: number;
  audioFadeOut: number;
  /** Text + style for `kind: 'title'` clips; absent otherwise (Phase 14). */
  title?: TitleContent;
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
} as const;

export const DEFAULT_CLIP_AUDIO_FADES = {
  audioFadeIn: 0,
  audioFadeOut: 0,
} as const;

export const DEFAULT_MASTER_GAIN = 1;

export type Timeline = TimelineTrack[];

export interface TransitionSourceDurations {
  durationForSource: (sourceId: string) => number | undefined;
}

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
      transform: { ...clip.transform },
      audioFadeIn: clip.audioFadeIn,
      audioFadeOut: clip.audioFadeOut,
      title: clip.title ? cloneTitleContent(clip.title) : undefined,
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

/**
 * Every video clip overlapping `time`, ordered bottom-to-top by track array
 * position (the last track is topmost / drawn last). Phase 12 compositing
 * consumes this so preview and export render the full layer stack rather than
 * just the first hit. At most one clip per track can overlap (tracks forbid
 * overlaps), so this yields one entry per video track with a clip at `time`.
 */
export function resolveAllAt(timeline: Timeline, time: number): ResolveResult[] {
  const layers: ResolveResult[] = [];
  if (!finite(time) || time < 0) return layers;
  for (const track of timeline) {
    if (track.type !== 'video') continue;
    for (const clip of track.clips) {
      if (!isInClip(time, clip)) continue;
      layers.push({
        clip,
        trackId: track.id,
        sourceTime: clip.inPoint + (time - clip.start),
      });
      break; // one clip per track at any timestamp
    }
  }
  return layers;
}

/** Finds the owning audio clip at a timeline timestamp. */
export function resolveAudioAt(timeline: Timeline, time: number): ResolveResult | null {
  return resolveOnTrackType(timeline, time, 'audio');
}

const TIMELINE_EPSILON = 1e-6;

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
    params: { ...transition.params },
  };
}

function isTransitionKind(value: unknown): value is TransitionKind {
  return value === 'cross-dissolve' || value === 'dip-to-black' || value === 'wipe' || value === 'slide';
}

export function normalizeTransitionKind(kind: unknown): TransitionKind {
  return isTransitionKind(kind) ? kind : 'cross-dissolve';
}

export function normalizeTransitionParams(params: Partial<TransitionParams> | undefined): TransitionParams {
  const direction = params?.direction;
  return direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down'
    ? { direction }
    : {};
}

function transitionBoundary(
  timeline: Timeline,
  trackId: string,
  fromClipId: string,
  toClipId: string,
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
  toClipId: string,
): number {
  const boundary = transitionBoundary(timeline, trackId, fromClipId, toClipId);
  if (!boundary) return 0;
  const handle = Math.min(
    boundary.fromClip.duration,
    boundary.toClip.duration,
    sourceTailHandle(boundary.fromClip, sourceDurations),
    sourceHeadHandle(boundary.toClip),
  );
  return Math.max(0, handle * 2);
}

export function clampTransitionDurationS(
  timeline: Timeline,
  sourceDurations: TransitionSourceDurations,
  trackId: string,
  fromClipId: string,
  toClipId: string,
  durationS: number,
): number {
  if (!finite(durationS) || durationS <= 0) return 0;
  const maxDuration = maxTransitionDurationS(timeline, sourceDurations, trackId, fromClipId, toClipId);
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
  },
): TimelineTransition[] {
  const durationS = clampTransitionDurationS(
    timeline,
    sourceDurations,
    transition.trackId,
    transition.fromClipId,
    transition.toClipId,
    transition.durationS,
  );
  if (durationS <= 0) return transitions as TimelineTransition[];
  const nextTransition: TimelineTransition = {
    id: transition.id,
    trackId: transition.trackId,
    fromClipId: transition.fromClipId,
    toClipId: transition.toClipId,
    durationS,
    kind: normalizeTransitionKind(transition.kind),
    params: normalizeTransitionParams(transition.params),
  };
  const withoutBoundary = transitions.filter(
    (item) =>
      item.trackId !== nextTransition.trackId ||
      item.fromClipId !== nextTransition.fromClipId ||
      item.toClipId !== nextTransition.toClipId,
  );
  return [...withoutBoundary.map(cloneTransition), nextTransition];
}

export function removeTransition(
  transitions: readonly TimelineTransition[],
  transitionId: string,
): TimelineTransition[] {
  const next = transitions.filter((transition) => transition.id !== transitionId).map(cloneTransition);
  return next.length === transitions.length ? (transitions as TimelineTransition[]) : next;
}

export function setTransition(
  timeline: Timeline,
  transitions: readonly TimelineTransition[],
  sourceDurations: TransitionSourceDurations,
  transitionId: string,
  patch: Partial<Pick<TimelineTransition, 'durationS' | 'kind' | 'params'>>,
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
            patch.durationS,
          );
    if (durationS <= 0) {
      changed = true;
      return null;
    }
    const updated: TimelineTransition = {
      ...transition,
      durationS,
      kind: patch.kind ? normalizeTransitionKind(patch.kind) : transition.kind,
      params: patch.params ? normalizeTransitionParams(patch.params) : { ...transition.params },
    };
    changed ||= !transitionsEqual(transition, updated);
    return updated;
  });
  const filtered = next.filter((transition): transition is TimelineTransition => transition !== null);
  return changed ? filtered : (transitions as TimelineTransition[]);
}

export function revalidateTransitions(
  timeline: Timeline,
  transitions: readonly TimelineTransition[],
  sourceDurations: TransitionSourceDurations,
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
      transition.durationS,
    );
    if (durationS <= 0) {
      changed = true;
      continue;
    }
    const normalized: TimelineTransition = {
      ...cloneTransition(transition),
      durationS,
      kind: normalizeTransitionKind(transition.kind),
      params: normalizeTransitionParams(transition.params),
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
  return {
    ...clip,
    effects: { ...clip.effects },
    transform: { ...clip.transform },
    audioFadeIn: clip.audioFadeIn,
    audioFadeOut: clip.audioFadeOut,
    title: clip.title ? cloneTitleContent(clip.title) : undefined,
  };
}

function cloneWithNewId(clip: TimelineClip): TimelineClip {
  return {
    ...cloneClip(clip),
    id: newId(clip.id),
  };
}

function sortByStart(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
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
export function splitClipAt(
  timeline: Timeline,
  trackId: string,
  time: number,
): Timeline {
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
      start: toStart,
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
  toStart: number,
): Timeline {
  const loc = trackWithClip(timeline, fromTrackId, clipId);
  const normalizedStart = normalizeMoveStart(toStart);
  if (!loc || normalizedStart === null) return timeline;
  const current = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
  if (fromTrackId === toTrackId && current.start === normalizedStart) return timeline;
  return moveClips(timeline, [{ trackId: fromTrackId, clipId, toTrackId, toStart: normalizedStart }]);
}

export function closeGaps(timeline: Timeline, trackId?: string): Timeline {
  let changed = false;
  const next = cloneTimeline(timeline);
  for (const track of next) {
    if (trackId && track.id !== trackId) continue;
    const laidOut = relayoutSequential(sortByStart(track.clips));
    changed ||= laidOut.some((clip, index) => clip.start !== track.clips[index]?.start || clip.id !== track.clips[index]?.id);
    track.clips = laidOut;
  }
  return changed ? next : timeline;
}

export function duplicateClips(
  timeline: Timeline,
  refs: readonly ClipReference[],
  atTime?: number,
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
  sourceBaseStart?: number,
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
      start: pasteAt + (item.clip.start - baseStart),
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

export function defaultClipTransform(): TransformParams {
  return { ...DEFAULT_TRANSFORM };
}

/** Replaces a clip's transform; returns the original timeline on no-op. */
export function setClipTransform(
  timeline: Timeline,
  trackId: string,
  clipId: string,
  transform: Partial<TransformParams>,
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
    title: normalizeTitleContent(partial.title),
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
  patch: { text?: string; style?: Partial<TitleStyle> },
): Timeline {
  const loc = trackWithClip(timeline, trackId, clipId);
  if (!loc) return timeline;

  const clip = timeline[loc.trackIndex]!.clips[loc.clipIndex]!;
  if (!isTitleClip(clip) || !clip.title) return timeline;

  const next = normalizeTitleContent({
    text: patch.text ?? clip.title.text,
    style: { ...clip.title.style, ...patch.style },
  });
  if (titleContentsEqual(clip.title, next)) return timeline;

  const cloned = cloneTimeline(timeline);
  cloned[loc.trackIndex]!.clips[loc.clipIndex]!.title = next;
  return cloned;
}

export function defaultTimelineClip(
  partial: Omit<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'> &
    Partial<Pick<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'>>,
): TimelineClip {
  return {
    effects: defaultClipEffects(),
    transform: defaultClipTransform(),
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

/** Appends a new empty track of the given type with default mix settings. */
export function addTrack(timeline: Timeline, type: TimelineTrack['type']): Timeline {
  return [
    ...timeline,
    {
      id: newId(`track-${type}`),
      type,
      clips: [],
      ...DEFAULT_TRACK_MIX,
    },
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
  const clamped = Math.min(Math.max(0, toIndex), timeline.length - 1);
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
  durationS: number,
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
  label?: string,
): TimelineMarker[] {
  if (!finite(time) || time < 0) return markers as TimelineMarker[];
  const safeLabel = label?.trim() || `Marker ${markers.length + 1}`;
  return sortMarkers([
    ...markers,
    {
      id: newId('marker'),
      time,
      label: safeLabel,
    },
  ]);
}

export function deleteMarker(markers: readonly TimelineMarker[], markerId: string): TimelineMarker[] {
  const next = markers.filter((marker) => marker.id !== markerId);
  return next.length === markers.length ? (markers as TimelineMarker[]) : next;
}

export function sortMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((a, b) => {
    const timeDiff = a.time - b.time;
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

export { normalizeClipEffects, type ClipEffectParams };
export {
  DEFAULT_TRANSFORM,
  normalizeTransform,
  transformsEqual,
  type FitMode,
  type TransformParams,
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
  type TitleStyle,
} from './title';
