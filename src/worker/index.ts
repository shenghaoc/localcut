/**
 * Cloudflare Worker entry. Serves the static SPA from the `ASSETS` binding and
 * adds a **same-origin reverse proxy** for the on-device ASR model.
 *
 * Why proxy instead of a direct browser fetch:
 * - The app is cross-origin isolated (`COEP: require-corp`, for SharedArrayBuffer),
 *   and Hugging Face's file CDN does not return `Access-Control-Allow-Origin` for
 *   arbitrary deployed origins, so a direct cross-origin `fetch()` is CORS-blocked.
 * - The model is large (>25 MB), so it also can't ship as a Workers static asset.
 *
 * The Worker fetches the file from Hugging Face **server-side** (no browser CORS)
 * and streams it back same-origin. The model still lives on Hugging Face — this
 * only relays the bytes; it never stores them. Range requests are forwarded so
 * the client can stream/resume the multi-megabyte download.
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
			return proxyHuggingFace(url, request);
		}
		return env.ASSETS.fetch(request);
	}
};

async function proxyHuggingFace(url: URL, request: Request): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405 });
	}
	// Resolve the requested path against the fixed Hugging Face origin only; the
	// origin guard blocks path/host smuggling (e.g. `//evil.com`, `../`).
	const path = url.pathname.slice(HF_PROXY_PREFIX.length);
	const target = new URL(path + url.search, `${HF_ORIGIN}/`);
	if (target.origin !== HF_ORIGIN) {
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
	// Same-origin response, loadable under COEP: require-corp. The bytes are
	// immutable and digest-pinned by the app, so long-cache them.
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	if (upstream.ok) {
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers
	});
}
