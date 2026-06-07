import { describe, expect, it } from 'vitest';
import { checkTestCapabilities } from './test-capability-skip';

describe('checkTestCapabilities', () => {
  it('returns an array of skips', () => {
    const skips = checkTestCapabilities();
    expect(Array.isArray(skips)).toBe(true);
    for (const skip of skips) {
      expect(skip.feature).toBeTruthy();
      expect(skip.reason).toBeTruthy();
    }
  });

  it('reports webgpu unavailable in Node test environment', () => {
    const skips = checkTestCapabilities();
    const webgpu = skips.find((s) => s.feature === 'webgpu');
    expect(webgpu).toBeTruthy();
    expect(webgpu!.reason).toBe('webgpu.unavailable');
  });

  it('reports webcodecs unavailable in Node test environment', () => {
    const skips = checkTestCapabilities();
    const decoder = skips.find((s) => s.feature === 'webcodecs-decoder');
    expect(decoder).toBeTruthy();
  });

  it('skip reasons are unique per feature', () => {
    const skips = checkTestCapabilities();
    const features = skips.map((s) => s.feature);
    expect(new Set(features).size).toBe(features.length);
  });
});
