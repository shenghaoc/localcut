/**
 * ONNX matte-model manifest (Phase 31 ORT/ONNX backend spike).
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
 *   recommending copyleft weights pushes obligations onto every deployer). This
 *   mirrors the LiteRT path's runtime gate in {@link file://./matte-engine.ts},
 *   moved earlier — before any byte is fetched.
 * - **Template gate**: a `template`-flagged (or otherwise unvalidatable) manifest
 *   keeps the experimental backend hidden rather than appearing loadable, exactly
 *   like the interpolation manifest (R2.4). The deployed default stays LiteRT.
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
 * compatibility but not yet runnable by the spike engine (it would need a resolve
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
	/** Channels on the image input — RGB, so 3 (the only value the spike runs). */
	inputChannels: number;
	/** Bytes per element (4 = FP32; the only width the spike's f32 buffers run). */
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
	/** Output channels — 1 (single-channel alpha/mask) for the spike. */
	outputChannels: number;
	/** Output value range — `unit` [0,1] alpha for the spike. */
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
			`io.inputChannels must be 3 (RGB) for the ORT matte spike; got ${inputChannels}`
		);
	}
	const bytesPerElement = requirePositiveInt(value['bytesPerElement'], 'bytesPerElement');
	if (bytesPerElement !== 4) {
		throw new MatteOnnxManifestError(
			`io.bytesPerElement must be 4 (FP32) for the ORT matte spike; got ${bytesPerElement}`
		);
	}

	const outputChannels = requirePositiveInt(value['outputChannels'], 'outputChannels');
	if (outputChannels !== 1) {
		throw new MatteOnnxManifestError(
			`io.outputChannels must be 1 (single-channel alpha) for the ORT matte spike; got ${outputChannels}. ` +
				'Multi-channel / softmax outputs need a resolve variant (future work).'
		);
	}
	const outputRange = value['outputRange'];
	if (outputRange === 'signed-unit') {
		throw new MatteOnnxManifestError(
			'io.outputRange "signed-unit" is not yet supported by the ORT matte spike; ' +
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
	// Template gate (R2.4): a placeholder manifest keeps the experimental backend
	// hidden — the deployed LiteRT default is unaffected.
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

	// License gate (hard fail): the app is MIT, so GPL-family weights are rejected
	// even when fetched at runtime — same verdict as the LiteRT path (RVM rejected).
	if (/gpl/i.test(base.license)) {
		throw new MatteOnnxManifestError(
			`model "${base.id}" declares a GPL-family license (${base.license}); refusing to load`
		);
	}

	const io = validateIo(isObject(value) ? value['io'] : undefined);
	return { ...base, io };
}
