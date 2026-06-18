import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

function flushQueue(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeSelf {
	postMessage: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	location: { origin: string };
	onmessage: ((event: MessageEvent) => void) | null;
}

interface WorkerHarness {
	messages: unknown[];
	fakeSelf: FakeSelf;
	processor: { abort: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> };
	/** Resolves the pending `finalize()` promise (set once finalize is called). */
	finishFinalize: (value: Float32Array) => void;
}

/** Wires the worker's module + global dependencies to controllable fakes. The
 *  processor's `finalize()` stays pending until `finishFinalize` is called, so
 *  tests can interleave a cancel between `cleanup-end` and the result. */
function setupWorkerMocks(): WorkerHarness {
	const messages: unknown[] = [];
	const holder = { resolveFinalize: (_value: Float32Array) => {} };
	const runtime = { accelerator: 'wasm' as const, resetState: vi.fn(), destroy: vi.fn() };
	const processor = {
		abort: vi.fn(),
		push: vi.fn(async () => new Float32Array(0)),
		finalize: vi.fn(
			() =>
				new Promise<Float32Array>((resolve) => {
					holder.resolveFinalize = resolve;
				})
		),
		inputSampleCount: 4
	};
	const fakeSelf: FakeSelf = {
		postMessage: vi.fn((message: unknown) => {
			messages.push(message);
		}),
		close: vi.fn(),
		location: { origin: 'http://localhost:5173' },
		onmessage: null
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
	vi.doMock('./onnx-model-manifest', () => ({
		validateOnnxCleanupManifest: vi.fn(() => ({
			version: '1.0.0',
			sizeBytes: 2,
			model1: { url: '/m1.onnx', sizeBytes: 1, checksum: 'sha256-a' },
			model2: { url: '/m2.onnx', sizeBytes: 1, checksum: 'sha256-b' },
			stateShape: [1, 1, 1, 1],
			io: {},
			executionProviders: ['wasm']
		}))
	}));
	vi.doMock('./dtln-ort-runtime', () => ({
		DtlnOrtRuntime: {
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

	return {
		messages,
		fakeSelf,
		processor,
		finishFinalize: (value) => holder.resolveFinalize(value)
	};
}

/** Loads the model, begins job 7, ends it, and waits until `finalize()` is pending. */
async function driveToFinalizePending(h: WorkerHarness): Promise<void> {
	h.fakeSelf.onmessage?.({
		data: {
			type: 'cleanup-load-model',
			manifestUrl: '/models/dtln-onnx/manifest.json',
			preferredAccelerator: 'wasm'
		}
	} as MessageEvent);
	await flushQueue();
	h.fakeSelf.onmessage?.({
		data: { type: 'cleanup-begin', jobId: 7, totalFrames: 1 }
	} as MessageEvent);
	await flushQueue();
	h.fakeSelf.onmessage?.({
		data: { type: 'cleanup-end', jobId: 7, output: 'pcm' }
	} as MessageEvent);
	await vi.waitFor(() => expect(h.processor.finalize).toHaveBeenCalledTimes(1));
}

describe('cleanup-ort-worker', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		vi.unstubAllGlobals();
	});

	it('drops stale cleanup-end results once the load generation changes', async () => {
		const h = setupWorkerMocks();
		await import('./cleanup-ort-worker');
		await driveToFinalizePending(h);

		// Cancel-all bumps the load generation while finalize is pending.
		h.fakeSelf.onmessage?.({ data: { type: 'cleanup-cancel' } } as MessageEvent);
		h.finishFinalize(new Float32Array([1, 2, 3, 4]));
		await flushQueue();

		expect(h.processor.abort).toHaveBeenCalledTimes(1);
		expect(h.messages).not.toContainEqual(
			expect.objectContaining({ type: 'cleanup-result', jobId: 7 })
		);
	});

	it('drops a cleanup-end result when the same job is cancelled mid-finalize', async () => {
		const h = setupWorkerMocks();
		await import('./cleanup-ort-worker');
		await driveToFinalizePending(h);

		// Cancel *this* job (no generation bump) while finalize is pending: the
		// `job !== active` guard must still suppress the result.
		h.fakeSelf.onmessage?.({ data: { type: 'cleanup-cancel', jobId: 7 } } as MessageEvent);
		h.finishFinalize(new Float32Array([1, 2, 3, 4]));
		await flushQueue();

		expect(h.processor.abort).toHaveBeenCalledTimes(1);
		expect(h.messages).not.toContainEqual(
			expect.objectContaining({ type: 'cleanup-result', jobId: 7 })
		);
	});
});
