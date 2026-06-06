import { describe, expect, it } from 'vitest';
import {
  createEmptyTimeline,
  DEFAULT_TRACK_MIX,
  defaultClipEffects,
  getTimelineDuration,
  removeClip,
  reorderClip,
  resolveAt,
  setClipEffectParam,
  setClipAudioFade,
  setTrackPan,
  splitClipAt,
  trimClip,
  type TimelineClip,
  type TimelineTrack,
} from './timeline';

function clip(
  partial: Omit<TimelineClip, 'effects' | 'audioFadeIn' | 'audioFadeOut'> &
    Partial<Pick<TimelineClip, 'effects' | 'audioFadeIn' | 'audioFadeOut'>>,
): TimelineClip {
  return { effects: defaultClipEffects(), audioFadeIn: 0, audioFadeOut: 0, ...partial };
}

describe('timeline', () => {
  it('starts empty', () => {
    expect(createEmptyTimeline()).toEqual([]);
  });

  it('computes total duration from track end times', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 2, duration: 3, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 10, duration: 4, inPoint: 1 }),
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
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 2, inPoint: 10 }),
          clip({ id: 'b', sourceId: 'src-1', start: 5, duration: 3, inPoint: 20 }),
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
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 })],
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
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 100 })],
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
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 })],
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
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 }),
          clip({ id: 'c', sourceId: 'src-1', start: 4, duration: 2, inPoint: 4 }),
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
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 2, duration: 2, inPoint: 2 }),
        ],
      },
      {
        id: 'video-track-2',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'c', sourceId: 'src-2', start: 0, duration: 3, inPoint: 0 }),
          clip({ id: 'd', sourceId: 'src-2', start: 3, duration: 1, inPoint: 3 }),
        ],
      },
    ];

    const next = reorderClip(timeline, 'video-track', 'b', 'video-track-2', 1);
    expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a']);
    expect(next[1]!.clips.map((clip) => clip.id)).toEqual(['c', 'b', 'd']);
    expect(next[1]!.clips[0]).toMatchObject({ id: 'c', start: 0, duration: 3 });
    expect(next[1]!.clips[1]).toMatchObject({
      id: 'b',
      start: 3, // follows c
      duration: 2,
    });
    // d must shift past the inserted clip instead of overlapping it at start 3.
    expect(next[1]!.clips[2]).toMatchObject({ id: 'd', start: 5, duration: 1 });
  });

  it('moves a clip to the end of its own track without overlap', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 1, duration: 1, inPoint: 0 }),
          clip({ id: 'c', sourceId: 'src-1', start: 2, duration: 1, inPoint: 0 }),
        ],
      },
    ];

    // Drop past the last clip -> toIndex === clips.length.
    const next = reorderClip(timeline, 'video-track', 'a', 'video-track', 3);
    expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['b', 'c', 'a']);
    expect(next[0]!.clips.map((clip) => clip.start)).toEqual([0, 1, 2]);
  });

  it('returns the original timeline reference on no-op edits', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 10, inPoint: 0 })],
      },
    ];
    expect(splitClipAt(timeline, 'video-track', 10)).toBe(timeline);
    expect(removeClip(timeline, 'video-track', 'missing')).toBe(timeline);
    expect(reorderClip(timeline, 'video-track', 'missing', 'video-track', 0)).toBe(timeline);
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 0 })).toBe(timeline);
  });

  it('supports in/out trim boundaries as absolute timeline times', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 })],
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

  it('extends the in-edge backward when the source has earlier content', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 5, duration: 5, inPoint: 100 })],
      },
    ];
    // Drag the in-edge from t=5 back to t=3; source-time 98 still in bounds.
    const next = trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 3, sourceDuration: 200 });
    expect(next[0]!.clips[0]).toMatchObject({ start: 3, duration: 7, inPoint: 98 });
  });

  it('refuses an in-edge extension that would require negative source time', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 2 })],
      },
    ];
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: -3, sourceDuration: 200 })).toBe(timeline);
  });

  it('extends the out-edge forward up to the source duration', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 10 })],
      },
    ];
    // Source ends at 20; clip uses inPoint=10, so out can extend to t=0+(20-10)=10.
    const next = trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 9, sourceDuration: 20 });
    expect(next[0]!.clips[0]).toMatchObject({ start: 0, duration: 9, inPoint: 10 });
  });

  it('refuses an out-edge extension that would overlap the next same-track clip', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 8, duration: 2, inPoint: 0 }),
        ],
      },
    ];
    // Source has plenty of headroom but the neighbor would be shadowed.
    expect(
      trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 9, sourceDuration: 100 }),
    ).toBe(timeline);
    // Extending exactly up to the neighbor's start is OK.
    const next = trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 8, sourceDuration: 100 });
    expect(next[0]!.clips[0]).toMatchObject({ start: 0, duration: 8 });
  });

  it('refuses an in-edge extension that would overlap the previous same-track clip', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 8, duration: 5, inPoint: 10 }),
        ],
      },
    ];
    // Pulling b's in-edge back to t=4 would overlap a (which ends at 5).
    expect(
      trimClip(timeline, 'video-track', 'b', { edge: 'in', time: 4, sourceDuration: 100 }),
    ).toBe(timeline);
    // Pulling back to exactly t=5 (touching a's out-edge) is OK.
    const next = trimClip(timeline, 'video-track', 'b', { edge: 'in', time: 5, sourceDuration: 100 });
    expect(next[0]!.clips[1]).toMatchObject({ start: 5, duration: 8, inPoint: 7 });
  });

  it('refuses an out-edge extension past the source duration', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 10 })],
      },
    ];
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 15, sourceDuration: 20 })).toBe(timeline);
  });

  it('without sourceDuration, refuses to extend past the current clip end', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 })],
      },
    ];
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 10 })).toBe(timeline);
  });

  it('updates one effect param on a clip', () => {
    const custom = { ...defaultClipEffects(), saturation: 1.4 };
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0, effects: custom })],
      },
    ];

    const next = setClipEffectParam(timeline, 'video-track', 'a', 'saturation', 0.6);
    expect(next).not.toBe(timeline);
    expect(next[0]!.clips[0]!.effects.saturation).toBeCloseTo(0.6);
    expect(timeline[0]!.clips[0]!.effects.saturation).toBeCloseTo(1.4);
    expect(setClipEffectParam(timeline, 'video-track', 'a', 'saturation', 1.4)).toBe(timeline);
  });

  it('keeps no-op trims when time is on clip edges', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 1, duration: 10, inPoint: 100 })],
      },
    ];

    expect(trimClip(timeline, 'video-track', 'a', { edge: 'in', time: 1 })[0]!.clips[0]).toEqual(
      timeline[0]!.clips[0],
    );
    expect(trimClip(timeline, 'video-track', 'a', { edge: 'out', time: 11 })[0]!.clips[0]).toEqual(
      timeline[0]!.clips[0],
    );
  });

  it('updates track pan within the legal range', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'audio-track',
        type: 'audio',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 5, inPoint: 0 })],
      },
    ];

    const next = setTrackPan(timeline, 'audio-track', -0.75);
    expect(next[0]!.pan).toBeCloseTo(-0.75);
    expect(setTrackPan(next, 'audio-track', -0.75)).toBe(next);
    expect(setTrackPan(timeline, 'audio-track', 2)).toBe(timeline);
  });

  it('updates clip audio fades without exceeding clip duration', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'audio-track',
        type: 'audio',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 })],
      },
    ];

    const next = setClipAudioFade(timeline, 'audio-track', 'a', 'in', 0.5);
    expect(next[0]!.clips[0]!.audioFadeIn).toBeCloseTo(0.5);
    expect(setClipAudioFade(timeline, 'audio-track', 'a', 'out', 3)).toBe(timeline);
  });
});
