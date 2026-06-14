import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import { loadLiteRtModule } from '../asr/litert-loader';
import {
	decodeFaceDetections,
	createLiteRtFaceDetector,
	createMockFaceDetector,
	type FaceDetection
} from './face-detector';
import type { ReframeModelManifest } from './model-manifest';

vi.mock('../asr/litert-loader', () => ({
	loadLiteRtModule: vi.fn()
}));

function manifest(over: Partial<ReframeModelManifest> = {}): ReframeModelManifest {
	return {
		id: 'm',
		version: '1',
		license: 'Apache-2.0',
		source: 'https://example.com/m.tflite',
		model: { url: '/models/reframe/m.tflite', sizeBytes: 4, checksum: `sha256-${'a'.repeat(64)}` },
		inputSize: 128,
		outputStride: 6,
		format: 'tflite',
		...over
	};
}

function compiledModel() {
	return { run: vi.fn(), delete: vi.fn() };
}

function fakeApi() {
	const api = {
		loadLiteRt: vi.fn(async () => undefined),
		loadAndCompile: vi.fn(),
		Tensor: { fromTypedArray: vi.fn() }
	};
	vi.mocked(loadLiteRtModule).mockResolvedValue(api);
	return api;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('decodeFaceDetections', () => {
	it('decodes [1,N,5] centre-form output with sigmoid score + threshold', () => {
		const data = new Float32Array([
			10,
			0.5,
			0.5,
			0.2,
			0.2, // strong detection (sigmoid(10) ≈ 1)
			-10,
			0.1,
			0.1,
			0.1,
			0.1 // weak detection (sigmoid(-10) ≈ 0) → dropped
		]);
		const dets = decodeFaceDetections(data, [1, 2, 5]);
		expect(dets).toHaveLength(1);
		expect(dets[0]!.x).toBeCloseTo(0.4, 5); // cx - w/2
		expect(dets[0]!.y).toBeCloseTo(0.4, 5);
		expect(dets[0]!.width).toBeCloseTo(0.2, 5);
		expect(dets[0]!.confidence).toBeGreaterThan(0.9);
	});

	it('accepts output without a leading batch dim', () => {
		const data = new Float32Array([10, 0.5, 0.5, 0.4, 0.4]);
		expect(decodeFaceDetections(data, [1, 5])).toHaveLength(1);
	});

	it('suppresses overlapping boxes via NMS, keeping the higher score', () => {
		const data = new Float32Array([
			5,
			0.5,
			0.5,
			0.4,
			0.4,
			4,
			0.51,
			0.51,
			0.4,
			0.4 // heavy overlap with the first
		]);
		const dets = decodeFaceDetections(data, [1, 2, 5]);
		expect(dets).toHaveLength(1);
		expect(dets[0]!.confidence).toBeGreaterThan(0.98); // sigmoid(5)
	});

	it('returns [] for malformed output (stride < 5)', () => {
		expect(decodeFaceDetections(new Float32Array([1, 2, 3]), [1, 1, 3])).toHaveLength(0);
	});
});

describe('createLiteRtFaceDetector', () => {
	it('compiles the TFLite model via LiteRT and disposes it', async () => {
		const api = fakeApi();
		const model = compiledModel();
		api.loadAndCompile.mockResolvedValue(model);
		const detector = await createLiteRtFaceDetector({
			wasmPath: '/litert/',
			accelerator: 'wasm',
			modelBytes: new Uint8Array([1, 2, 3, 4]),
			manifest: manifest()
		});
		expect(api.loadAndCompile).toHaveBeenCalledWith(expect.any(Uint8Array), {
			accelerator: 'wasm'
		});
		detector.dispose();
		expect(model.delete).toHaveBeenCalledTimes(1);
	});

	it('falls back to wasm when the accelerated compile fails', async () => {
		const api = fakeApi();
		const model = compiledModel();
		api.loadAndCompile
			.mockRejectedValueOnce(new Error('webgpu compile failed'))
			.mockResolvedValueOnce(model);
		const detector = await createLiteRtFaceDetector({
			wasmPath: '/litert/',
			accelerator: 'webgpu',
			modelBytes: new Uint8Array([1]),
			manifest: manifest()
		});
		expect(api.loadAndCompile).toHaveBeenLastCalledWith(expect.any(Uint8Array), {
			accelerator: 'wasm'
		});
		detector.dispose();
	});
});

describe('createMockFaceDetector (R11.2 injection)', () => {
	it('returns canned detections keyed by frame index', async () => {
		const face: FaceDetection = { x: 0.4, y: 0.4, width: 0.2, height: 0.2, confidence: 0.9 };
		const detector = createMockFaceDetector(new Map([['frame_0', [face]]]));
		const img = {
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1,
			colorSpace: 'srgb'
		} as ImageData;
		expect(await detector.detect(img)).toEqual([face]);
		expect(await detector.detect(img)).toEqual([]); // frame_1 absent
	});
});
