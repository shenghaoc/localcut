import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIP_AUDIO_FADES,
  DEFAULT_TRACK_MIX,
  defaultClipEffects,
  defaultClipTransform,
  type Timeline,
  type TimelineMarker,
} from './timeline';
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
          transform: defaultClipTransform(),
          ...DEFAULT_CLIP_AUDIO_FADES,
        },
      ],
    },
  ];
}

function makeSnapshot(label: string, markers: TimelineMarker[] = []) {
  return {
    timeline: makeTimeline(label),
    markers,
  };
}

describe('timeline history', () => {
  it('pushes snapshots and walks undo/redo without mutating stored entries', () => {
    let now = 0;
    const history = createTimelineHistory({ now: () => now });
    const base = makeSnapshot('base', [{ id: 'marker-a', time: 1, label: 'A' }]);
    const edited = makeSnapshot('edited', [{ id: 'marker-b', time: 2, label: 'B' }]);
    const final = makeSnapshot('final', [{ id: 'marker-c', time: 3, label: 'C' }]);

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
    history.push(makeSnapshot('one'));
    history.push(makeSnapshot('two'));
    history.push(makeSnapshot('three'));

    expect(history.size()).toEqual({ past: 2, future: 0 });
    expect(history.undo(makeSnapshot('current'))!.timeline[0]!.clips[0]!.id).toBe('three');
    expect(history.undo(makeSnapshot('three'))!.timeline[0]!.clips[0]!.id).toBe('two');
    expect(history.undo(makeSnapshot('two'))).toBeNull();
  });

  it('coalesces rapid effect edits with the same clip/key', () => {
    let now = 0;
    const history = createTimelineHistory({ coalesceWindowMs: 80, now: () => now });

    history.push(makeSnapshot('before-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 40;
    history.push(makeSnapshot('mid-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 40;
    history.push(makeSnapshot('late-drag'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });

    expect(history.size()).toEqual({ past: 1, future: 0 });
    expect(history.undo(makeSnapshot('after-drag'))!.timeline[0]!.clips[0]!.id).toBe('before-drag');
  });

  it('starts a new entry for a different effect key or idle gap', () => {
    let now = 0;
    const history = createTimelineHistory({ coalesceWindowMs: 80, now: () => now });

    history.push(makeSnapshot('one'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'saturation' },
    });
    now += 10;
    history.push(makeSnapshot('two'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'brightness' },
    });
    now += 100;
    history.push(makeSnapshot('three'), {
      coalesceKey: { clipId: 'clip-source-1', key: 'brightness' },
    });

    expect(history.size()).toEqual({ past: 3, future: 0 });
  });
});
