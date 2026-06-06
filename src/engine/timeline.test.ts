import { describe, expect, it } from 'vitest';
import {
  addMarker,
  addTrack,
  closeGaps,
  createEmptyTimeline,
  DEFAULT_TRACK_MIX,
  deleteMarker,
  defaultClipEffects,
  defaultClipTransform,
  defaultTimelineClip,
  duplicateClips,
  resolveAllAt,
  setClipTransform,
  getTimelineDuration,
  insertClip,
  moveClips,
  moveClipTo,
  pasteClips,
  removeClip,
  removeTrack,
  reorderTrack,
  resolveAt,
  setClipDuration,
  setClipEffectParam,
  setClipAudioFade,
  setTrackPan,
  splitClipAt,
  trimClip,
  type TimelineClip,
  type TimelineTrack,
} from './timeline';

function clip(
  partial: Omit<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'> &
    Partial<Pick<TimelineClip, 'effects' | 'transform' | 'audioFadeIn' | 'audioFadeOut'>>,
): TimelineClip {
  return {
    effects: defaultClipEffects(),
    transform: defaultClipTransform(),
    audioFadeIn: 0,
    audioFadeOut: 0,
    ...partial,
  };
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

  it('moves a clip across compatible tracks to an absolute start without relayout', () => {
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
          clip({ id: 'c', sourceId: 'src-2', start: 1, duration: 2, inPoint: 0 }),
          clip({ id: 'd', sourceId: 'src-2', start: 8, duration: 1, inPoint: 3 }),
        ],
      },
    ];

    const next = moveClipTo(timeline, 'video-track', 'b', 'video-track-2', 4);
    expect(next[0]!.clips.map((clip) => clip.id)).toEqual(['a']);
    expect(next[1]!.clips.map((clip) => clip.id)).toEqual(['c', 'b', 'd']);
    expect(next[1]!.clips[0]).toMatchObject({ id: 'c', start: 1, duration: 2 });
    expect(next[1]!.clips[1]).toMatchObject({
      id: 'b',
      start: 4,
      duration: 2,
    });
    expect(next[1]!.clips[2]).toMatchObject({ id: 'd', start: 8, duration: 1 });
  });

  it('moves a clip within its own track while preserving gaps', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 4, duration: 2, inPoint: 0 }),
          clip({ id: 'c', sourceId: 'src-1', start: 9, duration: 1, inPoint: 0 }),
        ],
      },
    ];

    const next = moveClipTo(timeline, 'video-track', 'b', 'video-track', 2);
    expect(next[0]!.clips.map((clip) => [clip.id, clip.start])).toEqual([
      ['a', 0],
      ['b', 2],
      ['c', 9],
    ]);
  });

  it('rejects absolute moves that would overlap destination-track clips', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 4, duration: 2, inPoint: 0 }),
          clip({ id: 'c', sourceId: 'src-1', start: 7, duration: 2, inPoint: 0 }),
        ],
      },
    ];

    expect(moveClipTo(timeline, 'video-track', 'b', 'video-track', 6)).toBe(timeline);
    expect(resolveAt(timeline, 7.25)!.clip.id).toBe('c');
  });

  it('rejects moves across incompatible track types', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 })],
      },
      {
        id: 'audio-track',
        type: 'audio',
        ...DEFAULT_TRACK_MIX,
        clips: [],
      },
    ];

    expect(moveClipTo(timeline, 'video-track', 'a', 'audio-track', 3)).toBe(timeline);
  });

  it('closes gaps only through the explicit closeGaps operation', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 2, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 6, duration: 2, inPoint: 0 }),
        ],
      },
    ];

    expect(moveClipTo(timeline, 'video-track', 'b', 'video-track', 3)[0]!.clips[1]!.start).toBe(3);
    const closed = closeGaps(timeline, 'video-track');
    expect(closed[0]!.clips.map((clip) => clip.start)).toEqual([0, 2]);
  });

  it('moves a batch of clips as one validated placement', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 3, duration: 1, inPoint: 0 }),
          clip({ id: 'c', sourceId: 'src-1', start: 10, duration: 1, inPoint: 0 }),
        ],
      },
    ];

    const next = moveClips(timeline, [
      { trackId: 'video-track', clipId: 'a', toTrackId: 'video-track', toStart: 5 },
      { trackId: 'video-track', clipId: 'b', toTrackId: 'video-track', toStart: 8 },
    ]);
    expect(next[0]!.clips.map((item) => [item.id, item.start])).toEqual([
      ['a', 5],
      ['b', 8],
      ['c', 10],
    ]);

    expect(
      moveClips(timeline, [
        { trackId: 'video-track', clipId: 'a', toTrackId: 'video-track', toStart: 9.5 },
        { trackId: 'video-track', clipId: 'b', toTrackId: 'video-track', toStart: 11 },
      ]),
    ).toBe(timeline);
  });

  it('duplicates and pastes clips while preserving their relative offsets', () => {
    const timeline: TimelineTrack[] = [
      {
        id: 'video-track',
        type: 'video',
        ...DEFAULT_TRACK_MIX,
        clips: [
          clip({ id: 'a', sourceId: 'src-1', start: 0, duration: 1, inPoint: 0 }),
          clip({ id: 'b', sourceId: 'src-1', start: 3, duration: 1, inPoint: 0 }),
        ],
      },
    ];

    const duplicated = duplicateClips(timeline, [
      { trackId: 'video-track', clipId: 'a' },
      { trackId: 'video-track', clipId: 'b' },
    ]);
    expect(duplicated[0]!.clips.map((item) => item.start)).toEqual([0, 3, 4, 7]);
    // Duplicated clips get exactly one fresh id segment appended to the source
    // id (e.g. "a-<uuid>"), not a compounded "a-<uuid>-<uuid>" from cloning twice.
    const dupIds = [duplicated[0]!.clips[2]!.id, duplicated[0]!.clips[3]!.id];
    expect(dupIds[0]!.startsWith('a-')).toBe(true);
    expect(dupIds[1]!.startsWith('b-')).toBe(true);
    // A single appended UUID yields 6 dash-separated segments; a compounded id
    // would have 11.
    expect(dupIds[0]!.split('-')).toHaveLength(6);
    expect(dupIds[1]!.split('-')).toHaveLength(6);
    expect(new Set(dupIds).size).toBe(2);

    const pasted = pasteClips(
      timeline,
      [
        { trackId: 'video-track', clip: timeline[0]!.clips[0]! },
        { trackId: 'video-track', clip: timeline[0]!.clips[1]! },
      ],
      10,
    );
    expect(pasted[0]!.clips.map((item) => item.start)).toEqual([0, 3, 10, 13]);
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
    expect(moveClipTo(timeline, 'video-track', 'missing', 'video-track', 0)).toBe(timeline);
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

  it('adds, sorts, and deletes timeline markers', () => {
    const markers = addMarker(
      [{ id: 'marker-existing', time: 8, label: 'Existing' }],
      2,
      'Intro',
    );
    expect(markers.map((marker) => marker.label)).toEqual(['Intro', 'Existing']);
    expect(markers[0]!.id).toMatch(/^marker-/);

    const deleted = deleteMarker(markers, markers[0]!.id);
    expect(deleted).toEqual([{ id: 'marker-existing', time: 8, label: 'Existing' }]);
    expect(deleteMarker(deleted, 'missing')).toBe(deleted);
  });
});

describe('timeline tracks', () => {
  function videoTrack(id: string, clips: TimelineClip[] = []): TimelineTrack {
    return { id, type: 'video', ...DEFAULT_TRACK_MIX, clips };
  }

  it('adds an empty track of the requested type with default mix', () => {
    const next = addTrack(createEmptyTimeline(), 'audio');
    expect(next).toHaveLength(1);
    expect(next[0]!.type).toBe('audio');
    expect(next[0]!.clips).toEqual([]);
    expect(next[0]!).toMatchObject(DEFAULT_TRACK_MIX);
    expect(next[0]!.id).toMatch(/^track-audio-/);
  });

  it('removes a track and returns the original on a missing id', () => {
    const timeline = [videoTrack('a'), videoTrack('b')];
    expect(removeTrack(timeline, 'a').map((t) => t.id)).toEqual(['b']);
    expect(removeTrack(timeline, 'missing')).toBe(timeline);
  });

  it('reorders tracks within bounds and is a no-op otherwise', () => {
    const timeline = [videoTrack('a'), videoTrack('b'), videoTrack('c')];
    expect(reorderTrack(timeline, 'c', 0).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(reorderTrack(timeline, 'a', 99).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(reorderTrack(timeline, 'a', 0)).toBe(timeline);
    expect(reorderTrack(timeline, 'missing', 1)).toBe(timeline);
  });

  it('inserts a clip when there is room and rejects overlaps', () => {
    const timeline = [
      videoTrack('v', [
        defaultTimelineClip({ id: 'a', sourceId: 's', start: 0, duration: 2, inPoint: 0 }),
      ]),
    ];
    const placed = insertClip(
      timeline,
      'v',
      defaultTimelineClip({ id: 'b', sourceId: 's', start: 3, duration: 2, inPoint: 0 }),
    );
    expect(placed[0]!.clips.map((c) => c.id)).toEqual(['a', 'b']);

    const overlapping = insertClip(
      timeline,
      'v',
      defaultTimelineClip({ id: 'c', sourceId: 's', start: 1, duration: 2, inPoint: 0 }),
    );
    expect(overlapping).toBe(timeline);
    expect(insertClip(timeline, 'missing', defaultTimelineClip({ id: 'd', sourceId: 's', start: 9, duration: 1, inPoint: 0 }))).toBe(timeline);
  });

  it('sets still clip duration, bounded by the next neighbor', () => {
    const timeline = [
      videoTrack('v', [
        defaultTimelineClip({ id: 'still', sourceId: 'img', start: 0, duration: 5, inPoint: 0 }),
        defaultTimelineClip({ id: 'next', sourceId: 's', start: 8, duration: 2, inPoint: 0 }),
      ]),
    ];
    const grown = setClipDuration(timeline, 'v', 'still', 6);
    expect(grown[0]!.clips[0]!.duration).toBe(6);

    // Clamps to the gap before the next clip (start 8 - start 0).
    const clamped = setClipDuration(timeline, 'v', 'still', 20);
    expect(clamped[0]!.clips[0]!.duration).toBe(8);

    expect(setClipDuration(timeline, 'v', 'still', 0)).toBe(timeline);
    expect(setClipDuration(timeline, 'v', 'still', 5)).toBe(timeline);
  });

  describe('resolveAllAt', () => {
    function stack(): TimelineTrack[] {
      return [
        {
          id: 'video-base',
          type: 'video',
          ...DEFAULT_TRACK_MIX,
          clips: [clip({ id: 'base', sourceId: 's1', start: 0, duration: 10, inPoint: 5 })],
        },
        {
          id: 'audio',
          type: 'audio',
          ...DEFAULT_TRACK_MIX,
          clips: [clip({ id: 'aud', sourceId: 's1', start: 0, duration: 10, inPoint: 0 })],
        },
        {
          id: 'video-top',
          type: 'video',
          ...DEFAULT_TRACK_MIX,
          clips: [clip({ id: 'pip', sourceId: 's2', start: 2, duration: 3, inPoint: 1 })],
        },
      ];
    }

    it('returns overlapping video layers bottom-to-top, skipping audio', () => {
      const layers = resolveAllAt(stack(), 3);
      expect(layers.map((l) => l.clip.id)).toEqual(['base', 'pip']);
      expect(layers[0]!.sourceTime).toBeCloseTo(8); // base inPoint 5 + (3 - 0)
      expect(layers[1]!.sourceTime).toBeCloseTo(2); // pip inPoint 1 + (3 - 2)
    });

    it('returns only the base layer outside the overlap window', () => {
      const layers = resolveAllAt(stack(), 7);
      expect(layers.map((l) => l.clip.id)).toEqual(['base']);
    });

    it('returns nothing in a gap or before zero', () => {
      expect(resolveAllAt(stack(), 50)).toEqual([]);
      expect(resolveAllAt(stack(), -1)).toEqual([]);
    });
  });

  describe('setClipTransform', () => {
    function withClip(): TimelineTrack[] {
      return [
        {
          id: 'v',
          type: 'video',
          ...DEFAULT_TRACK_MIX,
          clips: [clip({ id: 'a', sourceId: 's', start: 0, duration: 5, inPoint: 0 })],
        },
      ];
    }

    it('merges a partial transform and normalizes it', () => {
      const next = setClipTransform(withClip(), 'v', 'a', { scale: 0.5, opacity: 2 });
      expect(next[0]!.clips[0]!.transform.scale).toBe(0.5);
      expect(next[0]!.clips[0]!.transform.opacity).toBe(1);
    });

    it('returns the original timeline on no-op and unknown clips', () => {
      const timeline = withClip();
      expect(setClipTransform(timeline, 'v', 'a', { scale: 1 })).toBe(timeline);
      expect(setClipTransform(timeline, 'v', 'missing', { scale: 0.5 })).toBe(timeline);
    });
  });
});
