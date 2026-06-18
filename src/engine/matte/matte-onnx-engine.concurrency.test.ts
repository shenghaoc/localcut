/**
 * Scheduling / lifecycle contracts for {@link MatteOnnxEngine} (the experimental
 * ORT backend). Like the LiteRT engine, it shares one set of GPU input/uniform
 * buffers across every clip, so inference must serialize; it also owns the
 * VideoFrame (close exactly once), defers a deleted clip's history destruction
 * until in-flight inference drains, and treats a permanently-invalid manifest as
 * terminal. These drive the promise scheduling directly — the GPU work is stubbed
 * or never reached — so the invariants hold without hardware WebGPU.
 */

import { describe, expect, it, vi } from 'vite-plus/test';
import { MatteOnnxEngine } from './matte-onnx-engine';
import type { MatteFrameRequest } from './matte-backend';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

interface FakeSession {
	history: { destroy: () => void };
	historyView: GPUTextureView;
	lastSourceTimeS: number | null;
	historyStale: boolean;
}

/** Private surface the tests reach into to bypass model loading and stub inference. */
interface MatteOnnxEngineInternals {
	modelStatus: string;
	device: GPUDevice | null;
	runInference: (request: MatteFrameRequest, cacheKey: string) => Promise<GPUTextureView | null>;
	lastView: Map<string, GPUTextureView>;
	sessions: Map<string, FakeSession>;
	running: Promise<GPUTextureView | null> | null;
}

function makeEngine(options?: { testMode?: boolean }): {
	engine: MatteOnnxEngine;
	internals: MatteOnnxEngineInternals;
} {
	const engine = new MatteOnnxEngine({
		onStatus: vi.fn(),
		testMode: options?.testMode
	});
	const internals = engine as unknown as MatteOnnxEngineInternals;
	// Pretend the model is loaded (and adopt a stub ORT-owned device, which
	// loadModel would normally set from handle.device) so matteViewFor reaches the
	// inference path; the real GPU work is replaced by the stub each test installs.
	internals.modelStatus = 'loaded';
	internals.device = {} as unknown as GPUDevice;
	return { engine, internals };
}

function makeRequest(quality: 'preview' | 'export', clipId = 'clip'): MatteFrameRequest {
	return {
		clipId,
		modelKey: 'model',
		frame: { close: vi.fn() } as unknown as VideoFrame,
		sourceTimeS: 0,
		frameStepS: 1 / 30,
		quality
	};
}

describe('MatteOnnxEngine.matteViewFor concurrency', () => {
	it('serializes concurrent export requests so runInference never overlaps', async () => {
		const { engine, internals } = makeEngine();
		let active = 0;
		let maxActive = 0;
		let entered = 0;
		const gate = deferred<void>();
		internals.runInference = async (request) => {
			entered += 1;
			active += 1;
			maxActive = Math.max(maxActive, active);
			request.frame.close();
			await gate.promise;
			active -= 1;
			return null;
		};

		// Three export requests; the third is what exposes a race (two waiters parked
		// on the same in-flight promise both launching a second inference).
		const runs = [
			engine.matteViewFor(makeRequest('export')),
			engine.matteViewFor(makeRequest('export')),
			engine.matteViewFor(makeRequest('export'))
		];
		expect(entered).toBe(1);

		gate.resolve();
		await Promise.all(runs);

		expect(entered).toBe(3);
		expect(maxActive).toBe(1);
	});

	it('keeps preview realtime: returns the last view without a second runInference while busy', async () => {
		const { engine, internals } = makeEngine();
		let entered = 0;
		const gate = deferred<void>();
		internals.runInference = async (request) => {
			entered += 1;
			request.frame.close();
			await gate.promise;
			return null;
		};

		const exportRun = engine.matteViewFor(makeRequest('export', 'clip'));
		expect(entered).toBe(1);

		const lastView = {} as GPUTextureView;
		internals.lastView.set('clip', lastView);
		const previewClose = vi.fn();
		const preview = await engine.matteViewFor({
			...makeRequest('preview', 'clip'),
			frame: { close: previewClose } as unknown as VideoFrame
		});

		expect(preview).toBe(lastView);
		expect(previewClose).toHaveBeenCalledTimes(1);
		expect(entered).toBe(1);

		gate.resolve();
		await exportRun;
	});

	it('serializes preview requests in test mode (the reuse shortcut is disabled)', async () => {
		const { engine, internals } = makeEngine({ testMode: true });
		let active = 0;
		let maxActive = 0;
		let entered = 0;
		const gate = deferred<void>();
		internals.runInference = async (request) => {
			entered += 1;
			active += 1;
			maxActive = Math.max(maxActive, active);
			request.frame.close();
			await gate.promise;
			active -= 1;
			return null;
		};

		const runs = [
			engine.matteViewFor(makeRequest('preview')),
			engine.matteViewFor(makeRequest('preview')),
			engine.matteViewFor(makeRequest('preview'))
		];
		expect(entered).toBe(1);

		gate.resolve();
		await Promise.all(runs);

		expect(entered).toBe(3);
		expect(maxActive).toBe(1);
	});

	it('releases the frame exactly once when an early GPU step throws (no leak, no double close)', async () => {
		// A device that throws on the first GPU call runInference makes (building its
		// pipelines) fails before the eager post-import frame close; the frame-owning
		// guard must still release the frame, exactly once.
		const engine = new MatteOnnxEngine({ onStatus: vi.fn() });
		const internals = engine as unknown as MatteOnnxEngineInternals;
		internals.modelStatus = 'loaded';
		// The ORT-owned device loadModel would adopt; here a stub that throws on the
		// first GPU call so ensurePipelines fails before the eager frame close.
		internals.device = {
			createComputePipeline: () => {
				throw new Error('device lost');
			},
			createShaderModule: () => {
				throw new Error('device lost');
			}
		} as unknown as GPUDevice;
		const close = vi.fn();

		await expect(
			engine.matteViewFor({
				clipId: 'clip',
				modelKey: 'model',
				frame: { close } as unknown as VideoFrame,
				sourceTimeS: 0,
				frameStepS: 1 / 30,
				quality: 'export'
			})
		).rejects.toThrow('device lost');

		expect(close).toHaveBeenCalledTimes(1);
	});
});

describe('MatteOnnxEngine.deleteClip history lifetime', () => {
	function seedSession(internals: MatteOnnxEngineInternals): () => void {
		const destroy = vi.fn();
		internals.sessions.set('clip', {
			history: { destroy },
			historyView: {} as GPUTextureView,
			lastSourceTimeS: 0,
			historyStale: false
		});
		return destroy;
	}

	it('destroys history immediately when no inference is in flight', () => {
		const { engine, internals } = makeEngine();
		const destroy = seedSession(internals);
		internals.running = null;
		engine.deleteClip('clip');
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('defers destroying history until the in-flight run drains', async () => {
		const { engine, internals } = makeEngine();
		const destroy = seedSession(internals);
		const gate = deferred<GPUTextureView | null>();
		internals.running = gate.promise;

		engine.deleteClip('clip');
		// The in-flight run still holds this session and may bind historyView / copy
		// into history in its resolve pass — destroying now would be a WebGPU error.
		expect(destroy).not.toHaveBeenCalled();

		gate.resolve(null);
		await new Promise<void>((r) => setTimeout(r, 0));
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});

describe('MatteOnnxEngine permanent manifest failure', () => {
	it('does not refetch a permanently-invalid (template) manifest on every call', async () => {
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			json: async () => ({ template: true })
		}));
		vi.stubGlobal('fetch', fetchSpy);
		try {
			const onStatus = vi.fn();
			const engine = new MatteOnnxEngine({ onStatus });

			await engine.ensureModelLoaded();
			await engine.ensureModelLoaded();

			// The manifest is fetched once; a permanent (template/validation) failure is
			// terminal, so subsequent calls reuse the resolved load promise.
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const statuses = onStatus.mock.calls.map(
				(c) => c[0] as { modelStatus: string; error?: string }
			);
			const failed = statuses.filter((s) => s.modelStatus === 'failed');
			expect(failed.length).toBeGreaterThan(0);
			expect(failed.at(-1)?.error).toMatch(/No compatible ONNX matte model/);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
