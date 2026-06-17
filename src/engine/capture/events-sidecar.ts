/** Phase 41 T13.9 — read a capture session's `events.ndjson` sidecar.
 *
 *  Called on the main thread after `capture-landed` (the writer worker has
 *  already closed its SyncAccessHandle in handleFinalize, so the file is
 *  consistent and openable read-only). Crash-recovery import (future T7.3)
 *  uses the same reader.
 *
 *  Parsing is torn-tail tolerant: malformed lines are skipped without
 *  failing the whole read, mirroring the manifest parser policy. Missing
 *  file returns null (sidecar absent → no entries to populate).
 */

import type { CaptureEventLogEntry } from './event-log';

interface OptionalStorageManager {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
}

async function getCaptureSessionDir(sessionId: string): Promise<FileSystemDirectoryHandle | null> {
	const storage = (typeof navigator !== 'undefined' ? navigator.storage : undefined) as
		| OptionalStorageManager
		| undefined;
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		const captureDir = await root.getDirectoryHandle('capture', { create: false });
		return await captureDir.getDirectoryHandle(sessionId, { create: false });
	} catch {
		// Missing capture dir or session dir — sidecar is absent.
		return null;
	}
}

/**
 * Read and parse the session's `events.ndjson` sidecar.
 *
 * @returns parsed entries (possibly empty) when the file exists, or `null`
 *          when the OPFS file is missing or unreadable. Callers should treat
 *          a null result the same as "no events" — events are non-fatal
 *          sidecar data and the session is still valid without them.
 */
export async function readCaptureEventsSidecar(
	sessionId: string
): Promise<CaptureEventLogEntry[] | null> {
	const sessionDir = await getCaptureSessionDir(sessionId);
	if (!sessionDir) return null;

	let fileHandle: FileSystemFileHandle;
	try {
		fileHandle = await sessionDir.getFileHandle('events.ndjson', { create: false });
	} catch {
		// Sidecar wasn't opened (writer header failure path) — that's fine.
		return null;
	}

	let text: string;
	try {
		const file = await fileHandle.getFile();
		text = await file.text();
	} catch {
		return null;
	}

	return parseEventsSidecar(text);
}

/**
 * Pure parser for the sidecar text. Exposed for unit tests so they don't
 * have to round-trip through OPFS.
 */
export function parseEventsSidecar(text: string): CaptureEventLogEntry[] {
	const entries: CaptureEventLogEntry[] = [];
	if (!text) return entries;
	// `\n`-separated; the last line may be torn (no trailing newline + partial JSON).
	const lines = text.split('\n');
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		try {
			const parsed = JSON.parse(line) as CaptureEventLogEntry;
			if (typeof parsed === 'object' && parsed !== null && typeof parsed.kind === 'string') {
				entries.push(parsed);
			}
		} catch {
			// Torn or otherwise malformed line — skip it, keep what parses.
		}
	}
	return entries;
}
