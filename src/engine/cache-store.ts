import type { ProxyManifest } from './cache-types';
import type { CacheStorageEstimate } from './cache-budget';

export interface CacheWriteResult {
  readonly path: string;
  readonly byteSize: number;
}

export interface CacheDeleteResult {
  readonly deletedPaths: readonly string[];
  readonly missingPaths: readonly string[];
}

export interface CacheStore {
  readManifest(projectId: string): Promise<ProxyManifest | null>;
  writeManifest(manifest: ProxyManifest): Promise<void>;
  writeChunk(path: string, data: ReadableStream<Uint8Array> | Blob): Promise<CacheWriteResult>;
  readChunk(path: string): Promise<Blob | null>;
  deletePaths(paths: readonly string[]): Promise<CacheDeleteResult>;
  estimate(): Promise<CacheStorageEstimate>;
}

interface OpfsDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface StorageManagerWithOptionalOpfs {
  getDirectory?: () => Promise<OpfsDirectoryHandle>;
}

interface IndexedCacheRecord {
  path: string;
  blob: Blob;
  updatedAt: number;
}

const CACHE_DB_NAME = 'localcut-cache-v1';
const CACHE_STORE_NAME = 'chunks';

function cleanPath(path: string): string[] {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..');
}

function manifestPath(projectId: string): string {
  return `manifests/${projectId}.json`;
}

async function blobFromData(data: ReadableStream<Uint8Array> | Blob): Promise<Blob> {
  if (data instanceof Blob) return data;
  return new Response(data).blob();
}

async function writeDataToFile(
  file: FileSystemFileHandle,
  data: ReadableStream<Uint8Array> | Blob,
): Promise<number> {
  const writable = await file.createWritable();
  let byteSize = 0;
  try {
    if (data instanceof Blob) {
      byteSize = data.size;
      await writable.write(data);
    } else {
      const reader = data.getReader();
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          byteSize += result.value.byteLength;
          await writable.write(result.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
  await writable.close();
  return byteSize;
}

class OpfsCacheStore implements CacheStore {
  constructor(private readonly root: OpfsDirectoryHandle) {}

  async readManifest(projectId: string): Promise<ProxyManifest | null> {
    const blob = await this.readChunk(manifestPath(projectId));
    if (!blob) return null;
    try {
      return JSON.parse(await blob.text()) as ProxyManifest;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: ProxyManifest): Promise<void> {
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    await this.writeChunk(manifestPath(manifest.projectId), blob);
  }

  async writeChunk(path: string, data: ReadableStream<Uint8Array> | Blob): Promise<CacheWriteResult> {
    const file = await this.fileHandle(path, true);
    const byteSize = await writeDataToFile(file, data);
    return { path, byteSize };
  }

  async readChunk(path: string): Promise<Blob | null> {
    try {
      return await (await this.fileHandle(path, false)).getFile();
    } catch {
      return null;
    }
  }

  async deletePaths(paths: readonly string[]): Promise<CacheDeleteResult> {
    const deletedPaths: string[] = [];
    const missingPaths: string[] = [];
    for (const path of paths) {
      try {
        const parts = cleanPath(path);
        const fileName = parts.pop();
        if (!fileName) {
          missingPaths.push(path);
          continue;
        }
        const dir = await this.directoryForParts(parts, false);
        await dir.removeEntry(fileName);
        deletedPaths.push(path);
      } catch {
        missingPaths.push(path);
      }
    }
    return { deletedPaths, missingPaths };
  }

  async estimate(): Promise<CacheStorageEstimate> {
    const estimate = await navigator.storage.estimate();
    return {
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? null,
    };
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = cleanPath(path);
    const fileName = parts.pop();
    if (!fileName) throw new Error('Cache path must include a file name.');
    const dir = await this.directoryForParts(parts, create);
    return dir.getFileHandle(fileName, { create });
  }

  private async directoryForParts(parts: readonly string[], create: boolean): Promise<OpfsDirectoryHandle> {
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }
}

function openIndexedCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open cache database.'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cache database request failed.'));
  });
}

class IndexedDbCacheStore implements CacheStore {
  private readonly dbPromise = openIndexedCacheDb();

  async readManifest(projectId: string): Promise<ProxyManifest | null> {
    const blob = await this.readChunk(manifestPath(projectId));
    if (!blob) return null;
    try {
      return JSON.parse(await blob.text()) as ProxyManifest;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: ProxyManifest): Promise<void> {
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    await this.writeChunk(manifestPath(manifest.projectId), blob);
  }

  async writeChunk(path: string, data: ReadableStream<Uint8Array> | Blob): Promise<CacheWriteResult> {
    const blob = await blobFromData(data);
    const db = await this.dbPromise;
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CACHE_STORE_NAME);
    const record: IndexedCacheRecord = { path, blob, updatedAt: Date.now() };
    await idbRequest(store.put(record));
    await transactionDone(tx);
    return { path, byteSize: blob.size };
  }

  async readChunk(path: string): Promise<Blob | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
    const store = tx.objectStore(CACHE_STORE_NAME);
    const record = (await idbRequest(store.get(path))) as IndexedCacheRecord | undefined;
    return record?.blob ?? null;
  }

  async deletePaths(paths: readonly string[]): Promise<CacheDeleteResult> {
    const db = await this.dbPromise;
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CACHE_STORE_NAME);
    const deletedPaths: string[] = [];
    for (const path of paths) {
      await idbRequest(store.delete(path));
      deletedPaths.push(path);
    }
    await transactionDone(tx);
    return { deletedPaths, missingPaths: [] };
  }

  async estimate(): Promise<CacheStorageEstimate> {
    const estimate = await navigator.storage.estimate();
    return {
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? null,
    };
  }
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Cache transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Cache transaction aborted.'));
  });
}

export async function createCacheStore(): Promise<CacheStore> {
  const storage = navigator.storage as unknown as StorageManagerWithOptionalOpfs;
  if (storage.getDirectory) {
    return new OpfsCacheStore(await storage.getDirectory());
  }
  return new IndexedDbCacheStore();
}
