import { describe, expect, it } from 'vitest';
import type { TimelineTrackSnapshot } from '../protocol';
import {
  buildSnapTargets,
  resolveSnap,
  selectClipsInMarquee,
  timelineTimeAtClientX,
} from './timeline-interaction';

function timelineFixture(): TimelineTrackSnapshot[] {
  return [
    {
      id: 'video-track',
      type: 'video',
      gain: 1,
      pan: 0,
      muted: false,
      solo: false,
      clips: [
        {
          id: 'a',
          sourceId: 'source-1',
          start: 2,
          duration: 3,
          inPoint: 0,
          effects: {
            brightness: 0,
            contrast: 1,
            saturation: 1,
            temperature: 6500,
            temperatureStrength: 1,
          },
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            fit: 'fill',
          },
          audioFadeIn: 0,
          audioFadeOut: 0,
        },
        {
          id: 'b',
          sourceId: 'source-1',
          start: 8,
          duration: 2,
          inPoint: 3,
          effects: {
            brightness: 0,
            contrast: 1,
            saturation: 1,
            temperature: 6500,
            temperatureStrength: 1,
          },
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            fit: 'fill',
          },
          audioFadeIn: 0,
          audioFadeOut: 0,
        },
      ],
    },
  ];
}

describe('timeline interaction helpers', () => {
  it('builds snap targets from clips, markers, playhead, and zero', () => {
    const targets = buildSnapTargets(
      timelineFixture(),
      [{ id: 'marker-1', time: 6, label: 'Beat' }],
      4,
    );

    expect(targets.map((target) => [target.kind, target.time])).toEqual([
      ['zero', 0],
      ['playhead', 4],
      ['marker', 6],
      ['clip-start', 2],
      ['clip-end', 5],
      ['clip-start', 8],
      ['clip-end', 10],
    ]);
  });

  it('snaps to the nearest model target within the pixel threshold', () => {
    const targets = buildSnapTargets(timelineFixture(), [], 4);

    expect(resolveSnap(4.08, 100, targets, 10)).toMatchObject({
      time: 4,
      snapped: true,
      target: { kind: 'playhead' },
    });
    expect(resolveSnap(4.2, 100, targets, 10)).toMatchObject({
      time: 4.2,
      snapped: false,
      target: null,
    });
  });

  it('maps client x to timeline seconds from the scrolled content edge', () => {
    expect(timelineTimeAtClientX(240, 40, 100)).toBe(2);
    expect(timelineTimeAtClientX(20, 40, 100)).toBe(0);
  });

  it('selects clips intersecting a marquee time range on selected tracks', () => {
    expect(
      selectClipsInMarquee(timelineFixture(), {
        startTime: 4.5,
        endTime: 8.5,
        trackIds: ['video-track'],
      }),
    ).toEqual([
      { trackId: 'video-track', clipId: 'a' },
      { trackId: 'video-track', clipId: 'b' },
    ]);
  });
});
