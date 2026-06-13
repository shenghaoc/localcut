import { describe, expect, it } from 'vite-plus/test';
import { ManifestError, validateManifest } from './model-manifest';

const BASE_MANIFEST = {
	id: 'modnet-v1',
	version: '1.0.0',
	license: 'Apache-2.0',
	source: 'https://example.invalid/modnet',
	sizeBytes: 1024,
	checksum: `sha256-${'a'.repeat(64)}`,
	inputWidth: 512,
	inputHeight: 512
};

describe('matte model manifest', () => {
	it('defaults to the LiteRT model format and NHWC tensor layout', () => {
		expect(validateManifest(BASE_MANIFEST)).toMatchObject({
			format: 'tflite',
			inputLayout: 'nhwc'
		});
	});

	it('accepts explicit NCHW input layout', () => {
		expect(validateManifest({ ...BASE_MANIFEST, inputLayout: 'nchw' }).inputLayout).toBe('nchw');
	});

	it('rejects unsupported model formats', () => {
		expect(() => validateManifest({ ...BASE_MANIFEST, format: 'flatbuffer' })).toThrow(
			ManifestError
		);
	});

	it('rejects unsupported tensor layouts', () => {
		expect(() => validateManifest({ ...BASE_MANIFEST, inputLayout: 'hwc' })).toThrow(ManifestError);
	});
});
