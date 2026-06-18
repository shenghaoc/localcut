/**
 * DTLN **ONNX** cleanup-model manifest (ONNX Runtime Web backend).
 *
 * Declares the two-model + audio + state contract for the upstream `model_1.onnx`
 * / `model_2.onnx` weights and adds the ORT-specific runtime policy: pinned
 * execution providers and the graph IO tensor names the runtime feeds and reads.
 * Audio tensors are tiny, so the shipped manifest pins the `wasm` execution
 * provider; see {@link file://./dtln-ort-runtime.ts}.
 *
 * Assets are fetched via the same-origin GitHub proxy (`/_model/gh/`) and cached
 * in OPFS by the shared asset-cache module (Phase 29).
 */

import type { OrtExecutionProvider } from '../ml/ort/ort-types';
import { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE } from './dtln-dsp';

export { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE };

export interface CleanupModelAsset {
	url: string;
	sizeBytes: number;
	checksum: string;
}

/** Execution providers the ONNX cleanup runtime accepts (subset of ORT's). */
const VALID_EXECUTION_PROVIDERS: readonly OrtExecutionProvider[] = ['webgpu', 'webnn', 'wasm'];

/** Graph IO tensor names for the first DTLN model (STFT-magnitude masking). */
export interface OnnxCleanupModel1Io {
	/** Magnitude-spectrum input, shape `[1, 1, freqBins]`. */
	magnitudeInput: string;
	/** Recurrent-state input, shape `stateShape`. */
	stateInput: string;
	/** Predicted mask output, shape `[1, 1, freqBins]`. */
	maskOutput: string;
	/** Updated recurrent-state output, shape `stateShape`. */
	stateOutput: string;
}

/** Graph IO tensor names for the second DTLN model (learned-transform enhance). */
export interface OnnxCleanupModel2Io {
	/** Estimated time-domain frame input, shape `[1, 1, blockLen]`. */
	frameInput: string;
	/** Recurrent-state input, shape `stateShape`. */
	stateInput: string;
	/** Enhanced time-domain frame output, shape `[1, 1, blockLen]`. */
	frameOutput: string;
	/** Updated recurrent-state output, shape `stateShape`. */
	stateOutput: string;
}

export interface OnnxCleanupIo {
	model1: OnnxCleanupModel1Io;
	model2: OnnxCleanupModel2Io;
}

export interface OnnxCleanupManifest {
	id: string;
	version: string;
	license: string;
	source: string;
	/** Upstream author/distributor, e.g. for attribution in the UI/picker. */
	provider: string;
	/** Human-facing model-card URL. */
	modelCard: string;
	format: 'onnx';
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
	/** Pinned, ordered execution-provider preference (audio: `wasm`/CPU). */
	executionProviders: OrtExecutionProvider[];
	io: OnnxCleanupIo;
}

export class OnnxManifestError extends Error {
	constructor(message: string) {
		super(`Invalid ONNX cleanup manifest: ${message}`);
		this.name = 'OnnxManifestError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new OnnxManifestError(`"${field}" must be a non-empty string`);
	}
	return value;
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new OnnxManifestError(`"${field}" must be a positive integer`);
	}
	return value;
}

function validateAsset(value: unknown, field: string): CleanupModelAsset {
	if (!isRecord(value)) throw new OnnxManifestError(`"${field}" must be an object`);
	const url = requireString(value.url, `${field}.url`);
	const sizeBytes = requirePositiveInt(value.sizeBytes, `${field}.sizeBytes`);
	const checksum = requireString(value.checksum, `${field}.checksum`);
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new OnnxManifestError(`"${field}.checksum" must be "sha256-" followed by 64 hex digits`);
	}
	return { url, sizeBytes, checksum };
}

function validateModel1Io(value: unknown): OnnxCleanupModel1Io {
	if (!isRecord(value)) throw new OnnxManifestError('"io.model1" must be an object');
	return {
		magnitudeInput: requireString(value.magnitudeInput, 'io.model1.magnitudeInput'),
		stateInput: requireString(value.stateInput, 'io.model1.stateInput'),
		maskOutput: requireString(value.maskOutput, 'io.model1.maskOutput'),
		stateOutput: requireString(value.stateOutput, 'io.model1.stateOutput')
	};
}

function validateModel2Io(value: unknown): OnnxCleanupModel2Io {
	if (!isRecord(value)) throw new OnnxManifestError('"io.model2" must be an object');
	return {
		frameInput: requireString(value.frameInput, 'io.model2.frameInput'),
		stateInput: requireString(value.stateInput, 'io.model2.stateInput'),
		frameOutput: requireString(value.frameOutput, 'io.model2.frameOutput'),
		stateOutput: requireString(value.stateOutput, 'io.model2.stateOutput')
	};
}

function validateExecutionProviders(value: unknown): OrtExecutionProvider[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new OnnxManifestError('"executionProviders" must be a non-empty array');
	}
	return value.map((ep, i) => {
		if (typeof ep !== 'string' || !VALID_EXECUTION_PROVIDERS.includes(ep as OrtExecutionProvider)) {
			throw new OnnxManifestError(
				`executionProviders[${i}] must be one of ${VALID_EXECUTION_PROVIDERS.join(', ')}`
			);
		}
		return ep as OrtExecutionProvider;
	});
}

export function validateOnnxCleanupManifest(value: unknown): OnnxCleanupManifest {
	if (!isRecord(value)) throw new OnnxManifestError('manifest must be an object');
	const id = requireString(value.id, 'id');
	const version = requireString(value.version, 'version');
	const license = requireString(value.license, 'license');
	const source = requireString(value.source, 'source');
	const provider = requireString(value.provider, 'provider');
	const modelCard = requireString(value.modelCard, 'modelCard');
	if (value.format !== 'onnx') throw new OnnxManifestError('"format" must be "onnx"');
	const sizeBytes = requirePositiveInt(value.sizeBytes, 'sizeBytes');
	const model1 = validateAsset(value.model1, 'model1');
	const model2 = validateAsset(value.model2, 'model2');

	if (!isRecord(value.audio)) throw new OnnxManifestError('"audio" must be an object');
	if (value.audio.sampleRate !== DTLN_SAMPLE_RATE) {
		throw new OnnxManifestError(`"audio.sampleRate" must be ${DTLN_SAMPLE_RATE}`);
	}
	if (value.audio.channels !== 1) throw new OnnxManifestError('"audio.channels" must be 1');
	if (value.audio.blockLen !== DTLN_BLOCK_LEN) {
		throw new OnnxManifestError(`"audio.blockLen" must be ${DTLN_BLOCK_LEN}`);
	}
	if (value.audio.blockShift !== DTLN_BLOCK_SHIFT) {
		throw new OnnxManifestError(`"audio.blockShift" must be ${DTLN_BLOCK_SHIFT}`);
	}

	if (!Array.isArray(value.stateShape)) {
		throw new OnnxManifestError('"stateShape" must be an array');
	}
	const stateShape = (value.stateShape as unknown[]).map((dim, i) => {
		if (typeof dim !== 'number' || !Number.isInteger(dim) || dim <= 0) {
			throw new OnnxManifestError(`stateShape[${i}] must be a positive integer`);
		}
		return dim;
	});

	const executionProviders = validateExecutionProviders(value.executionProviders);

	if (!isRecord(value.io)) throw new OnnxManifestError('"io" must be an object');
	const io: OnnxCleanupIo = {
		model1: validateModel1Io(value.io.model1),
		model2: validateModel2Io(value.io.model2)
	};

	if (model1.sizeBytes + model2.sizeBytes !== sizeBytes) {
		throw new OnnxManifestError('"sizeBytes" must equal model1.sizeBytes + model2.sizeBytes');
	}

	return {
		id,
		version,
		license,
		source,
		provider,
		modelCard,
		format: 'onnx',
		sizeBytes,
		model1,
		model2,
		audio: {
			sampleRate: DTLN_SAMPLE_RATE,
			channels: 1,
			blockLen: DTLN_BLOCK_LEN,
			blockShift: DTLN_BLOCK_SHIFT
		},
		stateShape,
		executionProviders,
		io
	};
}
