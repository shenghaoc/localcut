import { describe, it, expect } from 'vite-plus/test';
import { validateManifest, type ReframeModelManifest } from './model-manifest';

describe('validateManifest', () => {
	const validManifest: ReframeModelManifest = {
		id: 'blazeface-test',
		version: '1.0.0',
		license: 'Apache-2.0',
		source: 'https://example.com/model.tflite',
		model: {
			url: '/models/reframe/blazeface.tflite',
			sizeBytes: 123456,
			checksum: `sha256-${'a'.repeat(64)}`
		},
		inputSize: 128,
		outputStride: 6,
		format: 'tflite'
	};

	it('accepts a valid manifest', () => {
		const result = validateManifest(validManifest);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.manifest.id).toBe('blazeface-test');
			expect(result.manifest.format).toBe('tflite');
			expect(result.manifest.model.checksum).toBe(`sha256-${'a'.repeat(64)}`);
		}
	});

	it('rejects null input', () => {
		expect(validateManifest(null).ok).toBe(false);
	});

	it('rejects missing required fields', () => {
		const result = validateManifest({ id: 'test' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('version');
	});

	it('rejects wrong format value', () => {
		const result = validateManifest({ ...validManifest, format: 'onnx' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('format');
	});

	it('rejects non-positive inputSize', () => {
		const result = validateManifest({ ...validManifest, inputSize: -1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('inputSize');
	});

	it('rejects an output stride below 5', () => {
		const result = validateManifest({ ...validManifest, outputStride: 4 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('outputStride');
	});

	it('rejects a non-positive model size', () => {
		const result = validateManifest({
			...validManifest,
			model: { ...validManifest.model, sizeBytes: 0 }
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('model.sizeBytes');
	});

	it('rejects an invalid model checksum format', () => {
		const result = validateManifest({
			...validManifest,
			model: { ...validManifest.model, checksum: 'a'.repeat(64) } // missing sha256- prefix
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('model.checksum');
	});

	it('rejects a missing model asset', () => {
		const { model: _model, ...withoutModel } = validManifest;
		const result = validateManifest(withoutModel);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.field).toBe('model');
	});

	it('tolerates unknown extra fields', () => {
		expect(validateManifest({ ...validManifest, extraField: 'ignored' }).ok).toBe(true);
	});
});
