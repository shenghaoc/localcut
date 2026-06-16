/** Phase 32b: Beauty ONNX model manifest validation tests. */

import { describe, expect, it } from 'vite-plus/test';
import { BeautyManifestError, manifestAssets, validateBeautyManifest } from './model-manifest';

const detectorAsset = {
	role: 'detector',
	format: 'onnx',
	url: '/_model/hf/localcut/facemesh-onnx/resolve/main/detector.onnx',
	sizeBytes: 1_200_000,
	checksum: 'sha256-' + '0'.repeat(64),
	license: 'Apache-2.0',
	source: 'https://huggingface.co/localcut/facemesh-onnx',
	provider: 'LocalCut fixture',
	modelCard: 'https://huggingface.co/localcut/facemesh-onnx/blob/main/README.md',
	inputs: [{ name: 'input', dims: [1, 3, 192, 192], dataType: 'float32', semantic: 'image' }],
	outputs: [
		{ name: 'boxes', dims: [1, 896, 16], dataType: 'float32', semantic: 'boxes' },
		{ name: 'scores', dims: [1, 896, 1], dataType: 'float32', semantic: 'scores' }
	]
} as const;

const landmarkAsset = {
	role: 'landmarks',
	format: 'onnx',
	url: '/_model/gcs/localcut-models/facemesh/landmarks.onnx',
	sizeBytes: 3_500_000,
	checksum: 'sha256-' + 'a'.repeat(64),
	license: 'Apache-2.0',
	source: 'https://storage.googleapis.com/localcut-models/facemesh/landmarks.onnx',
	provider: 'LocalCut fixture',
	modelCard: 'https://example.invalid/facemesh-model-card',
	inputs: [{ name: 'roi', dims: [1, 3, 256, 256], dataType: 'float32', semantic: 'image' }],
	outputs: [
		{ name: 'landmarks', dims: [1, 478, 3], dataType: 'float32', semantic: 'landmarks' },
		{ name: 'presence', dims: [1, 1], dataType: 'float32', semantic: 'presence' }
	]
} as const;

const VALID = {
	id: 'facemesh-onnx-primary-v1',
	version: '1.0.0',
	sizeBytes: detectorAsset.sizeBytes + landmarkAsset.sizeBytes,
	assets: {
		detector: detectorAsset,
		landmarks: landmarkAsset
	},
	topologyVersion: 1,
	landmarkCount: 478
};

describe('validateBeautyManifest', () => {
	it('accepts a valid multi-asset ONNX manifest', () => {
		const result = validateBeautyManifest(VALID);
		expect(result.id).toBe('facemesh-onnx-primary-v1');
		expect(result.assets.detector.format).toBe('onnx');
		expect(result.assets.landmarks.outputs[0]!.semantic).toBe('landmarks');
		expect(result.sizeBytes).toBe(detectorAsset.sizeBytes + landmarkAsset.sizeBytes);
	});

	it('rejects a placeholder template manifest so the feature stays gated', () => {
		expect(() => validateBeautyManifest({ ...VALID, template: true })).toThrow(BeautyManifestError);
		expect(() => validateBeautyManifest({ ...VALID, template: true })).toThrow('template');
	});

	it('accepts an optional blendshape asset', () => {
		const blendshape = {
			role: 'blendshape',
			format: 'onnx',
			url: '/models/beauty/blendshape.onnx',
			sizeBytes: 250_000,
			checksum: 'sha256-' + 'b'.repeat(64),
			license: 'Apache-2.0',
			source: 'https://example.invalid/blendshape.onnx',
			provider: 'LocalCut fixture',
			modelCard: 'https://example.invalid/blendshape-card',
			inputs: [
				{ name: 'landmarks', dims: [1, 478, 3], dataType: 'float32', semantic: 'landmarks' }
			],
			outputs: [
				{ name: 'coefficients', dims: [1, 52], dataType: 'float32', semantic: 'blendshapes' }
			]
		} as const;
		const manifest = validateBeautyManifest({
			...VALID,
			sizeBytes: VALID.sizeBytes + blendshape.sizeBytes,
			assets: { ...VALID.assets, blendshape }
		});
		expect(manifestAssets(manifest).map((asset) => asset.role)).toEqual([
			'detector',
			'landmarks',
			'blendshape'
		]);
	});

	it('rejects non-object input', () => {
		expect(() => validateBeautyManifest(null)).toThrow(BeautyManifestError);
		expect(() => validateBeautyManifest('string')).toThrow(BeautyManifestError);
	});

	it('rejects missing required fields', () => {
		expect(() => validateBeautyManifest({ ...VALID, id: '' })).toThrow('non-empty string');
		expect(() => validateBeautyManifest({ ...VALID, version: undefined })).toThrow(
			'non-empty string'
		);
		expect(() => validateBeautyManifest({ ...VALID, assets: undefined })).toThrow('assets');
	});

	it('rejects invalid checksum format', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: { ...detectorAsset, checksum: 'md5-abc123' }
				}
			})
		).toThrow('sha256-');
	});

	it('rejects size mismatch', () => {
		expect(() => validateBeautyManifest({ ...VALID, sizeBytes: 999_999 })).toThrow('sizeBytes');
	});

	it('rejects non-ONNX assets and TFLite assumptions', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: {
						...detectorAsset,
						format: 'tflite',
						url: '/models/beauty/blaze_face_short_range.tflite'
					}
				}
			})
		).toThrow('onnx');
	});

	it('rejects direct cross-origin model URLs', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: { ...detectorAsset, url: 'https://example.com/detector.onnx' }
				}
			})
		).toThrow('cross-origin');
	});

	it('rejects unknown model proxy prefixes', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: { ...detectorAsset, url: '/_model/http/example.com/detector.onnx' }
				}
			})
		).toThrow('/_model/hf');
	});

	it('rejects invalid tensor contracts', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					landmarks: {
						...landmarkAsset,
						outputs: []
					}
				}
			})
		).toThrow('outputs');
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					landmarks: {
						...landmarkAsset,
						inputs: [
							{ name: 'roi', dims: [1, 0, 256, 256], dataType: 'float32', semantic: 'image' }
						]
					}
				}
			})
		).toThrow('positive integer');
	});

	it('rejects incompatible v1 detector and landmark tensor shapes', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: {
						...detectorAsset,
						inputs: [
							{ name: 'input', dims: [1, 128, 128, 3], dataType: 'float32', semantic: 'image' }
						]
					}
				}
			})
		).toThrow('[1, 192, 192, 3]');
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					landmarks: {
						...landmarkAsset,
						inputs: [
							{ name: 'roi', dims: [1, 3, 128, 128], dataType: 'float32', semantic: 'image' }
						]
					}
				}
			})
		).toThrow('[1, 256, 256, 3]');
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					landmarks: {
						...landmarkAsset,
						outputs: [
							{ name: 'landmarks', dims: [1, 468, 3], dataType: 'float32', semantic: 'landmarks' }
						]
					}
				}
			})
		).toThrow('[1, 478, 3]');
	});

	it('rejects detector outputs that cannot be decoded consistently', () => {
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: {
						...detectorAsset,
						outputs: [{ name: 'boxes', dims: [1, 896, 16], dataType: 'float32', semantic: 'boxes' }]
					}
				}
			})
		).toThrow('scores');
		expect(() =>
			validateBeautyManifest({
				...VALID,
				assets: {
					...VALID.assets,
					detector: {
						...detectorAsset,
						outputs: [
							{ name: 'boxes', dims: [1, 896, 16], dataType: 'float32', semantic: 'boxes' },
							{ name: 'scores', dims: [1, 512, 1], dataType: 'float32', semantic: 'scores' }
						]
					}
				}
			})
		).toThrow('candidate count');
	});

	it('rejects incompatible landmark topology', () => {
		expect(() => validateBeautyManifest({ ...VALID, landmarkCount: 468 })).toThrow('landmarkCount');
		expect(() => validateBeautyManifest({ ...VALID, topologyVersion: 2 })).toThrow(
			'topologyVersion'
		);
	});
});

describe('manifestAssets', () => {
	it('returns detector then landmarks', () => {
		const manifest = validateBeautyManifest(VALID);
		const assets = manifestAssets(manifest);
		expect(assets.map((asset) => asset.role)).toEqual(['detector', 'landmarks']);
		expect(assets[0]!.url).toContain('detector.onnx');
		expect(assets[1]!.url).toContain('landmarks.onnx');
	});
});
