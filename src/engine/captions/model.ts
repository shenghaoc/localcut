import type { TimelineMarker } from '../timeline';
import type { TimelineTrack } from '../timeline';
import {
  CAPTION_PRESETS,
  captionSegmentEnd,
  cloneCaptionTrack,
  createCaptionTrack,
  DEFAULT_CAPTION_STYLE,
  effectiveCaptionStyle,
  normalizeCaptionSegment,
  normalizeCaptionStyle,
  sortCaptionSegments,
  type CaptionSegment,
  type CaptionStyle,
  type CaptionTrack,
} from './types';

export interface CaptionSnapTarget {
  time: number;
  label: string;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function cloneCaptionTracks(tracks: readonly CaptionTrack[]): CaptionTrack[] {
  return tracks.map(cloneCaptionTrack);
}

export function makeCaptionTrackId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `caption-track-${crypto.randomUUID()}`;
  }
  return `caption-track-${Math.random().toString(36).slice(2)}`;
}

export function makeCaptionSegmentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `caption-segment-${crypto.randomUUID()}`;
  }
  return `caption-segment-${Math.random().toString(36).slice(2)}`;
}

function findTrackIndex(tracks: readonly CaptionTrack[], trackId: string): number {
  return tracks.findIndex((track) => track.id === trackId);
}

function findSegmentIndex(track: CaptionTrack, segmentId: string): number {
  return track.segments.findIndex((segment) => segment.id === segmentId);
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function upsertCaptionTrack(
  tracks: readonly CaptionTrack[],
  track: CaptionTrack,
): CaptionTrack[] {
  const next = cloneCaptionTracks(tracks);
  const index = findTrackIndex(next, track.id);
  if (index >= 0) {
    next[index] = cloneCaptionTrack(track);
  } else {
    next.push(cloneCaptionTrack(track));
  }
  return next;
}

export function setCaptionTrackProps(
  tracks: readonly CaptionTrack[],
  trackId: string,
  patch: Partial<Pick<CaptionTrack, 'name' | 'language' | 'burnedIn' | 'visible'>> & {
    defaultStyle?: Partial<CaptionStyle>;
  },
): CaptionTrack[] {
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const track = next[trackIndex]!;
  let defaultStyle = track.defaultStyle;
  if (patch.defaultStyle) {
    const stylePatch = patch.defaultStyle;
    const presetChanged = hasOwn(stylePatch, 'presetId') && stylePatch.presetId !== track.defaultStyle.presetId;
    const nextPresetId =
      stylePatch.presetId === 'subtitle' || stylePatch.presetId === 'lower-third' || stylePatch.presetId === 'note'
        ? stylePatch.presetId
        : (DEFAULT_CAPTION_STYLE.presetId ?? 'subtitle');
    const presetDefaults = presetChanged ? CAPTION_PRESETS[nextPresetId] : null;
    defaultStyle = {
      ...track.defaultStyle,
      ...(presetDefaults
        ? {
            anchor: presetDefaults.anchor,
            maxWidthPercent: presetDefaults.maxWidthPercent,
            lineWrap: presetDefaults.lineWrap,
          }
        : {}),
      ...stylePatch,
      overrides: stylePatch.overrides
        ? { ...(track.defaultStyle.overrides ?? {}), ...stylePatch.overrides }
        : track.defaultStyle.overrides,
    };
  }
  next[trackIndex] = createCaptionTrack({
    ...track,
    name: patch.name ?? track.name,
    language: hasOwn(patch, 'language') ? (patch.language ?? null) : track.language,
    burnedIn: patch.burnedIn ?? track.burnedIn,
    visible: patch.visible ?? track.visible,
    segments: track.segments,
    defaultStyle,
  });
  return next;
}

export function setCaptionSegmentText(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentId: string,
  text: string,
): CaptionTrack[] {
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const segmentIndex = findSegmentIndex(next[trackIndex]!, segmentId);
  if (segmentIndex < 0) return tracks as CaptionTrack[];
  next[trackIndex]!.segments[segmentIndex] = {
    ...next[trackIndex]!.segments[segmentIndex]!,
    text,
  };
  next[trackIndex]!.segments = sortCaptionSegments(next[trackIndex]!.segments);
  return next;
}

export function setCaptionSegmentStyle(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentId: string,
  style: Partial<CaptionStyle>,
): CaptionTrack[] {
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const segmentIndex = findSegmentIndex(next[trackIndex]!, segmentId);
  if (segmentIndex < 0) return tracks as CaptionTrack[];
  const segment = next[trackIndex]!.segments[segmentIndex]!;
  const baseStyle = segment.style ?? next[trackIndex]!.defaultStyle;
  next[trackIndex]!.segments[segmentIndex] = {
    ...segment,
    style: normalizeCaptionStyle({
      ...baseStyle,
      ...style,
      overrides: style.overrides
        ? { ...(baseStyle.overrides ?? {}), ...style.overrides }
        : baseStyle.overrides,
    }),
  };
  return next;
}

export function setCaptionSegmentTiming(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentId: string,
  start: number,
  end: number,
): CaptionTrack[] {
  if (!finite(start) || !finite(end) || end <= start) return tracks as CaptionTrack[];
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const segmentIndex = findSegmentIndex(next[trackIndex]!, segmentId);
  if (segmentIndex < 0) return tracks as CaptionTrack[];
  next[trackIndex]!.segments[segmentIndex] = normalizeCaptionSegment({
    ...next[trackIndex]!.segments[segmentIndex]!,
    start,
    duration: end - start,
  });
  next[trackIndex]!.segments = sortCaptionSegments(next[trackIndex]!.segments);
  return next;
}

export function deleteCaptionSegments(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentIds: readonly string[],
): CaptionTrack[] {
  const ids = new Set(segmentIds);
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  next[trackIndex]!.segments = next[trackIndex]!.segments.filter((segment) => !ids.has(segment.id));
  return next;
}

export function splitCaptionSegment(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentId: string,
  time: number,
): CaptionTrack[] {
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const segmentIndex = findSegmentIndex(next[trackIndex]!, segmentId);
  if (segmentIndex < 0) return tracks as CaptionTrack[];
  const segment = next[trackIndex]!.segments[segmentIndex]!;
  if (time <= segment.start || time >= captionSegmentEnd(segment)) return tracks as CaptionTrack[];
  const leftDuration = time - segment.start;
  const rightDuration = captionSegmentEnd(segment) - time;
  const pieces = segment.text.split(/\s+/);
  const pivot = Math.max(1, Math.floor(pieces.length / 2));
  const leftText = pieces.slice(0, pivot).join(' ');
  const rightText = pieces.slice(pivot).join(' ');
  next[trackIndex]!.segments.splice(
    segmentIndex,
    1,
    { ...segment, duration: leftDuration, text: leftText },
    { ...segment, id: makeCaptionSegmentId(), start: time, duration: rightDuration, text: rightText },
  );
  next[trackIndex]!.segments = sortCaptionSegments(next[trackIndex]!.segments);
  return next;
}

export function mergeCaptionSegments(
  tracks: readonly CaptionTrack[],
  trackId: string,
  segmentIds: readonly string[],
): CaptionTrack[] {
  if (segmentIds.length < 2) return tracks as CaptionTrack[];
  const next = cloneCaptionTracks(tracks);
  const trackIndex = findTrackIndex(next, trackId);
  if (trackIndex < 0) return tracks as CaptionTrack[];
  const selected = next[trackIndex]!.segments.filter((segment) => segmentIds.includes(segment.id));
  if (selected.length < 2) return tracks as CaptionTrack[];
  selected.sort((a, b) => a.start - b.start);
  const merged: CaptionSegment = {
    id: selected[0]!.id,
    start: selected[0]!.start,
    duration: captionSegmentEnd(selected[selected.length - 1]!) - selected[0]!.start,
    text: selected.map((segment) => segment.text.trim()).join('\n'),
    style: selected[0]!.style,
  };
  next[trackIndex]!.segments = next[trackIndex]!.segments.filter((segment) => !segmentIds.includes(segment.id));
  next[trackIndex]!.segments.push(merged);
  next[trackIndex]!.segments = sortCaptionSegments(next[trackIndex]!.segments);
  return next;
}

export function buildCaptionSnapTargets(
  timeline: readonly TimelineTrack[],
  markers: readonly TimelineMarker[],
  captionTracks: readonly CaptionTrack[],
  playheadTime: number,
  trackId: string,
  excludeSegmentIds: readonly string[] = [],
): CaptionSnapTarget[] {
  const targets: CaptionSnapTarget[] = [{ time: 0, label: 'Start' }, { time: playheadTime, label: 'Playhead' }];
  for (const marker of markers) targets.push({ time: marker.time, label: marker.label });
  for (const track of timeline) {
    for (const clip of track.clips) {
      targets.push({ time: clip.start, label: clip.id });
      targets.push({ time: clip.start + clip.duration, label: clip.id });
    }
  }
  const excluded = new Set(excludeSegmentIds);
  for (const track of captionTracks) {
    if (track.id !== trackId) continue;
    for (const segment of track.segments) {
      if (excluded.has(segment.id)) continue;
      targets.push({ time: segment.start, label: segment.id });
      targets.push({ time: captionSegmentEnd(segment), label: segment.id });
    }
  }
  return targets.filter((target) => finite(target.time) && target.time >= 0);
}

export function snapCaptionTime(time: number, targets: readonly CaptionSnapTarget[], thresholdS = 0.1): number {
  let best = time;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const delta = Math.abs(target.time - time);
    if (delta <= thresholdS && delta < distance) {
      best = target.time;
      distance = delta;
    }
  }
  return best;
}

export function activeCaptionSegmentAt(track: CaptionTrack, time: number): CaptionSegment | null {
  for (const segment of track.segments) {
    if (segment.start > time) break;
    if (time >= segment.start && time < captionSegmentEnd(segment)) return segment;
  }
  return null;
}

export function activeCaptionSegmentsAt(tracks: readonly CaptionTrack[], time: number): Array<{ track: CaptionTrack; segment: CaptionSegment }> {
  const active: Array<{ track: CaptionTrack; segment: CaptionSegment }> = [];
  for (const track of tracks) {
    if (!track.visible || !track.burnedIn) continue;
    const segment = activeCaptionSegmentAt(track, time);
    if (segment) active.push({ track, segment });
  }
  return active;
}

export function resolvedCaptionStyle(track: CaptionTrack, segment: CaptionSegment): CaptionStyle {
  return effectiveCaptionStyle(track.defaultStyle, segment.style);
}
