/**
 * Lazy import boundary for `onnxruntime-web`.
 *
 * Every ORT entry point is reached through a **dynamic** `import()` here, never a
 * static top-level import anywhere in the app. That is what keeps the (multi-MB,
 * WASM-backed) runtimes out of the initial bundle: the WebGPU / WebNN / WASM
 * variants code-split into their own chunks and load only when a feature first
 * creates a session. The `no-startup-load` test enforces this at the module-graph
 * level (see {@link file://./no-startup-load.test.ts}).
 *
 * Subpath choice mirrors the ORT packaging:
 * - `onnxruntime-web/webgpu` — WebGPU EP (+ WASM CPU ops), the primary path for
 *   full-frame models.
 * - `onnxruntime-web/all`    — the superset build that also carries the WebNN EP.
 * - `onnxruntime-web/wasm`   — WASM-only, for small / non-frame-coupled models.
 *
 * Types are taken via `typeof import(...)` (erased at compile time), so importing
 * this module costs nothing at runtime until a loader function is called.
 */

/** The `onnxruntime-web` module namespace (all subpaths re-export the same API). */
export type OrtModule = typeof import('onnxruntime-web');

/**
 * Same-origin, build-scoped directory ORT's WASM artifacts are served from,
 * mirroring the LiteRT `/litert/<sha>/` layout. The Vite plugin
 * (`copyOrtRuntimeAssets`) vendors the `.wasm`/`.mjs` files here; the session
 * wrapper sets `env.wasm.wasmPaths` to this path so ORT never fetches its runtime
 * from a cross-origin CDN (blocked by COEP, and against the model-host policy).
 */
export function ortWasmBasePath(): string {
	const sha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
	return `/ort/${sha}/`;
}

/** Loads the WebGPU build (WebGPU EP, primary for full-frame/video models). */
export function loadOrtWebGpu(): Promise<OrtModule> {
	return import('onnxruntime-web/webgpu');
}

/** Loads the `all` build, which carries the WebNN EP (opt-in per model). */
export function loadOrtWebNN(): Promise<OrtModule> {
	return import('onnxruntime-web/all');
}

/** Loads the WASM-only build (small / non-frame-coupled models only). */
export function loadOrtWasm(): Promise<OrtModule> {
	return import('onnxruntime-web/wasm');
}
