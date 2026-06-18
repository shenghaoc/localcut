/**
 * ONNX Whisper model manifest validation (Phase 29 — ORT/ONNX backend).
 *
 * An ONNX Whisper model is an **encoder/decoder pair** plus a tokenizer, so this
 * manifest declares separate `encoder` and `decoder` ONNX assets (and, reserved
 * for a future KV-cache runtime, an optional `decoderWithPast`). The byte-exact
 * integrity contract (size + SHA-256), audio contract, special-token ids, and
 * decode-quality params are imported from shared validators in
 * {@link file://./model-manifest.ts}. ORT runtime policy (`format: 'onnx'`,
 * pinned execution providers through {@link resolveExecutionProviders}) layers
 * on top.
 *
 * Pure and unit-testable: no fetch, no ORT import.
 */
import type { AsrDecodeParams, AsrModelAssetSnapshot, AsrSpecialTokens } from '../../protocol';
import type { OrtExecutionProvider } from '../ml/ort/ort-types';
import { OrtEpPolicyError, resolveExecutionProviders } from '../ml/ort/ep-policy';
import {
	AsrManifestError,
	validateAsset,
	validateAudioConfig,
	validateDecodeParams,
	validateSpecialTokens,
	type AsrAudioConfig
} from './model-manifest';

const EXECUTION_PROVIDERS: readonly OrtExecutionProvider[] = ['webgpu', 'webnn', 'wasm'];

/** `input_ids` element type the decoder expects. Whisper exports from optimum
 *  use int64; int32 is allowed for models exported that way. */
export type AsrOrtInputIdsDataType = 'int32' | 'int64';
const INPUT_IDS_DTYPES: readonly AsrOrtInputIdsDataType[] = ['int32', 'int64'];

/**
 * ONNX tensor IO names for the encoder/decoder pair. These default to the
 * optimum / Transformers.js Whisper export convention but are manifest-declared
 * so a differently-named export can be wired without touching the runtime.
 */
export interface AsrOrtIoContract {
	/** Encoder input: log-mel features, float32 `[1, nMel, melFrames]`. */
	encoderInput: string;
	/** Encoder output / decoder cross-attention input: float32 `[1, frames, dModel]`. */
	encoderOutput: string;
	/** Decoder input: token ids, `[1, T]` (see {@link AsrOrtIoContract.inputIdsDataType}). */
	decoderInputIds: string;
	/** Decoder input name for the encoder hidden states. */
	decoderEncoderHidden: string;
	/** Decoder output: logits, float32 `[1, T, vocab]`. */
	decoderLogits: string;
	inputIdsDataType: AsrOrtInputIdsDataType;
}

/**
 * A validated ONNX Whisper manifest. Its transcribe-time fields
 * (`audio`/`maxDecodeTokens`/`vocabSize`/`tokens`/`languages`/`defaultLanguage`/
 * `decode`/`sizeBytes`) satisfy the worker's shared decode config while adding
 * the ONNX-specific assets, IO, and execution-provider policy.
 */
export interface AsrOrtModelManifestSnapshot {
	id: string;
	version: string;
	license: string;
	source: string;
	/** Runtime discriminator. */
	runtime: 'ort-whisper';
	format: 'onnx';
	/** Human-readable provenance for the picker (e.g. "OpenAI · onnx-community"). */
	provider: string | null;
	infoUrl: string | null;
	/** Pinned, ordered ORT execution providers. */
	executionProviders: OrtExecutionProvider[];
	/** Sum of all downloaded asset sizes — the download budget shown to the user. */
	sizeBytes: number;
	/** ONNX encoder graph (`input_features` → `last_hidden_state`). */
	encoder: AsrModelAssetSnapshot;
	/** ONNX decoder graph with no past inputs (`input_ids`, `encoder_hidden_states` → `logits`). */
	decoder: AsrModelAssetSnapshot;
	/** Optional KV-cache decoder, reserved for a future incremental-decode runtime.
	 *  The current no-cache runtime does not download or use it. */
	decoderWithPast: AsrModelAssetSnapshot | null;
	/** Byte-level BPE tokenizer vocabulary (`vocab.json`); merges are not needed
	 *  for decode-only. */
	tokenizer: AsrModelAssetSnapshot;
	io: AsrOrtIoContract;
	audio: AsrAudioConfig;
	maxDecodeTokens: number;
	vocabSize: number;
	encoderFramesPerSecond: number;
	tokens: AsrSpecialTokens;
	languages: string[];
	defaultLanguage: string | null;
	decode: AsrDecodeParams | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0;
}

function isPositiveNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isString(v: unknown): v is string {
	return typeof v === 'string';
}

/**
 * Cheap discriminator used by the worker to route a fetched manifest to the ORT
 * path before full validation. Only checks the `runtime` tag; never throws.
 */
export function isOrtWhisperManifestDocument(value: unknown): boolean {
	return isObject(value) && value['runtime'] === 'ort-whisper';
}

function validateExecutionProviders(value: unknown): OrtExecutionProvider[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new AsrManifestError('executionProviders must be a non-empty array');
	}
	const eps = value.map((entry, index) => {
		if (!EXECUTION_PROVIDERS.includes(entry as OrtExecutionProvider)) {
			throw new AsrManifestError(
				`executionProviders[${index}] must be one of [${EXECUTION_PROVIDERS.join(', ')}]`
			);
		}
		return entry as OrtExecutionProvider;
	});
	// ASR is never frame-coupled, so wasm/cpu is permitted; this still rejects an
	// empty/garbage EP list through the shared policy.
	try {
		return resolveExecutionProviders({ frameCoupled: false, executionProviders: eps });
	} catch (error) {
		if (error instanceof OrtEpPolicyError) throw new AsrManifestError(error.message);
		throw error;
	}
}

function validateIo(value: unknown): AsrOrtIoContract {
	if (!isObject(value)) throw new AsrManifestError('io must be an object');
	const name = (field: keyof AsrOrtIoContract): string => {
		if (!isNonEmptyString(value[field]))
			throw new AsrManifestError(`io.${field} must be a non-empty string`);
		return value[field];
	};
	const dtype = value['inputIdsDataType'];
	if (!INPUT_IDS_DTYPES.includes(dtype as AsrOrtInputIdsDataType)) {
		throw new AsrManifestError(
			`io.inputIdsDataType must be one of [${INPUT_IDS_DTYPES.join(', ')}]`
		);
	}
	return {
		encoderInput: name('encoderInput'),
		encoderOutput: name('encoderOutput'),
		decoderInputIds: name('decoderInputIds'),
		decoderEncoderHidden: name('decoderEncoderHidden'),
		decoderLogits: name('decoderLogits'),
		inputIdsDataType: dtype as AsrOrtInputIdsDataType
	};
}

/**
 * Validates an untrusted ONNX Whisper manifest document. Throws
 * {@link AsrManifestError} with a precise reason on the first violation. Unknown
 * fields are tolerated for forward compatibility.
 */
export function validateOrtWhisperManifest(value: unknown): AsrOrtModelManifestSnapshot {
	if (!isObject(value)) throw new AsrManifestError('manifest must be an object');

	if (value['runtime'] !== 'ort-whisper')
		throw new AsrManifestError('runtime must be "ort-whisper"');
	if (value['format'] !== 'onnx') throw new AsrManifestError('format must be "onnx"');

	if (!isNonEmptyString(value['id'])) throw new AsrManifestError('id must be a non-empty string');
	if (!isNonEmptyString(value['version']))
		throw new AsrManifestError('version must be a non-empty string');
	if (!isNonEmptyString(value['license']))
		throw new AsrManifestError('license must be a non-empty string');
	if (!isNonEmptyString(value['source']))
		throw new AsrManifestError('source must be a non-empty URL string');

	const executionProviders = validateExecutionProviders(value['executionProviders']);

	const encoder = validateAsset(value['encoder'], 'encoder');
	const decoder = validateAsset(value['decoder'], 'decoder');
	const decoderWithPast =
		value['decoderWithPast'] === undefined || value['decoderWithPast'] === null
			? null
			: validateAsset(value['decoderWithPast'], 'decoderWithPast');
	const tokenizer = validateAsset(value['tokenizer'], 'tokenizer');

	const declaredSize = value['sizeBytes'];
	if (!isPositiveNumber(declaredSize))
		throw new AsrManifestError('sizeBytes must be a positive number');
	const assetSum =
		encoder.sizeBytes + decoder.sizeBytes + tokenizer.sizeBytes + (decoderWithPast?.sizeBytes ?? 0);
	if (declaredSize !== assetSum)
		throw new AsrManifestError(
			`sizeBytes (${declaredSize}) must equal the sum of downloaded asset sizes (${assetSum})`
		);

	const io = validateIo(value['io']);
	const audio = validateAudioConfig(value['audio']);

	if (!isPositiveNumber(value['maxDecodeTokens']))
		throw new AsrManifestError('maxDecodeTokens must be a positive number');
	if (!isPositiveNumber(value['vocabSize']))
		throw new AsrManifestError('vocabSize must be a positive number');
	if (!isPositiveNumber(value['encoderFramesPerSecond']))
		throw new AsrManifestError('encoderFramesPerSecond must be a positive number');

	const tokens = validateSpecialTokens(value['tokens']);

	const languages = value['languages'];
	if (!Array.isArray(languages) || languages.length === 0 || !languages.every(isString))
		throw new AsrManifestError('languages must be a non-empty array of strings');

	const defaultLanguage = value['defaultLanguage'];
	if (defaultLanguage !== null && defaultLanguage !== undefined && !isString(defaultLanguage))
		throw new AsrManifestError('defaultLanguage must be a string or null');
	if (isString(defaultLanguage) && !languages.includes(defaultLanguage))
		throw new AsrManifestError('defaultLanguage must be one of languages');

	const decode = validateDecodeParams(value['decode']);

	const provider = value['provider'];
	if (provider !== undefined && provider !== null && !isString(provider))
		throw new AsrManifestError('provider must be a string or null');
	const infoUrl = value['infoUrl'];
	if (infoUrl !== undefined && infoUrl !== null && !isString(infoUrl))
		throw new AsrManifestError('infoUrl must be a string or null');

	return {
		id: value['id'],
		version: value['version'],
		license: value['license'],
		source: value['source'],
		runtime: 'ort-whisper',
		format: 'onnx',
		provider: isString(provider) ? provider : null,
		infoUrl: isString(infoUrl) ? infoUrl : null,
		executionProviders,
		sizeBytes: declaredSize,
		encoder,
		decoder,
		decoderWithPast,
		tokenizer,
		io,
		audio,
		maxDecodeTokens: value['maxDecodeTokens'] as number,
		vocabSize: value['vocabSize'] as number,
		encoderFramesPerSecond: value['encoderFramesPerSecond'] as number,
		tokens,
		languages,
		defaultLanguage: defaultLanguage ?? null,
		decode
	};
}

/** A downloadable ONNX-Whisper asset with a stable key (for progress accounting). */
export type AsrOrtAssetKey = 'encoder' | 'decoder' | 'decoderWithPast' | 'tokenizer';

/**
 * Lists the assets the no-cache ORT runtime downloads, in order. `decoderWithPast`
 * is intentionally excluded: the current runtime recomputes the decoder each step
 * from the full token sequence, so it never needs the KV-cache graph — declaring
 * it must not cost the user a download.
 */
export function ortWhisperManifestAssets(
	manifest: AsrOrtModelManifestSnapshot
): ReadonlyArray<{ key: AsrOrtAssetKey; asset: AsrModelAssetSnapshot }> {
	return [
		{ key: 'encoder', asset: manifest.encoder },
		{ key: 'decoder', asset: manifest.decoder },
		{ key: 'tokenizer', asset: manifest.tokenizer }
	];
}
