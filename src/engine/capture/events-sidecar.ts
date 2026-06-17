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
 *
 * Reads the file as a stream and parses line-by-line so peak memory holds
 * roughly (one chunk + the final entry array), not (full text + split-array
 * + entry array). For a 10-minute capture with continuous pointer events
 * (~36k events, ~3 MB file), that drops the main-thread allocation peak from
 * ~9 MB to under 4 MB.
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

	try {
		const file = await fileHandle.getFile();
		return await parseEventsSidecarStream(file.stream());
	} catch {
		return null;
	}
}

/** Parse an NDJSON stream of CaptureEventLogEntry records. Tolerates a torn
 *  final line and malformed records (skipped without aborting). */
export async function parseEventsSidecarStream(
	stream: ReadableStream<Uint8Array>
): Promise<CaptureEventLogEntry[]> {
	const entries: CaptureEventLogEntry[] = [];
	// `TextDecoderStream` is a TransformStream<BufferSource, string>; cast the
	// input stream to `ReadableStream<BufferSource>` because the TS lib types
	// are stricter than the spec on the pipeThrough input parameter.
	const reader = (stream as unknown as ReadableStream<BufferSource>)
		.pipeThrough(new TextDecoderStream())
		.getReader();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += value;
			// Drain all complete lines from the buffer; the trailing remainder
			// stays for the next chunk (or for the torn-tail handling below).
			let newlineIndex = buffer.indexOf('\n');
			while (newlineIndex !== -1) {
				pushIfValid(entries, buffer.slice(0, newlineIndex));
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf('\n');
			}
		}
	} finally {
		reader.releaseLock();
	}
	// Final unterminated line — may be valid (writer crashed without writing a
	// trailing \n) or torn JSON. `pushIfValid` skips on parse failure either way.
	pushIfValid(entries, buffer);
	return entries;
}

/**
 * Pure parser for the sidecar text. Kept for unit tests so they don't have to
 * round-trip through a real stream. Production code path uses
 * {@link parseEventsSidecarStream}.
 */
export function parseEventsSidecar(text: string): CaptureEventLogEntry[] {
	const entries: CaptureEventLogEntry[] = [];
	if (!text) return entries;
	const lines = text.split('\n');
	for (const raw of lines) pushIfValid(entries, raw);
	return entries;
}

function pushIfValid(entries: CaptureEventLogEntry[], raw: string): void {
	const line = raw.trim();
	if (!line) return;
	try {
		const parsed = JSON.parse(line) as CaptureEventLogEntry;
		if (typeof parsed === 'object' && parsed !== null && typeof parsed.kind === 'string') {
			entries.push(parsed);
		}
	} catch {
		// Torn or otherwise malformed line — skip it, keep what parses.
	}
}
