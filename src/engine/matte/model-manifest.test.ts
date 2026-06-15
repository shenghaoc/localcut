import { describe, expect, it } from 'vite-plus/test';

import { ManifestError, validateManifest } from './model-manifest';

/** A minimal valid matte manifest; individual tests override single fields. */
function validManifestInput(): Record<string, unknown> {
	return {
		id: 'mediapipe-selfie-general',
		version: '1.0.0',
		license: 'Apache-2.0',
		source: 'https://storage.googleapis.com/mediapipe-assets/selfie_segmentation.tflite',
		sizeBytes: 249505,
		checksum: 'sha256-' + 'a'.repeat(64),
		inputWidth: 256,
		inputHeight: 256,
		inputRange: 'unit'
	};
}

describe('matte model manifest (Phase 31)', () => {
	it('accepts a well-formed manifest and normalizes the checksum case', () => {
		const manifest = validateManifest({
			...validManifestInput(),
			checksum: 'sha256-' + 'A'.repeat(64)
		});
		expect(manifest.id).toBe('mediapipe-selfie-general');
		expect(manifest.checksum).toBe('sha256-' + 'a'.repeat(64));
		expect(manifest.inputRange).toBe('unit');
	});

	it('defaults inputRange to signed-unit when omitted (MODNet back-compat)', () => {
		const input = validManifestInput();
		delete input.inputRange;
		expect(validateManifest(input).inputRange).toBe('signed-unit');
	});

	it('accepts the explicit signed-unit range', () => {
		expect(
			validateManifest({ ...validManifestInput(), inputRange: 'signed-unit' }).inputRange
		).toBe('signed-unit');
	});

	it('rejects an unknown inputRange', () => {
		expect(() => validateManifest({ ...validManifestInput(), inputRange: 'percent' })).toThrow(
			ManifestError
		);
	});

	it('rejects a non-object manifest', () => {
		expect(() => validateManifest(null)).toThrow(ManifestError);
	});

	it('rejects a malformed checksum', () => {
		expect(() => validateManifest({ ...validManifestInput(), checksum: 'md5-deadbeef' })).toThrow(
			ManifestError
		);
	});

	it('rejects a non-positive input dimension', () => {
		expect(() => validateManifest({ ...validManifestInput(), inputWidth: 0 })).toThrow(
			ManifestError
		);
	});
});
