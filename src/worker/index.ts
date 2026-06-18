/**
 * Cloudflare Worker entry. Serves the static SPA from the `ASSETS` binding and
 * adds **same-origin reverse proxies** for on-device model assets hosted on
 * Hugging Face and GitHub.
 *
 * Why proxy instead of a direct browser fetch:
 * - The app is cross-origin isolated (`COEP: require-corp`, for SharedArrayBuffer),
 *   and neither Hugging Face nor GitHub's raw CDN returns
 *   `Access-Control-Allow-Origin` for arbitrary deployed origins, so a direct
 *   cross-origin `fetch()` is CORS-blocked.
 * - The models are large, so they can't ship as Workers static assets.
 *
 * The Worker fetches the file **server-side** (no browser CORS) and streams it
 * back same-origin. It never stores the bytes. Range requests are forwarded so
 * the client can stream/resume multi-megabyte downloads.
 *
 * This file is bundled by Wrangler (`main` in wrangler.jsonc); Vite does not
 * import it, so it stays out of the app bundle.
 */
interface Env {
	ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Same-origin path prefix that proxies to Hugging Face. */
const HF_PROXY_PREFIX = '/_model/hf/';
const HF_ORIGIN = 'https://huggingface.co';

/** Same-origin path prefix that proxies to GitHub raw content. */
const GH_PROXY_PREFIX = '/_model/gh/';
const GH_ORIGIN = 'https://raw.githubusercontent.com';

/** Same-origin path prefix that proxies to Google Cloud Storage (mediapipe-assets). */
const GCS_PROXY_PREFIX = '/_model/gcs/';
const GCS_ORIGIN = 'https://storage.googleapis.com';

/**
 * Same-origin path prefix that proxies ONNX Runtime Web's WASM runtime from the
 * jsDelivr npm CDN. ORT's `ort-wasm-simd-threaded.jsep.wasm` is ~26 MB — over
 * Cloudflare Workers' 25 MiB per-file static-asset limit, so it is proxied
 * instead of being vendored. Proxying keeps the fetch same-origin
 * (COEP: require-corp) and pins the version. Keep `ORT_RUNTIME_BASE` in sync with
 * the `onnxruntime-web` version in package.json.
 *
 * `ORT_ALLOWED_FILES` pins the exact set the runtime may fetch at this version:
 * the `.mjs` glue modules plus their matching `.wasm` binaries. Any other path
 * under the pinned upstream is rejected — defence in depth against the proxy
 * becoming an open jsDelivr-bouncer.
 */
const ORT_PROXY_PREFIX = '/_ort/';
const JSDELIVR_ORIGIN = 'https://cdn.jsdelivr.net';
const ORT_RUNTIME_BASE = '/npm/onnxruntime-web@1.26.0/dist/';
const ORT_ALLOWED_FILES: ReadonlySet<string> = new Set([
	'ort-wasm-simd-threaded.asyncify.mjs',
	'ort-wasm-simd-threaded.asyncify.wasm',
	'ort-wasm-simd-threaded.jsep.mjs',
	'ort-wasm-simd-threaded.jsep.wasm',
	'ort-wasm-simd-threaded.jspi.mjs',
	'ort-wasm-simd-threaded.jspi.wasm',
	'ort-wasm-simd-threaded.mjs',
	'ort-wasm-simd-threaded.wasm'
]);

const FORWARDED_RESPONSE_HEADERS = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'etag',
	'last-modified'
];

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith(HF_PROXY_PREFIX)) {
			return proxyModel(url, request, HF_PROXY_PREFIX, HF_ORIGIN);
		}
		if (url.pathname.startsWith(GH_PROXY_PREFIX)) {
			return proxyModel(url, request, GH_PROXY_PREFIX, GH_ORIGIN);
		}
		if (url.pathname.startsWith(GCS_PROXY_PREFIX)) {
			return proxyModel(url, request, GCS_PROXY_PREFIX, GCS_ORIGIN);
		}
		if (url.pathname.startsWith(ORT_PROXY_PREFIX)) {
			const file = url.pathname.slice(ORT_PROXY_PREFIX.length);
			if (!ORT_ALLOWED_FILES.has(file)) {
				return new Response('Not found', { status: 404 });
			}
			return proxyModel(url, request, ORT_PROXY_PREFIX, JSDELIVR_ORIGIN, ORT_RUNTIME_BASE);
		}
		return env.ASSETS.fetch(request);
	}
};

async function proxyModel(
	url: URL,
	request: Request,
	prefix: string,
	origin: string,
	basePath = '/'
): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405 });
	}
	const path = url.pathname.slice(prefix.length);
	const target = new URL(basePath + path + url.search, origin);
	if (target.origin !== origin) {
		return new Response('Bad proxy target', { status: 400 });
	}

	const range = request.headers.get('Range');
	const upstream = await fetch(target.toString(), {
		method: request.method,
		headers: range ? { Range: range } : {},
		redirect: 'follow'
	});

	const headers = new Headers();
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	if (upstream.ok) {
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers
	});
}
