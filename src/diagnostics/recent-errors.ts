import type { DiagnosticSeverity, DiagnosticSubsystem, RecentError, RecentErrorLog } from './types';
import { redactDiagnosticText } from './redaction';

export interface RecentErrorInput {
  readonly code: string;
  readonly subsystem: DiagnosticSubsystem;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly detail?: string;
  readonly affectedJobId?: string;
  readonly affectedSourceAlias?: string;
  readonly recoveryActionIds?: readonly string[];
  readonly occurredAt?: string;
}

export function createEmptyRecentErrorLog(capacity = 20): RecentErrorLog {
  return {
    capacity,
    droppedCount: 0,
    entries: [],
  };
}

function makeErrorId(input: RecentErrorInput, occurredAt: string): string {
  return `${input.subsystem}.${input.code}.${occurredAt}`;
}

export function createRecentError(input: RecentErrorInput): RecentError {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return {
    id: makeErrorId(input, occurredAt),
    code: input.code,
    subsystem: input.subsystem,
    severity: input.severity,
    occurredAt,
    message: redactDiagnosticText(input.message),
    redactedDetail: input.detail ? redactDiagnosticText(input.detail) : undefined,
    affectedJobId: input.affectedJobId,
    affectedSourceAlias: input.affectedSourceAlias?.startsWith('source-')
      ? input.affectedSourceAlias
      : undefined,
    recoveryActionIds: input.recoveryActionIds ?? [],
  };
}

export function addRecentError(log: RecentErrorLog, error: RecentError): RecentErrorLog {
  const entries = [error, ...log.entries.filter((entry) => entry.code !== error.code || entry.subsystem !== error.subsystem)];
  const kept = entries.slice(0, log.capacity);
  return {
    capacity: log.capacity,
    droppedCount: log.droppedCount + Math.max(0, entries.length - kept.length),
    entries: kept,
  };
}

export function logRecentError(log: RecentErrorLog, input: RecentErrorInput): RecentErrorLog {
  return addRecentError(log, createRecentError(input));
}
