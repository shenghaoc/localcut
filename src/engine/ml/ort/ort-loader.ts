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
 * Same-origin path ORT's WASM runtime is served from. ORT's
 * `ort-wasm-simd-threaded.jsep.wasm` is ~26 MB — over Cloudflare Workers' 25 MiB
 * per-file static-asset limit, so (unlike the smaller LiteRT runtime) it can't be
 * vendored. Instead the Worker reverse-proxies it from the jsDelivr npm CDN at
 * `/_ort/` (version-pinned); the session wrapper points `env.wasm.wasmPaths`
 * here so ORT fetches its runtime same-origin (COEP: require-corp), never via a
 * direct cross-origin browser request. See `src/worker/index.ts`.
 */
export function ortWasmBasePath(): string {
	return '/_ort/';
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
