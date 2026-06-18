/**
 * Shared Whisper manifest validation helpers (Phase 29).
 *
 * ONNX Whisper manifests use these pure, unit-testable validators for the
 * byte-exact asset contract, fixed 16 kHz audio contract, special token ids, and
 * decode-quality thresholds before any model bytes are fetched or executed.
 */
import type { AsrDecodeParams, AsrModelAssetSnapshot, AsrSpecialTokens } from '../../protocol';

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

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const CHECKSUM_RE = /^sha256-[0-9a-f]{64}$/;

export function validateAsset(value: unknown, field: string): AsrModelAssetSnapshot {
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

export function validateSpecialTokens(value: unknown): AsrSpecialTokens {
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

export function validateDecodeParams(value: unknown): AsrDecodeParams | null {
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

/** The fixed audio contract Whisper runs on: 16 kHz mono log-mel input. */
export interface AsrAudioConfig {
	sampleRate: 16000;
	channels: 1;
	hopLength: number;
	nMel: number;
	/** Decoder context window in seconds (Whisper = 30). */
	chunkLengthS: number;
}

/**
 * The transcribe-time configuration the worker's decode path depends on. The
 * ORT manifest snapshot satisfies this structurally, so transcription stays
 * decoupled from the concrete runtime implementation.
 */
export interface AsrTranscribeConfig {
	/** Total download size — surfaced in the loaded-model status. */
	sizeBytes: number;
	audio: AsrAudioConfig;
	maxDecodeTokens: number;
	vocabSize: number;
	tokens: AsrSpecialTokens;
	languages: string[];
	defaultLanguage: string | null;
	decode: AsrDecodeParams | null;
}

/** Validates the `audio` block: 16 kHz mono with positive hop/mel/chunk values. */
export function validateAudioConfig(value: unknown): AsrAudioConfig {
	if (!isObject(value)) throw new AsrManifestError('audio must be an object');
	if (value['sampleRate'] !== 16000) throw new AsrManifestError('audio.sampleRate must be 16000');
	if (value['channels'] !== 1) throw new AsrManifestError('audio.channels must be 1');
	if (!isPositiveNumber(value['hopLength']))
		throw new AsrManifestError('audio.hopLength must be a positive number');
	if (!isPositiveNumber(value['nMel']))
		throw new AsrManifestError('audio.nMel must be a positive number');
	if (!isPositiveNumber(value['chunkLengthS']))
		throw new AsrManifestError('audio.chunkLengthS must be a positive number');
	return {
		sampleRate: 16000,
		channels: 1,
		hopLength: value['hopLength'],
		nMel: value['nMel'],
		chunkLengthS: value['chunkLengthS']
	};
}
