import { describe, expect, it } from 'vite-plus/test';

import { ortWasmBasePath } from './ort-loader';

describe('ortWasmBasePath', () => {
	it('returns a same-origin, build-scoped /ort/<sha>/ directory', () => {
		const path = ortWasmBasePath();
		expect(path).toMatch(/^\/ort\/[^/]+\/$/);
	});

	it('falls back to the "dev" sha when __BUILD_SHA__ is undefined (test/runtime)', () => {
		// vitest's node config does not `define` __BUILD_SHA__, so the guard applies.
		expect(ortWasmBasePath()).toBe('/ort/dev/');
	});
});
