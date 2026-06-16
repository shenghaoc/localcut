import {
	deserializeProject,
	parseSourceDescriptor,
	type ProjectDoc,
	type SourceDescriptor
} from './project';
import type { PublishSettingsDoc } from '../protocol';
import { parsePublishSettings, sanitizeForPersist } from './publish-settings';
import {
	DEFAULT_WEBCAM_PRESET,
	type WebcamPipPreset,
	type WebcamPipCorner,
	type WebcamPipSize
} from './capture/webcam-preset';

const DB_NAME = 'localcut-projects';
const DB_VERSION = 3;
const PROJECT_STORE = 'project';
const SOURCE_STORE = 'sources';
// Phase 47: device-scoped publish settings. A separate store — never part of
// ProjectDoc — so project bundles and autosaves structurally cannot carry
// stream destinations or bearer tokens (R7.3).
const PUBLISH_SETTINGS_STORE = 'publish-settings';
export const CAPTURE_SETTINGS_STORE = 'capture-settings';
// Phase 45: device-scoped program source bindings. Maps sourceId to deviceId
// for webcam/mic sources. Not part of ProjectDoc because device IDs are
// machine-local and would make bundles non-portable.
const PROGRAM_SOURCE_BINDINGS_STORE = 'program-source-bindings';
const LAST_PROJECT_KEY = 'last';
const PUBLISH_SETTINGS_KEY = 'device';
const CAPTURE_SETTINGS_KEY = 'device';
const PROGRAM_SOURCE_BINDINGS_KEY = 'bindings';

export interface CaptureUxSettings {
	countdownS: 0 | 3 | 5;
	webcamPreset: WebcamPipPreset;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureUxSettings = {
	countdownS: 3,
	webcamPreset: { ...DEFAULT_WEBCAM_PRESET }
};

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
			if (!db.objectStoreNames.contains(PUBLISH_SETTINGS_STORE)) {
				db.createObjectStore(PUBLISH_SETTINGS_STORE);
			}
			if (!db.objectStoreNames.contains(CAPTURE_SETTINGS_STORE)) {
				db.createObjectStore(CAPTURE_SETTINGS_STORE);
			}
			if (!db.objectStoreNames.contains(PROGRAM_SOURCE_BINDINGS_STORE)) {
				db.createObjectStore(PROGRAM_SOURCE_BINDINGS_STORE);
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

function parseCountdown(value: unknown): CaptureUxSettings['countdownS'] {
	return value === 0 || value === 3 || value === 5 ? value : DEFAULT_CAPTURE_SETTINGS.countdownS;
}

function parseWebcamCorner(value: unknown): WebcamPipCorner {
	return value === 'top-left' ||
		value === 'top-right' ||
		value === 'bottom-left' ||
		value === 'bottom-right'
		? value
		: DEFAULT_CAPTURE_SETTINGS.webcamPreset.corner;
}

function parseWebcamSize(value: unknown): WebcamPipSize {
	return value === 'S' || value === 'M' || value === 'L'
		? value
		: DEFAULT_CAPTURE_SETTINGS.webcamPreset.size;
}

function parseWebcamPreset(value: unknown): WebcamPipPreset {
	if (!isRecord(value)) return { ...DEFAULT_CAPTURE_SETTINGS.webcamPreset };
	const margin =
		typeof value.marginPx === 'number' && Number.isFinite(value.marginPx)
			? Math.max(0, Math.min(64, Math.round(value.marginPx / 4) * 4))
			: DEFAULT_CAPTURE_SETTINGS.webcamPreset.marginPx;
	return {
		corner: parseWebcamCorner(value.corner),
		size: parseWebcamSize(value.size),
		marginPx: margin
	};
}

function parseCaptureSettings(value: unknown): CaptureUxSettings {
	if (!isRecord(value))
		return { ...DEFAULT_CAPTURE_SETTINGS, webcamPreset: { ...DEFAULT_WEBCAM_PRESET } };
	return {
		countdownS: parseCountdown(value.countdownS),
		webcamPreset: parseWebcamPreset(value.webcamPreset)
	};
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

export async function loadPublishSettings(): Promise<PublishSettingsDoc | null> {
	const db = await openDatabase();
	const transaction = db.transaction(PUBLISH_SETTINGS_STORE, 'readonly');
	const done = transactionDone(transaction);
	const [value] = await Promise.all([
		requestResult<unknown>(
			transaction.objectStore(PUBLISH_SETTINGS_STORE).get(PUBLISH_SETTINGS_KEY)
		),
		done
	]);
	return parsePublishSettings(value);
}

/** The token is stripped here unless the user opted in (R7.2). */
export async function savePublishSettings(settings: PublishSettingsDoc): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(PUBLISH_SETTINGS_STORE, 'readwrite');
	transaction
		.objectStore(PUBLISH_SETTINGS_STORE)
		.put(sanitizeForPersist(settings), PUBLISH_SETTINGS_KEY);
	await transactionDone(transaction);
}

export async function deletePublishSettings(): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(PUBLISH_SETTINGS_STORE, 'readwrite');
	transaction.objectStore(PUBLISH_SETTINGS_STORE).delete(PUBLISH_SETTINGS_KEY);
	await transactionDone(transaction);
}

export async function loadCaptureSettings(): Promise<CaptureUxSettings> {
	try {
		const db = await openDatabase();
		const transaction = db.transaction(CAPTURE_SETTINGS_STORE, 'readonly');
		const done = transactionDone(transaction);
		const [value] = await Promise.all([
			requestResult<unknown>(
				transaction.objectStore(CAPTURE_SETTINGS_STORE).get(CAPTURE_SETTINGS_KEY)
			),
			done
		]);
		return parseCaptureSettings(value);
	} catch {
		return { ...DEFAULT_CAPTURE_SETTINGS, webcamPreset: { ...DEFAULT_WEBCAM_PRESET } };
	}
}

export async function saveCaptureSettings(settings: CaptureUxSettings): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(CAPTURE_SETTINGS_STORE, 'readwrite');
	transaction.objectStore(CAPTURE_SETTINGS_STORE).put(
		{
			countdownS: parseCountdown(settings.countdownS),
			webcamPreset: parseWebcamPreset(settings.webcamPreset)
		},
		CAPTURE_SETTINGS_KEY
	);
	await transactionDone(transaction);
}

export async function saveStoredSourceWithoutHandle(record: StoredSourceRecord): Promise<void> {
	await saveStoredSource({
		sourceId: record.sourceId,
		descriptor: record.descriptor,
		file: record.file
	});
}

// ── Phase 45: Program Source Bindings ──

export interface ProgramSourceBinding {
	sourceId: string;
	kind: 'webcam' | 'mic';
	deviceId: string;
	label: string;
}

export async function loadProgramSourceBindings(): Promise<ProgramSourceBinding[] | null> {
	const db = await openDatabase();
	const transaction = db.transaction(PROGRAM_SOURCE_BINDINGS_STORE, 'readonly');
	const done = transactionDone(transaction);
	const [value] = await Promise.all([
		requestResult<unknown>(
			transaction.objectStore(PROGRAM_SOURCE_BINDINGS_STORE).get(PROGRAM_SOURCE_BINDINGS_KEY)
		),
		done
	]);
	if (!Array.isArray(value)) return null;
	// Validate each binding
	const bindings: ProgramSourceBinding[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		if (typeof item.sourceId !== 'string') continue;
		if (item.kind !== 'webcam' && item.kind !== 'mic') continue;
		if (typeof item.deviceId !== 'string') continue;
		if (typeof item.label !== 'string') continue;
		bindings.push({
			sourceId: item.sourceId,
			kind: item.kind,
			deviceId: item.deviceId,
			label: item.label
		});
	}
	return bindings;
}

export async function saveProgramSourceBindings(bindings: ProgramSourceBinding[]): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(PROGRAM_SOURCE_BINDINGS_STORE, 'readwrite');
	transaction.objectStore(PROGRAM_SOURCE_BINDINGS_STORE).put(bindings, PROGRAM_SOURCE_BINDINGS_KEY);
	await transactionDone(transaction);
}
