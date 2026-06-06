import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIP_EFFECTS } from './effects';
import { DEFAULT_TRANSFORM } from './transform';
import {
  deleteKeyframe,
  insertKeyframe,
  moveKeyframe,
  sampleClipParamsAt,
  sampleKeyframes,
  type Keyframe,
} from './keyframes';
import { defaultTimelineClip, setClipKeyframe, type Timeline } from './timeline';

describe('keyframes', () => {
  it('inserts sorted keyframes and replaces matching timestamps', () => {
    const track = insertKeyframe(
      [
        { t: 2, value: 20, easing: 'linear' },
        { t: 0, value: 0, easing: 'linear' },
      ],
      { t: 1, value: 10, easing: 'ease' },
    );
    expect(track.map((frame) => frame.t)).toEqual([0, 1, 2]);
    const replaced = insertKeyframe(track, { t: 1, value: 12, easing: 'hold' });
    expect(replaced).toHaveLength(3);
    expect(replaced[1]).toEqual({ t: 1, value: 12, easing: 'hold' });
  });

  it('moves and deletes keyframes without mutating the input track', () => {
    const original: Keyframe[] = [
      { t: 0, value: 0, easing: 'linear' },
      { t: 2, value: 1, easing: 'linear' },
    ];
    expect(moveKeyframe(original, 2, 1).map((frame) => frame.t)).toEqual([0, 1]);
    expect(deleteKeyframe(original, 0).map((frame) => frame.t)).toEqual([2]);
    expect(original.map((frame) => frame.t)).toEqual([0, 2]);
  });

  it('samples linear, ease, and hold interpolation', () => {
    expect(
      sampleKeyframes(
        [
          { t: 0, value: 0, easing: 'linear' },
          { t: 2, value: 10, easing: 'linear' },
        ],
        1,
        99,
      ),
    ).toBeCloseTo(5);
    expect(
      sampleKeyframes(
        [
          { t: 0, value: 0, easing: 'ease' },
          { t: 2, value: 10, easing: 'linear' },
        ],
        0.5,
        99,
      ),
    ).toBeCloseTo(1.5625);
    expect(
      sampleKeyframes(
        [
          { t: 0, value: 0, easing: 'hold' },
          { t: 2, value: 10, easing: 'linear' },
        ],
        1.5,
        99,
      ),
    ).toBe(0);
  });

  it('samples clip effect and transform params at the shared timeline timestamp', () => {
    const clip = defaultTimelineClip({
      id: 'clip-a',
      sourceId: 'source-a',
      start: 5,
      duration: 4,
      inPoint: 0,
      effects: { ...DEFAULT_CLIP_EFFECTS, brightness: 0 },
      transform: { ...DEFAULT_TRANSFORM, x: 0 },
      keyframes: {
        brightness: [
          { t: 0, value: 0, easing: 'linear' },
          { t: 4, value: 1, easing: 'linear' },
        ],
        x: [
          { t: 0, value: -0.5, easing: 'linear' },
          { t: 4, value: 0.5, easing: 'linear' },
        ],
      },
    });

    const previewSample = sampleClipParamsAt(clip, 7);
    const exportSample = sampleClipParamsAt(clip, 7);
    expect(previewSample.effects.brightness).toBeCloseTo(0.5);
    expect(previewSample.transform.x).toBeCloseTo(0);
    expect(exportSample).toEqual(previewSample);
  });

  it('stores keyframe command times clip-local', () => {
    const timeline: Timeline = [
      {
        id: 'track-video',
        type: 'video',
        gain: 1,
        pan: 0,
        muted: false,
        solo: false,
        clips: [
          defaultTimelineClip({
            id: 'clip-a',
            sourceId: 'source-a',
            start: 10,
            duration: 5,
            inPoint: 0,
          }),
        ],
      },
    ];

    const next = setClipKeyframe(timeline, 'track-video', 'clip-a', 'opacity', 12, 0.5, 'linear');
    expect(next[0]!.clips[0]!.keyframes?.opacity).toEqual([{ t: 2, value: 0.5, easing: 'linear' }]);
  });
});
