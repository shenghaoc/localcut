import { describe, expect, it } from 'vitest';
import {
  applyMasterAndClamp,
  applyMixStage,
  applyMixStageInPlace,
  computeClipFadeGain,
  equalPowerCrossfadeGains,
  equalPowerPanLaw,
  mixPreviewExportFixture,
} from './audio-mix';

describe('equalPowerPanLaw', () => {
  it('is unity at center and hard-pans at the extremes', () => {
    const center = equalPowerPanLaw(0);
    expect(center.left).toBeCloseTo(Math.SQRT1_2, 5);
    expect(center.right).toBeCloseTo(Math.SQRT1_2, 5);
    expect(center.left ** 2 + center.right ** 2).toBeCloseTo(1, 5);

    const hardLeft = equalPowerPanLaw(-1);
    expect(hardLeft.left).toBeCloseTo(1, 5);
    expect(hardLeft.right).toBeCloseTo(0, 5);

    const hardRight = equalPowerPanLaw(1);
    expect(hardRight.left).toBeCloseTo(0, 5);
    expect(hardRight.right).toBeCloseTo(1, 5);
  });
});

describe('computeClipFadeGain', () => {
  it('ramps in and out sample-accurately from clip-relative position', () => {
    expect(computeClipFadeGain(0, 2, 0.5, 0.5)).toBe(0);
    expect(computeClipFadeGain(0.25, 2, 0.5, 0.5)).toBeCloseTo(0.5, 5);
    expect(computeClipFadeGain(1, 2, 0.5, 0.5)).toBeCloseTo(1, 5);
    expect(computeClipFadeGain(1.75, 2, 0.5, 0.5)).toBeCloseTo(0.5, 5);
    expect(computeClipFadeGain(2, 2, 0.5, 0.5)).toBe(0);
  });
});

describe('equalPowerCrossfadeGains', () => {
  it('crossfades with constant power', () => {
    const start = equalPowerCrossfadeGains(0);
    expect(start.outgoing).toBeCloseTo(1, 5);
    expect(start.incoming).toBeCloseTo(0, 5);

    const mid = equalPowerCrossfadeGains(0.5);
    expect(mid.outgoing ** 2 + mid.incoming ** 2).toBeCloseTo(1, 5);

    const end = equalPowerCrossfadeGains(1);
    expect(end.outgoing).toBeCloseTo(0, 5);
    expect(end.incoming).toBeCloseTo(1, 5);
  });
});

describe('applyMixStage', () => {
  it('applies gain, pan, and fade on stereo PCM', () => {
    const pcm = new Float32Array([1, 1, 1, 1]);
    const mixed = applyMixStage(pcm, 2, {
      gain: 0.5,
      pan: -1,
      fadeInS: 0,
      fadeOutS: 0,
      clipOffsetS: 0,
      clipDurationS: 1,
      sampleRate: 2,
    });
    expect(mixed[0]).toBeCloseTo(0.5, 5);
    expect(mixed[1]).toBeCloseTo(0, 5);
    expect(mixed[2]).toBeCloseTo(0.5, 5);
    expect(mixed[3]).toBeCloseTo(0, 5);
  });

  it('spreads mono sources with equal-power pan', () => {
    const pcm = new Float32Array([1, 1]);
    applyMixStageInPlace(pcm, 2, {
      gain: 1,
      pan: 1,
      fadeInS: 0,
      fadeOutS: 0,
      clipOffsetS: 0,
      clipDurationS: 1,
      sampleRate: 2,
    });
    expect(pcm[0]).toBeCloseTo(0, 5);
    expect(pcm[1]).toBeCloseTo(1, 5);
  });

  it('applies master gain and clamps to ±1', () => {
    const pcm = new Float32Array([0.8, 0.8, 0.8, 0.8]);
    applyMasterAndClamp(pcm, 2);
    expect([...pcm]).toEqual([1, 1, 1, 1]);
  });
});

describe('preview/export mix equality', () => {
  it('matches the shared fixture through the mix stage and master bus', () => {
    const { preview, exported } = mixPreviewExportFixture();
    expect([...preview]).toEqual([...exported]);
  });
});
