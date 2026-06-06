import { describe, expect, it } from 'vitest';
import {
  clipEffectsEqual,
  DEFAULT_CLIP_EFFECTS,
  EFFECT_IDS,
  getEffectLabel,
  isBrightnessContrastActive,
  isColourTemperatureActive,
  isLutActive,
  isSaturationActive,
  normalizeClipEffects,
  packEffectUniform,
  packLutUniform,
} from './effects';

describe('effects', () => {
  it('exposes four colour-grade effects', () => {
    expect(EFFECT_IDS).toEqual(['brightness-contrast', 'saturation', 'colour-temperature', 'lut-apply']);
    expect(getEffectLabel('saturation')).toBe('Saturation');
    expect(getEffectLabel('lut-apply')).toBe('LUT');
  });

  it('normalizes partial clip params to defaults', () => {
    expect(normalizeClipEffects({ brightness: 0.2 })).toMatchObject({
      brightness: 0.2,
      contrast: DEFAULT_CLIP_EFFECTS.contrast,
      saturation: DEFAULT_CLIP_EFFECTS.saturation,
      lutStrength: 0,
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

  it('compares clip effect params field-wise', () => {
    expect(clipEffectsEqual(DEFAULT_CLIP_EFFECTS, { ...DEFAULT_CLIP_EFFECTS })).toBe(true);
    expect(clipEffectsEqual(DEFAULT_CLIP_EFFECTS, { ...DEFAULT_CLIP_EFFECTS, brightness: 0.1 })).toBe(
      false,
    );
  });

  it('detects default params as inactive', () => {
    expect(isBrightnessContrastActive(DEFAULT_CLIP_EFFECTS)).toBe(false);
    expect(isSaturationActive(DEFAULT_CLIP_EFFECTS)).toBe(false);
    expect(isColourTemperatureActive(DEFAULT_CLIP_EFFECTS)).toBe(false);
    expect(isLutActive(DEFAULT_CLIP_EFFECTS, undefined)).toBe(false);
  });

  it('detects non-default params as active', () => {
    expect(isBrightnessContrastActive({ ...DEFAULT_CLIP_EFFECTS, contrast: 1.2 })).toBe(true);
    expect(isSaturationActive({ ...DEFAULT_CLIP_EFFECTS, saturation: 0.5 })).toBe(true);
    expect(
      isColourTemperatureActive({ ...DEFAULT_CLIP_EFFECTS, temperature: 3200, temperatureStrength: 1 }),
    ).toBe(true);
    expect(
      isLutActive(
        { ...DEFAULT_CLIP_EFFECTS, lutStrength: 0.5 },
        {
          key: 'lut-a',
          fileName: 'grade.cube',
          title: 'Grade',
          size: 2,
          domainMin: [0, 0, 0],
          domainMax: [1, 1, 1],
          values: new Float32Array(24),
        },
      ),
    ).toBe(true);
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

  it('packs LUT strength uniforms', () => {
    const packed = packEffectUniform('lut-apply', {
      ...DEFAULT_CLIP_EFFECTS,
      lutStrength: 0.75,
    });
    expect(packed[0]).toBeCloseTo(0.75);
    expect(packed).toHaveLength(12);
    expect([...packed.slice(4, 7)]).toEqual([0, 0, 0]);
    expect([...packed.slice(8, 11)]).toEqual([1, 1, 1]);
  });

  it('packs LUT domain uniforms from the clip LUT', () => {
    const packed = packLutUniform(
      {
        ...DEFAULT_CLIP_EFFECTS,
        lutStrength: 0.5,
      },
      {
        key: 'lut-a',
        fileName: 'grade.cube',
        title: 'Grade',
        size: 2,
        domainMin: [0.1, 0.2, 0.3],
        domainMax: [0.9, 0.8, 0.7],
        values: new Float32Array(24),
      },
    );
    expect(packed[0]).toBeCloseTo(0.5);
    expect(packed[4]).toBeCloseTo(0.1);
    expect(packed[5]).toBeCloseTo(0.2);
    expect(packed[6]).toBeCloseTo(0.3);
    expect(packed[8]).toBeCloseTo(0.9);
    expect(packed[9]).toBeCloseTo(0.8);
    expect(packed[10]).toBeCloseTo(0.7);
  });
});
