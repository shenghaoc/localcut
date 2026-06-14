import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { loadLiteRtModule } from '../asr/litert-loader';
import { DtlnRuntime } from './dtln-runtime';

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
	vi.mocked(loadLiteRtModule).mockResolvedValue(api);
	return api;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('DtlnRuntime', () => {
	it('deletes model1 if WASM fallback compiles model1 but fails model2', async () => {
		const api = fakeApi();
		const wasmModel1 = compiledModel();
		const model2Failure = new Error('model2 compile failed');
		api.loadAndCompile
			.mockRejectedValueOnce(new Error('webgpu compile failed'))
			.mockResolvedValueOnce(wasmModel1)
			.mockRejectedValueOnce(model2Failure);

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
