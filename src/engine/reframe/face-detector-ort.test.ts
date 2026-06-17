import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import type { OrtSessionHandle } from '../ml/ort/ort-session';
import type { OrtModelManifest } from '../ml/ort/ort-types';

// The ORT runtime is not available in Node tests; the detector only needs the
// `Tensor` constructor (CPU wrapper around a Float32Array), so a fake suffices.
class FakeTensor {
	static disposeCount = 0;

	constructor(
		public readonly type: string,
		public readonly data: ArrayLike<number>,
		public readonly dims: readonly number[]
	) {}

	dispose(): void {
		FakeTensor.disposeCount++;
	}
}
vi.mock('../ml/ort/ort-loader', () => ({
	loadOrtWasm: vi.fn(async () => ({ Tensor: FakeTensor })),
	loadOrtWebGpu: vi.fn(async () => ({ Tensor: FakeTensor })),
	loadOrtWebNN: vi.fn(async () => ({ Tensor: FakeTensor })),
	ortWasmBasePath: () => '/_ort/'
}));

import {
	WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES,
	assertWasmEpAllowed,
	createOrtFaceDetector,
	normalizePixelsToTensor,
	OrtFaceDetectorUnavailableError
} from './face-detector-ort';
import type { FaceDetectorIoContract } from './face-detector-ort-manifest';

afterEach(() => {
	vi.clearAllMocks();
	FakeTensor.disposeCount = 0;
});

const NCHW_3CH: FaceDetectorIoContract = {
	layout: 'nchw',
	inputWidth: 2,
	inputHeight: 2,
	inputChannels: 3,
	bytesPerElement: 4,
	inputName: 'input',
	inputRange: 'unit'
};

const NHWC_3CH: FaceDetectorIoContract = { ...NCHW_3CH, layout: 'nhwc' };

const SIGNED_UNIT: FaceDetectorIoContract = { ...NCHW_3CH, inputRange: 'signed-unit' };

const MEAN_STD: FaceDetectorIoContract = {
	...NCHW_3CH,
	inputRange: 'mean-std',
	mean: [0.5, 0.5, 0.5],
	std: [0.5, 0.5, 0.5]
};

/** A 2×2 RGBA buffer: pixel (0,0) red, (1,0) green, (0,1) blue, (1,1) white. */
const PIXELS_2x2 = new Uint8ClampedArray([
	255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255
]);

describe('normalizePixelsToTensor', () => {
	it('lays out NCHW as channel-major (R plane, then G plane, then B plane)', () => {
		const out = normalizePixelsToTensor(PIXELS_2x2, NCHW_3CH);
		// R plane: [pixel0.r, pixel1.r, pixel2.r, pixel3.r] / 255
		expect(out.slice(0, 4)).toEqual(new Float32Array([1, 0, 0, 1]));
		// G plane
		expect(out.slice(4, 8)).toEqual(new Float32Array([0, 1, 0, 1]));
		// B plane
		expect(out.slice(8, 12)).toEqual(new Float32Array([0, 0, 1, 1]));
	});

	it('lays out NHWC as pixel-major (R,G,B per pixel)', () => {
		const out = normalizePixelsToTensor(PIXELS_2x2, NHWC_3CH);
		expect(out.slice(0, 3)).toEqual(new Float32Array([1, 0, 0])); // pixel 0 red
		expect(out.slice(3, 6)).toEqual(new Float32Array([0, 1, 0])); // pixel 1 green
		expect(out.slice(6, 9)).toEqual(new Float32Array([0, 0, 1])); // pixel 2 blue
		expect(out.slice(9, 12)).toEqual(new Float32Array([1, 1, 1])); // pixel 3 white
	});

	it('applies signed-unit normalisation: 0 → -1, 128 → ~0, 255 → 1', () => {
		const pixels = new Uint8ClampedArray([0, 128, 255, 255]);
		const out = normalizePixelsToTensor(pixels, {
			...SIGNED_UNIT,
			inputWidth: 1,
			inputHeight: 1
		});
		expect(out[0]).toBe(-1);
		expect(out[1]).toBeCloseTo((128 / 255) * 2 - 1, 6);
		expect(out[2]).toBe(1);
	});

	it('applies mean-std normalisation per channel', () => {
		const pixels = new Uint8ClampedArray([255, 255, 255, 255]);
		const out = normalizePixelsToTensor(pixels, {
			...MEAN_STD,
			inputWidth: 1,
			inputHeight: 1
		});
		// (1 - 0.5) / 0.5 = 1 for every channel.
		expect(out[0]).toBeCloseTo(1, 6);
		expect(out[1]).toBeCloseTo(1, 6);
		expect(out[2]).toBeCloseTo(1, 6);
	});

	it('throws on a too-small pixel buffer', () => {
		const tiny = new Uint8ClampedArray(8); // need ≥ 16 for 2×2 RGBA
		expect(() => normalizePixelsToTensor(tiny, NCHW_3CH)).toThrow(/too small/);
	});
});

describe('assertWasmEpAllowed', () => {
	it('passes for a small detector on WASM-only (e.g. BlazeFace 128×128×3×fp32 = 192 KiB)', () => {
		const io: FaceDetectorIoContract = {
			...NCHW_3CH,
			inputWidth: 128,
			inputHeight: 128
		};
		expect(() => assertWasmEpAllowed(io, ['wasm'])).not.toThrow();
	});

	it('throws for a large detector when WASM is in the EP list (e.g. 640×640×3×fp32 ≈ 4.7 MiB)', () => {
		const io: FaceDetectorIoContract = {
			...NCHW_3CH,
			inputWidth: 640,
			inputHeight: 640
		};
		expect(() => assertWasmEpAllowed(io, ['wasm'])).toThrow(OrtFaceDetectorUnavailableError);
		expect(() => assertWasmEpAllowed(io, ['wasm'])).toThrow(/WASM/);
	});

	it('throws for a large detector when WASM is a *fallback* behind an accelerator', () => {
		// Regression for codex P2: gating only `primaryEp` lets an oversized
		// detector through a `['webgpu','wasm']` list, even though ORT may run
		// it on WASM if WebGPU init fails.
		const io: FaceDetectorIoContract = {
			...NCHW_3CH,
			inputWidth: 640,
			inputHeight: 640
		};
		expect(() => assertWasmEpAllowed(io, ['webgpu', 'wasm'])).toThrow(
			OrtFaceDetectorUnavailableError
		);
		expect(() => assertWasmEpAllowed(io, ['webnn', 'wasm'])).toThrow(
			OrtFaceDetectorUnavailableError
		);
	});

	it('does not gate WebGPU- or WebNN-only EP lists regardless of tensor size', () => {
		const io: FaceDetectorIoContract = {
			...NCHW_3CH,
			inputWidth: 1024,
			inputHeight: 1024
		};
		expect(() => assertWasmEpAllowed(io, ['webgpu'])).not.toThrow();
		expect(() => assertWasmEpAllowed(io, ['webnn'])).not.toThrow();
		expect(() => assertWasmEpAllowed(io, ['webgpu', 'webnn'])).not.toThrow();
	});

	it('uses the documented byte budget', () => {
		expect(WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES).toBe(2 * 1024 * 1024);
	});
});

const VALID_MANIFEST = {
	id: 'face-detector',
	version: '1.0.0',
	license: 'Apache-2.0',
	source: 'https://example.com/face-detector',
	format: 'onnx',
	frameCoupled: false,
	executionProviders: ['webgpu'],
	model: {
		url: '/_model/r2/face-detector.onnx',
		sizeBytes: 1024,
		checksum: 'sha256-' + 'a'.repeat(64)
	},
	io: {
		layout: 'nchw',
		inputWidth: 4,
		inputHeight: 4,
		inputChannels: 3,
		bytesPerElement: 4,
		inputName: 'input',
		inputRange: 'unit'
	},
	decode: {
		type: 'raw-bbox',
		boxesOutputName: 'boxes',
		scoresOutputName: 'scores',
		boxFormat: 'xyxy-normalized',
		scoreThreshold: 0.5,
		iouThreshold: 0.3,
		maxDetections: 16
	}
};

const TEMPLATE_MANIFEST = { ...VALID_MANIFEST, template: true };

/** Build a stub session whose run() returns the supplied boxes/scores. */
function stubSession(boxes: Float32Array, scores: Float32Array) {
	const sessionRun = vi.fn(async () => ({
		boxes: { data: boxes, type: 'float32' },
		scores: { data: scores, type: 'float32' }
	}));
	const sessionRelease = vi.fn(async () => {});
	return {
		session: { run: sessionRun, release: sessionRelease } as never,
		sessionRun,
		sessionRelease
	};
}

function stubHandle(
	primaryEp: 'webgpu' | 'webnn' | 'wasm',
	stub: ReturnType<typeof stubSession>
): OrtSessionHandle {
	return {
		session: stub.session,
		executionProviders: [primaryEp] as const,
		primaryEp,
		tensorLocation: primaryEp === 'wasm' ? 'cpu' : 'gpu-buffer'
	};
}

describe('createOrtFaceDetector', () => {
	it('rejects a template manifest with OrtFaceDetectorUnavailableError', async () => {
		await expect(
			createOrtFaceDetector({
				manifestUrl: '/models/reframe-face/manifest.json',
				fetchManifest: async () => TEMPLATE_MANIFEST,
				loadModelBytes: async () => new Uint8Array(0),
				createSession: async () => {
					throw new Error('should not reach createSession');
				},
				resizeImageData: async () => new Uint8ClampedArray(64)
			})
		).rejects.toThrow(OrtFaceDetectorUnavailableError);
	});

	it('rejects a manifest the validator refuses (bad format, invalid io, etc.)', async () => {
		await expect(
			createOrtFaceDetector({
				manifestUrl: '/models/reframe-face/manifest.json',
				fetchManifest: async () => ({ ...VALID_MANIFEST, frameCoupled: true }),
				loadModelBytes: async () => new Uint8Array(0),
				createSession: async () => {
					throw new Error('should not reach createSession');
				},
				resizeImageData: async () => new Uint8ClampedArray(64)
			})
		).rejects.toThrow(OrtFaceDetectorUnavailableError);
	});

	it('refuses WASM EP for an oversized detector', async () => {
		const huge = {
			...VALID_MANIFEST,
			executionProviders: ['wasm'],
			io: { ...VALID_MANIFEST.io, inputWidth: 1024, inputHeight: 1024 }
		};
		const stub = stubSession(new Float32Array(0), new Float32Array(0));
		await expect(
			createOrtFaceDetector({
				manifestUrl: '/models/reframe-face/manifest.json',
				fetchManifest: async () => huge,
				loadModelBytes: async () => new Uint8Array(0),
				createSession: async () => stubHandle('wasm', stub),
				resizeImageData: async () => new Uint8ClampedArray(1024 * 1024 * 4)
			})
		).rejects.toThrow(OrtFaceDetectorUnavailableError);
		expect(stub.sessionRelease).toHaveBeenCalled();
	});

	it('runs preprocessing → session → decode for a raw-bbox detector', async () => {
		const stub = stubSession(
			new Float32Array([0.1, 0.2, 0.4, 0.6, 0.7, 0.7, 0.8, 0.8]),
			new Float32Array([0.95, 0.6])
		);
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => VALID_MANIFEST,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async (opts) => {
				// Sanity check: session creation receives the validated manifest.
				const { manifest, tensorLocation } = opts as unknown as {
					manifest: OrtModelManifest;
					tensorLocation?: string;
				};
				expect(manifest.id).toBe('face-detector');
				expect(manifest.frameCoupled).toBe(false);
				expect(tensorLocation).toBe('cpu');
				return stubHandle('webgpu', stub);
			},
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4) // 4×4 RGBA
		});

		const image: ImageData = {
			data: new Uint8ClampedArray(256 * 256 * 4),
			width: 256,
			height: 256,
			colorSpace: 'srgb'
		} as ImageData;
		const detections = await detector.detect(image);

		expect(stub.sessionRun).toHaveBeenCalledTimes(1);
		// The two synthetic detections survive both score threshold + NMS (they
		// do not overlap), and emerge as normalised FaceDetection boxes.
		expect(detections).toHaveLength(2);
		expect(detections[0]!.confidence).toBeGreaterThanOrEqual(detections[1]!.confidence);
		expect(detections[0]!.x).toBeGreaterThanOrEqual(0);
		expect(detections[0]!.width).toBeGreaterThan(0);
		expect(FakeTensor.disposeCount).toBe(1);
	});

	it('disposes the input tensor when session.run rejects', async () => {
		const session = {
			run: vi.fn(async () => {
				throw new Error('device lost');
			}),
			release: vi.fn(async () => {})
		};
		const handle = {
			session: session as never,
			executionProviders: ['webgpu'] as const,
			primaryEp: 'webgpu' as const,
			tensorLocation: 'gpu-buffer' as const
		};
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => VALID_MANIFEST,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async () => handle,
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4)
		});
		const image: ImageData = {
			data: new Uint8ClampedArray(256 * 256 * 4),
			width: 256,
			height: 256,
			colorSpace: 'srgb'
		} as ImageData;

		await expect(detector.detect(image)).rejects.toThrow(/device lost/);
		expect(FakeTensor.disposeCount).toBe(1);
	});

	it('disposes every output tensor after decoding', async () => {
		const boxesDispose = vi.fn();
		const scoresDispose = vi.fn();
		const session = {
			run: vi.fn(async () => ({
				boxes: {
					data: new Float32Array([0.1, 0.2, 0.4, 0.6]),
					type: 'float32',
					dispose: boxesDispose
				},
				scores: { data: new Float32Array([0.95]), type: 'float32', dispose: scoresDispose }
			})),
			release: vi.fn(async () => {})
		};
		const handle = {
			session: session as never,
			executionProviders: ['webgpu'] as const,
			primaryEp: 'webgpu' as const,
			tensorLocation: 'gpu-buffer' as const
		};
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => VALID_MANIFEST,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async () => handle,
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4)
		});
		const image: ImageData = {
			data: new Uint8ClampedArray(256 * 256 * 4),
			width: 256,
			height: 256,
			colorSpace: 'srgb'
		} as ImageData;

		expect(await detector.detect(image)).toHaveLength(1);
		expect(boxesDispose).toHaveBeenCalledTimes(1);
		expect(scoresDispose).toHaveBeenCalledTimes(1);
	});

	it('returns an empty array for a zero-sized ImageData without running the session', async () => {
		const stub = stubSession(new Float32Array(0), new Float32Array(0));
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => VALID_MANIFEST,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async () => stubHandle('webgpu', stub),
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4)
		});
		const empty: ImageData = {
			data: new Uint8ClampedArray(0),
			width: 0,
			height: 0,
			colorSpace: 'srgb'
		} as ImageData;
		expect(await detector.detect(empty)).toEqual([]);
		expect(stub.sessionRun).not.toHaveBeenCalled();
	});

	it('decodes anchor-offset detectors using anchors read from a session output', async () => {
		// Two candidates, one above threshold; the model emits flat anchors as
		// [cx, cy, w, h] per candidate alongside per-candidate offsets + scores.
		const offsets = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]);
		const scores = new Float32Array([0.95, 0.2]);
		const anchors = new Float32Array([0.5, 0.5, 0.2, 0.2, 0.1, 0.1, 0.05, 0.05]);
		const session = {
			run: vi.fn(async () => ({
				boxes: { data: offsets, type: 'float32' },
				scores: { data: scores, type: 'float32' },
				anchors: { data: anchors, type: 'float32' }
			})),
			release: vi.fn(async () => {})
		};
		const handle = {
			session: session as never,
			executionProviders: ['webgpu'] as const,
			primaryEp: 'webgpu' as const,
			tensorLocation: 'gpu-buffer' as const
		};
		const manifest = {
			...VALID_MANIFEST,
			decode: {
				type: 'anchor-offset',
				boxesOutputName: 'boxes',
				scoresOutputName: 'scores',
				anchorsOutputName: 'anchors',
				scoreThreshold: 0.5,
				iouThreshold: 0.3,
				maxDetections: 16
			}
		};
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => manifest,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async () => handle,
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4)
		});
		const image: ImageData = {
			data: new Uint8ClampedArray(256 * 256 * 4),
			width: 256,
			height: 256,
			colorSpace: 'srgb'
		} as ImageData;
		const detections = await detector.detect(image);
		// Only the high-confidence candidate survives the score threshold; the
		// decoded box matches anchor 0 (cx=0.5, w=0.2 → x ≈ 0.4, w ≈ 0.2).
		expect(detections).toHaveLength(1);
		expect(detections[0]!.x).toBeCloseTo(0.4, 5);
		expect(detections[0]!.width).toBeCloseTo(0.2, 5);
		expect(detections[0]!.confidence).toBeCloseTo(0.95, 5);
	});

	it('dispose() releases the underlying session', async () => {
		const stub = stubSession(new Float32Array(0), new Float32Array(0));
		const detector = await createOrtFaceDetector({
			manifestUrl: '/models/reframe-face/manifest.json',
			fetchManifest: async () => VALID_MANIFEST,
			loadModelBytes: async () => new Uint8Array(0),
			createSession: async () => stubHandle('webgpu', stub),
			resizeImageData: async () => new Uint8ClampedArray(4 * 4 * 4)
		});
		detector.dispose();
		// release is fired asynchronously by safeRelease; await a microtask cycle
		await new Promise((r) => setTimeout(r, 0));
		expect(stub.sessionRelease).toHaveBeenCalledTimes(1);
	});
});
