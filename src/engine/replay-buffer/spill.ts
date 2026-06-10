import type { SpillRange } from '../../protocol';
import type { RingBufferEntry } from './ring-buffer';

const SPILL_DIR = 'replay-buffer';

function getDir(): Promise<FileSystemDirectoryHandle> {
	return navigator.storage.getDirectory().then((root) =>
		root.getDirectoryHandle(SPILL_DIR, { create: true }),
	);
}

export async function spillEntries(
	entries: RingBufferEntry[],
	range: SpillRange,
): Promise<void> {
	const dir = await getDir();
	const fileHandle = await dir.getFileHandle(range.opfsFileName, { create: true });
	const writable = await fileHandle.createWritable();

	// Binary header: startTimestamp (f64), endTimestamp (f64), entryCount (u32), hasKeyframe (u8)
	const headerSize = 8 + 8 + 4 + 1;
	const totalSize = headerSize + entries.reduce((sum, e) => {
		// Per entry: type (u8), timestamp (f64), duration (f64), isKeyframe (u8), byteSize (u32)
		return sum + 1 + 8 + 8 + 1 + 4 + e.byteSize;
	}, 0);

	const buf = new ArrayBuffer(totalSize);
	const view = new DataView(buf);
	let offset = 0;
	view.setFloat64(offset, range.startTimestamp, true); offset += 8;
	view.setFloat64(offset, range.endTimestamp, true); offset += 8;
	view.setUint32(offset, entries.length, true); offset += 4;
	view.setUint8(offset, range.hasKeyframe ? 1 : 0); offset += 1;

	for (const entry of entries) {
		view.setUint8(offset, entry.type === 'video' ? 0 : 1); offset += 1;
		view.setFloat64(offset, entry.timestamp, true); offset += 8;
		view.setFloat64(offset, entry.duration, true); offset += 8;
		view.setUint8(offset, entry.isKeyframe ? 1 : 0); offset += 1;
		view.setUint32(offset, entry.byteSize, true); offset += 4;
		// Chunk data is stored externally (in EncodedChunk). Here we store byteSize only.
		// The actual chunk bytes are assumed to be re-assembled via the encoder output path.
	}

	await writable.write(buf);
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
	const buf = await file.arrayBuffer();
	const view = new DataView(buf);
	let offset = 0;

	// Read header (skip values already captured in SpillRange)
	offset += 8 + 8; // start/end timestamps
	const entryCount = view.getUint32(offset, true); offset += 4;
	offset += 1; // hasKeyframe

	const entries: RingBufferEntry[] = [];
	for (let i = 0; i < entryCount; i++) {
		const type = view.getUint8(offset) === 0 ? 'video' as const : 'audio' as const; offset += 1;
		const timestamp = view.getFloat64(offset, true); offset += 8;
		const duration = view.getFloat64(offset, true); offset += 8;
		const isKeyframe = view.getUint8(offset) === 1; offset += 1;
		const byteSize = view.getUint32(offset, true); offset += 4;
		entries.push({ type, timestamp, duration, byteSize, isKeyframe });
	}
	return entries;
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
			if (name.startsWith('replay-spill-')) {
				try { await dir.removeEntry(name); } catch { /* Ignore */ }
			}
		}
	}
}
