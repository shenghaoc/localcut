/**
 * Digest-verified, offline-reusable asset loading for ML models (Phases 28/29/37).
 *
 * Every model asset is fetched same-origin, verified byte-for-byte against the
 * manifest's SHA-256 digest, and cached so the (tens-of-megabytes) download
 * happens only once. The verification and cache-coordination logic is pure and
 * injectable: the worker supplies an OPFS-backed {@link AssetStore} and the real
 * `fetch`, while tests supply in-memory fakes.
 *
 * This module is feature-agnostic: it works with any asset descriptor that has
 * `url`, `sizeBytes`, and `checksum` fields (the `ModelAssetSnapshot` shape).
 * ASR, interpolation, and audio cleanup all reuse these functions.
 */
import type { ModelAssetSnapshot } from '../ml/asset-types';

/** Persistent byte store keyed by an opaque string (the asset checksum). */
export interface AssetStore {
	get(key: string): Promise<Uint8Array | null>;
	put(key: string, bytes: Uint8Array): Promise<void>;
}

export type FetchLike = (
	url: string,
	init?: { signal?: AbortSignal; mode?: RequestMode }
) => Promise<Response>;

export interface AssetProgress {
	receivedBytes: number;
	totalBytes: number;
}

export interface LoadAssetDeps {
	/** Cache backend; when omitted, every load re-downloads. */
	store?: AssetStore | null;
	/** Defaults to the global `fetch`. */
	fetch?: FetchLike;
	onProgress?: (progress: AssetProgress) => void;
	/** Reports whether the bytes came from the OPFS cache or the network. */
	onSource?: (source: 'cache' | 'network') => void;
	signal?: AbortSignal;
}

export class AssetIntegrityError extends Error {
	constructor(reason: string) {
		super(`ASR model asset failed integrity check: ${reason}`);
		this.name = 'AssetIntegrityError';
	}
}

export class AssetFetchError extends Error {
	constructor(reason: string) {
		super(`ASR model asset download failed: ${reason}`);
		this.name = 'AssetFetchError';
	}
}

/** Computes the `sha256-<hex>` digest of the given bytes via WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	const hex = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	return `sha256-${hex}`;
}

/** Throws unless `bytes` matches the asset's declared size and SHA-256 digest. */
export async function verifyAsset(bytes: Uint8Array, asset: ModelAssetSnapshot): Promise<void> {
	if (bytes.byteLength !== asset.sizeBytes) {
		throw new AssetIntegrityError(
			`size mismatch for ${asset.url}: expected ${asset.sizeBytes} bytes, got ${bytes.byteLength}`
		);
	}
	const digest = await sha256Hex(bytes);
	if (digest !== asset.checksum) {
		throw new AssetIntegrityError(`checksum mismatch for ${asset.url}: ${digest}`);
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function fetchWithProgress(
	asset: ModelAssetSnapshot,
	deps: LoadAssetDeps
): Promise<Uint8Array> {
	const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
	// Force CORS mode: an opaque (no-cors) cross-origin response carries no CORS
	// headers and would be blocked by the page's COEP: require-corp policy (and
	// can't be read anyway). A CORS response, by contrast, satisfies require-corp
	// without a CORP header — which is how remote model hosts (e.g. Hugging Face)
	// work from this cross-origin-isolated app.
	const response = await doFetch(asset.url, { signal: deps.signal, mode: 'cors' });
	if (!response.ok) {
		throw new AssetFetchError(`HTTP ${response.status} for ${asset.url}`);
	}

	const total = asset.sizeBytes;
	const body = response.body;
	if (!body) {
		// No streaming body (e.g. test Response); fall back to a single buffer.
		const buffer = new Uint8Array(await response.arrayBuffer());
		deps.onProgress?.({ receivedBytes: buffer.byteLength, totalBytes: total });
		return buffer;
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	let shouldCancelReader = false;
	try {
		for (;;) {
			throwIfAborted(deps.signal);
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				chunks.push(value);
				received += value.byteLength;
				deps.onProgress?.({ receivedBytes: received, totalBytes: total });
				if (received >= total) {
					shouldCancelReader = true;
					break;
				}
			}
		}
	} finally {
		if (shouldCancelReader) {
			await reader.cancel().catch(() => undefined);
		}
		reader.releaseLock();
	}

	const out = new Uint8Array(Math.min(received, total));
	let offset = 0;
	for (const chunk of chunks) {
		const remaining = out.byteLength - offset;
		if (remaining <= 0) break;
		const toCopy = Math.min(chunk.byteLength, remaining);
		out.set(chunk.subarray(0, toCopy), offset);
		offset += toCopy;
	}
	return out;
}

/**
 * Returns verified bytes for one asset, fetching and caching on first use and
 * reusing the cached copy (re-verified against the digest) afterwards. A
 * corrupted cache entry is silently re-downloaded; a corrupted *download* is a
 * hard error — never a fall-through to an unverified source.
 */
export async function loadVerifiedAsset(
	asset: ModelAssetSnapshot,
	deps: LoadAssetDeps = {}
): Promise<Uint8Array> {
	throwIfAborted(deps.signal);
	const key = asset.checksum;

	if (deps.store) {
		const cached = await deps.store.get(key).catch(() => null);
		if (cached) {
			try {
				await verifyAsset(cached, asset);
				deps.onProgress?.({ receivedBytes: asset.sizeBytes, totalBytes: asset.sizeBytes });
				deps.onSource?.('cache');
				return cached;
			} catch {
				// Corrupt cache entry — fall through and re-download.
			}
		}
	}

	const bytes = await fetchWithProgress(asset, deps);
	await verifyAsset(bytes, asset);
	deps.onSource?.('network');
	if (deps.store) {
		await deps.store.put(key, bytes).catch(() => {
			// Best-effort cache; a write failure must not fail the load.
		});
	}
	return bytes;
}

/**
 * OPFS-backed {@link AssetStore} for use inside the ASR worker. Returns `null`
 * when OPFS is unavailable, in which case loads simply re-download each session.
 */
export async function createOpfsAssetStore(dirName = 'asr-models'): Promise<AssetStore | null> {
	try {
		const storage = (navigator as Navigator & { storage?: StorageManager }).storage;
		if (!storage || typeof storage.getDirectory !== 'function') return null;
		const root = await storage.getDirectory();
		const dir = await root.getDirectoryHandle(dirName, { create: true });
		const fileName = (key: string): string => key.replace(/[^a-z0-9-]/gi, '_');
		return {
			async get(key) {
				try {
					const handle = await dir.getFileHandle(fileName(key));
					const file = await handle.getFile();
					return new Uint8Array(await file.arrayBuffer());
				} catch {
					return null;
				}
			},
			async put(key, bytes) {
				const handle = await dir.getFileHandle(fileName(key), { create: true });
				const writable = await handle.createWritable();
				await writable.write(bytes as BufferSource);
				await writable.close();
			}
		};
	} catch {
		return null;
	}
}
