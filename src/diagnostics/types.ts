export const DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION = 1;

export type DiagnosticCapabilityTier = 'accelerated' | 'limited' | 'starting' | 'blocked';

export type CapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

export interface CapabilityFinding {
  readonly code: string;
  readonly status: CapabilityStatus;
  readonly message: string;
  readonly action?: string;
}

export interface DeviceLostSummary {
  readonly reason: string;
  readonly message: string;
  readonly occurredAt: string;
  readonly recoveryAttempts: number;
  readonly fallbackMode: 'none' | 'limited-preview' | 'blocked';
}

export interface WebGpuCapability {
  readonly status: 'ready' | 'unavailable' | 'requesting' | 'lost' | 'recovering' | 'failed';
  readonly features: readonly string[];
  readonly optionalFeatures: {
    readonly shaderF16: CapabilityFinding;
    readonly timestampQuery: CapabilityFinding;
    readonly subgroups: CapabilityFinding;
  };
  readonly limits?: Readonly<Record<string, number>>;
  readonly lastDeviceLost?: DeviceLostSummary;
}

export interface CodecSupportSummary {
  readonly codec: string;
  readonly container?: string;
  readonly direction: 'decode' | 'encode';
  readonly supported: boolean;
  readonly reason?: string;
}

export interface CapabilityReport {
  readonly tier: DiagnosticCapabilityTier;
  readonly tierReason: string;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: CapabilityFinding;
  readonly webGpu: WebGpuCapability;
  readonly webCodecs: {
    readonly decoders: readonly CodecSupportSummary[];
    readonly encoders: readonly CodecSupportSummary[];
  };
  readonly mediabunny: CapabilityFinding;
  readonly audioWorklet: CapabilityFinding;
  readonly fileSystemAccess: CapabilityFinding;
  readonly opfs: CapabilityFinding;
  readonly findings: readonly CapabilityFinding[];
}

export type DiagnosticSubsystem =
  | 'capability'
  | 'worker'
  | 'gpu'
  | 'audio'
  | 'storage'
  | 'import'
  | 'export'
  | 'cache'
  | 'timeline'
  | 'accessibility'
  | 'performance';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface RecentError {
  readonly id: string;
  readonly code: string;
  readonly subsystem: DiagnosticSubsystem;
  readonly severity: DiagnosticSeverity;
  /** Timestamp of the most recent occurrence (updated on merge). */
  readonly occurredAt: string;
  /** Timestamp of the first occurrence in this run (preserved across merges). */
  readonly firstOccurredAt: string;
  /** How many times this subsystem+code has been logged (>= 1). */
  readonly occurrenceCount: number;
  readonly message: string;
  readonly redactedDetail?: string;
  readonly affectedJobId?: string;
  readonly affectedSourceAlias?: string;
  readonly recoveryActionIds: readonly string[];
}

export interface RecentErrorLog {
  readonly capacity: number;
  readonly droppedCount: number;
  readonly entries: readonly RecentError[];
}

export type RecoveryActionKind =
  | 'restart-worker'
  | 'retry-gpu-device'
  | 'switch-limited-preview'
  | 'retry-audio'
  | 'open-storage-cleanup'
  | 'request-storage-persistence'
  | 'relink-source'
  | 'retry-import'
  | 'retry-export'
  | 'cancel-job'
  | 'export-project-bundle'
  | 'reload-app';

export interface RecoveryAction {
  readonly actionId: string;
  readonly kind: RecoveryActionKind;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly destructive: boolean;
  readonly requiresUserGesture: boolean;
  readonly reasonDisabled?: string;
  readonly relatedErrorIds: readonly string[];
}

export type BudgetMetric =
  | 'main-thread-blocking-ms'
  | 'worker-decode-queue-frames'
  | 'worker-decode-queue-ms'
  | 'gpu-submissions-per-frame'
  | 'dropped-preview-frame-rate'
  | 'export-throughput-fps'
  | 'memory-usage-bytes'
  | 'cache-usage-bytes'
  | 'audio-underruns-per-minute';

export interface PerformanceBudget {
  readonly metric: BudgetMetric;
  readonly label: string;
  readonly unit: 'ms' | 'frames' | 'fps' | 'percent' | 'bytes' | 'count-per-minute';
  readonly window: 'startup' | 'playback-60s' | 'scrub-10s' | 'export-job' | 'session' | 'manual';
  readonly target: number;
  readonly warningAt: number;
  readonly breachAt: number;
  readonly observed: number | null;
  readonly status: 'ok' | 'warning' | 'breach' | 'not-measured';
  readonly sampleCount: number;
  readonly notes?: string;
}

export interface StorageDiagnosticSummary {
  readonly opfsSupported: boolean;
  readonly indexedDbSupported: boolean;
  readonly persistentStorage: 'granted' | 'denied' | 'unknown';
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly warning: 'ok' | 'near-limit' | 'storage-pressure' | 'unknown';
}

export interface ProxyCacheDiagnosticSummary {
  readonly status: 'available' | 'unavailable' | 'degraded' | 'unknown';
  readonly proxyAssets: number;
  readonly readyProxies: number;
  readonly failedProxies: number;
  readonly estimatedBytes: number;
  readonly message: string;
}

export interface ExportSettingsSummary {
  readonly codec: string;
  readonly container: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoBitrate: number;
  readonly sourceMode: 'original' | 'proxy';
  readonly range: 'full' | { readonly startS: number; readonly endS: number };
}

export interface BrowserDiagnosticSummary {
  readonly userAgentFamily: string;
  readonly userAgentVersion: string;
  readonly platformFamily: string;
}

export interface SafeSourceSummary {
  readonly sourceAlias: string;
  readonly mediaKind: 'video' | 'audio' | 'image' | 'offline' | 'unknown';
  readonly container?: string;
  readonly codecs: readonly string[];
  readonly dimensions?: { readonly width: number; readonly height: number };
  readonly durationBucket: '<10s' | '10s-1m' | '1m-10m' | '10m-1h' | '>1h' | 'unknown';
  readonly statusCodes: readonly string[];
}

export interface DiagnosticSnapshot {
  readonly schemaVersion: typeof DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly buildId?: string;
  readonly browser: BrowserDiagnosticSummary;
  readonly capability: CapabilityReport;
  readonly storage: StorageDiagnosticSummary;
  readonly proxyCache: ProxyCacheDiagnosticSummary;
  readonly activeExportSettings: ExportSettingsSummary | null;
  readonly performanceBudgets: readonly PerformanceBudget[];
  readonly recentErrors: RecentErrorLog;
  readonly recoveryActions: readonly RecoveryAction[];
}

export interface CopyableDiagnosticReport {
  readonly reportSchemaVersion: 1;
  readonly generatedAt: string;
  readonly snapshotId: string;
  readonly appVersion: string;
  readonly buildId?: string;
  readonly browser: BrowserDiagnosticSummary;
  readonly capability: CapabilityReport;
  readonly storage: StorageDiagnosticSummary;
  readonly proxyCache: ProxyCacheDiagnosticSummary;
  readonly activeExportSettings: ExportSettingsSummary | null;
  readonly performanceBudgets: readonly PerformanceBudget[];
  readonly recentErrors: RecentErrorLog;
  readonly recoveryActions: readonly RecoveryAction[];
  readonly safeSourceSummaries: readonly SafeSourceSummary[];
}

export interface DiagnosticSourceInput {
  readonly sourceId: string;
  readonly fileName?: string;
  readonly kind?: 'video' | 'audio' | 'image';
  readonly durationS?: number;
  readonly mimeType?: string | null;
  readonly fingerprint?: { readonly algorithm: string; readonly digest: string };
  readonly video?: {
    readonly width?: number;
    readonly height?: number;
    readonly codec?: string | null;
    readonly canDecode?: boolean;
  };
  readonly audio?: {
    readonly codec?: string | null;
    readonly canDecode?: boolean;
  };
  readonly proxy?: {
    readonly status?: string;
    readonly byteSize?: number;
  };
  readonly offline?: boolean;
}
