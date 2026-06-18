import { describe, expect, it } from 'vite-plus/test';

import { MatteOnnxManifestError, validateMatteOnnxManifest } from './matte-onnx-model';
// The actual shipped manifest, imported as raw text so the test pins the real
// deployed artifact (not a copy that could drift).
import shippedManifestRaw from '../../../public/models/matte-onnx/manifest.json?raw';

/** A minimal valid ONNX matte manifest; individual tests override single fields. */
function validManifest(): Record<string, unknown> {
	return {
		id: 'modnet-onnx-matte',
		version: '1.0.0',
		license: 'Apache-2.0',
		source: 'https://github.com/ZHKKKe/MODNet',
		format: 'onnx',
		frameCoupled: true,
		executionProviders: ['webgpu'],
		tensorLocation: 'gpu-buffer',
		model: {
			url: 'https://huggingface.co/org/modnet/resolve/main/modnet.onnx',
			sizeBytes: 26000000,
			checksum: 'sha256-' + 'a'.repeat(64)
		},
		io: {
			layout: 'nchw',
			inputWidth: 512,
			inputHeight: 512,
			inputChannels: 3,
			bytesPerElement: 4,
			inputName: 'input',
			inputRange: 'signed-unit',
			outputName: 'output',
			outputLayout: 'nchw',
			outputChannels: 1,
			outputRange: 'unit'
		}
	};
}

function withIo(overrides: Record<string, unknown>): Record<string, unknown> {
	const base = validManifest();
	return { ...base, io: { ...(base.io as Record<string, unknown>), ...overrides } };
}

describe('validateMatteOnnxManifest', () => {
	it('accepts a well-formed ONNX matte manifest', () => {
		const m = validateMatteOnnxManifest(validManifest());
		expect(m.id).toBe('modnet-onnx-matte');
		expect(m.format).toBe('onnx');
		expect(m.frameCoupled).toBe(true);
		expect(m.executionProviders).toEqual(['webgpu']);
		expect(m.io.layout).toBe('nchw');
		expect(m.io.inputName).toBe('input');
		expect(m.io.inputRange).toBe('signed-unit');
		expect(m.io.outputName).toBe('output');
		expect(m.io.outputChannels).toBe(1);
		expect(m.io.outputRange).toBe('unit');
	});

	it('normalizes the model checksum case', () => {
		const m = validateMatteOnnxManifest({
			...validManifest(),
			model: { ...(validManifest().model as object), checksum: 'sha256-' + 'A'.repeat(64) }
		});
		expect(m.model.checksum).toBe('sha256-' + 'a'.repeat(64));
	});

	// ── Template / disabled gate (keeps the experimental backend dark) ──

	it('rejects a placeholder/template manifest so the backend stays disabled', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), template: true })).toThrow(
			/placeholder template/
		);
	});

	// ── License gate (copyleft rejected) ──

	it('rejects an abbreviated copyleft license (e.g. RVM)', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), license: 'GPL-3.0' })).toThrow(
			/copyleft license/
		);
		expect(() =>
			validateMatteOnnxManifest({ ...validManifest(), license: 'AGPL-3.0-only' })
		).toThrow(MatteOnnxManifestError);
		expect(() => validateMatteOnnxManifest({ ...validManifest(), license: 'LGPL-2.1' })).toThrow(
			MatteOnnxManifestError
		);
	});

	it('rejects spelled-out copyleft licenses, not just the SPDX abbreviation', () => {
		expect(() =>
			validateMatteOnnxManifest({ ...validManifest(), license: 'GNU General Public License v3.0' })
		).toThrow(/copyleft license/);
		expect(() =>
			validateMatteOnnxManifest({
				...validManifest(),
				license: 'GNU Affero General Public License'
			})
		).toThrow(MatteOnnxManifestError);
	});

	it('accepts permissive licenses (Apache-2.0, MIT, BSD)', () => {
		for (const license of ['Apache-2.0', 'MIT', 'BSD-3-Clause']) {
			expect(validateMatteOnnxManifest({ ...validManifest(), license }).license).toBe(license);
		}
	});

	// ── Frame-coupled EP hard gate (no WASM/CPU per-frame fallback) ──

	it('rejects a non-frame-coupled manifest', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), frameCoupled: false })).toThrow(
			/must declare "frameCoupled": true/
		);
	});

	it('rejects a frame-coupled manifest that pins the wasm EP', () => {
		expect(() =>
			validateMatteOnnxManifest({ ...validManifest(), executionProviders: ['wasm'] })
		).toThrow(/must not use \[wasm\]/);
	});

	it('rejects a frame-coupled manifest with no GPU-class EP', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), executionProviders: [] })).toThrow(
			MatteOnnxManifestError
		);
	});

	it('rejects a frame-coupled manifest that pins tensorLocation cpu', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), tensorLocation: 'cpu' })).toThrow(
			MatteOnnxManifestError
		);
	});

	// ── EP gate: the backend runs only the WebGPU path (WebNN needs op-support proof) ──

	it('rejects a WebNN-pinned manifest (no WebNN tensor path yet)', () => {
		expect(() =>
			validateMatteOnnxManifest({ ...validManifest(), executionProviders: ['webnn'] })
		).toThrow(/exactly \["webgpu"\]/);
	});

	it('rejects a webgpu+webnn manifest (must be webgpu-only)', () => {
		expect(() =>
			validateMatteOnnxManifest({ ...validManifest(), executionProviders: ['webgpu', 'webnn'] })
		).toThrow(/exactly \["webgpu"\]/);
	});

	// ── Base manifest integrity ──

	it('rejects a non-object manifest', () => {
		expect(() => validateMatteOnnxManifest(null)).toThrow(MatteOnnxManifestError);
		expect(() => validateMatteOnnxManifest('x')).toThrow(MatteOnnxManifestError);
	});

	it('rejects a format other than onnx', () => {
		expect(() => validateMatteOnnxManifest({ ...validManifest(), format: 'json' })).toThrow(
			/"format" must be "onnx"/
		);
	});

	it('rejects a malformed model checksum', () => {
		expect(() =>
			validateMatteOnnxManifest({
				...validManifest(),
				model: { ...(validManifest().model as object), checksum: 'md5-deadbeef' }
			})
		).toThrow(/must be "sha256-" followed by 64 hex digits/);
	});

	// ── Matte IO + output contract ──

	it('rejects an io with an invalid input layout', () => {
		expect(() => validateMatteOnnxManifest(withIo({ layout: 'abc' }))).toThrow(
			/io.layout must be "nchw" or "nhwc"/
		);
	});

	it('rejects a non-positive input dimension', () => {
		expect(() => validateMatteOnnxManifest(withIo({ inputWidth: 0 }))).toThrow(
			/io.inputWidth must be a positive integer/
		);
	});

	it('requires RGB (inputChannels = 3)', () => {
		expect(() => validateMatteOnnxManifest(withIo({ inputChannels: 1 }))).toThrow(
			/io.inputChannels must be 3/
		);
	});

	it('requires FP32 (bytesPerElement = 4)', () => {
		expect(() => validateMatteOnnxManifest(withIo({ bytesPerElement: 2 }))).toThrow(
			/io.bytesPerElement must be 4/
		);
	});

	it('rejects a missing input/output name', () => {
		expect(() => validateMatteOnnxManifest(withIo({ inputName: '' }))).toThrow(
			/io.inputName must be a non-empty string/
		);
		expect(() => validateMatteOnnxManifest(withIo({ outputName: '' }))).toThrow(
			/io.outputName must be a non-empty string/
		);
	});

	it('rejects an unknown inputRange', () => {
		expect(() => validateMatteOnnxManifest(withIo({ inputRange: 'percent' }))).toThrow(
			/io.inputRange must be "unit" or "signed-unit"/
		);
	});

	it('accepts the unit inputRange (sigmoid-style normalization)', () => {
		expect(validateMatteOnnxManifest(withIo({ inputRange: 'unit' })).io.inputRange).toBe('unit');
	});

	it('requires a single-channel alpha output (outputChannels = 1)', () => {
		expect(() => validateMatteOnnxManifest(withIo({ outputChannels: 2 }))).toThrow(
			/io.outputChannels must be 1/
		);
	});

	it('requires a unit-range alpha output and explains signed-unit is unsupported', () => {
		expect(() => validateMatteOnnxManifest(withIo({ outputRange: 'signed-unit' }))).toThrow(
			/"signed-unit" is not yet supported/
		);
		expect(() => validateMatteOnnxManifest(withIo({ outputRange: 'logit' }))).toThrow(
			/io.outputRange must be "unit"/
		);
	});

	it('rejects an invalid output layout', () => {
		expect(() => validateMatteOnnxManifest(withIo({ outputLayout: 'xyz' }))).toThrow(
			/io.outputLayout must be "nchw" or "nhwc"/
		);
	});

	it('tolerates unknown fields (forward-compatible)', () => {
		const extra = {
			...validManifest(),
			extra: 'ignored',
			io: { ...(validManifest().io as object), extraIo: 7 }
		};
		expect(() => validateMatteOnnxManifest(extra)).not.toThrow();
	});
});

describe('shipped matte-onnx manifest', () => {
	it('is a valid JSON document', () => {
		expect(() => JSON.parse(shippedManifestRaw)).not.toThrow();
	});

	it('pins the shipped MODNet ONNX model and passes validation', () => {
		const doc = JSON.parse(shippedManifestRaw) as Record<string, unknown>;
		expect(doc.template).toBeUndefined();
		const manifest = validateMatteOnnxManifest(doc);
		expect(manifest.id).toBe('modnet-onnx-matte');
		expect(manifest.license).toBe('Apache-2.0');
		expect(manifest.model.sizeBytes).toBe(25_888_640);
		expect(manifest.model.checksum).toBe(
			'sha256-07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9'
		);
		expect(manifest.executionProviders).toEqual(['webgpu']);
		expect(manifest.tensorLocation).toBe('gpu-buffer');
		expect(manifest.io.inputWidth).toBe(256);
		expect(manifest.io.inputHeight).toBe(256);
		expect(manifest.io.inputName).toBe('input');
		expect(manifest.io.outputName).toBe('output');
	});
});
