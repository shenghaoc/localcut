import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AsrModelManifestSnapshot } from '../../protocol';
import { loadLiteRtModule } from './litert-loader';
import {
	createLiteRtWhisperRuntime,
	liteRtCompileOptionsForAccelerator,
	liteRtLoadOptionsForAccelerator
} from './litert-runtime';

vi.mock('./litert-loader', () => ({
	loadLiteRtModule: vi.fn()
}));

const MANIFEST: AsrModelManifestSnapshot = {
	id: 'whisper-test',
	version: 'test',
	license: 'MIT',
	source: 'local',
	sizeBytes: 2,
	model: { url: '/model.tflite', sizeBytes: 1, checksum: 'sha256-0'.padEnd(71, '0') },
	tokenizer: { url: '/vocab.json', sizeBytes: 1, checksum: 'sha256-0'.padEnd(71, '0') },
	audio: {
		sampleRate: 16000,
		channels: 1,
		hopLength: 160,
		nMel: 80,
		chunkLengthS: 30
	},
	maxDecodeTokens: 4,
	vocabSize: 3,
	encoderFramesPerSecond: 50,
	tokens: {
		startOfTranscript: 0,
		endOfText: 1,
		transcribe: 2,
		noTimestamps: 3,
		noSpeech: 4,
		timestampBegin: 5,
		language: { en: 6 }
	},
	languages: ['en'],
	defaultLanguage: 'en',
	decode: null
};

interface FakeTensor {
	data: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
}

function tensor(data: ArrayLike<number> | Error = new Float32Array([0, 1, 2])): FakeTensor {
	return {
		data: vi.fn(() => (data instanceof Error ? Promise.reject(data) : Promise.resolve(data))),
		delete: vi.fn()
	};
}

function fakeApi(modelOverrides: Partial<{ run: ReturnType<typeof vi.fn> }> = {}) {
	const model = {
		run: modelOverrides.run ?? vi.fn(async () => [tensor()]),
		delete: vi.fn()
	};
	const created: FakeTensor[] = [];
	const api = {
		loadLiteRt: vi.fn(async () => undefined),
		loadAndCompile: vi.fn(async () => model),
		Tensor: {
			fromTypedArray: vi.fn(() => {
				const next = tensor();
				created.push(next);
				return next;
			})
		}
	};
	vi.mocked(loadLiteRtModule).mockResolvedValue(api);
	return { api, model, created };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('LiteRT accelerator options', () => {
	it('uses the documented LiteRT options for WebGPU and WebNN', () => {
		expect(liteRtLoadOptionsForAccelerator('webgpu')).toEqual({ threads: false });
		expect(liteRtCompileOptionsForAccelerator('webgpu')).toEqual({ accelerator: 'webgpu' });
		expect(liteRtLoadOptionsForAccelerator('webnn')).toEqual({ threads: false, jspi: true });
		expect(liteRtCompileOptionsForAccelerator('webnn')).toEqual({
			accelerator: 'webnn',
			webNNOptions: { devicePreference: 'npu' }
		});
	});

	it('loads the JSPI runtime and compiles with WebNN options when WebNN is requested', async () => {
		const { api } = fakeApi();
		const bytes = new Uint8Array([1, 2, 3]);

		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: '/litert/',
			accelerator: 'webnn',
			modelBytes: bytes,
			manifest: MANIFEST
		});

		expect(runtime.accelerator).toBe('webnn');
		expect(api.loadLiteRt).toHaveBeenCalledWith('/litert/', { threads: false, jspi: true });
		expect(api.loadAndCompile).toHaveBeenCalledWith(bytes, {
			accelerator: 'webnn',
			webNNOptions: { devicePreference: 'npu' }
		});
	});

	it('tries WebNN device preferences before falling back to WASM', async () => {
		const { api } = fakeApi();
		const bytes = new Uint8Array([4, 5, 6]);
		const gpuModel = { run: vi.fn(), delete: vi.fn() };
		api.loadAndCompile
			.mockRejectedValueOnce(new Error('NPU unavailable'))
			.mockResolvedValueOnce(gpuModel);

		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: '/litert/',
			accelerator: 'webnn',
			modelBytes: bytes,
			manifest: MANIFEST
		});

		expect(runtime.accelerator).toBe('webnn');
		expect(api.loadAndCompile).toHaveBeenNthCalledWith(1, bytes, {
			accelerator: 'webnn',
			webNNOptions: { devicePreference: 'npu' }
		});
		expect(api.loadAndCompile).toHaveBeenNthCalledWith(2, bytes, {
			accelerator: 'webnn',
			webNNOptions: { devicePreference: 'gpu' }
		});
		expect(api.loadAndCompile).not.toHaveBeenCalledWith(bytes, { accelerator: 'wasm' });
	});

	it('falls back to the non-JSPI WASM runtime when WebNN load fails', async () => {
		const { api } = fakeApi();
		const bytes = new Uint8Array([7, 8, 9]);
		api.loadLiteRt
			.mockRejectedValueOnce(new Error('JSPI unavailable'))
			.mockResolvedValueOnce(undefined);

		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: '/litert/',
			accelerator: 'webnn',
			modelBytes: bytes,
			manifest: MANIFEST
		});

		expect(runtime.accelerator).toBe('wasm');
		expect(api.loadLiteRt).toHaveBeenNthCalledWith(1, '/litert/', {
			threads: false,
			jspi: true
		});
		expect(api.loadLiteRt).toHaveBeenNthCalledWith(2, '/litert/', { threads: false });
		expect(api.loadAndCompile).toHaveBeenCalledWith(bytes, { accelerator: 'wasm' });
	});

	it('falls back to WASM when an accelerated compile fails', async () => {
		const { api } = fakeApi();
		api.loadAndCompile
			.mockRejectedValueOnce(new Error('GPU compile failed'))
			.mockResolvedValueOnce({ run: vi.fn(), delete: vi.fn() });

		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: '/litert/',
			accelerator: 'webgpu',
			modelBytes: new Uint8Array([1]),
			manifest: MANIFEST
		});

		expect(runtime.accelerator).toBe('wasm');
		expect(api.loadAndCompile).toHaveBeenNthCalledWith(2, new Uint8Array([1]), {
			accelerator: 'wasm'
		});
	});

	it('deletes decode outputs even when reading logits rejects', async () => {
		const hidden = tensor();
		const logits = tensor(new Error('read failed'));
		const run = vi.fn(async (signature: string) => (signature === 'encode' ? [hidden] : [logits]));
		const { created } = fakeApi({ run });
		const runtime = await createLiteRtWhisperRuntime({
			wasmPath: '/litert/',
			accelerator: 'wasm',
			modelBytes: new Uint8Array([1]),
			manifest: MANIFEST
		});

		const encoded = await runtime.encode({
			data: new Float32Array(80),
			nMel: 80,
			nFrames: 1
		});
		await expect(runtime.decode(new Int32Array([0]), encoded)).rejects.toThrow('read failed');

		expect(logits.delete).toHaveBeenCalledTimes(1);
		expect(created[2]?.delete).toHaveBeenCalledTimes(1);
	});
});
