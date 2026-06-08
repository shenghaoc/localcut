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
		entries: []
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
		firstOccurredAt: occurredAt,
		occurrenceCount: 1,
		message: redactDiagnosticText(input.message),
		redactedDetail: input.detail ? redactDiagnosticText(input.detail) : undefined,
		affectedJobId: input.affectedJobId,
		affectedSourceAlias: input.affectedSourceAlias?.startsWith('source-')
			? input.affectedSourceAlias
			: undefined,
		recoveryActionIds: input.recoveryActionIds ?? []
	};
}

export function addRecentError(log: RecentErrorLog, error: RecentError): RecentErrorLog {
	// Repeated errors that share subsystem+code are *folded* into a single entry
	// rather than dropped: we keep the latest message/timestamp but preserve the
	// first-seen time and bump the occurrence count, so recurring failures stay
	// visible (and countable) instead of silently collapsing to one event.
	const prior = log.entries.find(
		(entry) => entry.code === error.code && entry.subsystem === error.subsystem
	);
	const merged: RecentError = prior
		? {
				...error,
				firstOccurredAt: prior.firstOccurredAt,
				occurrenceCount: prior.occurrenceCount + error.occurrenceCount
			}
		: error;
	const rest = log.entries.filter(
		(entry) => entry.code !== error.code || entry.subsystem !== error.subsystem
	);
	const entries = [merged, ...rest];
	const kept = entries.slice(0, log.capacity);
	return {
		capacity: log.capacity,
		droppedCount: log.droppedCount + Math.max(0, entries.length - kept.length),
		entries: kept
	};
}

export function logRecentError(log: RecentErrorLog, input: RecentErrorInput): RecentErrorLog {
	return addRecentError(log, createRecentError(input));
}
