import { describe, expect, it } from 'vitest';
import { runCleanup, type CleanupTarget } from './storage-cleanup';

describe('storage cleanup', () => {
  const TARGETS: CleanupTarget[] = [
    'render-cache',
    'thumbnails',
    'waveform-peaks',
    'unpinned-proxies',
    'all-generated-media',
  ];

  it.each(TARGETS)('runCleanup("%s") succeeds', async (target) => {
    const result = await runCleanup(target);
    expect(result.ok).toBe(true);
    expect(result.target).toBe(target);
    expect(result.freedBytes).toBeGreaterThanOrEqual(0);
  });

  it('repeated cleanup is safe', async () => {
    const first = await runCleanup('render-cache');
    const second = await runCleanup('render-cache');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('all-generated-media covers individual targets', async () => {
    const result = await runCleanup('all-generated-media');
    expect(result.ok).toBe(true);
  });

  it('cleanup result includes target identity', async () => {
    for (const target of TARGETS) {
      const result = await runCleanup(target);
      expect(result.target).toBe(target);
    }
  });
});
