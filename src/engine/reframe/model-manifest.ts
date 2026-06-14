/**
 * Model manifest validation for the LiteRT.js face-detection model.
 * Follows the Phase 28/29 LiteRT manifest pattern: a TFLite model asset with a
 * `sha256-`-prefixed digest, verified before use via the shared asset cache.
 */

export interface ReframeModelAsset {
	/** Same-origin or trusted-host URL of the `.tflite` model file. */
	url: string;
	sizeBytes: number;
	/** `"sha256-"` followed by 64 lowercase hex digits. */
	checksum: string;
}

export interface ReframeModelManifest {
	id: string;
	version: string;
	license: string;
	source: string;
	model: ReframeModelAsset;
	/** Square model input edge in px (e.g. 128). */
	inputSize: number;
	/** Floats per detection row in the model's flat output (see
	 *  `decodeFaceDetections`); must be ≥ 5 (`[score, cx, cy, w, h, …]`). */
	outputStride: number;
	format: 'tflite';
}

export interface ManifestValidationError {
	field: string;
	reason: string;
}

const CHECKSUM_RE = /^sha256-[0-9a-f]{64}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Validate a model manifest object. Returns the typed manifest on success, or
 * an error describing the first missing/invalid field.
 */
export function validateManifest(
	input: unknown
): { ok: true; manifest: ReframeModelManifest } | { ok: false; error: ManifestValidationError } {
	if (!isObject(input)) {
		return { ok: false, error: { field: 'root', reason: 'Manifest must be a non-null object' } };
	}

	for (const field of ['id', 'version', 'license', 'source'] as const) {
		if (typeof input[field] !== 'string') {
			return { ok: false, error: { field, reason: `Expected string, got ${typeof input[field]}` } };
		}
	}

	if (input.format !== 'tflite') {
		return {
			ok: false,
			error: { field: 'format', reason: `Expected 'tflite', got '${String(input.format)}'` }
		};
	}

	if (typeof input.inputSize !== 'number' || input.inputSize <= 0) {
		return { ok: false, error: { field: 'inputSize', reason: 'Must be a positive number' } };
	}
	if (typeof input.outputStride !== 'number' || input.outputStride < 5) {
		return { ok: false, error: { field: 'outputStride', reason: 'Must be a number ≥ 5' } };
	}

	if (!isObject(input.model)) {
		return { ok: false, error: { field: 'model', reason: 'Must be an object' } };
	}
	const model = input.model;
	if (typeof model.url !== 'string' || model.url.length === 0) {
		return { ok: false, error: { field: 'model.url', reason: 'Must be a non-empty string' } };
	}
	if (typeof model.sizeBytes !== 'number' || model.sizeBytes <= 0) {
		return { ok: false, error: { field: 'model.sizeBytes', reason: 'Must be a positive number' } };
	}
	if (typeof model.checksum !== 'string' || !CHECKSUM_RE.test(model.checksum)) {
		return {
			ok: false,
			error: { field: 'model.checksum', reason: 'Must be "sha256-" followed by 64 hex digits' }
		};
	}

	return {
		ok: true,
		manifest: {
			id: input.id as string,
			version: input.version as string,
			license: input.license as string,
			source: input.source as string,
			model: {
				url: model.url,
				sizeBytes: model.sizeBytes,
				checksum: model.checksum
			},
			inputSize: input.inputSize,
			outputStride: input.outputStride,
			format: 'tflite'
		}
	};
}
