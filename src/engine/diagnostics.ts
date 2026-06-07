import type { ExportSettings } from '../protocol';
import type {
  CapabilityFinding,
  CapabilityReport,
  DiagnosticSnapshot,
  DiagnosticCapabilityTier,
  ExportSettingsSummary,
  ProxyCacheDiagnosticSummary,
  RecentErrorLog,
  RecoveryAction,
  StorageDiagnosticSummary,
  WebGpuCapability,
} from '../diagnostics/types';
import { DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION } from '../diagnostics/types';
import { buildDefaultPerformanceBudgets } from '../diagnostics/performance-budgets';

interface DiagnosticSourceLike {
  readonly proxy?: {
    readonly status?: string;
    readonly byteSize?: number;
  };
}

export interface WorkerDiagnosticInput {
  readonly appVersion: string;
  readonly webgpuReady: boolean;
  readonly webgpuFeatures: readonly string[];
  readonly gpuUnavailableReason: string | null;
  readonly rendererSubmissionCount: number | null;
  readonly activeExportSettings: ExportSettings | null;
  readonly recentErrors: RecentErrorLog;
  readonly sources: readonly DiagnosticSourceLike[];
}

function makeSnapshotId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `diag-${crypto.randomUUID()}`;
  }
  return `diag-${Math.random().toString(36).slice(2)}`;
}

function finding(
  code: string,
  supported: boolean,
  message: string,
  action?: string,
): CapabilityFinding {
  return {
    code,
    status: supported ? 'supported' : 'unsupported',
    message,
    action,
  };
}

function featureFinding(feature: string, features: readonly string[], label: string): CapabilityFinding {
  const supported = features.includes(feature);
  return {
    code: `webgpu.feature.${feature}`,
    status: supported ? 'supported' : 'unsupported',
    message: supported ? `${label} is enabled on the WebGPU device.` : `${label} is not enabled on this WebGPU device.`,
    action: supported ? undefined : 'The editor will use the f32/shared-memory fallback where available.',
  };
}

function userAgentSummary(): DiagnosticSnapshot['browser'] {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
  const chromium = /(?:Chrome|Chromium|Edg)\/([0-9.]+)/.exec(ua);
  const firefox = /Firefox\/([0-9.]+)/.exec(ua);
  const safari = !chromium ? /Version\/([0-9.]+).*Safari/.exec(ua) : null;
  if (chromium) {
    return { userAgentFamily: 'Chromium', userAgentVersion: chromium[1]!, platformFamily: platform || 'unknown' };
  }
  if (firefox) {
    return { userAgentFamily: 'Firefox', userAgentVersion: firefox[1]!, platformFamily: platform || 'unknown' };
  }
  if (safari) {
    return { userAgentFamily: 'Safari', userAgentVersion: safari[1]!, platformFamily: platform || 'unknown' };
  }
  return { userAgentFamily: 'unknown', userAgentVersion: 'unknown', platformFamily: platform || 'unknown' };
}

function webGpuCapability(input: WorkerDiagnosticInput): WebGpuCapability {
  return {
    status: input.webgpuReady ? 'ready' : 'unavailable',
    features: input.webgpuFeatures,
    optionalFeatures: {
      shaderF16: featureFinding('shader-f16', input.webgpuFeatures, 'shader-f16'),
      timestampQuery: featureFinding('timestamp-query', input.webgpuFeatures, 'timestamp-query'),
      subgroups: featureFinding('subgroups', input.webgpuFeatures, 'subgroups'),
    },
  };
}

function buildCapabilityReport(input: WorkerDiagnosticInput): CapabilityReport {
  const isolated = globalThis.crossOriginIsolated === true;
  const hasSab = typeof SharedArrayBuffer === 'function';
  const hasWebCodecs = typeof VideoDecoder !== 'undefined';
  const hasOpfs = typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  const tier: DiagnosticCapabilityTier =
    isolated && hasSab && input.webgpuReady && hasWebCodecs ? 'accelerated' : 'limited';
  const findings: CapabilityFinding[] = [
    finding(
      'capability.cross_origin_isolated',
      isolated,
      isolated ? 'Cross-origin isolation is active.' : 'Cross-origin isolation is missing, so SharedArrayBuffer is gated.',
      isolated ? undefined : 'Serve the app with COOP/COEP headers, then reload.',
    ),
    finding(
      'capability.shared_array_buffer',
      hasSab,
      hasSab ? 'SharedArrayBuffer is available.' : 'SharedArrayBuffer is unavailable.',
      hasSab ? undefined : 'Use an isolated modern browser context.',
    ),
    finding(
      'capability.webcodecs',
      hasWebCodecs,
      hasWebCodecs ? 'WebCodecs is exposed in this worker.' : 'WebCodecs is unavailable in this worker.',
      hasWebCodecs ? undefined : 'Use a recent Chromium-based browser for accelerated import/export.',
    ),
  ];
  if (!input.webgpuReady && input.gpuUnavailableReason) {
    findings.push({
      code: 'capability.webgpu_unavailable',
      status: 'unavailable',
      message: input.gpuUnavailableReason,
      action: 'Enable hardware acceleration, update GPU drivers, or use a WebGPU-capable Chromium browser.',
    });
  }
  return {
    tier,
    tierReason:
      tier === 'accelerated'
        ? 'Worker has isolation, SharedArrayBuffer, WebGPU, and WebCodecs.'
        : input.gpuUnavailableReason ?? 'One or more accelerated worker capabilities are unavailable.',
    crossOriginIsolated: isolated,
    sharedArrayBuffer: finding(
      'capability.shared_array_buffer',
      hasSab,
      hasSab ? 'SharedArrayBuffer is available.' : 'SharedArrayBuffer is unavailable.',
      hasSab ? undefined : 'Enable COOP/COEP and reload.',
    ),
    webGpu: webGpuCapability(input),
    webCodecs: {
      decoders: [
        { codec: 'h264', container: 'mp4', direction: 'decode', supported: hasWebCodecs },
        { codec: 'vp9', container: 'webm', direction: 'decode', supported: hasWebCodecs },
        { codec: 'av1', container: 'mp4/webm', direction: 'decode', supported: hasWebCodecs },
      ],
      encoders: [
        { codec: 'h264', container: 'mp4', direction: 'encode', supported: typeof VideoEncoder !== 'undefined' },
        { codec: 'vp9', container: 'webm', direction: 'encode', supported: typeof VideoEncoder !== 'undefined' },
        { codec: 'av1', container: 'mp4/webm', direction: 'encode', supported: typeof VideoEncoder !== 'undefined' },
      ],
    },
    mediabunny: finding('capability.mediabunny', true, 'Mediabunny modules are bundled in the worker.'),
    audioWorklet: {
      code: 'capability.audio_worklet',
      status: 'unknown',
      message: 'AudioWorklet availability is not probed in the pipeline worker. See UI diagnostics for the main-thread report.',
    },
    fileSystemAccess: finding(
      'capability.file_system_access',
      false,
      'File System Access pickers are main-thread-only and reported by the UI snapshot.',
      'Open the diagnostics panel in the UI for picker availability.',
    ),
    opfs: finding(
      'capability.opfs',
      hasOpfs,
      hasOpfs ? 'OPFS is available for worker-owned cache data.' : 'OPFS is unavailable; cache falls back or is disabled.',
    ),
    findings,
  };
}

async function storageSummary(): Promise<StorageDiagnosticSummary> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
  const persisted = storage?.persisted ? await storage.persisted().catch(() => null) : null;
  const usageBytes = estimate?.usage ?? null;
  const quotaBytes = estimate?.quota ?? null;
  const freeBytes = usageBytes !== null && quotaBytes !== null ? quotaBytes - usageBytes : null;
  const warning =
    freeBytes === null
      ? 'unknown'
      : freeBytes < 512 * 1024 * 1024
        ? 'storage-pressure'
        : usageBytes !== null && quotaBytes !== null && usageBytes / quotaBytes > 0.8
          ? 'near-limit'
          : 'ok';
  return {
    opfsSupported: typeof storage?.getDirectory === 'function',
    indexedDbSupported: typeof indexedDB !== 'undefined',
    persistentStorage: persisted === null ? 'unknown' : persisted ? 'granted' : 'denied',
    usageBytes,
    quotaBytes,
    warning,
  };
}

function proxyCacheSummary(sources: readonly DiagnosticSourceLike[]): ProxyCacheDiagnosticSummary {
  let proxyAssets = 0;
  let readyProxies = 0;
  let failedProxies = 0;
  let estimatedBytes = 0;
  for (const source of sources) {
    if (!source.proxy) continue;
    proxyAssets += 1;
    if (source.proxy.status === 'ready') readyProxies += 1;
    if (source.proxy.status === 'failed') failedProxies += 1;
    estimatedBytes += source.proxy.byteSize ?? 0;
  }
  return {
    status: proxyAssets === 0 ? 'unknown' : failedProxies > 0 ? 'degraded' : 'available',
    proxyAssets,
    readyProxies,
    failedProxies,
    estimatedBytes,
    message: proxyAssets === 0 ? 'No proxy/cache assets are currently reported.' : 'Proxy/cache summary is available.',
  };
}

function exportSettingsSummary(settings: ExportSettings | null): ExportSettingsSummary | null {
  if (!settings) return null;
  return {
    codec: settings.codec,
    container: settings.container,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    videoBitrate: settings.videoBitrate,
    sourceMode: settings.sourceMode ?? 'original',
    range: settings.range ? { startS: settings.range.startS, endS: settings.range.endS } : 'full',
  };
}

function recoveryActions(input: WorkerDiagnosticInput): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  if (!input.webgpuReady) {
    actions.push({
      actionId: 'retry-gpu-device',
      kind: 'retry-gpu-device',
      label: 'Retry GPU',
      description: 'Reinitialize the pipeline after checking browser or driver state.',
      enabled: false,
      destructive: false,
      requiresUserGesture: false,
      reasonDisabled: 'Full GPU retry is not wired in this slice; reload remains the safe path.',
      relatedErrorIds: input.recentErrors.entries
        .filter((entry) => entry.subsystem === 'gpu')
        .map((entry) => entry.id),
    });
  }
  actions.push({
    actionId: 'export-project-bundle',
    kind: 'export-project-bundle',
    label: 'Export project bundle',
    description: 'Create a local bundle before clearing storage or reloading.',
    enabled: true,
    destructive: false,
    requiresUserGesture: true,
    relatedErrorIds: input.recentErrors.entries
      .filter((entry) => entry.subsystem === 'storage' || entry.subsystem === 'worker')
      .map((entry) => entry.id),
  });
  actions.push({
    actionId: 'reload-app',
    kind: 'reload-app',
    label: 'Reload app',
    description: 'Reload after saving/exporting project state.',
    enabled: true,
    destructive: false,
    requiresUserGesture: true,
    relatedErrorIds: [],
  });
  return actions;
}

export async function buildWorkerDiagnosticSnapshot(
  input: WorkerDiagnosticInput,
): Promise<DiagnosticSnapshot> {
  return {
    schemaVersion: DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: makeSnapshotId(),
    createdAt: new Date().toISOString(),
    appVersion: input.appVersion,
    browser: userAgentSummary(),
    capability: buildCapabilityReport(input),
    storage: await storageSummary(),
    proxyCache: proxyCacheSummary(input.sources),
    activeExportSettings: exportSettingsSummary(input.activeExportSettings),
    performanceBudgets: buildDefaultPerformanceBudgets({
      'gpu-submissions-per-frame': {
        observed: input.rendererSubmissionCount,
        sampleCount: input.rendererSubmissionCount === null ? 0 : 1,
      },
    }),
    recentErrors: input.recentErrors,
    recoveryActions: recoveryActions(input),
  };
}
