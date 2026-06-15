/**
 * Verified, OPFS-cached loading for ONNX model assets.
 *
 * This is a thin ORT-flavoured wrapper around the Phase 29 asset cache
 * ({@link loadVerifiedAsset} / {@link createOpfsAssetStore}): same-origin fetch,
 * SHA-256 + size verification, cross-session reuse keyed by digest. The download
 * and cache logic is **not** re-implemented here — only the host allowlist and
 * the ORT manifest → asset shape mapping live in this module.
 *
 * Model bytes are fetched same-origin (or through the Worker's `/_model/*`
 * reverse proxies) from a small allowlist of reputable hosts: Hugging Face,
 * GitHub, Google Cloud Storage, and Cloudflare R2. A manifest naming any other
 * host is refused before a byte is fetched (the digest pins *what*, the allowlist
 * pins *where*). There is no direct cross-origin browser fetch and no cloud
 * inference — see docs/ML-RUNTIME.md.
 */
import {
	createOpfsAssetStore,
	loadVerifiedAsset,
	type AssetStore,
	type LoadAssetDeps
} from '../../asr/asset-cache';
import type { OrtModelAsset } from './ort-types';

/**
 * Hosts (besides this app's own origin) the ORT model loader may fetch from. An
 * entry starting with `.` matches that domain and all subdomains. Most loads go
 * through the same-origin `/_model/{hf,gh,gcs}/` Worker proxies; these direct
 * hosts cover redirect hops (HF Xet/LFS CDNs) and R2 public buckets.
 */
export const ORT_TRUSTED_MODEL_HOSTS: readonly string[] = [
	// Hugging Face model repos + their Xet/LFS CDNs.
	'.huggingface.co',
	'.hf.co',
	// Google Cloud Storage (mediapipe / Google AI Edge assets).
	'storage.googleapis.com',
	// GitHub repositories and raw content.
	'github.com',
	'raw.githubusercontent.com',
	'objects.githubusercontent.com',
	// Cloudflare R2 public buckets (the project's own model host).
	'.r2.dev',
	'.r2.cloudflarestorage.com'
];

function hostMatches(host: string, entry: string): boolean {
	return entry.startsWith('.') ? host === entry.slice(1) || host.endsWith(entry) : host === entry;
}

export class UntrustedOrtModelHostError extends Error {
	constructor(url: string) {
		super(
			`Refusing to fetch ONNX model asset from an untrusted host: ${url}. ` +
				`Allowed: this app's origin or one of [${ORT_TRUSTED_MODEL_HOSTS.join(', ')}].`
		);
		this.name = 'UntrustedOrtModelHostError';
	}
}

/**
 * True when `url` is safe to fetch a model asset from: same-origin (any scheme,
 * which covers the `/_model/*` proxy paths), or an HTTPS URL whose hostname is in
 * {@link ORT_TRUSTED_MODEL_HOSTS}.
 */
export function isTrustedOrtModelUrl(url: string, sameOrigin: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url, sameOrigin);
	} catch {
		return false;
	}
	if (parsed.origin === sameOrigin) return true;
	if (parsed.protocol !== 'https:') return false;
	return ORT_TRUSTED_MODEL_HOSTS.some((entry) => hostMatches(parsed.hostname, entry));
}

/** Throws {@link UntrustedOrtModelHostError} unless `url` passes {@link isTrustedOrtModelUrl}. */
export function assertTrustedOrtModelUrl(url: string, sameOrigin: string): void {
	if (!isTrustedOrtModelUrl(url, sameOrigin)) throw new UntrustedOrtModelHostError(url);
}

/** Opens the OPFS-backed store ORT model assets are cached in (digest-keyed). */
export function createOrtOpfsAssetStore(): Promise<AssetStore | null> {
	return createOpfsAssetStore('ort-models');
}

export interface LoadOrtModelAssetDeps extends LoadAssetDeps {
	/** This app's origin, used for the host allowlist check. Defaults to
	 *  `self.location.origin` when running in a browser/worker context. */
	readonly sameOrigin?: string;
}

/**
 * Returns verified bytes for an ONNX model asset, after asserting the URL is an
 * allowlisted host. Fetch/verify/cache is delegated to {@link loadVerifiedAsset}.
 */
export async function loadOrtModelAsset(
	asset: OrtModelAsset,
	deps: LoadOrtModelAssetDeps = {}
): Promise<Uint8Array> {
	const origin =
		deps.sameOrigin ??
		(typeof self !== 'undefined' && self.location ? self.location.origin : 'null');
	// async so an untrusted-host rejection is a rejected promise, not a sync throw.
	assertTrustedOrtModelUrl(asset.url, origin);
	const { sameOrigin: _sameOrigin, ...assetDeps } = deps;
	void _sameOrigin;
	return loadVerifiedAsset(
		{ url: asset.url, sizeBytes: asset.sizeBytes, checksum: asset.checksum },
		assetDeps
	);
}
