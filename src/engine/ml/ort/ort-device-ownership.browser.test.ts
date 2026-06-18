/**
 * ORT device-ownership spike (Browser Mode, real Chromium + WebGPU).
 *
 * Acceptance: a `GPUBuffer` created from the device ORT owns
 * (`ort.env.webgpu.device`) can be used **both** by the app's own WebGPU compute
 * pass and by ORT's `Tensor.fromGpuBuffer` as a session input — proving ORT 1.26+
 * exposes a shareable WebGPU device. This runs only under `test:browser`; it
 * self-skips where WebGPU is unavailable (e.g. software-rendered CI VMs).
 *
 * `getData()` here is an explicit, manual verification readback — not a hot path.
 */
import { describe, expect, it } from 'vite-plus/test';

import { loadOrtWebGpu } from './ort-loader';
import { createOrtSession } from './ort-session';
import { FIXTURE_INPUT_NAME, FIXTURE_OUTPUT_NAME, makeIdentityOnnxModel } from './onnx-fixture';
import type { OrtModelManifest } from './ort-types';
import { DEFAULT_CLIP_EFFECTS } from '../../effects';
import { PreviewRenderer } from '../../gpu';
import { DEFAULT_TRANSFORM } from '../../transform';

const DIMS = [1, 4] as const;
const INPUT = new Float32Array([1, 2, 3, 4]);

const fixtureManifest: OrtModelManifest = {
	id: 'identity-spike',
	version: '1.0.0',
	license: 'MIT',
	source: 'in-memory fixture',
	format: 'onnx',
	model: { url: 'memory://identity', sizeBytes: 1, checksum: 'sha256-' + '0'.repeat(64) },
	executionProviders: ['webgpu'],
	frameCoupled: true,
	tensorLocation: 'gpu-buffer'
};

const DOUBLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
	let i = gid.x;
	if (i < arrayLength(&src)) { dst[i] = src[i] * 2.0; }
}`;

async function runAppDoublePass(device: GPUDevice, input: GPUBuffer): Promise<Float32Array> {
	const out = device.createBuffer({
		size: INPUT.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
	});
	const pipeline = device.createComputePipeline({
		layout: 'auto',
		compute: { module: device.createShaderModule({ code: DOUBLE_WGSL }), entryPoint: 'main' }
	});
	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: input } },
			{ binding: 1, resource: { buffer: out } }
		]
	});
	const readback = device.createBuffer({
		size: INPUT.byteLength,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
	});
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.dispatchWorkgroups(1);
	pass.end();
	encoder.copyBufferToBuffer(out, 0, readback, 0, INPUT.byteLength);
	device.queue.submit([encoder.finish()]);
	await readback.mapAsync(GPUMapMode.READ);
	const result = new Float32Array(readback.getMappedRange().slice(0));
	readback.unmap();
	out.destroy();
	readback.destroy();
	return result;
}

async function makeTinyFrame(): Promise<VideoFrame> {
	const canvas = new OffscreenCanvas(2, 2);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D canvas unavailable.');
	ctx.fillStyle = 'rgb(255, 255, 255)';
	ctx.fillRect(0, 0, 2, 2);
	const bitmap = canvas.transferToImageBitmap();
	const frame = new VideoFrame(bitmap, { timestamp: 0 });
	bitmap.close();
	return frame;
}

describe('ORT-WebGPU device ownership spike', () => {
	it('shares one GPUBuffer (on ORT-owned device) between an app pass and ORT', async (ctx) => {
		// `navigator.gpu` can exist while no adapter is actually available (e.g.
		// headless/software-rendered CI). Probe for a real adapter — not just the
		// API surface — so the spike skips instead of failing where ORT cannot get
		// a GPU device.
		if (typeof navigator === 'undefined' || !navigator.gpu) {
			ctx.skip();
			return;
		}
		const probeAdapter = await navigator.gpu.requestAdapter();
		if (!probeAdapter) {
			ctx.skip();
			return;
		}
		const ort = await loadOrtWebGpu();

		const handle = await createOrtSession({
			modelBytes: makeIdentityOnnxModel([...DIMS]),
			manifest: fixtureManifest
		});
		// ORT created and owns the WebGPU device; the app reuses it.
		expect(handle.deviceOwner).toBe('ort-webgpu');
		const device = handle.device;
		expect(device).toBeTruthy();
		if (!device) {
			ctx.skip();
			return;
		}

		// A GPUBuffer created from ORT's device, usable by ORT's tensor IO.
		const shared = device.createBuffer({
			size: INPUT.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
		});
		device.queue.writeBuffer(shared, 0, INPUT);

		// (1) The app's own WebGPU pass consumes the shared buffer.
		const doubled = await runAppDoublePass(device, shared);
		expect(Array.from(doubled)).toEqual([2, 4, 6, 8]);

		// (2) ORT consumes the same buffer as a GPU-buffer tensor (zero upload).
		const inputTensor = ort.Tensor.fromGpuBuffer(shared, { dataType: 'float32', dims: [...DIMS] });
		const outputs = await handle.session.run({ [FIXTURE_INPUT_NAME]: inputTensor });
		const output = outputs[FIXTURE_OUTPUT_NAME]!;
		const data = await output.getData(true);
		expect(Array.from(data as Float32Array)).toEqual(Array.from(INPUT));

		inputTensor.dispose();
		shared.destroy();
		void handle.session.release();
	});

	it('composites a same-device matte texture with a renderer built on ORT device', async (ctx) => {
		if (typeof navigator === 'undefined' || !navigator.gpu || typeof VideoFrame === 'undefined') {
			ctx.skip();
			return;
		}
		const probeAdapter = await navigator.gpu.requestAdapter();
		if (!probeAdapter) {
			ctx.skip();
			return;
		}

		const handle = await createOrtSession({
			modelBytes: makeIdentityOnnxModel([...DIMS]),
			manifest: fixtureManifest
		});
		const device = handle.device;
		expect(device).toBeTruthy();
		if (!device) {
			ctx.skip();
			return;
		}

		const canvas = new OffscreenCanvas(4, 4);
		const context = canvas.getContext('webgpu');
		if (!context) {
			ctx.skip();
			return;
		}
		const renderer = new PreviewRenderer(
			device,
			context,
			navigator.gpu.getPreferredCanvasFormat(),
			canvas,
			device.features.has('shader-f16'),
			{ ownsDevice: false }
		);
		const frame = await makeTinyFrame();
		const matte = device.createTexture({
			size: { width: 2, height: 2 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		device.pushErrorScope('validation');
		try {
			renderer.setPreviewSize(4, 4);
			renderer.present([
				{
					kind: 'frame',
					frame,
					effects: { ...DEFAULT_CLIP_EFFECTS },
					transform: { ...DEFAULT_TRANSFORM },
					matteView: matte.createView(),
					matteStrength: 1,
					matteMode: 'remove'
				}
			]);
			await device.queue.onSubmittedWorkDone();
			const validationError = await device.popErrorScope();
			expect(validationError).toBeNull();
		} finally {
			frame.close();
			matte.destroy();
			renderer.destroy();
			void handle.session.release();
		}
	});
});
