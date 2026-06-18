/**
 * Reframe face-detector ORT manifest (Phase 33 follow-up) — a base ORT manifest
 * plus the face-detector-specific `io` block (input tensor layout/range/name)
 * and `decode` block (NMS threshold, raw-bbox / anchor-offset selection).
 *
 * The base provenance + integrity + EP policy is the shared
 * {@link validateOrtManifest} (`OrtModelManifest`): `format: 'onnx'`, pinned
 * execution providers, digest-pinned ONNX bytes. The reframe face detector is
 * **not** frame-coupled — it runs at the analysis fps in a one-shot worker
 * pass, not on the preview/export hot path — so the manifest is allowed to
 * declare `wasm` alongside `webgpu`/`webnn`. The `face-detector-ort.ts` loader
 * then enforces the WASM input-tensor-size budget at session-creation time.
 *
 * Placeholder/template manifests are rejected: an unvalidatable or
 * `template`-flagged manifest hides the ORT face-detector path rather than
 * appearing loadable. Smart Reframe stays on saliency when this manifest cannot
 * load.
 */
import { OrtManifestError, validateOrtManifest } from '../ml/ort/ort-model-manifest';
import type { OrtModelManifest } from '../ml/ort/ort-types';

/** Tensor memory layout the ONNX graph expects on its image input. */
export type FaceDetectorTensorLayout = 'nchw' | 'nhwc';

/** Input pixel normalisation the model expects (matches common ONNX exports). */
export type FaceDetectorInputRange = 'unit' | 'signed-unit' | 'mean-std';

/** Face-detector input tensor contract (beyond the base ORT manifest). */
export interface FaceDetectorIoContract {
	readonly layout: FaceDetectorTensorLayout;
	readonly inputWidth: number;
	readonly inputHeight: number;
	readonly inputChannels: number;
	/** 4 for float32, 2 for float16, 1 for int8/uint8 — used for the WASM size gate. */
	readonly bytesPerElement: number;
	readonly inputName: string;
	readonly inputRange: FaceDetectorInputRange;
	/** Per-channel mean (length 3 for RGB); required iff `inputRange === 'mean-std'`. */
	readonly mean?: readonly number[];
	/** Per-channel std-dev (length 3 for RGB); required iff `inputRange === 'mean-std'`. */
	readonly std?: readonly number[];
}

/** Common decode tuning that every detector type uses. */
export interface FaceDetectorDecodeBase {
	readonly scoreThreshold: number;
	readonly iouThreshold: number;
	readonly maxDetections: number;
	/** True when the score output is unactivated logits rather than probabilities. */
	readonly applySigmoid?: boolean;
	/** Number of scalar score entries per candidate (default 1). */
	readonly scoreStride?: number;
	/** Index inside each score row to read, e.g. 1 for `[background, face]`. */
	readonly scoreIndex?: number;
}

/** Decode contract for direct-bbox detectors (YuNet / SCRFD-class). */
export interface FaceDetectorRawBboxDecode extends FaceDetectorDecodeBase {
	readonly type: 'raw-bbox';
	readonly boxesOutputName: string;
	readonly scoresOutputName: string;
	readonly boxFormat: 'xyxy-normalized' | 'xywh-normalized' | 'xywh-pixel';
}

/** Decode contract for anchor-offset detectors (BlazeFace-class). */
export interface FaceDetectorAnchorOffsetDecode extends FaceDetectorDecodeBase {
	readonly type: 'anchor-offset';
	readonly boxesOutputName: string;
	readonly scoresOutputName: string;
	/**
	 * ONNX output (flattened `[N × 4]` as `cx, cy, w, h` per candidate,
	 * normalised) the anchor priors are read from at decode time. Required —
	 * without anchors the offset outputs cannot be reconstructed into boxes.
	 */
	readonly anchorsOutputName: string;
	/** Per-axis variance scaling applied to offsets (default `[1,1,1,1]`). */
	readonly variance?: readonly [number, number, number, number];
}

export type FaceDetectorDecodeContract = FaceDetectorRawBboxDecode | FaceDetectorAnchorOffsetDecode;

/** A validated face-detector manifest (ORT manifest + io + decode). */
export interface ReframeFaceDetectorManifest extends OrtModelManifest {
	readonly io: FaceDetectorIoContract;
	readonly decode: FaceDetectorDecodeContract;
}

export class ReframeFaceDetectorManifestError extends Error {
	constructor(reason: string) {
		super(`Reframe face-detector manifest invalid: ${reason}`);
		this.name = 'ReframeFaceDetectorManifestError';
	}
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requirePositiveInt(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
		throw new ReframeFaceDetectorManifestError(`${field} must be a positive integer`);
	}
	return v;
}

function requireNonNegativeInt(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
		throw new ReframeFaceDetectorManifestError(`${field} must be a non-negative integer`);
	}
	return v;
}

function requireFiniteNumber(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		throw new ReframeFaceDetectorManifestError(`${field} must be a finite number`);
	}
	return v;
}

function requireUnitFraction(v: unknown, field: string): number {
	const n = requireFiniteNumber(v, field);
	if (n <= 0 || n >= 1) {
		throw new ReframeFaceDetectorManifestError(`${field} must be in (0, 1)`);
	}
	return n;
}

function requireName(v: unknown, field: string): string {
	if (typeof v !== 'string' || v.length === 0) {
		throw new ReframeFaceDetectorManifestError(`${field} must be a non-empty string`);
	}
	return v;
}

function requireBoolean(v: unknown, field: string): boolean {
	if (typeof v !== 'boolean') {
		throw new ReframeFaceDetectorManifestError(`${field} must be a boolean`);
	}
	return v;
}

function requireFiniteNumberArray(
	v: unknown,
	field: string,
	expectedLength: number
): readonly number[] {
	if (!Array.isArray(v) || v.length !== expectedLength) {
		throw new ReframeFaceDetectorManifestError(
			`${field} must be an array of ${expectedLength} numbers`
		);
	}
	return v.map((entry, index) => requireFiniteNumber(entry, `${field}[${index}]`));
}

/** Channel counts the preprocessor's RGBA → tensor path actually supports. */
const SUPPORTED_INPUT_CHANNELS: readonly number[] = [1, 3, 4];
/** Float32 is currently the only input dtype the loader builds tensors for. */
const SUPPORTED_BYTES_PER_ELEMENT: readonly number[] = [4];

function validateIo(raw: unknown): FaceDetectorIoContract {
	if (!isObject(raw)) throw new ReframeFaceDetectorManifestError('io must be an object');
	const layout = raw['layout'];
	if (layout !== 'nchw' && layout !== 'nhwc') {
		throw new ReframeFaceDetectorManifestError('io.layout must be "nchw" or "nhwc"');
	}
	const inputRange = raw['inputRange'];
	if (inputRange !== 'unit' && inputRange !== 'signed-unit' && inputRange !== 'mean-std') {
		throw new ReframeFaceDetectorManifestError(
			'io.inputRange must be "unit", "signed-unit", or "mean-std"'
		);
	}
	const inputChannels = requirePositiveInt(raw['inputChannels'], 'io.inputChannels');
	if (!SUPPORTED_INPUT_CHANNELS.includes(inputChannels)) {
		throw new ReframeFaceDetectorManifestError(
			`io.inputChannels must be one of [${SUPPORTED_INPUT_CHANNELS.join(', ')}] ` +
				`(the preprocessor reads from an RGBA buffer)`
		);
	}
	const bytesPerElement = requirePositiveInt(raw['bytesPerElement'], 'io.bytesPerElement');
	if (!SUPPORTED_BYTES_PER_ELEMENT.includes(bytesPerElement)) {
		throw new ReframeFaceDetectorManifestError(
			`io.bytesPerElement must be one of [${SUPPORTED_BYTES_PER_ELEMENT.join(', ')}] ` +
				`(the loader currently only builds float32 input tensors)`
		);
	}
	const io: FaceDetectorIoContract = {
		layout,
		inputWidth: requirePositiveInt(raw['inputWidth'], 'io.inputWidth'),
		inputHeight: requirePositiveInt(raw['inputHeight'], 'io.inputHeight'),
		inputChannels,
		bytesPerElement,
		inputName: requireName(raw['inputName'], 'io.inputName'),
		inputRange,
		...(inputRange === 'mean-std'
			? {
					mean: requireFiniteNumberArray(raw['mean'], 'io.mean', inputChannels),
					std: requireFiniteNumberArray(raw['std'], 'io.std', inputChannels)
				}
			: {})
	};
	return io;
}

function validateDecode(raw: unknown): FaceDetectorDecodeContract {
	if (!isObject(raw)) throw new ReframeFaceDetectorManifestError('decode must be an object');
	const type = raw['type'];
	const scoreStride =
		raw['scoreStride'] === undefined
			? undefined
			: requirePositiveInt(raw['scoreStride'], 'decode.scoreStride');
	const scoreIndex =
		raw['scoreIndex'] === undefined
			? undefined
			: requireNonNegativeInt(raw['scoreIndex'], 'decode.scoreIndex');
	if ((scoreStride === undefined) !== (scoreIndex === undefined)) {
		throw new ReframeFaceDetectorManifestError(
			'decode.scoreStride and decode.scoreIndex must be provided together'
		);
	}
	if (scoreStride !== undefined && scoreIndex !== undefined && scoreIndex >= scoreStride) {
		throw new ReframeFaceDetectorManifestError(
			'decode.scoreIndex must be less than decode.scoreStride'
		);
	}
	const base = {
		scoreThreshold: requireUnitFraction(raw['scoreThreshold'], 'decode.scoreThreshold'),
		iouThreshold: requireUnitFraction(raw['iouThreshold'], 'decode.iouThreshold'),
		maxDetections: requirePositiveInt(raw['maxDetections'], 'decode.maxDetections'),
		...(raw['applySigmoid'] === undefined
			? {}
			: { applySigmoid: requireBoolean(raw['applySigmoid'], 'decode.applySigmoid') }),
		...(scoreStride === undefined ? {} : { scoreStride }),
		...(scoreIndex === undefined ? {} : { scoreIndex })
	};
	if (type === 'raw-bbox') {
		const boxFormat = raw['boxFormat'];
		if (
			boxFormat !== 'xyxy-normalized' &&
			boxFormat !== 'xywh-normalized' &&
			boxFormat !== 'xywh-pixel'
		) {
			throw new ReframeFaceDetectorManifestError(
				'decode.boxFormat must be "xyxy-normalized", "xywh-normalized", or "xywh-pixel"'
			);
		}
		return {
			type: 'raw-bbox',
			boxesOutputName: requireName(raw['boxesOutputName'], 'decode.boxesOutputName'),
			scoresOutputName: requireName(raw['scoresOutputName'], 'decode.scoresOutputName'),
			boxFormat,
			...base
		};
	}
	if (type === 'anchor-offset') {
		const variance = raw['variance'];
		const decode: FaceDetectorAnchorOffsetDecode = {
			type: 'anchor-offset',
			boxesOutputName: requireName(raw['boxesOutputName'], 'decode.boxesOutputName'),
			scoresOutputName: requireName(raw['scoresOutputName'], 'decode.scoresOutputName'),
			anchorsOutputName: requireName(raw['anchorsOutputName'], 'decode.anchorsOutputName'),
			...(variance === undefined ? {} : { variance: validateVariance(variance) }),
			...base
		};
		return decode;
	}
	throw new ReframeFaceDetectorManifestError('decode.type must be "raw-bbox" or "anchor-offset"');
}

function validateVariance(raw: unknown): readonly [number, number, number, number] {
	if (!Array.isArray(raw) || raw.length !== 4) {
		throw new ReframeFaceDetectorManifestError('decode.variance must be an array of four numbers');
	}
	const out = raw.map((entry, index) => requireFiniteNumber(entry, `decode.variance[${index}]`));
	return [out[0]!, out[1]!, out[2]!, out[3]!];
}

/**
 * Validate an untrusted reframe face-detector manifest. Builds on
 * {@link validateOrtManifest} (ONNX format, provenance, integrity, EP policy)
 * and adds the face-detector `io` + `decode` contracts. Rejects
 * placeholder/template manifests so the ORT face-detector path stays hidden
 * until a real candidate is pinned — Smart Reframe falls back to saliency in
 * that case.
 */
export function validateReframeFaceDetectorManifest(value: unknown): ReframeFaceDetectorManifest {
	if (isObject(value) && value['template'] === true) {
		throw new ReframeFaceDetectorManifestError(
			'manifest is a placeholder template — vendor a real ONNX face detector ' +
				'(size + SHA-256 + io + decode) before the ORT path can load'
		);
	}
	let base: OrtModelManifest;
	try {
		base = validateOrtManifest(value);
	} catch (error) {
		if (error instanceof OrtManifestError) {
			throw new ReframeFaceDetectorManifestError(error.message);
		}
		throw error;
	}
	if (base.frameCoupled) {
		// Reframe analysis is a one-shot offline pass (not the preview/export hot
		// path), so allowing WASM is the whole point. A manifest that opts into the
		// frame-coupled rule would forbid WASM unnecessarily and confuse diagnostics.
		throw new ReframeFaceDetectorManifestError(
			'face-detector manifests must declare "frameCoupled": false ' +
				'(reframe analysis is not on the preview/export hot path)'
		);
	}
	const io = validateIo(isObject(value) ? value['io'] : undefined);
	const decode = validateDecode(isObject(value) ? value['decode'] : undefined);
	return { ...base, io, decode };
}

/**
 * Bytes of one input tensor for the model — used by the WASM EP eligibility
 * gate (the loader refuses the WASM EP for big tensors). Pure: derived from
 * the manifest's declared input shape.
 */
export function inputTensorBytes(io: FaceDetectorIoContract): number {
	return io.inputWidth * io.inputHeight * io.inputChannels * io.bytesPerElement;
}
