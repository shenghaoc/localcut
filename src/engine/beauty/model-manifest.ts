/** Phase 32b: Beauty ONNX model manifest validation.
 *
 *  Validates a multi-asset manifest for ORT-backed face detector and landmark
 *  models. Assets are digest-pinned ONNX files fetched through the shared model
 *  proxy/cache rules or same-origin static paths. The browser never fetches or
 *  parses MediaPipe `.task` bundles for this feature.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type BeautyModelAssetRole = 'detector' | 'landmarks' | 'blendshape';
export type BeautyTensorDataType = 'float16' | 'float32' | 'int32' | 'int64';

export interface BeautyTensorContract {
	/** Tensor name exposed by the ONNX graph. */
	name: string;
	/** Shape dimensions, using positive static dims for v1 manifests. */
	dims: number[];
	/** Tensor element type. */
	dataType: BeautyTensorDataType;
	/** Decoder-facing meaning, e.g. `image`, `boxes`, `scores`, `landmarks`. */
	semantic: string;
}

export interface BeautyModelAsset {
	role: BeautyModelAssetRole;
	format: 'onnx';
	/** Same-origin or shared-proxy URL the asset is fetched from. */
	url: string;
	/** Exact byte count. */
	sizeBytes: number;
	/** `sha256-<64 hex>` digest; verified before use. */
	checksum: string;
	license: string;
	source: string;
	provider: string;
	modelCard: string;
	inputs: BeautyTensorContract[];
	outputs: BeautyTensorContract[];
}

export interface BeautyModelAssets {
	detector: BeautyModelAsset;
	landmarks: BeautyModelAsset;
	blendshape?: BeautyModelAsset;
}

export interface BeautyModelManifest {
	id: string;
	version: string;
	/** Sum of all ONNX asset sizes; the total download budget shown to user. */
	sizeBytes: number;
	assets: BeautyModelAssets;
	/** Landmark topology version (for future compatibility). */
	topologyVersion: number;
	/** Number of landmarks (478 for the v1 topology). */
	landmarkCount: number;
}

// ─── Validation ─────────────────────────────────────────────────────────

const EXPECTED_LANDMARK_COUNT = 478;
const EXPECTED_TOPOLOGY_VERSION = 1;
const EXPECTED_DETECTOR_SIZE = 192;
const EXPECTED_LANDMARK_INPUT_SIZE = 256;
const EXPECTED_IMAGE_CHANNELS = 3;
const ALLOWED_PROXY_PREFIXES = ['/_model/hf/', '/_model/gh/', '/_model/gcs/'] as const;

export class BeautyManifestError extends Error {
	constructor(message: string) {
		super(`Invalid beauty model manifest: ${message}`);
		this.name = 'BeautyManifestError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new BeautyManifestError(`"${field}" must be a non-empty string`);
	}
	return value;
}

function requirePositiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new BeautyManifestError(`"${field}" must be a positive integer`);
	}
	return value;
}

function validateModelUrl(url: string, field: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url, 'https://localcut.invalid');
	} catch {
		throw new BeautyManifestError(`"${field}" must be a valid URL`);
	}

	if (parsed.origin !== 'https://localcut.invalid') {
		throw new BeautyManifestError(`"${field}" must not fetch directly cross-origin`);
	}

	if (parsed.pathname.startsWith('/_model/')) {
		const allowed = ALLOWED_PROXY_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
		if (!allowed) {
			throw new BeautyManifestError(`"${field}" must use /_model/hf, /_model/gh, or /_model/gcs`);
		}
	}
}

function validateTensorContract(value: unknown, field: string): BeautyTensorContract {
	if (!isRecord(value)) throw new BeautyManifestError(`"${field}" must be an object`);
	const name = requireString(value.name, `${field}.name`);
	const semantic = requireString(value.semantic, `${field}.semantic`);
	if (!Array.isArray(value.dims)) {
		throw new BeautyManifestError(`"${field}.dims" must be an array`);
	}
	const dims = (value.dims as unknown[]).map((d, i) => {
		if (typeof d !== 'number' || !Number.isInteger(d) || d <= 0) {
			throw new BeautyManifestError(`${field}.dims[${i}] must be a positive integer`);
		}
		return d;
	});
	const dataType = value.dataType;
	if (
		dataType !== 'float16' &&
		dataType !== 'float32' &&
		dataType !== 'int32' &&
		dataType !== 'int64'
	) {
		throw new BeautyManifestError(
			`"${field}.dataType" must be 'float16', 'float32', 'int32', or 'int64'`
		);
	}
	return { name, dims, dataType, semantic };
}

function validateTensorList(value: unknown, field: string): BeautyTensorContract[] {
	if (!Array.isArray(value)) {
		throw new BeautyManifestError(`"${field}" must be an array`);
	}
	const tensors = (value as unknown[]).map((tensor, index) =>
		validateTensorContract(tensor, `${field}[${index}]`)
	);
	if (tensors.length === 0) {
		throw new BeautyManifestError(`"${field}" must include at least one tensor`);
	}
	return tensors;
}

function validateAsset(
	value: unknown,
	field: string,
	role: BeautyModelAssetRole
): BeautyModelAsset {
	if (!isRecord(value)) throw new BeautyManifestError(`"${field}" must be an object`);
	if (value.role !== role) {
		throw new BeautyManifestError(`"${field}.role" must be "${role}"`);
	}
	if (value.format !== 'onnx') {
		throw new BeautyManifestError(`"${field}.format" must be "onnx"`);
	}
	const url = requireString(value.url, `${field}.url`);
	validateModelUrl(url, `${field}.url`);
	const sizeBytes = requirePositiveInt(value.sizeBytes, `${field}.sizeBytes`);
	const checksum = requireString(value.checksum, `${field}.checksum`);
	if (!/^sha256-[0-9a-f]{64}$/.test(checksum)) {
		throw new BeautyManifestError(
			`"${field}.checksum" must be "sha256-" followed by 64 hex digits`
		);
	}
	const license = requireString(value.license, `${field}.license`);
	const source = requireString(value.source, `${field}.source`);
	const provider = requireString(value.provider, `${field}.provider`);
	const modelCard = requireString(value.modelCard, `${field}.modelCard`);
	const inputs = validateTensorList(value.inputs, `${field}.inputs`);
	const outputs = validateTensorList(value.outputs, `${field}.outputs`);
	return {
		role,
		format: 'onnx',
		url,
		sizeBytes,
		checksum,
		license,
		source,
		provider,
		modelCard,
		inputs,
		outputs
	};
}

function validateAssets(value: unknown): BeautyModelAssets {
	if (!isRecord(value)) throw new BeautyManifestError('"assets" must be an object');
	const detector = validateAsset(value.detector, 'assets.detector', 'detector');
	const landmarks = validateAsset(value.landmarks, 'assets.landmarks', 'landmarks');
	const blendshape =
		value.blendshape === undefined
			? undefined
			: validateAsset(value.blendshape, 'assets.blendshape', 'blendshape');
	return blendshape ? { detector, landmarks, blendshape } : { detector, landmarks };
}

function isFloatTensor(tensor: BeautyTensorContract): boolean {
	return tensor.dataType === 'float16' || tensor.dataType === 'float32';
}

function imageTensorMatches(dims: readonly number[], size: number): boolean {
	if (dims.length !== 4 || dims[0] !== 1) return false;
	const nhwc = dims[1] === size && dims[2] === size && dims[3] === EXPECTED_IMAGE_CHANNELS;
	const nchw = dims[1] === EXPECTED_IMAGE_CHANNELS && dims[2] === size && dims[3] === size;
	return nhwc || nchw;
}

function tensorWithSemantic(
	tensors: readonly BeautyTensorContract[],
	semantic: string
): BeautyTensorContract | undefined {
	return tensors.find((tensor) => tensor.semantic === semantic);
}

function assertImageInput(
	asset: BeautyModelAsset,
	field: string,
	size: number
): BeautyTensorContract {
	const image = tensorWithSemantic(asset.inputs, 'image');
	if (!image) throw new BeautyManifestError(`"${field}.inputs" must include image tensor`);
	if (!isFloatTensor(image)) {
		throw new BeautyManifestError(`"${field}.inputs.image" must use float16 or float32 data`);
	}
	if (!imageTensorMatches(image.dims, size)) {
		throw new BeautyManifestError(
			`"${field}.inputs.image" must have shape [1, ${size}, ${size}, 3] or [1, 3, ${size}, ${size}]`
		);
	}
	return image;
}

function assertDetectorOutputs(asset: BeautyModelAsset): void {
	const boxes = tensorWithSemantic(asset.outputs, 'boxes');
	const scores = tensorWithSemantic(asset.outputs, 'scores');
	if (!boxes) throw new BeautyManifestError('"assets.detector.outputs" must include boxes tensor');
	if (!scores)
		throw new BeautyManifestError('"assets.detector.outputs" must include scores tensor');
	if (!isFloatTensor(boxes) || !isFloatTensor(scores)) {
		throw new BeautyManifestError('"assets.detector.outputs" boxes/scores must use float data');
	}
	if (
		boxes.dims.length < 2 ||
		scores.dims.length < 2 ||
		boxes.dims[0] !== 1 ||
		scores.dims[0] !== 1
	) {
		throw new BeautyManifestError('"assets.detector.outputs" boxes/scores must be batched tensors');
	}
	if (boxes.dims[1] !== scores.dims[1]) {
		throw new BeautyManifestError(
			'"assets.detector.outputs" boxes and scores must share candidate count'
		);
	}
}

function assertLandmarkOutputs(asset: BeautyModelAsset): void {
	const landmarks = tensorWithSemantic(asset.outputs, 'landmarks');
	if (!landmarks) {
		throw new BeautyManifestError('"assets.landmarks.outputs" must include landmarks tensor');
	}
	if (!isFloatTensor(landmarks)) {
		throw new BeautyManifestError('"assets.landmarks.outputs.landmarks" must use float data');
	}
	if (
		landmarks.dims.length !== 3 ||
		landmarks.dims[0] !== 1 ||
		landmarks.dims[1] !== EXPECTED_LANDMARK_COUNT ||
		landmarks.dims[2] !== 3
	) {
		throw new BeautyManifestError(
			`"assets.landmarks.outputs.landmarks" must have shape [1, ${EXPECTED_LANDMARK_COUNT}, 3]`
		);
	}
}

function assertV1AssetContracts(assets: BeautyModelAssets): void {
	assertImageInput(assets.detector, 'assets.detector', EXPECTED_DETECTOR_SIZE);
	assertDetectorOutputs(assets.detector);
	assertImageInput(assets.landmarks, 'assets.landmarks', EXPECTED_LANDMARK_INPUT_SIZE);
	assertLandmarkOutputs(assets.landmarks);
}

/** Validate an untrusted JSON value as a beauty ONNX model manifest. */
export function validateBeautyManifest(value: unknown): BeautyModelManifest {
	if (!isRecord(value)) throw new BeautyManifestError('manifest must be an object');

	// A placeholder/template manifest is the "no compatible model configured" state
	// (mirrors interpolation's R2.4 gate): reject it so the feature stays hidden until
	// a license-verified ONNX detector/landmark pair is vendored. See
	// public/models/beauty/README.md for the enable steps.
	if (value.template === true) {
		throw new BeautyManifestError(
			'manifest is a placeholder template — vendor license-verified detector + landmark ONNX models'
		);
	}

	const id = requireString(value.id, 'id');
	const version = requireString(value.version, 'version');
	const sizeBytes = requirePositiveInt(value.sizeBytes, 'sizeBytes');
	const assets = validateAssets(value.assets);
	const topologyVersion = requirePositiveInt(value.topologyVersion, 'topologyVersion');
	const landmarkCount = requirePositiveInt(value.landmarkCount, 'landmarkCount');

	if (topologyVersion !== EXPECTED_TOPOLOGY_VERSION) {
		throw new BeautyManifestError(
			`"topologyVersion" must be ${EXPECTED_TOPOLOGY_VERSION} for the v1 topology`
		);
	}
	if (landmarkCount !== EXPECTED_LANDMARK_COUNT) {
		throw new BeautyManifestError(
			`"landmarkCount" must be ${EXPECTED_LANDMARK_COUNT} for the v1 topology`
		);
	}
	assertV1AssetContracts(assets);

	const actualSize = manifestAssets({
		id,
		version,
		sizeBytes,
		assets,
		topologyVersion,
		landmarkCount
	})
		.map((asset) => asset.sizeBytes)
		.reduce((sum, size) => sum + size, 0);
	if (actualSize !== sizeBytes) {
		throw new BeautyManifestError('"sizeBytes" must equal the sum of all ONNX asset sizes');
	}

	return {
		id,
		version,
		sizeBytes,
		assets,
		topologyVersion,
		landmarkCount
	};
}

/** List assets in download order: detector, landmarks, then optional blendshape. */
export function manifestAssets(manifest: BeautyModelManifest): BeautyModelAsset[] {
	return [
		manifest.assets.detector,
		manifest.assets.landmarks,
		...(manifest.assets.blendshape ? [manifest.assets.blendshape] : [])
	];
}
