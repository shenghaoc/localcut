import type { SpillRange } from '../../protocol';
import type { RingBufferEntry } from './ring-buffer';

const SPILL_DIR = 'replay-buffer';
const SPILL_FILE_PREFIX = 'replay-spill-';

// Binary layout:
//   Header: startTimestamp (f64), endTimestamp (f64), entryCount (u32), hasKeyframe (u8)
//   Per entry: type (u8: 0=video, 1=audio), timestamp (f64), duration (f64),
//              isKeyframe (u8), byteSize (u32), then byteSize raw chunk bytes.
const HEADER_SIZE = 8 + 8 + 4 + 1;
const ENTRY_META_SIZE = 1 + 8 + 8 + 1 + 4;

/** Pure serializer so the format round-trips under unit test without OPFS. */
export function encodeSpillBuffer(
	entries: readonly RingBufferEntry[],
	range: SpillRange
): ArrayBuffer {
	const totalSize =
		HEADER_SIZE + entries.reduce((sum, e) => sum + ENTRY_META_SIZE + e.data.byteLength, 0);
	const buf = new ArrayBuffer(totalSize);
	const view = new DataView(buf);
	const bytes = new Uint8Array(buf);
	let offset = 0;
	view.setFloat64(offset, range.startTimestamp, true);
	offset += 8;
	view.setFloat64(offset, range.endTimestamp, true);
	offset += 8;
	view.setUint32(offset, entries.length, true);
	offset += 4;
	view.setUint8(offset, range.hasKeyframe ? 1 : 0);
	offset += 1;

	for (const entry of entries) {
		view.setUint8(offset, entry.type === 'video' ? 0 : 1);
		offset += 1;
		view.setFloat64(offset, entry.timestamp, true);
		offset += 8;
		view.setFloat64(offset, entry.duration, true);
		offset += 8;
		view.setUint8(offset, entry.isKeyframe ? 1 : 0);
		offset += 1;
		view.setUint32(offset, entry.data.byteLength, true);
		offset += 4;
		bytes.set(entry.data, offset);
		offset += entry.data.byteLength;
	}
	return buf;
}

/** Pure deserializer; the inverse of {@link encodeSpillBuffer}. */
export function decodeSpillBuffer(buf: ArrayBuffer): RingBufferEntry[] {
	const view = new DataView(buf);
	let offset = 8 + 8; // start/end timestamps (already captured in SpillRange)
	const entryCount = view.getUint32(offset, true);
	offset += 4;
	offset += 1; // hasKeyframe

	const entries: RingBufferEntry[] = [];
	for (let i = 0; i < entryCount; i++) {
		const type = view.getUint8(offset) === 0 ? ('video' as const) : ('audio' as const);
		offset += 1;
		const timestamp = view.getFloat64(offset, true);
		offset += 8;
		const duration = view.getFloat64(offset, true);
		offset += 8;
		const isKeyframe = view.getUint8(offset) === 1;
		offset += 1;
		const byteSize = view.getUint32(offset, true);
		offset += 4;
		const data = new Uint8Array(buf.slice(offset, offset + byteSize));
		offset += byteSize;
		entries.push({ type, timestamp, duration, byteSize, isKeyframe, data });
	}
	return entries;
}

function getDir(): Promise<FileSystemDirectoryHandle> {
	if (typeof navigator === 'undefined' || !navigator.storage) {
		return Promise.reject(new Error('OPFS is not supported in this environment.'));
	}
	return navigator.storage
		.getDirectory()
		.then((root) => root.getDirectoryHandle(SPILL_DIR, { create: true }));
}

export async function spillEntries(entries: RingBufferEntry[], range: SpillRange): Promise<void> {
	const dir = await getDir();
	const fileHandle = await dir.getFileHandle(range.opfsFileName, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(encodeSpillBuffer(entries, range));
	} catch (error) {
		await writable.close().catch(() => undefined);
		throw error;
	}
	await writable.close();
}

export async function readSpillRange(range: SpillRange): Promise<RingBufferEntry[]> {
	const dir = await getDir();
	let fileHandle: FileSystemFileHandle;
	try {
		fileHandle = await dir.getFileHandle(range.opfsFileName);
	} catch {
		return [];
	}
	const file = await fileHandle.getFile();
	return decodeSpillBuffer(await file.arrayBuffer());
}

export async function deleteSpillFile(range: SpillRange): Promise<void> {
	const dir = await getDir();
	try {
		await dir.removeEntry(range.opfsFileName);
	} catch {
		// File may not exist — ignore
	}
}

export async function cleanupSpills(): Promise<void> {
	const dir = await getDir();
	// FileSystemDirectoryHandle doesn't expose async iterable in all TS libs.
	// Use a manual iteration via keys() which returns an async iterator.
	const iter = (dir as unknown as { keys(): AsyncIterableIterator<string> }).keys();
	if (iter) {
		for await (const name of iter) {
			if (name.startsWith(SPILL_FILE_PREFIX)) {
				try {
					await dir.removeEntry(name);
				} catch {
					/* Ignore */
				}
			}
		}
	}
}

/**
 * Creates (or truncates) a file in the replay OPFS directory for a finalized
 * saved clip. Saved clips share the directory with spill files but use a
 * distinct prefix, so {@link cleanupSpills} leaves them alone.
 */
export async function createReplaySaveFile(fileName: string): Promise<FileSystemFileHandle> {
	const dir = await getDir();
	return dir.getFileHandle(fileName, { create: true });
}

export async function deleteReplaySaveFile(fileName: string): Promise<void> {
	const dir = await getDir();
	try {
		await dir.removeEntry(fileName);
	} catch {
		// File may not exist — ignore
	}
}
