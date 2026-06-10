import { describe, expect, it } from 'vitest';
import {
	ManifestError,
	parseNpy,
	RNNOISE_TENSOR_NAMES,
	unpackWeights,
	validateManifest,
	verifyWeights,
	type CleanupModelManifest
} from './model-manifest';

function npyBytes(shape: number[], values: number[]): Uint8Array {
	const headerDict = `{ 'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}) }`;
	let header = headerDict;
	const unpadded = 10 + header.length + 1;
	const padding = (64 - (unpadded % 64)) % 64;
	header = header + ' '.repeat(padding) + '\n';
	const bytes = new Uint8Array(10 + header.length + values.length * 4);
	bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
	new DataView(bytes.buffer).setUint16(8, header.length, true);
	for (let i = 0; i < header.length; i++) bytes[10 + i] = header.charCodeAt(i);
	new Float32Array(bytes.buffer, 10 + header.length, values.length).set(values);
	return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function packedFixture(): Promise<{ manifest: CleanupModelManifest; bytes: ArrayBuffer }> {
	const parts: Uint8Array[] = [];
	const tensors: Array<{ name: string; byteOffset: number; byteLength: number }> = [];
	let offset = 0;
	for (const name of RNNOISE_TENSOR_NAMES) {
		const part = npyBytes([2, 3], [1, 2, 3, 4, 5, 6]);
		tensors.push({ name, byteOffset: offset, byteLength: part.length });
		parts.push(part);
		offset += part.length;
	}
	const blob = new Uint8Array(offset);
	let cursor = 0;
	for (const part of parts) {
		blob.set(part, cursor);
		cursor += part.length;
	}
	const manifest = validateManifest({
		id: 'rnnoise',
		version: 'test-1',
		license: 'BSD-3-Clause',
		source: 'https://example.invalid/rnnoise',
		sizeBytes: blob.length,
		checksum: `sha256-${await sha256Hex(blob)}`,
		audio: { sampleRate: 48000, channels: 1, frameSize: 480 },
		tensors
	});
	return { manifest, bytes: blob.slice().buffer };
}

describe('validateManifest', () => {
	it('accepts a valid manifest and tolerates unknown fields', async () => {
		const { manifest } = await packedFixture();
		const withExtra = { ...manifest, futureField: true };
		expect(validateManifest(withExtra).version).toBe('test-1');
	});

	it('rejects non-object documents', () => {
		expect(() => validateManifest(null)).toThrow(ManifestError);
		expect(() => validateManifest('rnnoise')).toThrow(ManifestError);
	});

	it.each([
		['id', { id: 'other' }],
		['version', { version: '' }],
		['license', { license: 42 }],
		['source', { source: undefined }],
		['sizeBytes', { sizeBytes: -1 }],
		['checksum', { checksum: 'md5-abc' }],
		['audio.sampleRate', { audio: { sampleRate: 44100, channels: 1, frameSize: 480 } }],
		['audio.channels', { audio: { sampleRate: 48000, channels: 2, frameSize: 480 } }],
		['tensors', { tensors: 'none' }]
	])('rejects invalid %s with a specific reason', async (_field, patch) => {
		const { manifest } = await packedFixture();
		expect(() => validateManifest({ ...manifest, ...patch })).toThrow(ManifestError);
	});

	it('rejects a manifest missing a required tensor', async () => {
		const { manifest } = await packedFixture();
		const tensors = manifest.tensors.filter((t) => t.name !== 'vad_gru_W');
		expect(() => validateManifest({ ...manifest, tensors })).toThrow(/vad_gru_W/);
	});

	it('rejects tensor ranges that exceed the declared size', async () => {
		const { manifest } = await packedFixture();
		const tensors = manifest.tensors.map((t, i) =>
			i === 0 ? { ...t, byteLength: manifest.sizeBytes + 1 } : t
		);
		expect(() => validateManifest({ ...manifest, tensors })).toThrow(/exceeds/);
	});
});

describe('verifyWeights', () => {
	it('accepts bytes matching size and checksum', async () => {
		const { manifest, bytes } = await packedFixture();
		await expect(verifyWeights(manifest, bytes)).resolves.toBeUndefined();
	});

	it('rejects a size mismatch as a hard error', async () => {
		const { manifest, bytes } = await packedFixture();
		await expect(verifyWeights(manifest, bytes.slice(0, bytes.byteLength - 1))).rejects.toThrow(
			/size mismatch/
		);
	});

	it('rejects a checksum mismatch as a hard error', async () => {
		const { manifest, bytes } = await packedFixture();
		const tampered = bytes.slice();
		new Uint8Array(tampered)[tampered.byteLength - 1]! ^= 0xff;
		await expect(verifyWeights(manifest, tampered)).rejects.toThrow(/checksum mismatch/);
	});
});

describe('parseNpy / unpackWeights', () => {
	it('parses little-endian float32 tensors with shape', () => {
		const bytes = npyBytes([2, 3], [1, 2, 3, 4, 5, 6]);
		const tensor = parseNpy(bytes.slice().buffer, 0, bytes.length);
		expect(tensor.shape).toEqual([2, 3]);
		expect([...tensor.data]).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('parses one-dimensional tensors (trailing-comma shape)', () => {
		const bytes = npyBytes([4], [9, 8, 7, 6]);
		const tensor = parseNpy(bytes.slice().buffer, 0, bytes.length);
		expect(tensor.shape).toEqual([4]);
	});

	it('rejects bad magic and truncated data', () => {
		const bytes = npyBytes([2], [1, 2]);
		const bad = bytes.slice();
		bad[0] = 0;
		expect(() => parseNpy(bad.slice().buffer, 0, bad.length)).toThrow(/magic/);
		expect(() => parseNpy(bytes.slice().buffer, 0, bytes.length - 4)).toThrow(/truncated/);
	});

	it('unpacks every tensor declared by the manifest', async () => {
		const { manifest, bytes } = await packedFixture();
		const weights = unpackWeights(manifest, bytes);
		expect(weights.size).toBe(RNNOISE_TENSOR_NAMES.length);
		for (const name of RNNOISE_TENSOR_NAMES) {
			expect(weights.get(name)?.shape).toEqual([2, 3]);
		}
	});
});

describe('shipped manifest asset', () => {
	it('matches the packed weights asset byte-for-byte', async () => {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const { fileURLToPath } = await import('node:url');
		const root = path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			'../../../public/models/rnnoise'
		);
		const manifestJson = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf-8'));
		const manifest = validateManifest(manifestJson);
		const weights = await fs.readFile(path.join(root, 'weights.bin'));
		const copy = new Uint8Array(weights.byteLength);
		copy.set(weights);
		const bytes = copy.buffer;
		await expect(verifyWeights(manifest, bytes)).resolves.toBeUndefined();
		const unpacked = unpackWeights(manifest, bytes);
		// Spot-check the published RNNoise GRU shapes.
		expect(unpacked.get('input_dense_kernel_0')?.shape).toEqual([42, 24]);
		expect(unpacked.get('vad_gru_W')?.shape).toEqual([1, 72, 24]);
		expect(unpacked.get('noise_gru_W')?.shape).toEqual([1, 144, 90]);
		expect(unpacked.get('denoise_gru_W')?.shape).toEqual([1, 288, 114]);
		expect(unpacked.get('denoise_output_kernel_0')?.shape).toEqual([96, 22]);
	});
});
