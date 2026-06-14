import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

function flushQueue(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('cleanup-worker', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		vi.unstubAllGlobals();
	});

	it('drops stale cleanup-end results once the load generation changes', async () => {
		const messages: unknown[] = [];
		let resolveFinalize!: (value: Float32Array) => void;
		const runtime = {
			accelerator: 'wasm' as const,
			resetState: vi.fn(),
			destroy: vi.fn()
		};
		const processor = {
			abort: vi.fn(),
			push: vi.fn(async () => new Float32Array(0)),
			finalize: vi.fn(
				() =>
					new Promise<Float32Array>((resolve) => {
						resolveFinalize = resolve;
					})
			),
			inputSampleCount: 4
		};
		const fakeSelf = {
			postMessage: vi.fn((message: unknown) => {
				messages.push(message);
			}),
			close: vi.fn(),
			location: { origin: 'http://localhost:5173' },
			onmessage: null as ((event: MessageEvent) => void) | null
		};

		vi.stubGlobal('self', fakeSelf);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({})
			}))
		);

		vi.doMock('../asr/asset-cache', () => ({
			createOpfsAssetStore: vi.fn(async () => ({})),
			loadVerifiedAsset: vi.fn(async () => new Uint8Array([1]))
		}));
		vi.doMock('./model-manifest', () => ({
			validateManifest: vi.fn(() => ({
				version: '1.0.0',
				sizeBytes: 2,
				model1: { url: '/m1.tflite', sizeBytes: 1, checksum: 'sha256-a' },
				model2: { url: '/m2.tflite', sizeBytes: 1, checksum: 'sha256-b' },
				stateShape: [1, 1, 1, 1]
			}))
		}));
		vi.doMock('./dtln-runtime', () => ({
			DtlnRuntime: {
				create: vi.fn(async () => runtime)
			}
		}));
		vi.doMock('./cleanup-jobs', () => ({
			CleanupCancelledError: class CleanupCancelledError extends Error {},
			CleanupJobProcessor: class CleanupJobProcessorMock {
				constructor() {
					return processor as unknown as CleanupJobProcessorMock;
				}
			},
			concatPcm: vi.fn((chunks: readonly Float32Array[]) => {
				const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
				const out = new Float32Array(total);
				let offset = 0;
				for (const chunk of chunks) {
					out.set(chunk, offset);
					offset += chunk.length;
				}
				return out;
			}),
			downmixToMono: vi.fn((pcm: Float32Array) => pcm),
			trimDtlnOutputToInput: vi.fn((rawPcm: Float32Array) => rawPcm)
		}));
		vi.doMock('../audio-resampler', () => ({
			AudioResampler: vi.fn()
		}));
		vi.doMock('./dtln-dsp', () => ({
			DtlnDsp: class DtlnDspMock {},
			DTLN_BLOCK_SHIFT: 128,
			DTLN_SAMPLE_RATE: 16_000
		}));
		vi.doMock('./wav', () => ({
			encodeWavPcm16: vi.fn()
		}));

		await import('./cleanup-worker');

		fakeSelf.onmessage?.({
			data: {
				type: 'cleanup-load-model',
				manifestUrl: '/models/dtln/manifest.json',
				wasmPath: '/litert/',
				preferredAccelerator: 'wasm'
			}
		} as MessageEvent);
		await flushQueue();
		fakeSelf.onmessage?.({
			data: { type: 'cleanup-begin', jobId: 7, totalFrames: 1 }
		} as MessageEvent);
		await flushQueue();
		fakeSelf.onmessage?.({
			data: { type: 'cleanup-end', jobId: 7, output: 'pcm' }
		} as MessageEvent);
		await vi.waitFor(() => expect(processor.finalize).toHaveBeenCalledTimes(1));
		fakeSelf.onmessage?.({
			data: { type: 'cleanup-cancel' }
		} as MessageEvent);

		resolveFinalize(new Float32Array([1, 2, 3, 4]));
		await flushQueue();

		expect(messages).not.toContainEqual(
			expect.objectContaining({ type: 'cleanup-result', jobId: 7 })
		);
	});
});
