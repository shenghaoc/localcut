import { describe, expect, it } from 'vite-plus/test';
import type { AsrModelAssetSnapshot } from '../../protocol';
import {
	AssetFetchError,
	AssetIntegrityError,
	loadVerifiedAsset,
	sha256Hex,
	verifyAsset,
	type AssetStore,
	type FetchLike
} from './asset-cache';

function memStore(): AssetStore & { map: Map<string, Uint8Array> } {
	const map = new Map<string, Uint8Array>();
	return {
		map,
		async get(key) {
			return map.get(key) ?? null;
		},
		async put(key, bytes) {
			map.set(key, bytes);
		}
	};
}

async function asset(bytes: Uint8Array, url = '/model.bin'): Promise<AsrModelAssetSnapshot> {
	return { url, sizeBytes: bytes.byteLength, checksum: await sha256Hex(bytes) };
}

function countingFetch(bytes: Uint8Array): FetchLike & { calls: number } {
	const fn: FetchLike & { calls: number } = Object.assign(
		async () => {
			fn.calls++;
			return new Response(bytes.slice());
		},
		{ calls: 0 }
	);
	return fn;
}

const SAMPLE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('verifyAsset', () => {
	it('passes for matching bytes', async () => {
		await expect(verifyAsset(SAMPLE, await asset(SAMPLE))).resolves.toBeUndefined();
	});

	it('rejects a size mismatch', async () => {
		const a = await asset(SAMPLE);
		await expect(verifyAsset(new Uint8Array([1, 2, 3]), a)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
	});

	it('rejects a digest mismatch', async () => {
		const a = await asset(SAMPLE);
		const tampered = SAMPLE.slice();
		tampered[0] = 99;
		await expect(verifyAsset(tampered, a)).rejects.toThrow(/checksum mismatch/);
	});
});

describe('loadVerifiedAsset', () => {
	it('downloads, verifies, and caches on first use', async () => {
		const a = await asset(SAMPLE);
		const store = memStore();
		const fetchFn = countingFetch(SAMPLE);
		const bytes = await loadVerifiedAsset(a, { store, fetch: fetchFn });
		expect(Array.from(bytes)).toEqual(Array.from(SAMPLE));
		expect(fetchFn.calls).toBe(1);
		expect(store.map.has(a.checksum)).toBe(true);
	});

	it('reuses the cached copy without re-downloading', async () => {
		const a = await asset(SAMPLE);
		const store = memStore();
		const fetchFn = countingFetch(SAMPLE);
		await loadVerifiedAsset(a, { store, fetch: fetchFn });
		await loadVerifiedAsset(a, { store, fetch: fetchFn });
		expect(fetchFn.calls).toBe(1);
	});

	it('re-downloads when the cached copy is corrupt', async () => {
		const a = await asset(SAMPLE);
		const store = memStore();
		store.map.set(a.checksum, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
		const fetchFn = countingFetch(SAMPLE);
		const bytes = await loadVerifiedAsset(a, { store, fetch: fetchFn });
		expect(Array.from(bytes)).toEqual(Array.from(SAMPLE));
		expect(fetchFn.calls).toBe(1);
	});

	it('reports download progress', async () => {
		const a = await asset(SAMPLE);
		const events: number[] = [];
		await loadVerifiedAsset(a, {
			fetch: countingFetch(SAMPLE),
			onProgress: (p) => events.push(p.receivedBytes)
		});
		expect(events.at(-1)).toBe(SAMPLE.byteLength);
	});

	it('stops reading once the manifest-declared byte count arrives', async () => {
		const a = await asset(SAMPLE);
		let cancelled = false;
		const hangingBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(SAMPLE.slice());
			},
			cancel() {
				cancelled = true;
			}
		});

		const bytes = await loadVerifiedAsset(a, {
			fetch: async () => new Response(hangingBody)
		});

		expect(Array.from(bytes)).toEqual(Array.from(SAMPLE));
		expect(cancelled).toBe(true);
	});

	it('truncates an oversized final chunk to the manifest-declared byte count', async () => {
		const a = await asset(SAMPLE);
		const oversizedBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([...SAMPLE, 9, 10]));
			}
		});

		const bytes = await loadVerifiedAsset(a, {
			fetch: async () => new Response(oversizedBody)
		});

		expect(Array.from(bytes)).toEqual(Array.from(SAMPLE));
	});

	it('raises a fetch error on a non-OK response', async () => {
		const a = await asset(SAMPLE);
		await expect(
			loadVerifiedAsset(a, { fetch: async () => new Response(null, { status: 404 }) })
		).rejects.toBeInstanceOf(AssetFetchError);
	});

	it('rejects a download that fails integrity and does not cache it', async () => {
		const a = await asset(SAMPLE);
		const store = memStore();
		const wrong = new Uint8Array([5, 5, 5, 5, 5, 5, 5, 5]);
		await expect(
			loadVerifiedAsset(a, { store, fetch: async () => new Response(wrong.slice()) })
		).rejects.toBeInstanceOf(AssetIntegrityError);
		expect(store.map.size).toBe(0);
	});
});
