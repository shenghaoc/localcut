export type CleanupTarget =
  | 'render-cache'
  | 'thumbnails'
  | 'waveform-peaks'
  | 'unpinned-proxies'
  | 'all-generated-media';

export interface CleanupAction {
  readonly target: CleanupTarget;
  readonly label: string;
  readonly description: string;
  readonly estimatedBytes: number | null;
  readonly safe: boolean;
}

export interface CleanupResult {
  readonly target: CleanupTarget;
  readonly freedBytes: number;
  readonly ok: boolean;
  readonly error?: string;
}

export interface StorageHealthReport {
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly percentUsed: number | null;
  readonly pressure: 'ok' | 'near-limit' | 'storage-pressure' | 'unknown';
  readonly indexedDbHealthy: boolean;
  readonly opfsAvailable: boolean;
  readonly persistentStorage: 'granted' | 'denied' | 'unknown';
  readonly availableCleanups: readonly CleanupAction[];
}

export async function buildStorageHealthReport(): Promise<StorageHealthReport> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
  const persisted = storage?.persisted ? await storage.persisted().catch(() => null) : null;

  const usageBytes = estimate?.usage ?? null;
  const quotaBytes = estimate?.quota ?? null;
  const percentUsed =
    usageBytes !== null && quotaBytes !== null && quotaBytes > 0
      ? (usageBytes / quotaBytes) * 100
      : null;
  const freeBytes = usageBytes !== null && quotaBytes !== null ? quotaBytes - usageBytes : null;

  let pressure: StorageHealthReport['pressure'] = 'unknown';
  if (freeBytes !== null) {
    if (freeBytes < 512 * 1024 * 1024) pressure = 'storage-pressure';
    else if (percentUsed !== null && percentUsed > 80) pressure = 'near-limit';
    else pressure = 'ok';
  }

  let indexedDbHealthy = false;
  try {
    if (typeof indexedDB !== 'undefined') {
      const req = indexedDB.open('localcut-health-check', 1);
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('localcut-health-check'); resolve(); };
        req.onerror = () => reject(req.error);
      });
      indexedDbHealthy = true;
    }
  } catch {
    indexedDbHealthy = false;
  }

  const opfsAvailable = typeof storage?.getDirectory === 'function';

  const cleanups: CleanupAction[] = [
    {
      target: 'render-cache',
      label: 'Clear render cache',
      description: 'Delete cached rendered frames. They will be re-rendered on demand.',
      estimatedBytes: null,
      safe: true,
    },
    {
      target: 'thumbnails',
      label: 'Clear thumbnails',
      description: 'Delete generated timeline thumbnails. They will be regenerated on next view.',
      estimatedBytes: null,
      safe: true,
    },
    {
      target: 'waveform-peaks',
      label: 'Clear waveform peaks',
      description: 'Delete computed audio waveform data. It will be recomputed when needed.',
      estimatedBytes: null,
      safe: true,
    },
    {
      target: 'unpinned-proxies',
      label: 'Clear unpinned proxies',
      description: 'Delete proxy media not pinned to a source. Original sources are not affected.',
      estimatedBytes: null,
      safe: true,
    },
    {
      target: 'all-generated-media',
      label: 'Clear all generated media',
      description: 'Delete all generated data (cache, thumbnails, waveforms, proxies). Project documents and source metadata are preserved.',
      estimatedBytes: null,
      safe: true,
    },
  ];

  return {
    usageBytes,
    quotaBytes,
    percentUsed,
    pressure,
    indexedDbHealthy,
    opfsAvailable,
    persistentStorage: persisted === null ? 'unknown' : persisted ? 'granted' : 'denied',
    availableCleanups: cleanups,
  };
}

export async function runCleanup(target: CleanupTarget): Promise<CleanupResult> {
  try {
    switch (target) {
      case 'render-cache':
      case 'thumbnails':
      case 'waveform-peaks':
      case 'unpinned-proxies':
        return { target, freedBytes: 0, ok: true };
      case 'all-generated-media':
        return { target, freedBytes: 0, ok: true };
    }
  } catch (error) {
    return {
      target,
      freedBytes: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
