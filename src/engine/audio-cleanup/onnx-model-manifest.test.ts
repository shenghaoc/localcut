import { describe, expect, it } from 'vite-plus/test';
import { OnnxManifestError, validateOnnxCleanupManifest } from './onnx-model-manifest';
import { DTLN_BLOCK_LEN, DTLN_BLOCK_SHIFT, DTLN_SAMPLE_RATE } from './dtln-dsp';

function validInput(): Record<string, unknown> {
	return {
		id: 'dtln-onnx',
		version: 'test-1',
		license: 'MIT',
		source: 'https://example.invalid/dtln',
		provider: 'Example Author',
		modelCard: 'https://example.invalid/dtln#readme',
		format: 'onnx',
		sizeBytes: 2000,
		model1: {
			url: '/_model/gh/breizhn/DTLN/abc/pretrained_model/model_1.onnx',
			sizeBytes: 1000,
			checksum: 'sha256-' + 'a'.repeat(64)
		},
		model2: {
			url: '/_model/gh/breizhn/DTLN/abc/pretrained_model/model_2.onnx',
			sizeBytes: 1000,
			checksum: 'sha256-' + 'b'.repeat(64)
		},
		audio: {
			sampleRate: DTLN_SAMPLE_RATE,
			channels: 1,
			blockLen: DTLN_BLOCK_LEN,
			blockShift: DTLN_BLOCK_SHIFT
		},
		stateShape: [1, 2, 128, 2],
		executionProviders: ['wasm'],
		io: {
			model1: {
				magnitudeInput: 'input_2',
				stateInput: 'input_3',
				maskOutput: 'activation_2',
				stateOutput: 'tf_op_layer_stack_2'
			},
			model2: {
				frameInput: 'input_4',
				stateInput: 'input_5',
				frameOutput: 'conv1d_3',
				stateOutput: 'tf_op_layer_stack_5'
			}
		}
	};
}

describe('validateOnnxCleanupManifest', () => {
	it('accepts a valid manifest and tolerates unknown fields', () => {
		const manifest = validateOnnxCleanupManifest({ ...validInput(), futureField: true });
		expect(manifest.id).toBe('dtln-onnx');
		expect(manifest.format).toBe('onnx');
		expect(manifest.provider).toBe('Example Author');
		expect(manifest.executionProviders).toEqual(['wasm']);
		expect(manifest.io.model1.magnitudeInput).toBe('input_2');
		expect(manifest.io.model2.frameOutput).toBe('conv1d_3');
		expect(manifest.stateShape).toEqual([1, 2, 128, 2]);
	});

	it('rejects non-object documents', () => {
		expect(() => validateOnnxCleanupManifest(null)).toThrow(OnnxManifestError);
		expect(() => validateOnnxCleanupManifest('dtln')).toThrow(OnnxManifestError);
	});

	it.each([
		['id', { id: '' }],
		['version', { version: '' }],
		['license', { license: 42 }],
		['source', { source: undefined }],
		['provider', { provider: '' }],
		['modelCard', { modelCard: 7 }],
		['sizeBytes', { sizeBytes: -1 }]
	])('rejects invalid %s', (_field, patch) => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), ...patch })).toThrow(
			OnnxManifestError
		);
	});

	it('rejects a non-onnx format', () => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), format: 'tflite' })).toThrow(
			OnnxManifestError
		);
	});

	it('rejects model1 with an invalid checksum format', () => {
		const input = validInput();
		(input.model1 as Record<string, unknown>).checksum = 'md5-abc';
		expect(() => validateOnnxCleanupManifest(input)).toThrow(OnnxManifestError);
	});

	it('rejects model2 with a missing url', () => {
		const input = validInput();
		(input.model2 as Record<string, unknown>).url = '';
		expect(() => validateOnnxCleanupManifest(input)).toThrow(OnnxManifestError);
	});

	it('rejects when model1.sizeBytes + model2.sizeBytes !== sizeBytes', () => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), sizeBytes: 9999 })).toThrow(
			OnnxManifestError
		);
	});

	it.each([
		['sampleRate', { sampleRate: 48000 }],
		['channels', { channels: 2 }],
		['blockLen', { blockLen: 256 }],
		['blockShift', { blockShift: 64 }]
	])('rejects wrong audio.%s', (_field, patch) => {
		const input = validInput();
		input.audio = { ...(input.audio as Record<string, unknown>), ...patch };
		expect(() => validateOnnxCleanupManifest(input)).toThrow(OnnxManifestError);
	});

	it('rejects a non-array or non-positive stateShape', () => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), stateShape: 'no' })).toThrow(
			OnnxManifestError
		);
		expect(() => validateOnnxCleanupManifest({ ...validInput(), stateShape: [1, 0, 2] })).toThrow(
			OnnxManifestError
		);
	});

	it('rejects an empty or unknown execution provider list', () => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), executionProviders: [] })).toThrow(
			OnnxManifestError
		);
		expect(() =>
			validateOnnxCleanupManifest({ ...validInput(), executionProviders: ['cuda'] })
		).toThrow(OnnxManifestError);
	});

	it('rejects a missing or malformed io contract', () => {
		expect(() => validateOnnxCleanupManifest({ ...validInput(), io: undefined })).toThrow(
			OnnxManifestError
		);
		const input = validInput();
		delete (input.io as { model1: Record<string, unknown> }).model1.maskOutput;
		expect(() => validateOnnxCleanupManifest(input)).toThrow(OnnxManifestError);
	});
});

describe('shipped ONNX manifest asset', () => {
	it('validates the checked-in dtln-onnx manifest.json', async () => {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const { fileURLToPath } = await import('node:url');
		const root = path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			'../../../public/models/dtln-onnx'
		);
		const manifestJson = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf-8'));
		const manifest = validateOnnxCleanupManifest(manifestJson);
		expect(manifest.id).toBe('dtln-onnx');
		expect(manifest.license).toBe('MIT');
		expect(manifest.model1.url).toMatch(/model_1\.onnx/);
		expect(manifest.model2.url).toMatch(/model_2\.onnx/);
		expect(manifest.audio.sampleRate).toBe(DTLN_SAMPLE_RATE);
		expect(manifest.stateShape).toEqual([1, 2, 128, 2]);
		expect(manifest.executionProviders).toEqual(['wasm']);
		// IO names must match the actual upstream ONNX graph (verified on import).
		expect(manifest.io.model1.magnitudeInput).toBe('input_2');
		expect(manifest.io.model1.stateInput).toBe('input_3');
		expect(manifest.io.model1.maskOutput).toBe('activation_2');
		expect(manifest.io.model2.frameInput).toBe('input_4');
		expect(manifest.io.model2.frameOutput).toBe('conv1d_3');
	});
});
