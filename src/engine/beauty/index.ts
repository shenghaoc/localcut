/** Phase 32b: Beauty engine barrel. */

export {
	LANDMARK_COUNT,
	LANDMARK_COORDS,
	LANDMARK_FLOATS,
	LANDMARK_RING_CAPACITY,
	BEAUTY_CLAMP_RANGES,
	SUBTLE_PRESET,
	PRESETS,
	normalizeBeautyEffect,
	isBeautyActive,
	effectiveStrength,
	packBeautyUniform,
	packLandmarkBuffer,
	type BeautyClampRange
} from './beauty-params';

export {
	DEFAULT_ONE_EURO,
	createOneEuroState,
	resetOneEuroState,
	applyOneEuro,
	type OneEuroConfig,
	type OneEuroState
} from './one-euro';

export {
	DEFAULT_CADENCE_CONFIG,
	deriveSolveInterval,
	adaptCadence,
	createCadenceState,
	advanceCadence,
	updateCadence,
	type CadenceConfig,
	type CadenceState
} from './cadence';

export {
	createLandmarkRing,
	pushSample,
	resetRing,
	getNewest,
	interpolateLandmarks,
	type LandmarkSample,
	type LandmarkRing
} from './landmark-track';

export {
	scoreCandidate,
	selectPrimaryFace,
	createPrimaryFaceState,
	updatePrimaryFace,
	acknowledgeRamp,
	type FaceCandidate,
	type PrimaryFaceState
} from './primary-face';

export {
	validateBeautyManifest,
	manifestAssets,
	BeautyManifestError,
	type BeautyModelAsset,
	type BeautyTensorContract,
	type BeautyModelManifest
} from './model-manifest';

export {
	DETECTOR_SIZE,
	DETECTOR_FLOATS,
	LANDMARK_INPUT_SIZE,
	LANDMARK_INPUT_FLOATS,
	trackFrameClose,
	cpuPreprocessROI,
	type PreprocessResult,
	type PreprocessRegion
} from './preprocess';

export {
	FACE_OVAL_INDICES,
	LEFT_EYE_INDICES,
	RIGHT_EYE_INDICES,
	LIP_OUTER_INDICES,
	DEFAULT_EXCLUSIONS,
	DEFAULT_FEATHER_WIDTH,
	DEFAULT_GEOMETRY_MASK_REGION,
	generateGeometryMask,
	type GeometryMaskRegion,
	type GeometryMaskResult
} from './geometry-mask';
