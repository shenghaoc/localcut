import { afterEach, describe, expect, it } from 'vite-plus/test';

import { ortWasmBasePath } from './ort-loader';
import { ORT_RUNTIME_CACHE_NAME } from './ort-runtime-assets';

// These caches belong only to this test's local browser origin.
const OLD_CACHE_NAME = 'localcut-test-ort-runtime-v1';
const CURRENT_CACHE_NAME = `localcut-test-${ORT_RUNTIME_CACHE_NAME}`;

describe('ORT runtime cache upgrade', () => {
	afterEach(async () => {
		await caches.delete(OLD_CACHE_NAME);
		await caches.delete(CURRENT_CACHE_NAME);
	});

	it.each(['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])(
		'cannot reuse pre-upgrade %s bytes and caches the new runtime for offline use',
		async (file) => {
			const oldRequest = new Request(`${location.origin}/_ort/${file}`);
			const currentRequest = new Request(`${location.origin}${ortWasmBasePath()}${file}`);
			const oldCache = await caches.open(OLD_CACHE_NAME);
			await oldCache.put(oldRequest, new Response('ORT 1.26 runtime'));
			expect(await (await oldCache.match(oldRequest))?.text()).toBe('ORT 1.26 runtime');
			// Even a previous service worker using CacheFirst cannot match the new URL.
			expect(await oldCache.match(currentRequest, { ignoreVary: true })).toBeUndefined();

			const currentCache = await caches.open(CURRENT_CACHE_NAME);
			expect(await currentCache.match(currentRequest, { ignoreVary: true })).toBeUndefined();
			await currentCache.put(currentRequest, new Response('current ORT runtime'));
			expect(await (await currentCache.match(currentRequest))?.text()).toBe('current ORT runtime');
		}
	);
});
