import { describe, expect, it } from 'vite-plus/test';

import { OrtManifestError, validateOrtManifest } from './ort-model-manifest';

/** A minimal valid ONNX manifest; individual tests override single fields. */
function validManifestInput(): Record<string, unknown> {
	return {
		id: 'rife-frame-interpolation',
		version: '1.0.0',
		license: 'MIT',
		source: 'https://huggingface.co/example/rife-onnx',
		format: 'onnx',
		model: {
			url: '/_model/hf/example/rife-onnx/resolve/main/model.onnx',
			sizeBytes: 12_345_678,
			checksum: 'sha256-' + 'a'.repeat(64)
		},
		executionProviders: ['webgpu'],
		frameCoupled: true,
		opset: 17,
		tensorLocation: 'gpu-buffer',
		infoUrl: 'https://huggingface.co/example/rife-onnx'
	};
}

describe('ORT model manifest validation', () => {
	it('accepts a well-formed manifest and normalizes the checksum case', () => {
		const manifest = validateOrtManifest({
			...validManifestInput(),
			model: {
				url: '/model.onnx',
				sizeBytes: 100,
				checksum: 'sha256-' + 'A'.repeat(64)
			}
		});
		expect(manifest.id).toBe('rife-frame-interpolation');
		expect(manifest.format).toBe('onnx');
		expect(manifest.model.checksum).toBe('sha256-' + 'a'.repeat(64));
		expect(manifest.executionProviders).toEqual(['webgpu']);
		expect(manifest.frameCoupled).toBe(true);
		expect(manifest.tensorLocation).toBe('gpu-buffer');
		expect(manifest.opset).toBe(17);
	});

	it('accepts a non-frame-coupled WASM model', () => {
		const manifest = validateOrtManifest({
			...validManifestInput(),
			executionProviders: ['wasm'],
			frameCoupled: false,
			tensorLocation: 'cpu'
		});
		expect(manifest.executionProviders).toEqual(['wasm']);
		expect(manifest.frameCoupled).toBe(false);
	});

	it('tolerates optional fields being omitted', () => {
		const input = validManifestInput();
		delete input.opset;
		delete input.tensorLocation;
		delete input.infoUrl;
		const manifest = validateOrtManifest(input);
		expect(manifest.opset).toBeUndefined();
		expect(manifest.tensorLocation).toBeUndefined();
		expect(manifest.infoUrl).toBeUndefined();
	});

	it('rejects a non-object manifest', () => {
		expect(() => validateOrtManifest(null)).toThrow(OrtManifestError);
	});

	it('rejects a non-onnx format', () => {
		expect(() => validateOrtManifest({ ...validManifestInput(), format: 'tflite' })).toThrow(
			OrtManifestError
		);
	});

	it('rejects a malformed checksum', () => {
		expect(() =>
			validateOrtManifest({
				...validManifestInput(),
				model: { url: '/m.onnx', sizeBytes: 1, checksum: 'md5-deadbeef' }
			})
		).toThrow(OrtManifestError);
	});

	it('rejects a non-positive model size', () => {
		expect(() =>
			validateOrtManifest({
				...validManifestInput(),
				model: { url: '/m.onnx', sizeBytes: 0, checksum: 'sha256-' + 'a'.repeat(64) }
			})
		).toThrow(OrtManifestError);
	});

	it('rejects an unknown execution provider', () => {
		expect(() =>
			validateOrtManifest({ ...validManifestInput(), executionProviders: ['cuda'] })
		).toThrow(OrtManifestError);
	});

	it('rejects an empty execution-provider list', () => {
		expect(() => validateOrtManifest({ ...validManifestInput(), executionProviders: [] })).toThrow(
			OrtManifestError
		);
	});

	it('rejects a frame-coupled manifest that pins WASM (no silent CPU fallback)', () => {
		expect(() =>
			validateOrtManifest({
				...validManifestInput(),
				frameCoupled: true,
				executionProviders: ['webgpu', 'wasm']
			})
		).toThrow(OrtManifestError);
	});

	it('rejects a frame-coupled manifest with no GPU-class provider', () => {
		expect(() =>
			validateOrtManifest({
				...validManifestInput(),
				frameCoupled: true,
				executionProviders: ['wasm']
			})
		).toThrow(OrtManifestError);
	});

	it('rejects a non-boolean frameCoupled', () => {
		expect(() => validateOrtManifest({ ...validManifestInput(), frameCoupled: 'yes' })).toThrow(
			OrtManifestError
		);
	});
});
