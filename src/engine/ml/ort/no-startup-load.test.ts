/**
 * Guards the ORT foundation hard constraint at the module-graph level: the
 * `onnxruntime-web` runtime (WebGPU / WebNN / WASM variants) must never enter the
 * initial app bundle. It may be reached only through the dynamic `import()`s in
 * `ort-loader.ts`; every other ORT module is either pure (no ORT import) or uses
 * `import type` (erased at compile time). Importing the foundation's pure modules
 * performs zero network fetches and never pulls in the ORT runtime.
 */

import { describe, expect, it, vi } from 'vite-plus/test';

import entrySource from '../../../index.tsx?raw';
import appSource from '../../../ui/App.tsx?raw';
import workerSource from '../../worker.ts?raw';
import viteConfigSource from '../../../../vite.config.ts?raw';
import loaderSource from './ort-loader.ts?raw';
import sessionSource from './ort-session.ts?raw';
import typesSource from './ort-types.ts?raw';
import manifestSource from './ort-model-manifest.ts?raw';
import epPolicySource from './ep-policy.ts?raw';
import assetLoaderSource from './ort-asset-loader.ts?raw';
import webnnSource from './webnn-context.ts?raw';
import fixtureSource from './onnx-fixture.ts?raw';

/** Matches a static, top-level `import ... from 'onnxruntime-web[...]'` (not `import type`). */
const STATIC_ORT_IMPORT = /^import\s+(?!type\b)[^;]*from\s+['"]onnxruntime-web/m;
/** Matches any *import* of the onnxruntime-web specifier (static, type, or dynamic) —
 *  i.e. a real module-graph edge, not a prose mention in a comment. */
const ANY_ORT_IMPORT = /(?:from\s+['"]onnxruntime-web|import\(\s*['"]onnxruntime-web)/;
/** Matches a dynamic import of an onnxruntime-web subpath. */
const DYNAMIC_ORT_IMPORT = /import\(\s*['"]onnxruntime-web\/(webgpu|all|wasm)['"]\s*\)/;

describe('ORT runtime is lazy (module graph)', () => {
	it('the app entry and shell never import onnxruntime-web', () => {
		expect(entrySource).not.toMatch(ANY_ORT_IMPORT);
		expect(appSource).not.toMatch(ANY_ORT_IMPORT);
	});

	it('the pipeline worker never imports onnxruntime-web (no startup runtime load)', () => {
		expect(workerSource).not.toMatch(ANY_ORT_IMPORT);
	});

	it('the loader reaches onnxruntime-web only through dynamic imports', () => {
		expect(loaderSource).not.toMatch(STATIC_ORT_IMPORT);
		expect(loaderSource).toMatch(DYNAMIC_ORT_IMPORT);
		// All three documented subpaths are present.
		expect(loaderSource).toContain("import('onnxruntime-web/webgpu')");
		expect(loaderSource).toContain("import('onnxruntime-web/all')");
		expect(loaderSource).toContain("import('onnxruntime-web/wasm')");
	});

	it('the session wrapper imports onnxruntime-web types only (erased), never the runtime', () => {
		expect(sessionSource).not.toMatch(STATIC_ORT_IMPORT);
		// Its only ORT specifier reference is the erased `import type`.
		expect(sessionSource).toMatch(/^import type\s+\{[^}]*\}\s+from\s+'onnxruntime-web';/m);
	});

	it('keeps ORT WASM and runtime chunks out of the PWA precache', () => {
		// The vendored WASM (`/ort/`) and the lazily-imported ORT JS chunks
		// (`*onnxruntime*`) must be excluded from the Workbox precache, or the
		// service worker would download the ORT runtime at install — defeating the
		// no-startup-load guarantee. They are runtime-cached instead.
		expect(viteConfigSource).toMatch(/globIgnores:[^\]]*'\*\*\/ort\/\*\*'/);
		expect(viteConfigSource).toMatch(/globIgnores:[^\]]*'\*\*\/\*onnxruntime\*'/);
		expect(viteConfigSource).toMatch(/urlPattern:\s*\/\\\/ort\\\/\//);
	});

	it('the pure foundation modules do not import onnxruntime-web', () => {
		expect(typesSource).not.toMatch(ANY_ORT_IMPORT);
		expect(manifestSource).not.toMatch(ANY_ORT_IMPORT);
		expect(epPolicySource).not.toMatch(ANY_ORT_IMPORT);
		expect(assetLoaderSource).not.toMatch(ANY_ORT_IMPORT);
		expect(webnnSource).not.toMatch(ANY_ORT_IMPORT);
		expect(fixtureSource).not.toMatch(ANY_ORT_IMPORT);
	});
});

describe('ORT runtime is lazy (runtime)', () => {
	it('importing the pure modules + loader triggers zero fetches', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		try {
			await import('./ort-types');
			await import('./ort-model-manifest');
			await import('./ep-policy');
			await import('./ort-asset-loader');
			await import('./webnn-context');
			await import('./onnx-fixture');
			// Importing the loader module is safe: the dynamic import lives inside the
			// loader functions, so it does not run until a function is called.
			const loader = await import('./ort-loader');
			expect(typeof loader.loadOrtWebGpu).toBe('function');
			expect(typeof loader.loadOrtWebNN).toBe('function');
			expect(typeof loader.loadOrtWasm).toBe('function');
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
