import type { MediaFingerprint } from './types';

const SMALL_BLOB_LIMIT = 64 * 1024;

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export interface FingerprintOptions {
  chunkSize?: number;
  onProgress?: (bytesDone: number) => void;
  /** Test hook: tracks the largest single chunk buffer allocated. */
  trackMaxChunkBytes?: (bytes: number) => void;
}

type DigestStreamLike = {
  writable: WritableStream<Uint8Array>;
  digest: Promise<ArrayBuffer>;
};

function getDigestStreamConstructor():
  | (new (algorithm: string) => DigestStreamLike)
  | undefined {
  return (globalThis as { DigestStream?: new (algorithm: string) => DigestStreamLike }).DigestStream;
}

async function fingerprintWithDigestStream(
  blob: Blob,
  onProgress?: (bytesDone: number) => void,
  trackMaxChunkBytes?: (bytes: number) => void,
): Promise<MediaFingerprint> {
  const DigestStreamCtor = getDigestStreamConstructor();
  if (!DigestStreamCtor) {
    throw new Error('DigestStream is unavailable for large blob fingerprinting.');
  }
  const digestStream = new DigestStreamCtor('SHA-256');
  const reader = blob.stream().getReader();
  const writer = digestStream.writable.getWriter();
  let bytesDone = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        trackMaxChunkBytes?.(value.byteLength);
        bytesDone += value.byteLength;
        onProgress?.(bytesDone);
        await writer.write(value);
      }
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error);
    throw error;
  }
  const digest = await digestStream.digest;
  return { algorithm: 'sha-256', digest: bufferToHex(digest) };
}

/** Incremental SHA-256 over blob bytes without loading large files into one buffer. */
export async function fingerprintBlob(
  blob: Blob,
  options: FingerprintOptions = {},
): Promise<MediaFingerprint> {
  if (blob.size <= SMALL_BLOB_LIMIT) {
    const buffer = await blob.arrayBuffer();
    options.trackMaxChunkBytes?.(buffer.byteLength);
    options.onProgress?.(buffer.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return { algorithm: 'sha-256', digest: bufferToHex(digest) };
  }

  if (getDigestStreamConstructor()) {
    return fingerprintWithDigestStream(blob, options.onProgress, options.trackMaxChunkBytes);
  }

  throw new Error(
    `Cannot fingerprint ${blob.size} byte blob: DigestStream is required for files larger than ${SMALL_BLOB_LIMIT} bytes.`,
  );
}

export function fingerprintsEqual(a: MediaFingerprint, b: MediaFingerprint): boolean {
  return a.algorithm === b.algorithm && a.digest === b.digest;
}
