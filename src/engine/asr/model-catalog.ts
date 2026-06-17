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

// Re-export the shared trust machinery (Phase 37 T2.1 generalisation).
// The ASR-specific names are preserved as aliases for backward compatibility.
export {
	TRUSTED_MODEL_HOSTS as ASR_TRUSTED_MODEL_HOSTS,
	UntrustedModelHostError,
	isTrustedModelUrl,
	assertTrustedModelUrl
} from '../ml/asset-types';

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
 * Worker proxy; see `public/models/whisper-onnx/README.md` (ONNX) and
 * `public/models/whisper/README.md` (LiteRT).
 *
 * The default is the **int8-quantized ONNX** Whisper Base on ONNX Runtime Web:
 * ~77 MB versus the 290 MB LiteRT fp32 build — a far friendlier first download for
 * a PWA — at comparable caption quality. The fp32 LiteRT builds stay selectable as
 * the highest-fidelity / proven option (see `docs/ML-RUNTIME.md` for the size vs
 * quality trade-off). The worker picks the runtime from each manifest's `runtime`
 * field, so the two engines coexist behind one picker.
 */
export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[] = [
	{
		id: 'whisper-base-onnx-int8',
		name: 'Whisper Base (ONNX, int8)',
		description: 'Multilingual (~74M params), int8-quantized — best balance of size and accuracy.',
		provider: 'OpenAI · onnx-community',
		infoUrl: 'https://huggingface.co/onnx-community/whisper-base',
		license: 'Apache-2.0 / MIT',
		languages: ['en', 'zh'],
		sizeBytes: 77_347_042,
		manifestUrl: '/models/whisper-onnx/manifest.json',
		recommended: true
	},
	{
		id: 'whisper-tiny-onnx-int8',
		name: 'Whisper Tiny (ONNX, int8)',
		description: 'Smaller & faster (~39M params), int8-quantized — quickest download (~41 MB).',
		provider: 'OpenAI · onnx-community',
		infoUrl: 'https://huggingface.co/onnx-community/whisper-tiny',
		license: 'Apache-2.0 / MIT',
		languages: ['en', 'zh'],
		sizeBytes: 41_421_611,
		manifestUrl: '/models/whisper-onnx/manifest-tiny.json'
	},
	{
		id: 'whisper-base',
		name: 'Whisper Base (LiteRT, fp32)',
		description: 'Full-precision (~74M params) on LiteRT.js — highest fidelity, ~290 MB download.',
		provider: 'OpenAI · litert-community',
		infoUrl: 'https://huggingface.co/litert-community/whisper-base',
		license: 'Apache-2.0 / MIT',
		languages: ['en', 'zh'],
		sizeBytes: 290_918_186,
		manifestUrl: '/models/whisper/manifest.json'
	},
	{
		id: 'whisper-tiny',
		name: 'Whisper Tiny (LiteRT, fp32)',
		description: 'Full-precision (~39M params) on LiteRT.js — proven path, ~152 MB download.',
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
