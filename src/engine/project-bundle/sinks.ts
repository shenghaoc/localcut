/** Directory read/write adapter for bundle export/import (FS Access or test doubles). */

export interface BundleDirectorySink {
  writeText(relativePath: string, text: string): Promise<void>;
  writeBlob(relativePath: string, blob: Blob, onProgress?: (bytes: number) => void): Promise<void>;
  readText(relativePath: string): Promise<string | null>;
  readBlob(relativePath: string): Promise<Blob | null>;
  exists(relativePath: string): Promise<boolean>;
  getSize(relativePath: string): Promise<number | null>;
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function getDirectoryHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const parts = normalizePath(relativePath).split('/').filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = await current.getDirectoryHandle(parts[i]!, { create });
  }
  return current;
}

async function getFileHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = normalizePath(relativePath).split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('Invalid bundle path.');
  const dir = await getDirectoryHandle(root, relativePath, create);
  return dir.getFileHandle(parts[parts.length - 1]!, { create });
}

export function createFsDirectorySink(root: FileSystemDirectoryHandle): BundleDirectorySink {
  return {
    async writeText(relativePath, text) {
      const handle = await getFileHandle(root, relativePath, true);
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    },
    async writeBlob(relativePath, blob, onProgress) {
      const handle = await getFileHandle(root, relativePath, true);
      const writable = await handle.createWritable();
      const reader = blob.stream().getReader();
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            bytes += value.byteLength;
            onProgress?.(bytes);
            await writable.write(value);
          }
        }
        await writable.close();
      } catch (error) {
        await writable.abort();
        throw error;
      }
    },
    async readText(relativePath) {
      const blob = await this.readBlob(relativePath);
      if (!blob) return null;
      return blob.text();
    },
    async readBlob(relativePath) {
      try {
        const handle = await getFileHandle(root, relativePath, false);
        const file = await handle.getFile();
        return file;
      } catch {
        return null;
      }
    },
    async exists(relativePath) {
      try {
        await getFileHandle(root, relativePath, false);
        return true;
      } catch {
        return false;
      }
    },
    async getSize(relativePath) {
      const blob = await this.readBlob(relativePath);
      return blob ? blob.size : null;
    },
  };
}
