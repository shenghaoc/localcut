import { describe, expect, it } from 'vitest';
import {
  createEmptyTimeline,
  getTimelineDuration,
  removeClip,
  reorderClip,
  resolveAt,
  splitClipAt,
  trimClip,
  type TimelineTrack,
} from './timeline';

describe('timeline', () => {
  it('starts empty', () => {
    expect(createEmptyTimeline()).toEqual([]);
  });

  it('computes total duration from track end times', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [
          { id: 'a', sourceId: 'src-1', start: 2, duration: 3, inPoint: 0 },
          { id: 'b', sourceId: 'src-1', start: 10, duration: 4, inPoint: 1 },
        ],
      },
    ];
    expect(getTimelineDuration(timeline)).toBe(14);
  });

  it('resolves a timestamp into owning clip + source timestamp', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [
          { id: 'a', sourceId: 'src-1', start: 1, duration: 2, inPoint: 10 },
          { id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 20 },
        ],
      },
    ];

    const resolved = resolveAt(timeline, 5.2);
    expect(resolved).not.toBeNull();
    expect(resolved!.clip.id).toBe('b');
    expect(resolved!.sourceTime).toBeCloseTo(20.2);
  });

  it('does not resolve outside all clips', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [{ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }],
      },
    ];
    expect(resolveAt(timeline, 1)).toBeNull();
    expect(resolveAt(timeline, -1)).toBeNull();
    expect(resolveAt(timeline, Number.NaN)).toBeNull();
  });

  it('splits a clip at timeline time', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [{ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 100 }],
      },
    ];

    const next = splitClipAt(timeline, 'video-track', 4);
    expect(next[0]!.clips).toHaveLength(2);
    expect(next[0]!.clips[0]).toMatchObject({
      id: 'a',
      duration: 4,
      inPoint: 100,
    });
    expect(next[0]!.clips[1]).toMatchObject({
      id: expect.stringMatching(/^a-/),
      duration: 6,
      start: 4,
      inPoint: 104,
    });
  });

  it('does not split out of clip bounds', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [{ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 }],
      },
    ];
    expect(splitClipAt(timeline, 'video-track', -1)).toEqual(timeline);
    expect(splitClipAt(timeline, 'video-track', 10)).toEqual(timeline);
  });

  it('removes a clip and keeps sibling timing', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [
          { id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 },
          { id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 },
          { id: 'c', sourceId: 'src-1', start: 4, duration: 2, inPoint: 4 },
        ],
      },
    ];
    const next = removeClip(timeline, 'video-track', 'b');
    expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a', 'c']);
    expect(next[0]!.clips[1]).toMatchObject({ id: 'c', start: 4 });
  });

  it('reorders a clip across tracks at the target index', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [
          { id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 },
          { id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 },
        ],
      },
      {
        id: 'video-track-2',
        type: 'video',
        clips: [
          { id: 'c', sourceId: 'src-2', start: 0, duration: 3, inPoint: 0 },
          { id: 'd', sourceId: 'src-2', start: 3, duration: 1, inPoint: 3 },
        ],
      },
    ];

    const next = reorderClip(timeline, 'video-track', 'b', 'video-track-2', 1);
    expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a']);
    expect(next[1]!.clips.map((clip) => clip.id)).toEqual(['c', 'b', 'd']);
    expect(next[1]!.clips[1]).toMatchObject({
      id: 'b',
      start: 3, // follows c
      duration: 2,
    });
  });

  it('supports in/out trim boundaries as absolute timeline times', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [{ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 }],
      },
    ];

    const trimmedIn = trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 4 });
    expect(trimmedIn[0]!.clips[0]).toMatchObject({
      start: 4,
      inPoint: 103,
      duration: 7,
    });

    const trimmedOut = trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 6 });
    expect(trimmedOut[0]!.clips[0]).toMatchObject({
      duration: 5,
      start: 1,
      inPoint: 100,
    });
  });

  it('keeps no-op trims when time is on clip edges', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        clips: [{ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 }],
      },
    ];

    expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 1 })[0]!.clips[0]).toEqual(
      timeline[0]!.clips[0],
    );
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 11 })[0]!.clips[0]).toEqual(
      timeline[0]!.clips[0],
    );
  });
});
