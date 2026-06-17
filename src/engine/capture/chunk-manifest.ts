import type { CaptureSourceSnapshot } from '../../protocol';

export type CaptureManifestRecord =
	| {
			kind: 'header';
			version: 1;
			sessionId: string;
			startedAtIso: string;
			epochUs: number | null;
			sources: CaptureSourceSnapshot[];
			chunkTargetS: number;
	  }
	| { kind: 'epoch'; epochUs: number }
	| {
			kind: 'chunk';
			sourceId: string;
			file: string;
			byteOffset: number;
			byteLength: number;
			fromUs: number;
			toUs: number;
			keyFrame: boolean;
			preEncodeDrops: number;
	  }
	| { kind: 'source-ended'; sourceId: string; reason: string }
	| { kind: 'finalize'; endedAtIso: string; reason: string }
	// Phase 42: Recorder UX manifest extensions (version-tolerant)
	| { kind: 'pause'; atUs: number }
	| { kind: 'resume'; atUs: number }
	| { kind: 'source-added'; source: CaptureSourceSnapshot; atUs: number }
	| { kind: 'source-region-applied'; sourceId: string; mode: 'crop' | 'element'; atUs: number }
	// Phase 45: Program Mode scene-switch events.
	| { kind: 'scene-switch'; sceneId: string; atUs: number };

export const MANIFEST_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isCaptureSourceKind(value: unknown): value is CaptureSourceSnapshot['kind'] {
	return value === 'screen' || value === 'webcam' || value === 'mic' || value === 'system-audio';
}

function isManifestSource(value: unknown): value is CaptureSourceSnapshot {
	if (!isRecord(value)) return false;
	return (
		typeof value.sourceId === 'string' &&
		isCaptureSourceKind(value.kind) &&
		typeof value.label === 'string'
	);
}

/**
 * Parse a single NDJSON line into a CaptureManifestRecord.
 * Returns `undefined` for unknown or malformed lines (forward-compatible).
 */
export function parseManifestLine(line: string): CaptureManifestRecord | undefined {
	try {
		const obj = JSON.parse(line) as unknown;
		if (!isRecord(obj) || typeof obj.kind !== 'string') {
			return undefined;
		}
		// Known kinds are validated; unknown kinds are silently skipped.
		switch (obj.kind) {
			case 'header':
				if (
					obj.version !== MANIFEST_VERSION ||
					typeof obj.sessionId !== 'string' ||
					typeof obj.startedAtIso !== 'string' ||
					!(obj.epochUs === null || isFiniteNumber(obj.epochUs)) ||
					!Array.isArray(obj.sources) ||
					!obj.sources.every(
						(source) =>
							isRecord(source) &&
							typeof source.sourceId === 'string' &&
							isCaptureSourceKind(source.kind)
					) ||
					!isFiniteNumber(obj.chunkTargetS)
				) {
					return undefined;
				}
				return obj as CaptureManifestRecord;
			case 'epoch':
				if (!isFiniteNumber(obj.epochUs)) return undefined;
				return obj as CaptureManifestRecord;
			case 'chunk':
				if (
					typeof obj.sourceId !== 'string' ||
					typeof obj.file !== 'string' ||
					!isFiniteNumber(obj.byteOffset) ||
					!isFiniteNumber(obj.byteLength) ||
					!isFiniteNumber(obj.fromUs) ||
					!isFiniteNumber(obj.toUs) ||
					typeof obj.keyFrame !== 'boolean' ||
					!isFiniteNumber(obj.preEncodeDrops)
				) {
					return undefined;
				}
				return obj as CaptureManifestRecord;
			case 'source-ended':
				if (typeof obj.sourceId !== 'string' || typeof obj.reason !== 'string') return undefined;
				return obj as CaptureManifestRecord;
			case 'finalize':
				if (typeof obj.endedAtIso !== 'string' || typeof obj.reason !== 'string') {
					return undefined;
				}
				return obj as CaptureManifestRecord;
			case 'pause':
			case 'resume':
				if (!isFiniteNumber(obj.atUs)) return undefined;
				return obj as CaptureManifestRecord;
			case 'source-added':
				if (!isFiniteNumber(obj.atUs) || !isManifestSource(obj.source)) return undefined;
				return obj as CaptureManifestRecord;
			case 'source-region-applied':
				if (typeof obj.sourceId !== 'string' || !isFiniteNumber(obj.atUs)) return undefined;
				if (obj.mode !== 'crop' && obj.mode !== 'element') return undefined;
				return obj as CaptureManifestRecord;
			case 'scene-switch':
				if (typeof obj.sceneId !== 'string' || !isFiniteNumber(obj.atUs)) return undefined;
				return obj as CaptureManifestRecord;
			default:
				return undefined;
		}
	} catch {
		// Malformed JSON (torn tail) — discard silently.
		return undefined;
	}
}

/**
 * Parse a full NDJSON manifest string into an array of records.
 * Unknown kinds and torn-tail lines are silently skipped.
 */
export function parseManifest(ndjson: string): CaptureManifestRecord[] {
	const records: CaptureManifestRecord[] = [];
	for (const line of ndjson.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const record = parseManifestLine(trimmed);
		if (record !== undefined) {
			records.push(record);
		}
	}
	return records;
}

/**
 * Append helpers for the writer — produce a JSON string for each record kind.
 */

export function appendPauseRecord(atUs: number): string {
	return JSON.stringify({ kind: 'pause', atUs });
}

export function appendResumeRecord(atUs: number): string {
	return JSON.stringify({ kind: 'resume', atUs });
}

export function appendSourceAddedRecord(source: CaptureSourceSnapshot, atUs: number): string {
	return JSON.stringify({ kind: 'source-added', source, atUs });
}

export function appendSourceRegionAppliedRecord(
	sourceId: string,
	mode: 'crop' | 'element',
	atUs: number
): string {
	return JSON.stringify({ kind: 'source-region-applied', sourceId, mode, atUs });
}
