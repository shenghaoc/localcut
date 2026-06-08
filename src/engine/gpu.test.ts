import { beforeAll, describe, expect, it, vi } from 'vitest';
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
		createBuffer: () => ({ destroy: vi.fn() }),
		createCommandEncoder: () => encoder,
		importExternalTexture: () => ({}),
		queue: {
			submit,
			writeBuffer: vi.fn(),
			onSubmittedWorkDone: () => Promise.resolve()
		},
		destroy: vi.fn()
	} as unknown as GPUDevice;
	return { device, submit };
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

function layer(width: number, height: number): CompositeLayer {
	return {
		kind: 'frame',
		frame: { displayWidth: width, displayHeight: height } as unknown as VideoFrame,
		effects: { ...DEFAULT_CLIP_EFFECTS },
		transform: { ...DEFAULT_TRANSFORM }
	};
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
	it('does not enable scopes via setScopesEnabled while the feature flag is off', () => {
		const { device, submit } = fakeDevice();
		const renderer = new PreviewRenderer(device, fakeContext(), 'rgba8unorm', fakeCanvas(), false);
		renderer.setPreviewSize(64, 64);
		renderer.setScopeSab(new SharedArrayBuffer(64));
		renderer.setScopesEnabled(true);

		expect(renderer.scopesActive).toBe(false);
		renderer.present([layer(1920, 1080)]);
		expect(submit).toHaveBeenCalledTimes(1);
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
