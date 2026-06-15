import { describe, expect, it } from 'vite-plus/test';

import { ortWasmBasePath } from './ort-loader';

describe('ortWasmBasePath', () => {
	it('returns the same-origin /_ort/ proxy path (not a cross-origin URL)', () => {
		const path = ortWasmBasePath();
		expect(path).toBe('/_ort/');
		// Must be a same-origin relative path so ORT fetches under COEP, never a CDN.
		expect(path.startsWith('http')).toBe(false);
	});
});
