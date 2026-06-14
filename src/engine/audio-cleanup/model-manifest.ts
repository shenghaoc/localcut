/**
 * DTLN cleanup-model manifest: declares two TFLite model assets (provenance,
 * license, exact size, SHA-256 checksum) and the fixed audio contract. Assets
 * are fetched via the HuggingFace proxy and cached in OPFS by the shared
 * asset-cache module from Phase 29.
 */

import { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE } from './dtln-dsp';

export { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE };

export interface CleanupModelAsset {
	url: string;
	sizeBytes: number;
	checksum: string;
}

export interface CleanupModelManifest {
	id: string;
	version: string;
	license: string;
	source: string;
	sizeBytes: number;
	model1: CleanupModelAsset;
	model2: CleanupModelAsset;
	audio: {
		sampleRate: typeof DTLN_SAMPLE_RATE;
		channels: 1;
		blockLen: typeof DTLN_BLOCK_LEN;
		blockShift: typeof DTLN_BLOCK_SHIFT;
	};
	stateShape: number[];
}

export class ManifestError extends Error {
	constructor(message: string) {
		super(`Invalid cleanup model manifest: ${message}`);
		this.name = 'ManifestError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ManifestError(`"${field}" must be a non-empty string`);
	}
	return value;
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new ManifestError(`"${field}" must be a positive integer`);
	}
	return value;
}

function validateAsset(value: unknown, field: string): CleanupModelAsset {
	if (!isRecord(value)) throw new ManifestError(`"${field}" must be an object`);
	const url = requireString(value.url, `${field}.url`);
	const sizeBytes = requirePositiveInt(value.sizeBytes, `${field}.sizeBytes`);
	const checksum = requireString(value.checksum, `${field}.checksum`);
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new ManifestError(`"${field}.checksum" must be "sha256-" followed by 64 hex digits`);
	}
	return { url, sizeBytes, checksum };
}

export function validateManifest(value: unknown): CleanupModelManifest {
	if (!isRecord(value)) throw new ManifestError('manifest must be an object');
	const id = requireString(value.id, 'id');
	const version = requireString(value.version, 'version');
	const license = requireString(value.license, 'license');
	const source = requireString(value.source, 'source');
	const sizeBytes = requirePositiveInt(value.sizeBytes, 'sizeBytes');
	const model1 = validateAsset(value.model1, 'model1');
	const model2 = validateAsset(value.model2, 'model2');

	if (!isRecord(value.audio)) throw new ManifestError('"audio" must be an object');
	if (value.audio.sampleRate !== DTLN_SAMPLE_RATE) {
		throw new ManifestError(`"audio.sampleRate" must be ${DTLN_SAMPLE_RATE}`);
	}
	if (value.audio.channels !== 1) throw new ManifestError('"audio.channels" must be 1');
	if (value.audio.blockLen !== DTLN_BLOCK_LEN) {
		throw new ManifestError(`"audio.blockLen" must be ${DTLN_BLOCK_LEN}`);
	}
	if (value.audio.blockShift !== DTLN_BLOCK_SHIFT) {
		throw new ManifestError(`"audio.blockShift" must be ${DTLN_BLOCK_SHIFT}`);
	}

	if (!Array.isArray(value.stateShape)) {
		throw new ManifestError('"stateShape" must be an array');
	}
	const stateShape = (value.stateShape as unknown[]).map((dim, i) => {
		if (typeof dim !== 'number' || !Number.isInteger(dim) || dim <= 0) {
			throw new ManifestError(`stateShape[${i}] must be a positive integer`);
		}
		return dim;
	});

	if (model1.sizeBytes + model2.sizeBytes !== sizeBytes) {
		throw new ManifestError('"sizeBytes" must equal model1.sizeBytes + model2.sizeBytes');
	}

	return {
		id,
		version,
		license,
		source,
		sizeBytes,
		model1,
		model2,
		audio: {
			sampleRate: DTLN_SAMPLE_RATE,
			channels: 1,
			blockLen: DTLN_BLOCK_LEN,
			blockShift: DTLN_BLOCK_SHIFT
		},
		stateShape
	};
}
