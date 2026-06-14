import { describe, expect, it } from 'vite-plus/test';
import { ManifestError, validateManifest } from './model-manifest';
import { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE } from './dtln-dsp';

function validManifestInput(): Record<string, unknown> {
	return {
		id: 'dtln',
		version: 'test-1',
		license: 'MIT',
		source: 'https://example.invalid/dtln',
		sizeBytes: 2000,
		model1: {
			url: '/_model/gh/breizhn/DTLN/master/model_1.tflite',
			sizeBytes: 1000,
			checksum: 'sha256-' + 'a'.repeat(64)
		},
		model2: {
			url: '/_model/gh/breizhn/DTLN/master/model_2.tflite',
			sizeBytes: 1000,
			checksum: 'sha256-' + 'b'.repeat(64)
		},
		audio: {
			sampleRate: DTLN_SAMPLE_RATE,
			channels: 1,
			blockLen: DTLN_BLOCK_LEN,
			blockShift: DTLN_BLOCK_SHIFT
		},
		stateShape: [1, 2, 128, 2]
	};
}

describe('validateManifest', () => {
	it('accepts a valid manifest and tolerates unknown fields', () => {
		const input = { ...validManifestInput(), futureField: true };
		const manifest = validateManifest(input);
		expect(manifest.version).toBe('test-1');
		expect(manifest.model1.sizeBytes).toBe(1000);
		expect(manifest.model2.sizeBytes).toBe(1000);
		expect(manifest.audio.sampleRate).toBe(DTLN_SAMPLE_RATE);
		expect(manifest.stateShape).toEqual([1, 2, 128, 2]);
	});

	it('rejects non-object documents', () => {
		expect(() => validateManifest(null)).toThrow(ManifestError);
		expect(() => validateManifest('dtln')).toThrow(ManifestError);
	});

	it.each([
		['id', { id: '' }],
		['version', { version: '' }],
		['license', { license: 42 }],
		['source', { source: undefined }],
		['sizeBytes', { sizeBytes: -1 }]
	])('rejects invalid %s', (_field, patch) => {
		expect(() => validateManifest({ ...validManifestInput(), ...patch })).toThrow(ManifestError);
	});

	it('rejects model1 with invalid checksum format', () => {
		const input = validManifestInput();
		(input.model1 as Record<string, unknown>).checksum = 'md5-abc';
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects model2 with missing url', () => {
		const input = validManifestInput();
		(input.model2 as Record<string, unknown>).url = '';
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects when model1.sizeBytes + model2.sizeBytes !== sizeBytes', () => {
		const input = validManifestInput();
		input.sizeBytes = 9999;
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects wrong audio.sampleRate', () => {
		const input = validManifestInput();
		(input.audio as Record<string, unknown>).sampleRate = 48000;
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects wrong audio.channels', () => {
		const input = validManifestInput();
		(input.audio as Record<string, unknown>).channels = 2;
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects non-array stateShape', () => {
		const input = validManifestInput();
		input.stateShape = 'invalid';
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});

	it('rejects stateShape with non-positive integers', () => {
		const input = validManifestInput();
		input.stateShape = [1, 0, 128];
		expect(() => validateManifest(input)).toThrow(ManifestError);
	});
});

describe('shipped manifest asset', () => {
	it('validates the checked-in manifest.json', async () => {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const { fileURLToPath } = await import('node:url');
		const root = path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			'../../../public/models/dtln'
		);
		const manifestJson = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf-8'));
		const manifest = validateManifest(manifestJson);
		expect(manifest.id).toBe('dtln');
		expect(manifest.model1.url).toMatch(/model_1\.tflite/);
		expect(manifest.model2.url).toMatch(/model_2\.tflite/);
		expect(manifest.audio.sampleRate).toBe(DTLN_SAMPLE_RATE);
		expect(manifest.stateShape).toEqual([1, 2, 128, 2]);
	});
});
