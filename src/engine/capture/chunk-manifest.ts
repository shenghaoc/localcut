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
	| { kind: 'source-region-applied'; sourceId: string; mode: 'crop' | 'element'; atUs: number };

export const MANIFEST_VERSION = 1;

/**
 * Parse a single NDJSON line into a CaptureManifestRecord.
 * Returns `undefined` for unknown or malformed lines (forward-compatible).
 */
export function parseManifestLine(line: string): CaptureManifestRecord | undefined {
	try {
		const obj = JSON.parse(line) as Record<string, unknown>;
		if (typeof obj !== 'object' || obj === null || typeof obj.kind !== 'string') {
			return undefined;
		}
		// Known kinds are validated; unknown kinds are silently skipped.
		switch (obj.kind) {
			case 'header':
			case 'epoch':
			case 'chunk':
			case 'source-ended':
			case 'finalize':
			case 'pause':
			case 'resume':
			case 'source-added':
			case 'source-region-applied':
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
