import type {
  CopyableDiagnosticReport,
  DiagnosticSnapshot,
  DiagnosticSourceInput,
  RecentError,
  RecentErrorLog,
  SafeSourceSummary,
} from './types';

const PATH_OR_URL_PATTERNS = [
  /file:\/\/[^\s'")]+/gi,
  /blob:[^\s'")]+/gi,
  /(?:\/[^\s'")]+)+/g,
  /(?:[A-Za-z]:\\[^\s'")]+(?:\\[^\s'")]+)*)/g,
  /(?:[^\s'"]+\\)+[^\s'"]+/g,
];

const QUOTED_FILE_PATTERN = /(["'`])([^"'`]*(?:\.[A-Za-z0-9]{2,5})[^"'`]*)\1/g;
const COMMON_FILE_PATTERN = /\b[^\s/\\'"]+\.(mp4|mov|webm|mkv|png|jpe?g|webp|gif|mp3|m4a|wav|ogg|srt|vtt|cube)\b/gi;
const HEX_FINGERPRINT_PATTERN = /\b[a-f0-9]{32,}\b/gi;

function stableSourceAliases(sources: readonly DiagnosticSourceInput[]): Map<string, string> {
  const sorted = [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return new Map(sorted.map((source, index) => [source.sourceId, `source-${index + 1}`]));
}

export function redactDiagnosticText(value: string): string {
  let redacted = value;
  for (const pattern of PATH_OR_URL_PATTERNS) {
    redacted = redacted.replace(pattern, '[redacted-path]');
  }
  redacted = redacted.replace(QUOTED_FILE_PATTERN, '$1[redacted-file]$1');
  redacted = redacted.replace(COMMON_FILE_PATTERN, '[redacted-file]');
  redacted = redacted.replace(HEX_FINGERPRINT_PATTERN, '[redacted-fingerprint]');
  return redacted;
}

function durationBucket(durationS: number | undefined): SafeSourceSummary['durationBucket'] {
  if (durationS === undefined || !Number.isFinite(durationS) || durationS < 0) return 'unknown';
  if (durationS < 10) return '<10s';
  if (durationS < 60) return '10s-1m';
  if (durationS < 600) return '1m-10m';
  if (durationS < 3600) return '10m-1h';
  return '>1h';
}

function containerFromMime(mimeType: string | null | undefined): string | undefined {
  if (!mimeType) return undefined;
  const [type] = mimeType.split(';');
  const subtype = type?.split('/')[1]?.trim();
  return subtype || undefined;
}

function sourceStatusCodes(source: DiagnosticSourceInput): string[] {
  const codes: string[] = [];
  if (source.offline) codes.push('offline');
  if (source.video && source.video.canDecode === false) codes.push('video-decode-unsupported');
  if (source.audio && source.audio.canDecode === false) codes.push('audio-decode-unsupported');
  if (source.fingerprint) codes.push(`fingerprint-${source.fingerprint.algorithm}`);
  if (source.proxy?.status) codes.push(`proxy-${source.proxy.status}`);
  return codes.length > 0 ? codes : ['ok'];
}

export function buildSafeSourceSummaries(
  sources: readonly DiagnosticSourceInput[],
): SafeSourceSummary[] {
  const aliases = stableSourceAliases(sources);
  return sources.map((source) => {
    const codecs = [source.video?.codec ?? null, source.audio?.codec ?? null].filter(
      (codec): codec is string => typeof codec === 'string' && codec.length > 0,
    );
    const width = source.video?.width;
    const height = source.video?.height;
    return {
      sourceAlias: aliases.get(source.sourceId) ?? 'source-unknown',
      mediaKind: source.offline ? 'offline' : (source.kind ?? 'unknown'),
      container: containerFromMime(source.mimeType),
      codecs,
      ...(typeof width === 'number' && typeof height === 'number'
        ? { dimensions: { width, height } }
        : {}),
      durationBucket: durationBucket(source.durationS),
      statusCodes: sourceStatusCodes(source),
    };
  });
}

function redactRecentError(error: RecentError): RecentError {
  return {
    ...error,
    message: redactDiagnosticText(error.message),
    redactedDetail: error.redactedDetail ? redactDiagnosticText(error.redactedDetail) : undefined,
    affectedSourceAlias: error.affectedSourceAlias?.startsWith('source-')
      ? error.affectedSourceAlias
      : undefined,
  };
}

function redactRecentErrorLog(log: RecentErrorLog): RecentErrorLog {
  return {
    ...log,
    entries: log.entries.map(redactRecentError),
  };
}

export function buildCopyableDiagnosticReport(
  snapshot: DiagnosticSnapshot,
  sources: readonly DiagnosticSourceInput[] = [],
  generatedAt = new Date().toISOString(),
): CopyableDiagnosticReport {
  return {
    reportSchemaVersion: 1,
    generatedAt,
    snapshotId: snapshot.snapshotId,
    appVersion: snapshot.appVersion,
    browser: snapshot.browser,
    capability: snapshot.capability,
    storage: snapshot.storage,
    proxyCache: snapshot.proxyCache,
    activeExportSettings: snapshot.activeExportSettings,
    performanceBudgets: snapshot.performanceBudgets,
    recentErrors: redactRecentErrorLog(snapshot.recentErrors),
    recoveryActions: snapshot.recoveryActions,
    safeSourceSummaries: buildSafeSourceSummaries(sources),
  };
}

export function formatCopyableDiagnosticReport(report: CopyableDiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
