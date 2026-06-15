/**
 * WebNN shared-context spike (Browser Mode).
 *
 * Acceptance: when WebNN is available, create an `MLContext` from the renderer's
 * `GPUDevice` and hand it to ORT's WebNN EP, then run a toy model whose **output
 * stays an `MLTensor`** (`location === 'ml-tensor'`) — i.e. no implicit CPU
 * readback on the hot path. When WebNN is unavailable, the helper reports
 * `unsupported` cleanly and the spike skips the run. Runs only under
 * `test:browser`; the WebNN run self-skips on engines without `navigator.ml`.
 *
 * The single `getData()` call is explicit verification, not a hot-path readback.
 */
import { describe, expect, it } from 'vite-plus/test';

import { createOrtSession } from './ort-session';
import { createWebnnContextFromDevice, isWebnnAvailable } from './webnn-context';
import { FIXTURE_INPUT_NAME, FIXTURE_OUTPUT_NAME, makeIdentityOnnxModel } from './onnx-fixture';
import { loadOrtWebNN } from './ort-loader';
import type { OrtModelManifest } from './ort-types';

const DIMS = [1, 4] as const;
const INPUT = new Float32Array([1, 2, 3, 4]);

const webnnManifest: OrtModelManifest = {
	id: 'identity-webnn-spike',
	version: '1.0.0',
	license: 'MIT',
	source: 'in-memory fixture',
	format: 'onnx',
	model: { url: 'memory://identity', sizeBytes: 1, checksum: 'sha256-' + '0'.repeat(64) },
	executionProviders: ['webnn'],
	frameCoupled: true,
	tensorLocation: 'ml-tensor'
};

async function getGpuDevice(): Promise<GPUDevice | null> {
	if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;
	const adapter = await navigator.gpu.requestAdapter();
	return (await adapter?.requestDevice()) ?? null;
}

describe('ORT-WebNN shared-context spike', () => {
	it('reports unsupported cleanly when WebNN is unavailable', async (ctx) => {
		if (isWebnnAvailable()) {
			ctx.skip();
			return;
		}
		const device = await getGpuDevice();
		if (!device) {
			ctx.skip();
			return;
		}
		const result = await createWebnnContextFromDevice(device);
		expect(result.supported).toBe(false);
		if (!result.supported) expect(typeof result.reason).toBe('string');
	});

	it('runs a toy model with an MLTensor output via a GPUDevice-backed context', async (ctx) => {
		const device = await getGpuDevice();
		if (!device || !isWebnnAvailable()) {
			ctx.skip();
			return;
		}
		const contextResult = await createWebnnContextFromDevice(device);
		if (!contextResult.supported) {
			ctx.skip();
			return;
		}

		const ort = await loadOrtWebNN();
		const handle = await createOrtSession({
			modelBytes: makeIdentityOnnxModel([...DIMS]),
			manifest: webnnManifest,
			mlContext: contextResult.context,
			webnnDeviceType: 'gpu'
		});
		expect(handle.deviceOwner).toBe('webnn-context');
		expect(handle.tensorLocation).toBe('ml-tensor');

		const input = new ort.Tensor('float32', INPUT, [...DIMS]);
		const outputs = await handle.session.run({ [FIXTURE_INPUT_NAME]: input });
		const output = outputs[FIXTURE_OUTPUT_NAME]!;
		// The hot-path output stays on the WebNN device (no implicit CPU copy).
		expect(output.location).toBe('ml-tensor');

		// Explicit verification readback only (not part of the inference hot path).
		const data = await output.getData(true);
		expect(Array.from(data as Float32Array)).toEqual(Array.from(INPUT));

		input.dispose();
		await handle.session.release();
	});
});
