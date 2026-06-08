import {
	deserializeProject,
	parseSourceDescriptor,
	type ProjectDoc,
	type SourceDescriptor
} from './project';

const DB_NAME = 'localcut-projects';
const DB_VERSION = 1;
const PROJECT_STORE = 'project';
const SOURCE_STORE = 'sources';
const LAST_PROJECT_KEY = 'last';

export interface StoredSourceRecord {
	sourceId: string;
	descriptor: SourceDescriptor;
	file?: File;
	fileHandle?: FileSystemFileHandle;
}

export type StoredProjectLoadResult =
	| { ok: true; doc: ProjectDoc | null }
	| { ok: false; reason: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
	});
}

function openDatabase(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is unavailable in this browser context.'));
			return;
		}

		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(PROJECT_STORE)) {
				db.createObjectStore(PROJECT_STORE);
			}
			if (!db.objectStoreNames.contains(SOURCE_STORE)) {
				db.createObjectStore(SOURCE_STORE, { keyPath: 'sourceId' });
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};
		request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
		request.onblocked = () =>
			reject(new Error('IndexedDB upgrade is blocked by another open tab.'));
	});
	return dbPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileValue(value: unknown): value is File {
	return typeof File !== 'undefined' && value instanceof File;
}

function isFileHandleValue(value: unknown): value is FileSystemFileHandle {
	return (
		isRecord(value) &&
		value.kind === 'file' &&
		typeof value.name === 'string' &&
		typeof value.getFile === 'function'
	);
}

export async function loadStoredProject(): Promise<StoredProjectLoadResult> {
	const db = await openDatabase();
	const transaction = db.transaction(PROJECT_STORE, 'readonly');
	const done = transactionDone(transaction);
	const [value] = await Promise.all([
		requestResult<unknown>(transaction.objectStore(PROJECT_STORE).get(LAST_PROJECT_KEY)),
		done
	]);
	if (value === undefined) return { ok: true, doc: null };

	const result = deserializeProject(value);
	if (!result.ok) return result;
	return { ok: true, doc: result.doc };
}

export async function saveStoredProject(doc: ProjectDoc): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(PROJECT_STORE, 'readwrite');
	transaction.objectStore(PROJECT_STORE).put(doc, LAST_PROJECT_KEY);
	await transactionDone(transaction);
}

export async function deleteStoredProject(): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction([PROJECT_STORE, SOURCE_STORE], 'readwrite');
	transaction.objectStore(PROJECT_STORE).delete(LAST_PROJECT_KEY);
	transaction.objectStore(SOURCE_STORE).clear();
	await transactionDone(transaction);
}

export async function loadStoredSource(sourceId: string): Promise<StoredSourceRecord | null> {
	const db = await openDatabase();
	const transaction = db.transaction(SOURCE_STORE, 'readonly');
	const done = transactionDone(transaction);
	const [value] = await Promise.all([
		requestResult<unknown>(transaction.objectStore(SOURCE_STORE).get(sourceId)),
		done
	]);
	if (!isRecord(value) || value.sourceId !== sourceId || !isRecord(value.descriptor)) {
		return null;
	}

	const descriptor = parseSourceDescriptor(value.descriptor);
	if (!descriptor) return null;
	if (descriptor.sourceId !== sourceId) return null;

	const file = isFileValue(value.file) ? value.file : undefined;
	const fileHandle = isFileHandleValue(value.fileHandle) ? value.fileHandle : undefined;
	return {
		sourceId,
		descriptor,
		file,
		fileHandle
	};
}

export async function deleteStoredSource(sourceId: string): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(SOURCE_STORE, 'readwrite');
	transaction.objectStore(SOURCE_STORE).delete(sourceId);
	await transactionDone(transaction);
}

export async function saveStoredSource(record: StoredSourceRecord): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(SOURCE_STORE, 'readwrite');
	transaction.objectStore(SOURCE_STORE).put(record);
	await transactionDone(transaction);
}

export async function saveStoredSourceWithoutHandle(record: StoredSourceRecord): Promise<void> {
	await saveStoredSource({
		sourceId: record.sourceId,
		descriptor: record.descriptor,
		file: record.file
	});
}
