/**
 * Curated catalog of on-device ASR models and the allowlist of hosts the loader
 * is permitted to fetch them from (Phase 29).
 *
 * Two intents:
 *
 * 1. **Trust.** Model assets are large binaries that run as code (TFLite graphs
 *    compiled by LiteRT). They may be fetched only from this app's own origin or
 *    a small allowlist of reputable, CORS-friendly model hosts — never an
 *    arbitrary URL a manifest happens to name. The digest check still pins exact
 *    bytes; the allowlist additionally pins *where* they may come from.
 *
 * 2. **Choice.** Each catalog entry carries a human description, provider, and a
 *    `infoUrl` model-card link the UI surfaces so users can read about a model
 *    before downloading it. The list is structured to hold many models; today it
 *    ships two (Whisper Base + Tiny) and the UI shows a picker once there is more
 *    than one. Both can be downloaded and kept at once (OPFS keys assets by
 *    SHA-256), so switching between them never re-downloads.
 */

/**
 * Hostnames (besides this app's own origin) the model loader may fetch from. An
 * entry starting with `.` matches that domain and all subdomains. Hugging Face
 * `resolve` URLs 302-redirect to a signed Xet/LFS CDN, so those CDN hosts are
 * included too — the redirect is browser-followed (and would be enforced by any
 * future CSP `connect-src`, which applies to every hop).
 */
export const ASR_TRUSTED_MODEL_HOSTS: readonly string[] = [
	// Hugging Face model repos + their Xet/LFS CDNs (cas-bridge.xethub.hf.co,
	// *.cdn.hf.co, cdn-lfs*.huggingface.co).
	'.huggingface.co',
	'.hf.co',
	// Kaggle Models / Google AI Edge (LiteRT) assets are served from GCS.
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
			`Refusing to fetch ASR model asset from an untrusted host: ${url}. ` +
				`Allowed: this app's origin or one of [${ASR_TRUSTED_MODEL_HOSTS.join(', ')}].`
		);
		this.name = 'UntrustedModelHostError';
	}
}

/**
 * True when `url` is safe to fetch a model asset from: same-origin (any scheme),
 * or an HTTPS URL whose hostname is in {@link ASR_TRUSTED_MODEL_HOSTS}.
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
	return ASR_TRUSTED_MODEL_HOSTS.some((entry) => hostMatches(parsed.hostname, entry));
}

/** Throws {@link UntrustedModelHostError} unless `url` passes {@link isTrustedModelUrl}. */
export function assertTrustedModelUrl(url: string, sameOrigin: string): void {
	if (!isTrustedModelUrl(url, sameOrigin)) throw new UntrustedModelHostError(url);
}

/** A selectable on-device ASR model. */
export interface AsrModelCatalogEntry {
	/** Stable id used for selection/persistence. */
	id: string;
	/** Display name, e.g. "Whisper Base". */
	name: string;
	/** One-line description shown in the picker. */
	description: string;
	/** Human-readable provenance, e.g. "OpenAI · self-hosted". */
	provider: string;
	/** Model-card / documentation URL the UI links to ("Learn more"). */
	infoUrl: string;
	license: string;
	/** ISO language codes the model transcribes. */
	languages: readonly string[];
	/** Total download size in bytes (for the picker; the manifest is authoritative). */
	sizeBytes: number;
	/** Same-origin or allowlisted URL of the model's manifest JSON. */
	manifestUrl: string;
	/** Marks the default selection. */
	recommended?: boolean;
}

/**
 * Shipped catalog. Add entries here to offer more models — each needs a manifest
 * (with real asset sizes + SHA-256 digests) reachable from an allowlisted host.
 * The models are fetched from Hugging Face through the same-origin `/_model/hf/`
 * Worker proxy; see `public/models/whisper/README.md`.
 */
export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[] = [
	{
		id: 'whisper-base',
		name: 'Whisper Base',
		description: 'Multilingual speech-to-text (~74M params) — better accuracy on-device.',
		provider: 'OpenAI · litert-community',
		infoUrl: 'https://huggingface.co/litert-community/whisper-base',
		license: 'Apache-2.0 / MIT',
		languages: ['en', 'zh'],
		sizeBytes: 290_918_186,
		manifestUrl: '/models/whisper/manifest.json',
		recommended: true
	},
	{
		id: 'whisper-tiny',
		name: 'Whisper Tiny',
		description: 'Smaller & faster (~39M params) — quicker download, lower accuracy.',
		provider: 'OpenAI · litert-community',
		infoUrl: 'https://huggingface.co/litert-community/whisper-tiny',
		license: 'Apache-2.0 / MIT',
		languages: ['en', 'zh'],
		sizeBytes: 151_814_734,
		manifestUrl: '/models/whisper/manifest-tiny.json'
	}
];

/** The default (recommended) catalog entry. */
export function defaultModel(): AsrModelCatalogEntry {
	return ASR_MODEL_CATALOG.find((entry) => entry.recommended) ?? ASR_MODEL_CATALOG[0];
}

/** Looks up a catalog entry by id, or returns the default. */
export function modelById(id: string | null | undefined): AsrModelCatalogEntry {
	return ASR_MODEL_CATALOG.find((entry) => entry.id === id) ?? defaultModel();
}
