import { describe, it, expect } from 'vite-plus/test';
import {
	validateInterpolationManifest,
	toModelIoContract,
	InterpolationManifestError
} from './interpolation-model';

const VALID_MANIFEST = {
	id: 'rife-v1',
	version: '1.0.0',
	license: 'MIT',
	source: 'https://github.com/hzwer/ECCV2022-RIFE',
	format: 'onnx',
	frameCoupled: true,
	executionProviders: ['webgpu'],
	tensorLocation: 'gpu-buffer',
	model: {
		url: 'https://huggingface.co/org/rife/resolve/main/model.onnx',
		sizeBytes: 1024,
		checksum: 'sha256-' + 'a'.repeat(64)
	},
	io: {
		layout: 'nchw',
		inputWidth: 256,
		inputHeight: 256,
		inputChannels: 3,
		bytesPerElement: 4,
		input0Name: 'img0',
		input1Name: 'img1',
		timestepName: 'timestep',
		outputName: 'output',
		flowOutput: true,
		flowOutputName: 'flow',
		maxDisplacement: 32
	}
};

describe('validateInterpolationManifest', () => {
	it('accepts a valid ONNX manifest', () => {
		const result = validateInterpolationManifest(VALID_MANIFEST);
		expect(result.id).toBe('rife-v1');
		expect(result.format).toBe('onnx');
		expect(result.frameCoupled).toBe(true);
		expect(result.executionProviders).toEqual(['webgpu']);
		expect(result.model.sizeBytes).toBe(1024);
		expect(result.io.layout).toBe('nchw');
		expect(result.io.input0Name).toBe('img0');
		expect(result.io.flowOutput).toBe(true);
	});

	it('rejects a placeholder/template manifest (R2.4 — feature stays hidden)', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, template: true })).toThrow(
			/placeholder template/
		);
	});

	it('rejects non-object input', () => {
		expect(() => validateInterpolationManifest(null)).toThrow(InterpolationManifestError);
		expect(() => validateInterpolationManifest('string')).toThrow(InterpolationManifestError);
	});

	it('rejects format other than onnx', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, format: 'tflite' })).toThrow(
			/"format" must be "onnx"/
		);
	});

	it('rejects a non-frame-coupled manifest', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, frameCoupled: false })).toThrow(
			/must declare "frameCoupled": true/
		);
	});

	it('rejects a frame-coupled manifest that pins the wasm EP (no CPU fallback)', () => {
		expect(() =>
			validateInterpolationManifest({ ...VALID_MANIFEST, executionProviders: ['wasm'] })
		).toThrow(/must not use \[wasm\]/);
	});

	it('rejects a frame-coupled manifest with no GPU-class EP', () => {
		expect(() =>
			validateInterpolationManifest({ ...VALID_MANIFEST, executionProviders: [] })
		).toThrow(InterpolationManifestError);
	});

	it('rejects missing id / version / license / source', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, id: '' })).toThrow(
			/"id" must be a non-empty string/
		);
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, version: '' })).toThrow(
			/"version" must be a non-empty string/
		);
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, license: '' })).toThrow(
			/"license" must be a non-empty string/
		);
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, source: '' })).toThrow(
			/"source" must be a non-empty string/
		);
	});

	it('rejects missing or invalid model asset', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, model: undefined })).toThrow(
			/"model" must be an object/
		);
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				model: { ...VALID_MANIFEST.model, checksum: 'md5-abc' }
			})
		).toThrow(/must be "sha256-" followed by 64 hex digits/);
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				model: { ...VALID_MANIFEST.model, sizeBytes: 0 }
			})
		).toThrow(/"model.sizeBytes" must be a positive integer/);
	});

	it('rejects a missing io contract', () => {
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, io: undefined })).toThrow(
			/io must be an object/
		);
	});

	it('rejects io with invalid layout', () => {
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				io: { ...VALID_MANIFEST.io, layout: 'abc' }
			})
		).toThrow(/io.layout must be "nchw" or "nhwc"/);
	});

	it('rejects io with a non-positive inputWidth', () => {
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				io: { ...VALID_MANIFEST.io, inputWidth: 0 }
			})
		).toThrow(/io.inputWidth must be a positive number/);
	});

	it('rejects io missing an input name', () => {
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				io: { ...VALID_MANIFEST.io, input0Name: '' }
			})
		).toThrow(/io.input0Name must be a non-empty string/);
	});

	it('rejects io with non-boolean flowOutput', () => {
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				io: { ...VALID_MANIFEST.io, flowOutput: 'yes' }
			})
		).toThrow(/io.flowOutput must be a boolean/);
	});

	it('requires flowOutputName when flowOutput is true', () => {
		const { flowOutputName: _drop, ...ioNoName } = VALID_MANIFEST.io;
		void _drop;
		expect(() => validateInterpolationManifest({ ...VALID_MANIFEST, io: ioNoName })).toThrow(
			/io.flowOutputName must be a non-empty string/
		);
	});

	it('rejects io with negative maxDisplacement', () => {
		expect(() =>
			validateInterpolationManifest({
				...VALID_MANIFEST,
				io: { ...VALID_MANIFEST.io, maxDisplacement: -1 }
			})
		).toThrow(/io.maxDisplacement must be a non-negative number/);
	});

	it('accepts a fixed-midpoint model (timestepName null)', () => {
		const result = validateInterpolationManifest({
			...VALID_MANIFEST,
			io: { ...VALID_MANIFEST.io, timestepName: null }
		});
		expect(result.io.timestepName).toBeNull();
	});

	it('tolerates unknown fields (forward-compatible)', () => {
		const withExtra = {
			...VALID_MANIFEST,
			extraField: 'ignored',
			io: { ...VALID_MANIFEST.io, extraIoField: 42 } as Record<string, unknown>
		};
		expect(() => validateInterpolationManifest(withExtra)).not.toThrow();
	});
});

describe('toModelIoContract', () => {
	it('converts manifest io to the engine ModelIoContract', () => {
		const result = toModelIoContract(validateInterpolationManifest(VALID_MANIFEST).io);
		expect(result).toEqual({
			inputWidth: 256,
			inputHeight: 256,
			inputChannels: 3,
			bytesPerElement: 4,
			flowOutput: true,
			maxDisplacement: 32
		});
	});
});
