import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import worker from './index';
import { dependencies } from '../../package.json';

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

	it.each(['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])(
		'proxies versioned %s from the pinned runtime package',
		async (file) => {
			const fetchSpy = vi.fn(
				async () =>
					new Response('export default {}', { headers: { 'content-type': 'text/javascript' } })
			);
			vi.stubGlobal('fetch', fetchSpy);

			const response = await worker.fetch(
				new Request(`https://localcut.test/_ort/${dependencies['onnxruntime-web']}/${file}`),
				env()
			);

			expect(response.status).toBe(200);
			expect(fetchSpy).toHaveBeenCalledWith(
				`https://cdn.jsdelivr.net/npm/onnxruntime-web@${dependencies['onnxruntime-web']}/dist/${file}`,
				{ method: 'GET', headers: {}, redirect: 'follow' }
			);
			expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
			expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
			expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
			expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
		}
	);

	it('rejects unknown ORT runtime files instead of opening the CDN proxy', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		const response = await worker.fetch(
			new Request(
				`https://localcut.test/_ort/${dependencies['onnxruntime-web']}/not-ort-runtime.js`
			),
			env()
		);

		expect(response.status).toBe(404);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it.each(['/_ort/ort-wasm-simd-threaded.mjs', '/_ort/1.26.0/ort-wasm-simd-threaded.wasm'])(
		'rejects stale runtime path %s without serving the SPA or a newer runtime',
		async (path) => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);
			const bindings = env();
			const response = await worker.fetch(new Request(`https://localcut.test${path}`), bindings);
			expect(response.status).toBe(404);
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
		}
	);
});
