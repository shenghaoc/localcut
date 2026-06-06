import { describe, expect, it } from 'vitest';
import {
  invalidateSourceChange,
  invalidateTimelineEdit,
  invalidateTransitionEdit,
  rangesOverlap,
  transitionRange,
} from './cache-invalidation';
import {
  DEFAULT_TRACK_MIX,
  defaultTimelineClip,
  type Timeline,
  type TimelineTransition,
} from './timeline';

function clip(id: string, sourceId: string, start: number, duration: number) {
  return defaultTimelineClip({
    id,
    sourceId,
    start,
    duration,
    inPoint: 0,
  });
}

function timelineFixture(): Timeline {
  return [
    {
      id: 'track-1',
      type: 'video',
      ...DEFAULT_TRACK_MIX,
      clips: [clip('clip-a', 'source-a', 0, 5), clip('clip-b', 'source-b', 5, 5)],
    },
    {
      id: 'track-2',
      type: 'video',
      ...DEFAULT_TRACK_MIX,
      clips: [clip('clip-c', 'source-c', 2, 4)],
    },
  ];
}

describe('rangesOverlap', () => {
  it('detects overlapping ranges and ignores touching edges', () => {
    expect(rangesOverlap({ startS: 0, endS: 2 }, { startS: 1, endS: 3 })).toBe(true);
    expect(rangesOverlap({ startS: 0, endS: 2 }, { startS: 2, endS: 3 })).toBe(false);
  });
});

describe('invalidateTimelineEdit', () => {
  it('invalidates old and new spans for moved clips', () => {
    const before = timelineFixture();
    const after = timelineFixture();
    after[0]!.clips[0] = { ...after[0]!.clips[0]!, start: 8 };

    const invalidation = invalidateTimelineEdit(before, after);

    expect(invalidation.clipIds).toContain('clip-a');
    expect(invalidation.sourceIds).toContain('source-a');
    expect(invalidation.ranges).toEqual([
      { startS: 0, endS: 5 },
      { startS: 8, endS: 13 },
    ]);
  });

  it('invalidates the full timeline when track order changes', () => {
    const before = timelineFixture();
    const after = [before[1]!, before[0]!];

    const invalidation = invalidateTimelineEdit(before, after);

    expect(invalidation.fullTimeline).toBe(true);
    expect(invalidation.reasons).toContain('track-order');
    expect(invalidation.ranges).toEqual([{ startS: 0, endS: 10 }]);
  });
});

describe('transition invalidation', () => {
  const transition: TimelineTransition = {
    id: 'transition-1',
    trackId: 'track-1',
    fromClipId: 'clip-a',
    toClipId: 'clip-b',
    durationS: 2,
    kind: 'cross-dissolve',
    params: {},
  };

  it('computes centered transition windows', () => {
    expect(transitionRange(timelineFixture(), transition)).toEqual({ startS: 4, endS: 6 });
  });

  it('invalidates edited transition windows', () => {
    const invalidation = invalidateTransitionEdit(timelineFixture(), [transition], [{ ...transition, durationS: 3 }]);

    expect(invalidation.clipIds).toEqual(['clip-a', 'clip-b']);
    expect(invalidation.ranges).toEqual([{ startS: 3.5, endS: 6.5 }]);
    expect(invalidation.reasons).toContain('transition-edited');
  });
});

describe('invalidateSourceChange', () => {
  it('invalidates every timeline range using a relinked source', () => {
    const invalidation = invalidateSourceChange(timelineFixture(), 'source-c');

    expect(invalidation.sourceIds).toEqual(['source-c']);
    expect(invalidation.clipIds).toEqual(['clip-c']);
    expect(invalidation.ranges).toEqual([{ startS: 2, endS: 6 }]);
  });
});
