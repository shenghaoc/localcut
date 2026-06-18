/**
 * Shared ML asset types (Phase 37, T2.1). Generalises the ASR-specific
 * asset snapshot into a feature-agnostic interface so interpolation,
 * audio cleanup, and future ML features reuse the same trust/cache
 * machinery without duplicating types.
 *
 * The ASR protocol types (`AsrModelAssetSnapshot`,
 * `CleanupModelAssetSnapshot`) are structurally identical; this module
 * defines the shared shape and re-exports it for consumers.
 */

/**
 * A verified model asset descriptor. Any ML feature's manifest declares
 * its assets with this shape: a URL, exact byte size, and SHA-256 digest.
 */
export interface ModelAssetSnapshot {
	url: string;
	sizeBytes: number;
	checksum: string;
}

/**
 * A model catalog entry. Each ML feature (ASR, interpolation, cleanup)
 * maintains a catalog of available models with this shape.
 */
export interface ModelCatalogEntry {
	/** Stable id used for selection/persistence. */
	id: string;
	/** Display name, e.g. "Whisper Base" or "FILM Interpolation". */
	name: string;
	/** One-line description shown in the picker. */
	description: string;
	/** Human-readable provenance, e.g. "Google Research · Apache-2.0". */
	provider: string;
	/** Model-card / documentation URL the UI links to ("Learn more"). */
	infoUrl: string;
	/** SPDX license identifier. */
	license: string;
	/** Total download size in bytes (for the picker; the manifest is authoritative). */
	sizeBytes: number;
	/** Same-origin or allowlisted URL of the model's manifest JSON. */
	manifestUrl: string;
	/** Marks the default selection. */
	recommended?: boolean;
}

/**
 * Hostnames (besides this app's own origin) the model loader may fetch from.
 * Shared across all ML features. An entry starting with `.` matches that
 * domain and all subdomains.
 */
export const TRUSTED_MODEL_HOSTS: readonly string[] = [
	// Hugging Face model repos + their Xet/LFS CDNs.
	'.huggingface.co',
	'.hf.co',
	// Kaggle Models / Google AI Edge assets are served from GCS.
	'www.kaggle.com',
	'storage.googleapis.com',
	// GitHub repositories and raw content.
	'github.com',
	'raw.githubusercontent.com',
	'objects.githubusercontent.com'
];

function hostMatches(host: string, entry: string): boolean {
	return entry.startsWith('.') ? host === entry.slice(1) || host.endsWith(entry) : host === entry;
}

export class UntrustedModelHostError extends Error {
	constructor(url: string) {
		super(
			`Refusing to fetch model asset from an untrusted host: ${url}. ` +
				`Allowed: this app's origin or one of [${TRUSTED_MODEL_HOSTS.join(', ')}].`
		);
		this.name = 'UntrustedModelHostError';
	}
}

/**
 * True when `url` is safe to fetch a model asset from: same-origin (any scheme),
 * or an HTTPS URL whose hostname is in {@link TRUSTED_MODEL_HOSTS}.
 */
export function isTrustedModelUrl(url: string, sameOrigin: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url, sameOrigin);
	} catch {
		return false;
	}
	if (parsed.origin === sameOrigin) return true;
	if (parsed.protocol !== 'https:') return false;
	return TRUSTED_MODEL_HOSTS.some((entry) => hostMatches(parsed.hostname, entry));
}

/** Throws {@link UntrustedModelHostError} unless `url` passes {@link isTrustedModelUrl}. */
export function assertTrustedModelUrl(url: string, sameOrigin: string): void {
	if (!isTrustedModelUrl(url, sameOrigin)) throw new UntrustedModelHostError(url);
}
