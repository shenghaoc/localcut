import { describe, expect, it } from 'vitest';
import { parseCubeLut } from './lut';

function identityCube(size: number): string {
  const rows: string[] = [`TITLE "Identity ${size}"`, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
      }
    }
  }
  return rows.join('\n');
}

describe('.cube LUT parser', () => {
  it('parses a valid 2x2x2 cube with title and domains', () => {
    const lut = parseCubeLut(`
      # comment
      TITLE "Warm"
      DOMAIN_MIN 0 0 0
      DOMAIN_MAX 1 1 1
      LUT_3D_SIZE 2
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `);
    expect(lut.title).toBe('Warm');
    expect(lut.size).toBe(2);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.values).toHaveLength(24);
    expect(lut.values[23]).toBe(1);
  });

  it('parses differently sized 3D LUTs', () => {
    const lut = parseCubeLut(identityCube(3));
    expect(lut.size).toBe(3);
    expect(lut.values).toHaveLength(81);
  });

  it('rejects malformed cube files gracefully', () => {
    expect(() => parseCubeLut('0 0 0')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCubeLut('LUT_1D_SIZE 16')).toThrow(/3D/);
    expect(() => parseCubeLut('LUT_3D_SIZE 1\n0 0 0')).toThrow(/integer/);
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0')).toThrow(/samples/);
    expect(() => parseCubeLut('LUT_3D_SIZE 2\nDOMAIN_MIN 0 nope 0')).toThrow(/non-numeric/);
  });
});
