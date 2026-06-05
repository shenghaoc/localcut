import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIP_EFFECTS,
  EFFECT_IDS,
  getEffectLabel,
  normalizeClipEffects,
  packEffectUniform,
} from './effects';

describe('effects', () => {
  it('exposes three colour-grade effects', () => {
    expect(EFFECT_IDS).toEqual(['brightness-contrast', 'saturation', 'colour-temperature']);
    expect(getEffectLabel('saturation')).toBe('Saturation');
  });

  it('normalizes partial clip params to defaults', () => {
    expect(normalizeClipEffects({ brightness: 0.2 })).toMatchObject({
      brightness: 0.2,
      contrast: DEFAULT_CLIP_EFFECTS.contrast,
      saturation: DEFAULT_CLIP_EFFECTS.saturation,
    });
  });

  it('packs brightness-contrast uniforms', () => {
    const packed = packEffectUniform('brightness-contrast', {
      ...DEFAULT_CLIP_EFFECTS,
      brightness: -0.25,
      contrast: 1.5,
    });
    expect(packed[0]).toBeCloseTo(-0.25);
    expect(packed[1]).toBeCloseTo(1.5);
  });

  it('packs saturation uniforms', () => {
    const packed = packEffectUniform('saturation', {
      ...DEFAULT_CLIP_EFFECTS,
      saturation: 0.75,
    });
    expect(packed[0]).toBeCloseTo(0.75);
  });

  it('packs colour-temperature uniforms', () => {
    const packed = packEffectUniform('colour-temperature', {
      ...DEFAULT_CLIP_EFFECTS,
      temperature: 3200,
      temperatureStrength: 0.5,
    });
    expect(packed[0]).toBeCloseTo(3200);
    expect(packed[1]).toBeCloseTo(0.5);
  });
});
