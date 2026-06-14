import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../asr/litert-loader', () => ({
	loadLiteRtModule: vi.fn()
}));

interface FakeCompiledModel {
	run: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
}

function compiledModel(): FakeCompiledModel {
	return {
		run: vi.fn(),
		delete: vi.fn()
	};
}

function fakeApi() {
	const api = {
		loadLiteRt: vi.fn(async () => undefined),
		loadAndCompile: vi.fn(),
		Tensor: {
			fromTypedArray: vi.fn()
		}
	};
	return api;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('DtlnRuntime', () => {
	it('reloads LiteRT when a later create needs different load options', async () => {
		const api = fakeApi();
		const { loadLiteRtModule } = await import('../asr/litert-loader');
		vi.mocked(loadLiteRtModule).mockResolvedValue(api);
		api.loadAndCompile.mockImplementation(async () => compiledModel());
		const { DtlnRuntime } = await import('./dtln-runtime');

		const webnn = await DtlnRuntime.create({
			wasmPath: '/litert/',
			accelerator: 'webnn',
			model1Bytes: new Uint8Array([1]),
			model2Bytes: new Uint8Array([2]),
			stateShape: [1, 2, 128, 2]
		});
		webnn.destroy();

		const webgpu = await DtlnRuntime.create({
			wasmPath: '/litert/',
			accelerator: 'webgpu',
			model1Bytes: new Uint8Array([3]),
			model2Bytes: new Uint8Array([4]),
			stateShape: [1, 2, 128, 2]
		});
		webgpu.destroy();

		expect(api.loadLiteRt).toHaveBeenNthCalledWith(1, '/litert/', {
			threads: false,
			jspi: true
		});
		expect(api.loadLiteRt).toHaveBeenNthCalledWith(2, '/litert/', { threads: false });
	});

	it('deletes model1 if WASM fallback compiles model1 but fails model2', async () => {
		const api = fakeApi();
		const { loadLiteRtModule } = await import('../asr/litert-loader');
		vi.mocked(loadLiteRtModule).mockResolvedValue(api);
		const wasmModel1 = compiledModel();
		const model2Failure = new Error('model2 compile failed');
		api.loadAndCompile
			.mockRejectedValueOnce(new Error('webgpu compile failed'))
			.mockResolvedValueOnce(wasmModel1)
			.mockRejectedValueOnce(model2Failure);
		const { DtlnRuntime } = await import('./dtln-runtime');

		await expect(
			DtlnRuntime.create({
				wasmPath: '/litert/',
				accelerator: 'webgpu',
				model1Bytes: new Uint8Array([1]),
				model2Bytes: new Uint8Array([2]),
				stateShape: [1, 2, 128, 2]
			})
		).rejects.toThrow(model2Failure);

		expect(wasmModel1.delete).toHaveBeenCalledTimes(1);
	});
});
