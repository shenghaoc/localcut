/**
 * ONNX model manifest validation for the ORT foundation.
 *
 * ONNX manifests carry provenance + byte-exact integrity data, with ORT runtime
 * policy added: the declared format must be `onnx`, the execution
 * providers are pinned and validated against {@link file://./ep-policy.ts}, and a
 * frame-coupled model is rejected if it would ever resolve to WASM/CPU. Validation
 * is pure and tolerant of unknown fields; it never fetches anything.
 */
import type {
	OrtExecutionProvider,
	OrtModelAsset,
	OrtModelManifest,
	OrtTensorLocation
} from './ort-types';
import { OrtEpPolicyError, resolveExecutionProviders } from './ep-policy';

export class OrtManifestError extends Error {
	constructor(message: string) {
		super(`Invalid ONNX model manifest: ${message}`);
		this.name = 'OrtManifestError';
	}
}

const EXECUTION_PROVIDERS: readonly OrtExecutionProvider[] = ['webgpu', 'webnn', 'wasm'];
const TENSOR_LOCATIONS: readonly OrtTensorLocation[] = ['cpu', 'gpu-buffer', 'ml-tensor'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new OrtManifestError(`"${field}" must be a non-empty string`);
	}
	return value;
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new OrtManifestError(`"${field}" must be a positive integer`);
	}
	return value;
}

function requireChecksum(value: unknown, field: string): string {
	const checksum = requireString(value, field).toLowerCase();
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new OrtManifestError(`"${field}" must be "sha256-" followed by 64 hex digits`);
	}
	return checksum;
}

function parseModelAsset(value: unknown): OrtModelAsset {
	if (!isRecord(value)) throw new OrtManifestError('"model" must be an object');
	return {
		url: requireString(value.url, 'model.url'),
		sizeBytes: requirePositiveInt(value.sizeBytes, 'model.sizeBytes'),
		checksum: requireChecksum(value.checksum, 'model.checksum')
	};
}

function parseExecutionProviders(value: unknown): OrtExecutionProvider[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new OrtManifestError('"executionProviders" must be a non-empty array');
	}
	return value.map((entry, index) => {
		if (!EXECUTION_PROVIDERS.includes(entry as OrtExecutionProvider)) {
			throw new OrtManifestError(
				`"executionProviders[${index}]" must be one of [${EXECUTION_PROVIDERS.join(', ')}]`
			);
		}
		return entry as OrtExecutionProvider;
	});
}

function parseTensorLocation(value: unknown): OrtTensorLocation | undefined {
	if (value === undefined || value === null) return undefined;
	if (!TENSOR_LOCATIONS.includes(value as OrtTensorLocation)) {
		throw new OrtManifestError(`"tensorLocation" must be one of [${TENSOR_LOCATIONS.join(', ')}]`);
	}
	return value as OrtTensorLocation;
}

/** Validates an untrusted ONNX manifest document. Unknown fields are tolerated. */
export function validateOrtManifest(value: unknown): OrtModelManifest {
	if (!isRecord(value)) throw new OrtManifestError('manifest must be an object');

	if (value.format !== 'onnx') {
		throw new OrtManifestError('"format" must be "onnx"');
	}

	const frameCoupled = value.frameCoupled;
	if (typeof frameCoupled !== 'boolean') {
		throw new OrtManifestError('"frameCoupled" must be a boolean');
	}

	const executionProviders = parseExecutionProviders(value.executionProviders);
	// Enforce the EP hard gate at validation time too: a frame-coupled manifest
	// that pins WASM (or pins no GPU-class EP) is rejected before any fetch.
	try {
		resolveExecutionProviders({ frameCoupled, executionProviders });
	} catch (error) {
		if (error instanceof OrtEpPolicyError) throw new OrtManifestError(error.message);
		throw error;
	}

	const opset =
		value.opset === undefined || value.opset === null
			? undefined
			: requirePositiveInt(value.opset, 'opset');

	const tensorLocation = parseTensorLocation(value.tensorLocation);
	// The frame-coupled hard gate also covers the tensor location: a per-frame
	// model that pins `cpu` would force ORT to copy full-frame outputs back to the
	// CPU (the WebGPU session leaves `preferredOutputLocation` unset), which is the
	// exact silent CPU round-trip this validator exists to prevent.
	if (frameCoupled && tensorLocation === 'cpu') {
		throw new OrtManifestError(
			'frame-coupled models must not declare tensorLocation "cpu"; ' +
				'full-frame outputs must stay on-device (gpu-buffer or ml-tensor)'
		);
	}

	return {
		id: requireString(value.id, 'id'),
		version: requireString(value.version, 'version'),
		license: requireString(value.license, 'license'),
		source: requireString(value.source, 'source'),
		format: 'onnx',
		model: parseModelAsset(value.model),
		executionProviders,
		frameCoupled,
		...(opset !== undefined ? { opset } : {}),
		...(tensorLocation !== undefined ? { tensorLocation } : {}),
		...(value.infoUrl !== undefined ? { infoUrl: requireString(value.infoUrl, 'infoUrl') } : {})
	};
}
