import type { BundleIntegrityCode, BundleIntegrityItem, BundleIntegrityReport } from './types';

export function createEmptyIntegrityReport(bundleId: string): BundleIntegrityReport {
  return {
    bundleId,
    ok: true,
    items: [],
    summary: {
      sourcesEmbedded: 0,
      sourcesOffline: 0,
      assetsVerified: 0,
      assetsFailed: 0,
      cachesSkipped: 0,
    },
  };
}

export function addIntegrityItem(
  report: BundleIntegrityReport,
  item: BundleIntegrityItem,
): BundleIntegrityReport {
  const items = [...report.items, item];
  const summary = { ...report.summary };
  if (item.code === 'ok' && item.sourceId) {
    summary.sourcesEmbedded += 1;
  }
  if (
    item.sourceId &&
    item.code !== 'ok' &&
    (item.code === 'missing-file' ||
      item.code === 'fingerprint-mismatch' ||
      item.code === 'descriptor-mismatch' ||
      item.code === 'size-mismatch')
  ) {
    summary.sourcesOffline += 1;
  }
  if (item.assetId && item.code === 'ok') {
    summary.assetsVerified += 1;
  }
  if (
    item.assetId &&
    item.code !== 'ok' &&
    item.code !== 'cache-stale' &&
    item.severity === 'error'
  ) {
    summary.assetsFailed += 1;
  }
  if (item.code === 'cache-stale') {
    summary.cachesSkipped += 1;
  }
  const blocking = item.severity === 'error' && item.code !== 'cache-stale';
  return {
    bundleId: report.bundleId,
    ok: report.ok && !blocking,
    items,
    summary,
  };
}

export function integrityItem(
  code: BundleIntegrityCode,
  severity: BundleIntegrityItem['severity'],
  message: string,
  fields: Partial<BundleIntegrityItem> = {},
): BundleIntegrityItem {
  return { code, severity, message, ...fields };
}
