/** Phase 32b: Beauty ORT runtime selection tests. */

import { describe, expect, it } from 'vite-plus/test';
import { createBeautySession, resolveExecutionProvider } from './beauty-runtime';
import type { BeautyModelManifest } from './model-manifest';

const manifest: BeautyModelManifest = {
	id: 'facemesh-onnx-primary-v1',
	version: '1.0.0',
	sizeBytes: 2,
	assets: {
		detector: {
			role: 'detector',
			format: 'onnx',
			url: '/models/beauty/detector.onnx',
			sizeBytes: 1,
			checksum: 'sha256-' + '0'.repeat(64),
			license: 'Apache-2.0',
			source: 'https://example.invalid/detector',
			provider: 'LocalCut fixture',
			modelCard: 'https://example.invalid/detector-card',
			inputs: [{ name: 'input', dims: [1, 3, 192, 192], dataType: 'float32', semantic: 'image' }],
			outputs: [{ name: 'scores', dims: [1, 1], dataType: 'float32', semantic: 'scores' }]
		},
		landmarks: {
			role: 'landmarks',
			format: 'onnx',
			url: '/models/beauty/landmarks.onnx',
			sizeBytes: 1,
			checksum: 'sha256-' + 'a'.repeat(64),
			license: 'Apache-2.0',
			source: 'https://example.invalid/landmarks',
			provider: 'LocalCut fixture',
			modelCard: 'https://example.invalid/landmark-card',
			inputs: [{ name: 'roi', dims: [1, 3, 256, 256], dataType: 'float32', semantic: 'image' }],
			outputs: [
				{ name: 'landmarks', dims: [1, 478, 3], dataType: 'float32', semantic: 'landmarks' }
			]
		}
	},
	topologyVersion: 1,
	landmarkCount: 478
};

describe('resolveExecutionProvider', () => {
	it('selects ORT-WebGPU when available', () => {
		expect(resolveExecutionProvider('webgpu', { webgpuAvailable: true })).toBe('webgpu');
	});

	it('requires per-model proof before selecting ORT-WebNN', () => {
		expect(
			resolveExecutionProvider('webnn', {
				webnnModelSupported: true,
				allowWasmReducedPath: true
			})
		).toBe('webnn');
		expect(resolveExecutionProvider('webnn', { allowWasmReducedPath: true })).toBe('wasm');
	});

	it('uses ORT-WASM only when the reduced/export-only path is explicit', () => {
		expect(resolveExecutionProvider('wasm', { allowWasmReducedPath: true })).toBe('wasm');
		expect(() => resolveExecutionProvider('wasm')).toThrow('No supported ORT execution provider');
	});
});

describe('createBeautySession', () => {
	it('creates a typed ORT scaffold session without loading runtime chunks', async () => {
		const session = await createBeautySession({
			assetBytes: {
				detector: new ArrayBuffer(1),
				landmarks: new ArrayBuffer(1)
			},
			executionProvider: 'wasm',
			manifest,
			allowWasmReducedPath: true
		});

		expect(session.status).toBe('ready');
		expect(session.executionProvider).toBe('wasm');
		expect(session.infer(new Float32Array(1), new Float32Array(1))).toBeNull();
		session.dispose();
		expect(session.status).toBe('disposed');
	});
});
