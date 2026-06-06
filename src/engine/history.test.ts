import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_MIX, defaultClipEffects, type Timeline } from './timeline';
import { createTimelineHistory } from './history';

function makeTimeline(label: string): Timeline {
  return [
    {
      id: 'track-video-source-1',
      type: 'video',
      ...DEFAULT_TRACK_MIX,
      clips: [
        {
          id: label,
          sourceId: 'source-1',
          start: 0,
          duration: 5,
          inPoint: 0,
          effects: defaultClipEffects(),
        },
      ],
    },
  ];
}

describe('timeline history', () => {
  it('pushes snapshots and walks undo/redo without mutating stored entries', () => {
    let now = 0;
    const history = createTimelineHistory({ now: () => now });
    const base = makeTimeline('base');
    const edited = makeTimeline('edited');
    const final = makeTimeline('final');

    history.push(base);
    now += 100;
    history.push(edited);

    expect(history.state()).toEqual({ canUndo: true, canRedo: false });
    expect(history.undo(final)).toEqual(edited);
    expect(history.undo(edited)).toEqual(base);
    expect(history.state()).toEqual({ canUndo: false, canRedo: true });
    expect(history.redo(base)).toEqual(edited);
  });

  it('caps the undo stack', () => {
    const history = createTimelineHistory({ limit: 2 });
    history.push(makeTimeline('one'));
    history.push(makeTimeline('two'));
    history.push(makeTimeline('three'));

    expect(history.size()).toEqual({ past: 2, future: 0 });
    expect(history.undo(makeTimeline('current'))![0]!.clips[0]!.id).toBe('three');
    expect(history.undo(makeTimeline('three'))![0]!.clips[0]!.id).toBe('two');
    expect(history.undo(makeTimeline('two'))).toBeNull();
  });

  it('coalesces rapid effect edits with the same clip/key', () => {
    let now = 0;
    const history = createTimelineHistory({ coalesceWindowMs: 80, now: () => now });

    history.push(makeTimeline('before-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 40;
    history.push(makeTimeline('mid-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 40;
    history.push(makeTimeline('late-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });

    expect(history.size()).toEqual({ past: 1, future: 0 });
    expect(history.undo(makeTimeline('after-drag'))![0]!.clips[0]!.id).toBe('before-drag');
  });

  it('starts a new entry for a different effect key or idle gap', () => {
    let now = 0;
    const history = createTimelineHistory({ coalesceWindowMs: 80, now: () => now });

    history.push(makeTimeline('one'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 10;
    history.push(makeTimeline('two'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'brightness' },
    });
    now += 100;
    history.push(makeTimeline('three'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'brightness' },
    });

    expect(history.size()).toEqual({ past: 3, future: 0 });
  });
});
