import { describe, it, expect } from 'vite-plus/test';
import {
	inputTensorBytes,
	ReframeFaceDetectorManifestError,
	validateReframeFaceDetectorManifest
} from './face-detector-ort-manifest';

const VALID_MODEL = {
	url: '/_model/hf/example/face-detector/resolve/main/model.onnx',
	sizeBytes: 1024,
	checksum: 'sha256-' + 'a'.repeat(64)
};

const BASE_VALID = {
	id: 'face-detector',
	version: '1.0.0',
	license: 'Apache-2.0',
	source: 'https://example.com/face-detector',
	format: 'onnx',
	frameCoupled: false,
	executionProviders: ['webgpu', 'wasm'],
	model: VALID_MODEL,
	io: {
		layout: 'nchw',
		inputWidth: 128,
		inputHeight: 128,
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

describe('validateReframeFaceDetectorManifest', () => {
	it('accepts a fully-specified raw-bbox manifest', () => {
		const manifest = validateReframeFaceDetectorManifest(BASE_VALID);
		expect(manifest.id).toBe('face-detector');
		expect(manifest.frameCoupled).toBe(false);
		expect(manifest.executionProviders).toEqual(['webgpu', 'wasm']);
		expect(manifest.io.inputWidth).toBe(128);
		expect(manifest.decode.type).toBe('raw-bbox');
		if (manifest.decode.type === 'raw-bbox') {
			expect(manifest.decode.boxFormat).toBe('xyxy-normalized');
		}
	});

	it('accepts an anchor-offset manifest with variance', () => {
		const manifest = validateReframeFaceDetectorManifest({
			...BASE_VALID,
			decode: {
				type: 'anchor-offset',
				boxesOutputName: 'boxes',
				scoresOutputName: 'scores',
				anchorsOutputName: 'anchors',
				variance: [0.1, 0.1, 0.2, 0.2],
				scoreThreshold: 0.6,
				iouThreshold: 0.3,
				maxDetections: 8
			}
		});
		expect(manifest.decode.type).toBe('anchor-offset');
		if (manifest.decode.type === 'anchor-offset') {
			expect(manifest.decode.anchorsOutputName).toBe('anchors');
			expect(manifest.decode.variance).toEqual([0.1, 0.1, 0.2, 0.2]);
		}
	});

	it('rejects an anchor-offset manifest without anchorsOutputName', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				decode: {
					type: 'anchor-offset',
					boxesOutputName: 'boxes',
					scoresOutputName: 'scores',
					scoreThreshold: 0.5,
					iouThreshold: 0.3,
					maxDetections: 8
				}
			})
		).toThrow(/anchorsOutputName/);
	});

	it('accepts a mean-std input range with mean + std vectors', () => {
		const manifest = validateReframeFaceDetectorManifest({
			...BASE_VALID,
			io: {
				...BASE_VALID.io,
				inputRange: 'mean-std',
				mean: [0.485, 0.456, 0.406],
				std: [0.229, 0.224, 0.225]
			}
		});
		expect(manifest.io.inputRange).toBe('mean-std');
		expect(manifest.io.mean).toEqual([0.485, 0.456, 0.406]);
	});

	it('rejects a placeholder/template manifest with a clear error', () => {
		expect(() => validateReframeFaceDetectorManifest({ ...BASE_VALID, template: true })).toThrow(
			ReframeFaceDetectorManifestError
		);
		expect(() => validateReframeFaceDetectorManifest({ ...BASE_VALID, template: true })).toThrow(
			/placeholder template/
		);
	});

	it('rejects a frame-coupled manifest (reframe analysis is not on the hot path)', () => {
		// Use webgpu-only EPs so the base validator's frame-coupled-vs-wasm rule
		// does not fire first — that lets the face-detector-specific check be the
		// one that rejects this manifest.
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				frameCoupled: true,
				executionProviders: ['webgpu']
			})
		).toThrow(/frameCoupled.*false/);
	});

	it('rejects an invalid base ORT manifest with a ReframeFaceDetectorManifestError', () => {
		expect(() => validateReframeFaceDetectorManifest({ ...BASE_VALID, format: 'tflite' })).toThrow(
			ReframeFaceDetectorManifestError
		);
	});

	it('rejects an unknown layout', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, layout: 'nhwx' }
			})
		).toThrow(/layout/);
	});

	it('rejects an out-of-range score threshold', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				decode: { ...BASE_VALID.decode, scoreThreshold: 1.0 }
			})
		).toThrow(/scoreThreshold/);
	});

	it('rejects an unknown decode type', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				decode: { ...BASE_VALID.decode, type: 'unknown' }
			})
		).toThrow(/decode\.type/);
	});

	it('rejects mean-std without mean/std vectors', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, inputRange: 'mean-std' }
			})
		).toThrow(/io\.mean/);
	});

	it('rejects mean of the wrong length', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: {
					...BASE_VALID.io,
					inputRange: 'mean-std',
					mean: [0.5, 0.5],
					std: [0.5, 0.5, 0.5]
				}
			})
		).toThrow(/io\.mean/);
	});

	it('rejects unsupported inputChannels (preprocessor reads RGBA)', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, inputChannels: 2 }
			})
		).toThrow(/inputChannels/);
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, inputChannels: 5 }
			})
		).toThrow(/inputChannels/);
	});

	it('rejects non-float32 input dtypes', () => {
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, bytesPerElement: 1 }
			})
		).toThrow(/bytesPerElement/);
		expect(() =>
			validateReframeFaceDetectorManifest({
				...BASE_VALID,
				io: { ...BASE_VALID.io, bytesPerElement: 2 }
			})
		).toThrow(/bytesPerElement/);
	});

	it('accepts RGBA inputChannels=4 with matching 4-element mean/std', () => {
		const manifest = validateReframeFaceDetectorManifest({
			...BASE_VALID,
			io: {
				...BASE_VALID.io,
				inputChannels: 4,
				inputRange: 'mean-std',
				mean: [0.5, 0.5, 0.5, 0.5],
				std: [0.5, 0.5, 0.5, 0.5]
			}
		});
		expect(manifest.io.inputChannels).toBe(4);
		expect(manifest.io.mean).toHaveLength(4);
	});
});

describe('inputTensorBytes', () => {
	it('is the product of input dimensions and bytesPerElement', () => {
		const manifest = validateReframeFaceDetectorManifest(BASE_VALID);
		expect(inputTensorBytes(manifest.io)).toBe(128 * 128 * 3 * 4);
	});

	it('scales with inputChannels (RGBA pushes tensor bytes higher)', () => {
		const manifest = validateReframeFaceDetectorManifest({
			...BASE_VALID,
			io: { ...BASE_VALID.io, inputChannels: 4 }
		});
		expect(inputTensorBytes(manifest.io)).toBe(128 * 128 * 4 * 4);
	});
});
