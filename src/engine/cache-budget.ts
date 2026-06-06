import type { CacheBudget, CacheCategory, CacheUsageSnapshot, CategoryUsage, TimeRange } from './cache-types';
import { rangesOverlap } from './cache-invalidation';

export interface CacheStorageEstimate {
  readonly usageBytes: number;
  readonly quotaBytes: number | null;
}

export interface CacheBudgetEntry {
  readonly id: string;
  readonly category: CacheCategory;
  readonly byteSize: number;
  readonly lastUsedAt: number;
  readonly status: 'writing' | 'ready' | 'stale' | 'failed' | 'deleted';
  readonly ranges?: readonly TimeRange[];
  readonly proxyId?: string;
  readonly inFlight?: boolean;
}

export interface CacheEvictionPlan {
  readonly evictIds: readonly string[];
  readonly protectedIds: readonly string[];
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly targetBytes: number;
}

const EMPTY_CATEGORY_USAGE = {
  proxies: 0,
  renderChunks: 0,
  thumbnails: 0,
  filmstrips: 0,
  waveforms: 0,
  metadata: 0,
} as const;

type MutableCategoryUsage = {
  -readonly [Key in keyof CategoryUsage]: number;
};

function categoryKey(category: CacheCategory): keyof CacheUsageSnapshot['categories'] {
  switch (category) {
    case 'render-chunks':
      return 'renderChunks';
    case 'proxies':
      return 'proxies';
    case 'thumbnails':
      return 'thumbnails';
    case 'filmstrips':
      return 'filmstrips';
    case 'waveforms':
      return 'waveforms';
    case 'metadata':
      return 'metadata';
  }
}

function warningForUsage(
  totalBytes: number,
  budget: CacheBudget,
  estimate?: CacheStorageEstimate,
): CacheUsageSnapshot['warning'] {
  if (estimate?.quotaBytes !== null && estimate?.quotaBytes !== undefined) {
    const freeBytes = estimate.quotaBytes - estimate.usageBytes;
    if (freeBytes < budget.minFreeBytes) return 'storage-pressure';
  }
  if (totalBytes >= budget.evictAtBytes || totalBytes >= budget.maxBytes) return 'over-budget';
  if (totalBytes >= budget.warnAtBytes) return 'near-limit';
  return 'ok';
}

export function computeCacheUsage(
  entries: readonly CacheBudgetEntry[],
  budget: CacheBudget,
  estimate?: CacheStorageEstimate,
): CacheUsageSnapshot {
  const categories: MutableCategoryUsage = { ...EMPTY_CATEGORY_USAGE };
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.status === 'deleted') continue;
    const bytes = Math.max(0, entry.byteSize);
    totalBytes += bytes;
    const key = categoryKey(entry.category);
    categories[key] += bytes;
  }
  const quotaBytes = estimate?.quotaBytes ?? null;
  const freeBytes = quotaBytes === null ? null : Math.max(0, quotaBytes - (estimate?.usageBytes ?? totalBytes));
  return {
    totalBytes,
    quotaBytes,
    freeBytes,
    categories,
    warning: warningForUsage(totalBytes, budget, estimate),
  };
}

function categoryEvictionRank(category: CacheCategory): number {
  switch (category) {
    case 'render-chunks':
      return 1;
    case 'thumbnails':
      return 2;
    case 'filmstrips':
      return 3;
    case 'waveforms':
      return 4;
    case 'metadata':
      return 5;
    case 'proxies':
      return 6;
  }
}

function statusEvictionRank(status: CacheBudgetEntry['status']): number {
  switch (status) {
    case 'failed':
      return 0;
    case 'stale':
      return 1;
    case 'deleted':
      return 2;
    case 'ready':
      return 3;
    case 'writing':
      return 4;
  }
}

function entryProtected(entry: CacheBudgetEntry, budget: CacheBudget): boolean {
  if (entry.inFlight || entry.status === 'writing') return true;
  if (entry.proxyId && budget.pinnedProxyIds.includes(entry.proxyId)) return true;
  if (entry.ranges?.some((range) => budget.protectedRanges.some((protectedRange) => rangesOverlap(range, protectedRange)))) {
    return true;
  }
  return false;
}

function evictionTargetBytes(
  bytesBefore: number,
  budget: CacheBudget,
  estimate?: CacheStorageEstimate,
): number {
  let target = Math.min(budget.maxBytes, budget.evictAtBytes);
  if (estimate?.quotaBytes !== null && estimate?.quotaBytes !== undefined) {
    const freeBytes = estimate.quotaBytes - estimate.usageBytes;
    const pressureBytes = budget.minFreeBytes - freeBytes;
    if (pressureBytes > 0) {
      target = Math.min(target, Math.max(0, bytesBefore - pressureBytes));
    }
  }
  return Math.max(0, target);
}

export function planCacheEviction(
  entries: readonly CacheBudgetEntry[],
  budget: CacheBudget,
  estimate?: CacheStorageEstimate,
): CacheEvictionPlan {
  const bytesBefore = entries
    .filter((entry) => entry.status !== 'deleted')
    .reduce((sum, entry) => sum + Math.max(0, entry.byteSize), 0);
  const targetBytes = evictionTargetBytes(bytesBefore, budget, estimate);
  const protectedIds: string[] = [];
  const candidates: CacheBudgetEntry[] = [];
  for (const entry of entries) {
    if (entry.status === 'deleted') continue;
    if (entryProtected(entry, budget)) {
      protectedIds.push(entry.id);
    } else {
      candidates.push(entry);
    }
  }
  candidates.sort((a, b) => {
    const status = statusEvictionRank(a.status) - statusEvictionRank(b.status);
    if (status !== 0) return status;
    const category = categoryEvictionRank(a.category) - categoryEvictionRank(b.category);
    if (category !== 0) return category;
    return a.lastUsedAt - b.lastUsedAt || a.id.localeCompare(b.id);
  });

  let bytesAfter = bytesBefore;
  const evictIds: string[] = [];
  for (const entry of candidates) {
    if (bytesAfter <= targetBytes) break;
    evictIds.push(entry.id);
    bytesAfter -= Math.max(0, entry.byteSize);
  }

  return {
    evictIds,
    protectedIds: protectedIds.sort(),
    bytesBefore,
    bytesAfter,
    targetBytes,
  };
}
