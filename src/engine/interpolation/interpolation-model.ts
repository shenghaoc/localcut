/**
 * Interpolation model manifest (Phase 37) — an ORT/ONNX manifest plus the
 * interpolation-specific I/O contract.
 *
 * The base provenance + integrity + EP policy is the shared
 * {@link validateOrtManifest} (`OrtModelManifest`): `format: 'onnx'`,
 * `frameCoupled: true` (so the EP policy forbids any WASM/CPU fallback), pinned
 * execution providers, and a digest-pinned ONNX asset. On top of that, the
 * interpolation `io` block declares how the engine wires tensors: input/output
 * names, tensor layout, the model input resolution, the timestep convention, and
 * whether a flow field is produced (for motion blur).
 *
 * Placeholder/template manifests are rejected (R2.4): an unvalidatable or
 * `template`-flagged manifest hides the feature rather than appearing loadable.
 */
import type { ModelIoContract } from './tiling';
import { OrtManifestError, validateOrtManifest } from '../ml/ort/ort-model-manifest';
import type { OrtModelManifest } from '../ml/ort/ort-types';

/** Tensor memory layout the ONNX graph expects on its image inputs. */
export type TensorLayout = 'nchw' | 'nhwc';

/** Interpolation-specific model I/O contract (beyond the base ORT manifest). */
export interface ManifestIoContract {
	/** `nchw` (PyTorch/RIFE convention) or `nhwc`. */
	layout: TensorLayout;
	/** Model input width in pixels. */
	inputWidth: number;
	/** Model input height in pixels. */
	inputHeight: number;
	/** Channels per image input (typically 3 for RGB). */
	inputChannels: number;
	/** Bytes per element (2 for FP16, 4 for FP32) — for VRAM/tiling math. */
	bytesPerElement: number;
	/** ONNX input name for frame 0. */
	input0Name: string;
	/** ONNX input name for frame 1. */
	input1Name: string;
	/** ONNX input name for the fractional timestep `tau`, or `null` if the model
	 *  is fixed-midpoint (t=0.5) and recursion is used for other instants. */
	timestepName: string | null;
	/** ONNX output name for the synthesized RGB frame. */
	outputName: string;
	/** Whether the model exposes a flow field (enables motion-blur synthesis). */
	flowOutput: boolean;
	/** ONNX output name for the flow field, when `flowOutput` is true. */
	flowOutputName?: string;
	/** Maximum pixel displacement the model handles (sets the tile halo). */
	maxDisplacement: number;
}

/** A validated interpolation model manifest (ORT manifest + interpolation IO). */
export interface InterpolationModelManifestSnapshot extends OrtModelManifest {
	readonly io: ManifestIoContract;
}

export class InterpolationManifestError extends Error {
	constructor(reason: string) {
		super(`Interpolation model manifest invalid: ${reason}`);
		this.name = 'InterpolationManifestError';
	}
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requirePositiveNumber(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
		throw new InterpolationManifestError(`io.${field} must be a positive number`);
	}
	return v;
}

function requireNonNegativeNumber(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
		throw new InterpolationManifestError(`io.${field} must be a non-negative number`);
	}
	return v;
}

function requireName(v: unknown, field: string): string {
	if (typeof v !== 'string' || v.length === 0) {
		throw new InterpolationManifestError(`io.${field} must be a non-empty string`);
	}
	return v;
}

function validateIo(value: unknown): ManifestIoContract {
	if (!isObject(value)) throw new InterpolationManifestError('io must be an object');
	const layout = value['layout'];
	if (layout !== 'nchw' && layout !== 'nhwc') {
		throw new InterpolationManifestError('io.layout must be "nchw" or "nhwc"');
	}
	const flowOutput = value['flowOutput'];
	if (typeof flowOutput !== 'boolean') {
		throw new InterpolationManifestError('io.flowOutput must be a boolean');
	}
	const timestepRaw = value['timestepName'];
	if (timestepRaw !== null && typeof timestepRaw !== 'string') {
		throw new InterpolationManifestError('io.timestepName must be a string or null');
	}
	const io: ManifestIoContract = {
		layout,
		inputWidth: requirePositiveNumber(value['inputWidth'], 'inputWidth'),
		inputHeight: requirePositiveNumber(value['inputHeight'], 'inputHeight'),
		inputChannels: requirePositiveNumber(value['inputChannels'], 'inputChannels'),
		bytesPerElement: requirePositiveNumber(value['bytesPerElement'], 'bytesPerElement'),
		input0Name: requireName(value['input0Name'], 'input0Name'),
		input1Name: requireName(value['input1Name'], 'input1Name'),
		timestepName: timestepRaw === null ? null : requireName(timestepRaw, 'timestepName'),
		outputName: requireName(value['outputName'], 'outputName'),
		flowOutput,
		maxDisplacement: requireNonNegativeNumber(value['maxDisplacement'], 'maxDisplacement')
	};
	if (flowOutput) io.flowOutputName = requireName(value['flowOutputName'], 'flowOutputName');
	return io;
}

/**
 * Validates an untrusted interpolation manifest. Builds on {@link validateOrtManifest}
 * (ONNX format, provenance, integrity, frame-coupled EP policy) and adds the
 * interpolation IO contract. Rejects placeholder/template manifests (R2.4) and any
 * manifest that is not frame-coupled (interpolation always is).
 */
export function validateInterpolationManifest(value: unknown): InterpolationModelManifestSnapshot {
	if (isObject(value) && value['template'] === true) {
		throw new InterpolationManifestError(
			'manifest is a placeholder template — vendor a real ONNX model (size + SHA-256 + IO) before the feature can load'
		);
	}
	let base: OrtModelManifest;
	try {
		base = validateOrtManifest(value);
	} catch (error) {
		if (error instanceof OrtManifestError) throw new InterpolationManifestError(error.message);
		throw error;
	}
	if (!base.frameCoupled) {
		throw new InterpolationManifestError('interpolation models must declare "frameCoupled": true');
	}
	const io = validateIo(isObject(value) ? value['io'] : undefined);
	return { ...base, io };
}

/** Maps the interpolation IO contract to the tiling module's model contract. */
export function toModelIoContract(io: ManifestIoContract): ModelIoContract {
	return {
		inputWidth: io.inputWidth,
		inputHeight: io.inputHeight,
		inputChannels: io.inputChannels,
		bytesPerElement: io.bytesPerElement,
		flowOutput: io.flowOutput,
		maxDisplacement: io.maxDisplacement
	};
}
