import { describe, expect, it } from 'vite-plus/test';
import { dependencies } from '../../../../package.json';

import { ortWasmBasePath } from './ort-loader';
import { ORT_RUNTIME_CACHE_NAME, ORT_RUNTIME_VERSION } from './ort-runtime-assets';

describe('ortWasmBasePath', () => {
	it('versions the same-origin proxy path with the installed runtime', () => {
		const path = ortWasmBasePath();
		expect(path).toBe(`/_ort/${dependencies['onnxruntime-web']}/`);
		// Must be a same-origin relative path so ORT fetches under COEP, never a CDN.
		expect(path.startsWith('http')).toBe(false);
	});

	it('rotates the PWA runtime cache with the installed runtime', () => {
		expect(ORT_RUNTIME_VERSION).toBe(dependencies['onnxruntime-web']);
		expect(ORT_RUNTIME_CACHE_NAME).toBe(`ort-runtime-${dependencies['onnxruntime-web']}`);
		expect(ORT_RUNTIME_CACHE_NAME).not.toBe('ort-runtime-v1');
	});
});
