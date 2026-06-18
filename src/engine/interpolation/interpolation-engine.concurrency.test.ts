/**
 * Concurrency contract for {@link InterpolationEngine.synthesise}.
 *
 * The engine shares one pair of input buffers and the preprocess/postprocess
 * uniform buffers across every call, so two overlapping `synthesise` invocations
 * must not run at once — otherwise they would stomp the same buffers and corrupt
 * each other's in-flight frame. This drives the promise-serialization logic
 * directly: `ensurePipelines` is a no-op and the per-tile GPU work in
 * `synthesiseTile` is stubbed to a controllable gate, so the invariant under test
 * is the scheduling, not the shaders. `synthesiseTile` is the seam (not the new
 * `runSynthesis` wrapper) so the same test would fail against the unserialized
 * version of `synthesise`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { InterpolationEngine } from './interpolation-engine';
import type { Tile, TilePlan } from './tiling';

beforeAll(() => {
	// runSynthesis builds the output texture's usage bitmask from GPUTextureUsage,
	// a WebGPU runtime global absent in Node. Stub it at the boundary so the real
	// runSynthesis runs up to the (separately stubbed) synthesiseTile tile pass.
	vi.stubGlobal('GPUTextureUsage', {
		TEXTURE_BINDING: 0x04,
		STORAGE_BINDING: 0x08,
		COPY_SRC: 0x10
	});
});

afterAll(() => {
	vi.unstubAllGlobals();
});

/** A promise paired with its resolver, used to gate the stubbed synthesis. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Private surface the tests reach into to bypass loading and stub the GPU work. */
interface InterpInternals {
	status: string;
	device: GPUDevice | null;
	model: unknown;
	ort: unknown;
	disposed: boolean;
	ensurePipelines: () => void;
	synthesiseTile: (...args: unknown[]) => Promise<void>;
}

function makeEngine(): { engine: InterpolationEngine; internals: InterpInternals } {
	const engine = new InterpolationEngine({ onStatus: vi.fn() });
	const internals = engine as unknown as InterpInternals;
	// Pretend a model is loaded so synthesise reaches the work path; the GPU work is
	// replaced by the stubs below. loadModel would normally adopt ORT's device from
	// handle.device — here a stub whose only reached method is createTexture (after
	// ensurePipelines is stubbed out), returning a disposable output-texture stand-in.
	internals.status = 'loaded';
	internals.device = { createTexture: () => ({ destroy: vi.fn() }) } as unknown as GPUDevice;
	internals.model = {};
	internals.ort = {};
	internals.ensurePipelines = () => {};
	return { engine, internals };
}

const FRAME = {} as unknown as VideoFrame;
// One tile per call: the loop body (the stubbed synthesiseTile) runs exactly once.
const PLAN = { tiles: [{} as Tile] } as unknown as TilePlan;

describe('InterpolationEngine.synthesise concurrency', () => {
	it('serializes concurrent synthesise calls so synthesiseTile never overlaps', async () => {
		const { engine, internals } = makeEngine();
		let active = 0;
		let maxActive = 0;
		let entered = 0;
		const gate = deferred<void>();
		internals.synthesiseTile = async () => {
			entered += 1;
			active += 1;
			maxActive = Math.max(maxActive, active);
			await gate.promise;
			active -= 1;
		};

		// One synthesis in flight, then two more calls arrive while it is busy.
		// Without serialization all three would run their tile passes at once on the
		// shared input/uniform buffers (maxActive > 1), corrupting in-flight frames.
		const runs = [
			engine.synthesise(FRAME, FRAME, 0.5, 1920, 1080, PLAN),
			engine.synthesise(FRAME, FRAME, 0.5, 1920, 1080, PLAN),
			engine.synthesise(FRAME, FRAME, 0.5, 1920, 1080, PLAN)
		];

		// Only the first has entered the tile pass synchronously; the others are
		// parked awaiting the run ahead of them in the chain.
		expect(entered).toBe(1);

		gate.resolve();
		await Promise.all(runs);

		// All three ran, but never more than one at a time.
		expect(entered).toBe(3);
		expect(maxActive).toBe(1);
	});

	it('rejects with a disposed-specific error when disposed mid-flight', async () => {
		const { engine, internals } = makeEngine();
		// Loaded model still present (dispose nulls it only after the run drains), so
		// the message must say "disposed", not the generic "not loaded".
		internals.disposed = true;

		await expect(engine.synthesise(FRAME, FRAME, 0.5, 1920, 1080, PLAN)).rejects.toThrow(
			'InterpolationEngine is disposed.'
		);
	});
});
