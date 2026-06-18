/**
 * ONNX matte-model manifest (Phase 31 ORT/ONNX backend).
 *
 * The base provenance + integrity + execution-provider policy is the shared
 * {@link validateOrtManifest} (`OrtModelManifest`): `format: 'onnx'`,
 * `frameCoupled: true` (so the EP policy forbids any WASM/CPU fallback on the
 * per-frame matte path), pinned execution providers, and a digest-pinned ONNX
 * asset. On top of that, the matte `io` block declares how the engine wires
 * tensors and — explicitly — the **output contract**: the alpha/mask layout,
 * channel count, and value range the model emits.
 *
 * Two gates beyond the shared validator:
 * - **License gate**: GPL-family weights are rejected (the deployed app is MIT;
 *   recommending copyleft weights pushes obligations onto every deployer).
 * - **Template gate**: a `template`-flagged (or otherwise unvalidatable) manifest
 *   reports the model as unconfigured rather than appearing loadable, matching the
 *   interpolation manifest pattern.
 *
 * Validation is pure and tolerant of unknown fields; it never fetches anything.
 */
import type { MatteInputRange } from '../../protocol';
import { OrtManifestError, validateOrtManifest } from '../ml/ort/ort-model-manifest';
import type { OrtModelManifest } from '../ml/ort/ort-types';

/** Tensor memory layout the ONNX graph uses on its image input / alpha output. */
export type MatteOnnxLayout = 'nchw' | 'nhwc';

/**
 * Value range of the model's alpha/mask output. `unit` is [0, 1] (a sigmoid is
 * baked into the export — the common case for MODNet/U²-Net-class matting and for
 * segmentation confidence). `signed-unit` ([-1, 1]) is declared for forward
 * compatibility but not yet runnable by the engine (it would need a resolve
 * denormalize); {@link validateMatteOnnxManifest} rejects it with a clear message.
 */
export type MatteOnnxOutputRange = 'unit' | 'signed-unit';

/**
 * Matte-specific model I/O contract (beyond the base ORT manifest). The output
 * fields state the alpha/mask **shape** (`outputLayout` + `outputChannels`,
 * i.e. `[1, 1, H, W]` for NCHW single-channel) and **value range** (`outputRange`),
 * which the resolve pass relies on.
 */
export interface MatteOnnxIoContract {
	/** Input layout: `nchw` (PyTorch/MODNet convention) or `nhwc`. */
	layout: MatteOnnxLayout;
	/** Model input width in pixels. */
	inputWidth: number;
	/** Model input height in pixels. */
	inputHeight: number;
	/** Channels on the image input — RGB, so 3. */
	inputChannels: number;
	/** Bytes per element (4 = FP32; the only width the f32 buffers run). */
	bytesPerElement: number;
	/** ONNX input name for the RGB image. */
	inputName: string;
	/** Pixel normalization the model expects: `unit` [0,1] or `signed-unit` [-1,1]. */
	inputRange: MatteInputRange;
	/** ONNX output name for the alpha/mask. */
	outputName: string;
	/** Output layout. With a single channel the buffer index is the same either
	 *  way; declared so the contract is explicit and future multi-channel outputs
	 *  are unambiguous. */
	outputLayout: MatteOnnxLayout;
	/** Output channels — 1 (single-channel alpha/mask). */
	outputChannels: number;
	/** Output value range — `unit` [0,1] alpha. */
	outputRange: MatteOnnxOutputRange;
}

/** A validated ONNX matte manifest (ORT manifest + matte IO/output contract). */
export interface MatteOnnxModelManifestSnapshot extends OrtModelManifest {
	readonly io: MatteOnnxIoContract;
}

export class MatteOnnxManifestError extends Error {
	constructor(reason: string) {
		super(`ONNX matte model manifest invalid: ${reason}`);
		this.name = 'MatteOnnxManifestError';
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new MatteOnnxManifestError(`io.${field} must be a positive integer`);
	}
	return value;
}

function requireName(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new MatteOnnxManifestError(`io.${field} must be a non-empty string`);
	}
	return value;
}

function requireLayout(value: unknown, field: string): MatteOnnxLayout {
	if (value !== 'nchw' && value !== 'nhwc') {
		throw new MatteOnnxManifestError(`io.${field} must be "nchw" or "nhwc"`);
	}
	return value;
}

function requireInputRange(value: unknown): MatteInputRange {
	if (value !== 'unit' && value !== 'signed-unit') {
		throw new MatteOnnxManifestError('io.inputRange must be "unit" or "signed-unit"');
	}
	return value;
}

function validateIo(value: unknown): MatteOnnxIoContract {
	if (!isObject(value)) throw new MatteOnnxManifestError('io must be an object');

	const inputChannels = requirePositiveInt(value['inputChannels'], 'inputChannels');
	if (inputChannels !== 3) {
		throw new MatteOnnxManifestError(
			`io.inputChannels must be 3 (RGB) for the ORT matte backend; got ${inputChannels}`
		);
	}
	const bytesPerElement = requirePositiveInt(value['bytesPerElement'], 'bytesPerElement');
	if (bytesPerElement !== 4) {
		throw new MatteOnnxManifestError(
			`io.bytesPerElement must be 4 (FP32) for the ORT matte backend; got ${bytesPerElement}`
		);
	}

	const outputChannels = requirePositiveInt(value['outputChannels'], 'outputChannels');
	if (outputChannels !== 1) {
		throw new MatteOnnxManifestError(
			`io.outputChannels must be 1 (single-channel alpha) for the ORT matte backend; got ${outputChannels}. ` +
				'Multi-channel / softmax outputs need a resolve variant (future work).'
		);
	}
	const outputRange = value['outputRange'];
	if (outputRange === 'signed-unit') {
		throw new MatteOnnxManifestError(
			'io.outputRange "signed-unit" is not yet supported by the ORT matte backend; ' +
				'bake a sigmoid into the export so the alpha is "unit" [0,1].'
		);
	}
	if (outputRange !== 'unit') {
		throw new MatteOnnxManifestError('io.outputRange must be "unit" (alpha in [0,1])');
	}

	return {
		layout: requireLayout(value['layout'], 'layout'),
		inputWidth: requirePositiveInt(value['inputWidth'], 'inputWidth'),
		inputHeight: requirePositiveInt(value['inputHeight'], 'inputHeight'),
		inputChannels,
		bytesPerElement,
		inputName: requireName(value['inputName'], 'inputName'),
		inputRange: requireInputRange(value['inputRange']),
		outputName: requireName(value['outputName'], 'outputName'),
		outputLayout: requireLayout(value['outputLayout'], 'outputLayout'),
		outputChannels,
		outputRange
	};
}

/**
 * Validates an untrusted ONNX matte manifest. Builds on {@link validateOrtManifest}
 * (ONNX format, provenance, integrity, frame-coupled EP policy) and adds the matte
 * IO + output contract, the GPL license gate, and the placeholder/template gate.
 * Rejects any manifest that is not frame-coupled (matte always is).
 */
export function validateMatteOnnxManifest(value: unknown): MatteOnnxModelManifestSnapshot {
	// Template gate: a placeholder manifest reports the model as unconfigured.
	if (isObject(value) && value['template'] === true) {
		throw new MatteOnnxManifestError(
			'manifest is a placeholder template — vendor a real, license-verified ONNX matte model ' +
				'(size + SHA-256 + IO/output contract) before the experimental backend can load'
		);
	}

	let base: OrtModelManifest;
	try {
		base = validateOrtManifest(value);
	} catch (error) {
		if (error instanceof OrtManifestError) throw new MatteOnnxManifestError(error.message);
		throw error;
	}

	if (!base.frameCoupled) {
		throw new MatteOnnxManifestError('matte models must declare "frameCoupled": true');
	}

	// EP gate: the ORT matte engine implements only the WebGPU path (it injects the
	// renderer device, builds `Tensor.fromGpuBuffer` inputs, and reads
	// `outputTensor.gpuBuffer`). A WebNN-pinned manifest passes the shared
	// frame-coupled gate but cannot run here — the engine would force `gpu-buffer`
	// IO on an `ml-tensor` EP. Require webgpu-only until a dedicated WebNN tensor
	// path exists (which needs a per-operator support proof first).
	if (base.executionProviders.length !== 1 || base.executionProviders[0] !== 'webgpu') {
		throw new MatteOnnxManifestError(
			`executionProviders must be exactly ["webgpu"] for the ORT matte backend; got ` +
				`[${base.executionProviders.join(', ')}]. ORT-WebNN needs a separate tensor path ` +
				`(per-operator support proof) before it can be pinned.`
		);
	}

	// License gate (hard fail): the app is MIT, so copyleft weights are rejected even
	// when fetched at runtime.
	if (isCopyleftLicense(base.license)) {
		throw new MatteOnnxManifestError(
			`model "${base.id}" declares a copyleft license (${base.license}); refusing to load — ` +
				`the app is MIT and ships only permissively-licensed weights`
		);
	}

	const io = validateIo(isObject(value) ? value['io'] : undefined);
	return { ...base, io };
}

/**
 * True for GPL-family / copyleft licenses this MIT app refuses to ship weights
 * under. Matches both the SPDX abbreviation and the spelled-out name, so
 * `GPL-3.0`, `LGPL-2.1`, `AGPL-3.0-only`, `GNU General Public License v3.0`, and
 * `GNU Affero General Public License` are all rejected — not just bare `gpl`.
 */
function isCopyleftLicense(license: string): boolean {
	return /\b[al]?gpl\b|general public license|affero|copyleft/i.test(license);
}
