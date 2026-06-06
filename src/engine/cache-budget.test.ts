import { describe, expect, it } from 'vitest';
import { computeCacheUsage, planCacheEviction, type CacheBudgetEntry } from './cache-budget';
import { DEFAULT_CACHE_BUDGET, type CacheBudget } from './cache-types';

const budget: CacheBudget = {
  ...DEFAULT_CACHE_BUDGET,
  maxBytes: 1_000,
  warnAtBytes: 700,
  evictAtBytes: 500,
  minFreeBytes: 200,
  protectedRanges: [{ startS: 10, endS: 20 }],
  pinnedProxyIds: ['proxy-pinned'],
};

function entry(patch: Partial<CacheBudgetEntry> & Pick<CacheBudgetEntry, 'id' | 'category' | 'byteSize'>): CacheBudgetEntry {
  return {
    lastUsedAt: 0,
    status: 'ready',
    ...patch,
  };
}

describe('computeCacheUsage', () => {
  it('accounts usage by category and reports pressure', () => {
    const usage = computeCacheUsage(
      [
        entry({ id: 'proxy', category: 'proxies', byteSize: 300 }),
        entry({ id: 'render', category: 'render-chunks', byteSize: 450 }),
        entry({ id: 'waveform', category: 'waveforms', byteSize: 25 }),
        entry({ id: 'manifest', category: 'metadata', byteSize: 10 }),
      ],
      budget,
      { usageBytes: 900, quotaBytes: 1_000 },
    );

    expect(usage.totalBytes).toBe(785);
    expect(usage.categories.proxies).toBe(300);
    expect(usage.categories.renderChunks).toBe(450);
    expect(usage.categories.metadata).toBe(10);
    expect(DEFAULT_CACHE_BUDGET.categorySoftLimits.metadata).toBeGreaterThan(0);
    expect(usage.warning).toBe('storage-pressure');
  });
});

describe('planCacheEviction', () => {
  it('evicts stale and old render data before unpinned proxies', () => {
    const plan = planCacheEviction(
      [
        entry({ id: 'proxy-old', category: 'proxies', byteSize: 400, proxyId: 'proxy-old', lastUsedAt: 1 }),
        entry({ id: 'render-old', category: 'render-chunks', byteSize: 300, lastUsedAt: 0 }),
        entry({ id: 'thumb-stale', category: 'thumbnails', byteSize: 100, status: 'stale', lastUsedAt: 5 }),
        entry({ id: 'waveform', category: 'waveforms', byteSize: 100, lastUsedAt: 2 }),
      ],
      budget,
    );

    expect(plan.evictIds).toEqual(['thumb-stale', 'render-old']);
    expect(plan.bytesAfter).toBe(500);
  });

  it('protects pinned proxies, active ranges, and in-flight writes', () => {
    const plan = planCacheEviction(
      [
        entry({ id: 'pinned', category: 'proxies', byteSize: 500, proxyId: 'proxy-pinned' }),
        entry({ id: 'active-range', category: 'render-chunks', byteSize: 300, ranges: [{ startS: 12, endS: 13 }] }),
        entry({ id: 'writing', category: 'render-chunks', byteSize: 300, status: 'writing', inFlight: true }),
        entry({ id: 'old-render', category: 'render-chunks', byteSize: 400, lastUsedAt: 0 }),
      ],
      budget,
    );

    expect(plan.protectedIds).toEqual(['active-range', 'pinned', 'writing']);
    expect(plan.evictIds).toEqual(['old-render']);
  });
});
