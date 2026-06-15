import { describe, expect, it } from 'vite-plus/test';

import { sha256Hex, type AssetStore } from '../../asr/asset-cache';
import {
	UntrustedOrtModelHostError,
	isTrustedOrtModelUrl,
	loadOrtModelAsset
} from './ort-asset-loader';

const ORIGIN = 'https://editor.example.com';

describe('ORT trusted model URLs', () => {
	it('accepts same-origin URLs and the /_model proxy paths', () => {
		expect(isTrustedOrtModelUrl('/models/x/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('/_model/hf/org/repo/resolve/main/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('/_model/gh/org/repo/main/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('/_model/gcs/bucket/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl(`${ORIGIN}/models/x/model.onnx`, ORIGIN)).toBe(true);
	});

	it('accepts allowlisted HTTPS hosts (HF, GCS, GitHub, R2)', () => {
		expect(isTrustedOrtModelUrl('https://huggingface.co/org/repo/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('https://cas-bridge.xethub.hf.co/x/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('https://storage.googleapis.com/b/model.onnx', ORIGIN)).toBe(true);
		expect(isTrustedOrtModelUrl('https://raw.githubusercontent.com/o/r/model.onnx', ORIGIN)).toBe(
			true
		);
		expect(isTrustedOrtModelUrl('https://my-bucket.r2.dev/model.onnx', ORIGIN)).toBe(true);
	});

	it('rejects arbitrary and non-HTTPS hosts', () => {
		expect(isTrustedOrtModelUrl('https://evil.example.net/model.onnx', ORIGIN)).toBe(false);
		expect(isTrustedOrtModelUrl('http://huggingface.co/org/repo/model.onnx', ORIGIN)).toBe(false);
		expect(isTrustedOrtModelUrl('https://nothuggingface.co.evil.com/model.onnx', ORIGIN)).toBe(
			false
		);
		// A bare string with a scheme-like prefix that is still cross-origin.
		expect(isTrustedOrtModelUrl('https://r2.dev.evil.com/model.onnx', ORIGIN)).toBe(false);
	});
});

describe('loadOrtModelAsset', () => {
	it('refuses an untrusted host before fetching', async () => {
		let fetched = false;
		await expect(
			loadOrtModelAsset(
				{
					url: 'https://evil.example.net/model.onnx',
					sizeBytes: 4,
					checksum: 'sha256-' + '0'.repeat(64)
				},
				{
					sameOrigin: ORIGIN,
					fetch: async () => {
						fetched = true;
						return new Response(new Uint8Array(4));
					}
				}
			)
		).rejects.toBeInstanceOf(UntrustedOrtModelHostError);
		expect(fetched).toBe(false);
	});

	it('fetches, verifies, and caches a trusted asset (delegating to the shared cache)', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const checksum = await sha256Hex(bytes);
		const cache = new Map<string, Uint8Array>();
		const store: AssetStore = {
			get: async (key) => cache.get(key) ?? null,
			put: async (key, value) => void cache.set(key, value)
		};
		let fetchCount = 0;
		const fetchImpl = async (): Promise<Response> => {
			fetchCount += 1;
			return new Response(bytes);
		};

		const first = await loadOrtModelAsset(
			{ url: '/_model/hf/org/repo/resolve/main/model.onnx', sizeBytes: bytes.byteLength, checksum },
			{ sameOrigin: ORIGIN, store, fetch: fetchImpl }
		);
		expect(Array.from(first)).toEqual(Array.from(bytes));
		expect(fetchCount).toBe(1);

		// Second load is served from the digest-keyed cache (no second fetch).
		const second = await loadOrtModelAsset(
			{ url: '/_model/hf/org/repo/resolve/main/model.onnx', sizeBytes: bytes.byteLength, checksum },
			{ sameOrigin: ORIGIN, store, fetch: fetchImpl }
		);
		expect(Array.from(second)).toEqual(Array.from(bytes));
		expect(fetchCount).toBe(1);
	});
});
