/**
 * ASR model manifest validation (Phase 29, LiteRT.js WASM Whisper). Pure,
 * unit-testable functions that validate the Whisper model manifest before any
 * fetch or graph build.
 *
 * The manifest declares a single TFLite model (with `encode`/`decode`
 * signatures) and a tokenizer vocabulary, each with an exact byte size and a
 * SHA-256 digest, plus the special token ids for the model's vocabulary. Bytes
 * are verified against the digest before they reach LiteRT; a mismatch is a hard
 * error and must never trigger a silent retry against another source.
 */
import type {
	AsrDecodeParams,
	AsrModelAssetSnapshot,
	AsrModelManifestSnapshot,
	AsrSpecialTokens
} from '../../protocol';

export class AsrManifestError extends Error {
	constructor(reason: string) {
		super(`ASR model manifest invalid: ${reason}`);
		this.name = 'AsrManifestError';
	}
}

function isString(v: unknown): v is string {
	return typeof v === 'string';
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0;
}

function isPositiveNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isTokenId(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isArrayOfStrings(v: unknown): v is string[] {
	return Array.isArray(v) && v.every(isString);
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const CHECKSUM_RE = /^sha256-[0-9a-f]{64}$/;

function validateAsset(value: unknown, field: string): AsrModelAssetSnapshot {
	if (!isObject(value)) throw new AsrManifestError(`${field} must be an object`);
	if (!isNonEmptyString(value['url']))
		throw new AsrManifestError(`${field}.url must be a non-empty string`);
	if (!isPositiveNumber(value['sizeBytes']))
		throw new AsrManifestError(`${field}.sizeBytes must be a positive number`);
	if (!isString(value['checksum']) || !CHECKSUM_RE.test(value['checksum']))
		throw new AsrManifestError(`${field}.checksum must be "sha256-" followed by 64 hex digits`);
	return {
		url: value['url'],
		sizeBytes: value['sizeBytes'],
		checksum: value['checksum']
	};
}

function validateSpecialTokens(value: unknown): AsrSpecialTokens {
	if (!isObject(value)) throw new AsrManifestError('tokens must be an object');
	for (const field of [
		'startOfTranscript',
		'endOfText',
		'transcribe',
		'noTimestamps',
		'noSpeech',
		'timestampBegin'
	] as const) {
		if (!isTokenId(value[field]))
			throw new AsrManifestError(`tokens.${field} must be a non-negative integer`);
	}
	const language = value['language'];
	if (!isObject(language)) throw new AsrManifestError('tokens.language must be an object');
	const languageMap: Record<string, number> = {};
	for (const [code, id] of Object.entries(language)) {
		if (!isTokenId(id))
			throw new AsrManifestError(`tokens.language.${code} must be a non-negative integer`);
		languageMap[code] = id;
	}
	return {
		startOfTranscript: value['startOfTranscript'] as number,
		endOfText: value['endOfText'] as number,
		transcribe: value['transcribe'] as number,
		noTimestamps: value['noTimestamps'] as number,
		noSpeech: value['noSpeech'] as number,
		timestampBegin: value['timestampBegin'] as number,
		language: languageMap
	};
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function validateDecodeParams(value: unknown): AsrDecodeParams | null {
	if (value === undefined || value === null) return null;
	if (!isObject(value)) throw new AsrManifestError('decode must be an object or null');
	const params: AsrDecodeParams = {};
	if (value['logProbThreshold'] !== undefined) {
		if (!isFiniteNumber(value['logProbThreshold']) || value['logProbThreshold'] > 0)
			throw new AsrManifestError('decode.logProbThreshold must be a non-positive finite number');
		params.logProbThreshold = value['logProbThreshold'];
	}
	if (value['noSpeechThreshold'] !== undefined) {
		if (
			!isFiniteNumber(value['noSpeechThreshold']) ||
			value['noSpeechThreshold'] < 0 ||
			value['noSpeechThreshold'] > 1
		)
			throw new AsrManifestError(
				'decode.noSpeechThreshold must be a finite number between 0 and 1'
			);
		params.noSpeechThreshold = value['noSpeechThreshold'];
	}
	if (value['compressionRatioThreshold'] !== undefined) {
		if (
			!isFiniteNumber(value['compressionRatioThreshold']) ||
			value['compressionRatioThreshold'] <= 0
		)
			throw new AsrManifestError(
				'decode.compressionRatioThreshold must be a positive finite number'
			);
		params.compressionRatioThreshold = value['compressionRatioThreshold'];
	}
	if (value['temperatures'] !== undefined) {
		if (
			!Array.isArray(value['temperatures']) ||
			!value['temperatures'].every((t: unknown) => isFiniteNumber(t) && (t as number) >= 0)
		)
			throw new AsrManifestError(
				'decode.temperatures must be an array of non-negative finite numbers'
			);
		if (value['temperatures'].length === 0)
			throw new AsrManifestError('decode.temperatures must not be empty');
		if (value['temperatures'][0] !== 0)
			throw new AsrManifestError('decode.temperatures must start with 0.0 (greedy decoding)');
		params.temperatures = value['temperatures'];
	}
	return params;
}

/**
 * Validates an untrusted manifest document. Throws {@link AsrManifestError} with
 * a precise reason on the first violation. Unknown fields are tolerated so the
 * manifest can carry extra provenance without breaking older clients.
 */
export function validateAsrManifest(value: unknown): AsrModelManifestSnapshot {
	if (!isObject(value)) throw new AsrManifestError('manifest must be an object');

	if (!isNonEmptyString(value['id'])) throw new AsrManifestError('id must be a non-empty string');
	if (!isNonEmptyString(value['version']))
		throw new AsrManifestError('version must be a non-empty string');
	if (!isNonEmptyString(value['license']))
		throw new AsrManifestError('license must be a non-empty string');
	if (!isNonEmptyString(value['source']))
		throw new AsrManifestError('source must be a non-empty URL string');

	const model = validateAsset(value['model'], 'model');
	const tokenizer = validateAsset(value['tokenizer'], 'tokenizer');

	const declaredSize = value['sizeBytes'];
	if (!isPositiveNumber(declaredSize))
		throw new AsrManifestError('sizeBytes must be a positive number');
	const assetSum = model.sizeBytes + tokenizer.sizeBytes;
	if (declaredSize !== assetSum)
		throw new AsrManifestError(
			`sizeBytes (${declaredSize}) must equal the sum of asset sizes (${assetSum})`
		);

	const audio = value['audio'];
	if (!isObject(audio)) throw new AsrManifestError('audio must be an object');
	if (audio['sampleRate'] !== 16000) throw new AsrManifestError('audio.sampleRate must be 16000');
	if (audio['channels'] !== 1) throw new AsrManifestError('audio.channels must be 1');
	if (!isPositiveNumber(audio['hopLength']))
		throw new AsrManifestError('audio.hopLength must be a positive number');
	if (!isPositiveNumber(audio['nMel']))
		throw new AsrManifestError('audio.nMel must be a positive number');
	if (!isPositiveNumber(audio['chunkLengthS']))
		throw new AsrManifestError('audio.chunkLengthS must be a positive number');

	if (!isPositiveNumber(value['maxDecodeTokens']))
		throw new AsrManifestError('maxDecodeTokens must be a positive number');
	if (!isPositiveNumber(value['vocabSize']))
		throw new AsrManifestError('vocabSize must be a positive number');
	if (!isPositiveNumber(value['encoderFramesPerSecond']))
		throw new AsrManifestError('encoderFramesPerSecond must be a positive number');

	const tokens = validateSpecialTokens(value['tokens']);

	const languages = value['languages'];
	if (!isArrayOfStrings(languages) || languages.length === 0)
		throw new AsrManifestError('languages must be a non-empty array of strings');

	const defaultLanguage = value['defaultLanguage'];
	if (defaultLanguage !== null && !isString(defaultLanguage))
		throw new AsrManifestError('defaultLanguage must be a string or null');
	if (isString(defaultLanguage) && !languages.includes(defaultLanguage))
		throw new AsrManifestError('defaultLanguage must be one of languages');

	const decode = validateDecodeParams(value['decode']);

	return {
		id: value['id'],
		version: value['version'],
		license: value['license'],
		source: value['source'],
		sizeBytes: declaredSize,
		model,
		tokenizer,
		audio: {
			sampleRate: 16000,
			channels: 1,
			hopLength: audio['hopLength'] as number,
			nMel: audio['nMel'] as number,
			chunkLengthS: audio['chunkLengthS'] as number
		},
		maxDecodeTokens: value['maxDecodeTokens'] as number,
		vocabSize: value['vocabSize'] as number,
		encoderFramesPerSecond: value['encoderFramesPerSecond'] as number,
		tokens,
		languages,
		defaultLanguage: defaultLanguage ?? null,
		decode
	};
}

/** Lists the manifest assets in download order with stable keys. */
export function manifestAssets(
	manifest: AsrModelManifestSnapshot
): ReadonlyArray<{ key: 'model' | 'tokenizer'; asset: AsrModelAssetSnapshot }> {
	return [
		{ key: 'model', asset: manifest.model },
		{ key: 'tokenizer', asset: manifest.tokenizer }
	];
}
