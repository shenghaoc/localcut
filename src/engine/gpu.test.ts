import { beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { PreviewRenderer, type CompositeLayer } from './gpu';
import { DEFAULT_CLIP_EFFECTS } from './effects';
import { DEFAULT_TRANSFORM } from './transform';

// WebGPU usage-flag enums are host globals the renderer ORs together; the values
// are irrelevant to the mock, only that the symbols resolve.
beforeAll(() => {
	const g = globalThis as Record<string, unknown>;
	g.GPUTextureUsage ??= { STORAGE_BINDING: 1, TEXTURE_BINDING: 2 };
	g.GPUBufferUsage ??= { UNIFORM: 1, COPY_DST: 2 };
});

/**
 * Minimal WebGPU device mock — just enough surface for PreviewRenderer's
 * pipeline/texture/encoder calls. The submission counter is what matters: the
 * architecture demands exactly one `queue.submit` per composited frame.
 */
function fakeDevice() {
	const submit = vi.fn();
	const writeBuffer = vi.fn();
	const pass = {
		setPipeline: vi.fn(),
		setBindGroup: vi.fn(),
		dispatchWorkgroups: vi.fn(),
		draw: vi.fn(),
		end: vi.fn()
	};
	const encoder = {
		beginComputePass: () => pass,
		beginRenderPass: () => pass,
		finish: () => ({})
	};
	const pipeline = { getBindGroupLayout: () => ({}) };
	const device = {
		createShaderModule: () => ({}),
		createComputePipeline: () => pipeline,
		createRenderPipeline: () => pipeline,
		createSampler: () => ({}),
		createBindGroup: () => ({}),
		createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }),
		createBuffer: (descriptor: { size?: number } = {}) => ({
			size: descriptor.size,
			destroy: vi.fn()
		}),
		createCommandEncoder: () => encoder,
		importExternalTexture: () => ({}),
		queue: {
			submit,
			writeBuffer,
			onSubmittedWorkDone: () => Promise.resolve()
		},
		destroy: vi.fn()
	} as unknown as GPUDevice;
	return { device, submit, writeBuffer };
}

function fakeContext(): GPUCanvasContext {
	return {
		configure: vi.fn(),
		getCurrentTexture: () => ({ createView: () => ({}) })
	} as unknown as GPUCanvasContext;
}

function fakeCanvas(): OffscreenCanvas {
	return { width: 0, height: 0 } as unknown as OffscreenCanvas;
}

function layer(
	width: number,
	height: number,
	transition?: CompositeLayer['transition'],
	overrides?: Partial<{ effects: typeof DEFAULT_CLIP_EFFECTS; skinSmoothBypass: boolean }>
): CompositeLayer {
	return {
		kind: 'frame',
		frame: { displayWidth: width, displayHeight: height } as unknown as VideoFrame,
		effects: overrides?.effects ?? { ...DEFAULT_CLIP_EFFECTS },
		transform: { ...DEFAULT_TRANSFORM },
		transition,
		skinSmoothBypass: overrides?.skinSmoothBypass
	};
}

function transitionPair(
	transitionId: string,
	kind: 'cross-dissolve' | 'dip-to-black' | 'wipe' | 'slide',
	mixT: number
): CompositeLayer[] {
	const shared = { mixT, kind, params: {}, transitionId, durationS: 1 } as const;
	return [
		layer(1920, 1080, { ...shared, role: 'outgoing' }),
		layer(1920, 1080, { ...shared, role: 'incoming' })
	];
}

describe('PreviewRenderer single submission', () => {
	it('issues exactly one queue.submit per frame for 0, 1, 2, and N layers', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		for (const count of [0, 1, 2, 5]) {
			submit.mockClear();
			const layers = Array.from({ length: count }, () => layer(1920, 1080));
			renderer.present(layers);
			expect(submit, `${count} layers`).toHaveBeenCalledTimes(1);
			expect(renderer.lastFrameSubmissionCount).toBe(1);
		}
	});

	it('keeps one submit per frame through transition windows (T3.2)', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		// A lone pair, a pair under extra layers, and two simultaneous pairs (each
		// gets its own uniform buffer) — always exactly one queue.submit.
		const stacks: CompositeLayer[][] = [
			transitionPair('tr-1', 'cross-dissolve', 0.5),
			[layer(1280, 720), ...transitionPair('tr-1', 'wipe', 0.25), layer(1280, 720)],
			[...transitionPair('tr-1', 'dip-to-black', 0.1), ...transitionPair('tr-2', 'slide', 0.9)]
		];
		for (const stack of stacks) {
			submit.mockClear();
			renderer.present(stack);
			expect(submit).toHaveBeenCalledTimes(1);
			expect(renderer.lastFrameSubmissionCount).toBe(1);
		}
	});

	it('grows the per-layer transform uniform pool without extra submissions', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(32, 32);

		// A deep stack on the first frame, then a shallow one: still one submit each.
		renderer.present(Array.from({ length: 6 }, () => layer(1280, 720)));
		expect(submit).toHaveBeenCalledTimes(1);
		submit.mockClear();
		renderer.present([layer(1280, 720)]);
		expect(submit).toHaveBeenCalledTimes(1);
	});
});

describe('PreviewRenderer scope gating (B7)', () => {
	it('enables scopes when the feature flag is on and setScopesEnabled(true)', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);
		renderer.setScopeSab(new SharedArrayBuffer(64));
		renderer.setScopesEnabled(true);

		expect(renderer.scopesActive).toBe(true);
		renderer.present([layer(1920, 1080)]);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it('disables scopes via setScopesEnabled(false) regardless of the feature flag', () => {
		const { device } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);
		renderer.setScopeSab(new SharedArrayBuffer(64));
		renderer.setScopesEnabled(true);
		renderer.setScopesEnabled(false);
		expect(renderer.scopesActive).toBe(false);
	});

	it('keeps a single submission per frame even when scope dispatch is forced on', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);
		renderer.setScopeSab(new SharedArrayBuffer(64));
		// Force the internal flag past the feature gate to prove the dispatch itself
		// never adds a queue.submit; it runs inside the one per-frame encoder.
		(renderer as unknown as { scopesEnabled: boolean }).scopesEnabled = true;

		submit.mockClear();
		renderer.present([layer(1920, 1080)]);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(renderer.lastFrameSubmissionCount).toBe(1);
	});
});

describe('Phase 32a: skin-smooth pass count', () => {
	it('adds 7 extra dispatch calls for one smoothed layer, still 1 submit', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		const pass = (
			device.createCommandEncoder() as unknown as {
				beginComputePass: () => { dispatchWorkgroups: ReturnType<typeof vi.fn> };
			}
		).beginComputePass();
		const dispatch = pass.dispatchWorkgroups;

		submit.mockClear();
		dispatch.mockClear();
		renderer.present([layer(1920, 1080)]);
		const baselineDispatches = dispatch.mock.calls.length;

		submit.mockClear();
		dispatch.mockClear();
		const smoothed = layer(1920, 1080, undefined, {
			effects: { ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5 }
		});
		renderer.present([smoothed]);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls.length - baselineDispatches).toBe(7);
	});

	it('adds 0 extra dispatches for strength 0, still 1 submit', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		const pass = (
			device.createCommandEncoder() as unknown as {
				beginComputePass: () => { dispatchWorkgroups: ReturnType<typeof vi.fn> };
			}
		).beginComputePass();
		const dispatch = pass.dispatchWorkgroups;

		dispatch.mockClear();
		renderer.present([layer(1920, 1080)]);
		const baselineDispatches = dispatch.mock.calls.length;

		dispatch.mockClear();
		renderer.present([
			layer(1920, 1080, undefined, {
				effects: { ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0 }
			})
		]);
		expect(submit).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls.length).toBe(baselineDispatches);
	});

	it('adds 0 extra dispatches when bypass is true, still 1 submit', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		const pass = (
			device.createCommandEncoder() as unknown as {
				beginComputePass: () => { dispatchWorkgroups: ReturnType<typeof vi.fn> };
			}
		).beginComputePass();
		const dispatch = pass.dispatchWorkgroups;

		dispatch.mockClear();
		renderer.present([layer(1920, 1080)]);
		const baselineDispatches = dispatch.mock.calls.length;

		dispatch.mockClear();
		renderer.present([
			layer(1920, 1080, undefined, {
				effects: { ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5 },
				skinSmoothBypass: true
			})
		]);
		expect(submit).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls.length).toBe(baselineDispatches);
	});

	it('adds 14 extra dispatches for two smoothed layers, still 1 submit', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		const pass = (
			device.createCommandEncoder() as unknown as {
				beginComputePass: () => { dispatchWorkgroups: ReturnType<typeof vi.fn> };
			}
		).beginComputePass();
		const dispatch = pass.dispatchWorkgroups;

		dispatch.mockClear();
		renderer.present([layer(1920, 1080), layer(1920, 1080)]);
		const baselineDispatches = dispatch.mock.calls.length;

		dispatch.mockClear();
		const smoothedEffects = { ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5 };
		renderer.present([
			layer(1920, 1080, undefined, { effects: smoothedEffects }),
			layer(1920, 1080, undefined, { effects: smoothedEffects })
		]);
		expect(submit).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls.length - baselineDispatches).toBe(14);
	});

	it('writes frame-global skin box uniforms once for multiple smoothed layers', () => {
		const { device, writeBuffer } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);

		const smoothedEffects = { ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5 };
		writeBuffer.mockClear();
		renderer.present([
			layer(1920, 1080, undefined, { effects: smoothedEffects }),
			layer(1920, 1080, undefined, { effects: smoothedEffects })
		]);

		const boxUniformWrites = writeBuffer.mock.calls.filter(
			([buffer]) => (buffer as { size?: number }).size === 16
		);
		expect(boxUniformWrites).toHaveLength(2);
	});
});
