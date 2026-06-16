/**
 * Concurrency contract for {@link MatteEngine.matteViewFor}.
 *
 * The engine shares one set of GPU input/uniform buffers across every clip, so a
 * second inference must never start while one is in flight — otherwise two runs
 * would stomp the same buffers and corrupt the in-flight frame. These tests drive
 * the promise-serialization logic directly (the GPU work in `runInference` is
 * stubbed): the invariant under test is the scheduling, not the shaders.
 */

import { describe, expect, it, vi } from 'vite-plus/test';
import { MatteEngine, type MatteFrameRequest } from './matte-engine';

/** A promise paired with its resolver, used to gate the stubbed inference. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Private surface the tests reach into to bypass model loading and stub inference. */
interface MatteEngineInternals {
	modelStatus: string;
	runInference: (request: MatteFrameRequest, cacheKey: string) => Promise<GPUTextureView | null>;
	lastView: Map<string, GPUTextureView>;
}

function makeEngine(options?: { testMode?: boolean }): {
	engine: MatteEngine;
	internals: MatteEngineInternals;
} {
	const engine = new MatteEngine({
		device: {} as unknown as GPUDevice,
		onStatus: vi.fn(),
		wasmPath: '/litert/',
		testMode: options?.testMode
	});
	const internals = engine as unknown as MatteEngineInternals;
	// Pretend the model is loaded so matteViewFor reaches the inference path; the
	// real GPU work is replaced by the stub each test installs.
	internals.modelStatus = 'loaded';
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

describe('MatteEngine.matteViewFor concurrency', () => {
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
			// The real runInference consumes the imported frame; mirror that so the
			// stub's contract matches.
			request.frame.close();
			await gate.promise;
			active -= 1;
			return null;
		};

		// One run in flight, then two more export requests arrive while it is busy.
		// The pre-fix code had both waiters await the SAME in-flight promise and then
		// each call runInference after it resolved — two inferences running at once on
		// the shared GPU buffers (maxActive === 2). Two callers alone never expose this
		// (the second's lone await resolves only once the first is done); it takes a
		// third to make two waiters race.
		const runs = [
			engine.matteViewFor(makeRequest('export')),
			engine.matteViewFor(makeRequest('export')),
			engine.matteViewFor(makeRequest('export'))
		];

		// Only the first has entered runInference synchronously; the others are parked.
		expect(entered).toBe(1);

		gate.resolve();
		await Promise.all(runs);

		// All three ran, but never more than one at a time.
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
		expect(entered).toBe(1); // preview did not start a second inference

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
		// pipelines), so the body fails before its eager post-import frame close. The
		// frame-owning guard must still release the frame, and exactly once.
		const engine = new MatteEngine({
			device: {
				createShaderModule: () => {
					throw new Error('device lost');
				}
			} as unknown as GPUDevice,
			onStatus: vi.fn(),
			wasmPath: '/litert/'
		});
		(engine as unknown as MatteEngineInternals).modelStatus = 'loaded';
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

		// Released exactly once — not leaked (0) and not double-closed (2).
		expect(close).toHaveBeenCalledTimes(1);
	});
});
