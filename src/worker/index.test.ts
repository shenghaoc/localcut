import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import worker from './index';

function env() {
	return {
		ASSETS: {
			fetch: vi.fn(async () => new Response('asset'))
		}
	};
}

describe('Worker model proxy', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('proxies the ORT WASM glue module from the pinned runtime package', async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response('export default {}', { headers: { 'content-type': 'text/javascript' } })
		);
		vi.stubGlobal('fetch', fetchSpy);

		const response = await worker.fetch(
			new Request('https://localcut.test/_ort/ort-wasm-simd-threaded.mjs'),
			env()
		);

		expect(response.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.mjs',
			{ method: 'GET', headers: {}, redirect: 'follow' }
		);
		expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
		expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
		expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
	});

	it('rejects unknown ORT runtime files instead of opening the CDN proxy', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		const response = await worker.fetch(
			new Request('https://localcut.test/_ort/not-ort-runtime.js'),
			env()
		);

		expect(response.status).toBe(404);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
