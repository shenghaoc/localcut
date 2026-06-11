/**
 * ASR model manifest validation (Phase 29). Pure, unit-testable functions
 * for validating the Whisper model manifest before any fetch or graph build.
 */
import type { AsrModelManifestSnapshot } from '../../protocol';

export class AsrManifestError extends Error {
	constructor(reason: string) {
		super(`ASR model manifest invalid: ${reason}`);
		this.name = 'AsrManifestError';
	}
}

function isString(v: unknown): v is string {
	return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function isArrayOfStrings(v: unknown): v is string[] {
	return Array.isArray(v) && v.every(isString);
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateAsrManifest(value: unknown): AsrModelManifestSnapshot {
	if (!isObject(value)) throw new AsrManifestError('manifest must be an object');

	const id = value['id'];
	if (id !== 'whisper-tiny-bilingual') throw new AsrManifestError('id must be "whisper-tiny-bilingual"');

	const version = value['version'];
	if (!isString(version) || version.length === 0) throw new AsrManifestError('version must be a non-empty string');

	const license = value['license'];
	if (!isString(license) || license.length === 0) throw new AsrManifestError('license must be a non-empty string');

	const source = value['source'];
	if (!isString(source) || source.length === 0) throw new AsrManifestError('source must be a non-empty URL string');

	const sizeBytes = value['sizeBytes'];
	if (!isNumber(sizeBytes) || sizeBytes <= 0) throw new AsrManifestError('sizeBytes must be a positive number');

	const checksum = value['checksum'];
	if (!isString(checksum) || !checksum.startsWith('sha256-') || checksum.length < 71)
		throw new AsrManifestError('checksum must be "sha256-<hex>" (64 hex chars)');

	const audio = value['audio'];
	if (!isObject(audio)) throw new AsrManifestError('audio must be an object');
	if (audio['sampleRate'] !== 16000) throw new AsrManifestError('audio.sampleRate must be 16000');
	if (audio['channels'] !== 1) throw new AsrManifestError('audio.channels must be 1');
	if (!isNumber(audio['hopLength']) || (audio['hopLength'] as number) <= 0)
		throw new AsrManifestError('audio.hopLength must be a positive number');
	if (!isNumber(audio['nMel']) || (audio['nMel'] as number) <= 0)
		throw new AsrManifestError('audio.nMel must be a positive number');

	const vocabSize = value['vocabSize'];
	if (!isNumber(vocabSize) || vocabSize <= 0) throw new AsrManifestError('vocabSize must be a positive number');

	const encoderFps = value['encoderFramesPerSecond'];
	if (!isNumber(encoderFps) || encoderFps <= 0)
		throw new AsrManifestError('encoderFramesPerSecond must be a positive number');

	const languages = value['languages'];
	if (!isArrayOfStrings(languages) || languages.length === 0)
		throw new AsrManifestError('languages must be a non-empty array of strings');

	return {
		id: 'whisper-tiny-bilingual',
		version,
		license,
		source,
		sizeBytes,
		checksum,
		audio: {
			sampleRate: 16000,
			channels: 1,
			hopLength: audio['hopLength'] as number,
			nMel: audio['nMel'] as number
		} as AsrModelManifestSnapshot['audio'],
		vocabSize,
		encoderFramesPerSecond: encoderFps,
		languages
	};
}
