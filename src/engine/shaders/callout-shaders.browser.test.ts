import { describe, expect, it } from 'vite-plus/test';

import blurRegionF32 from './blur-region.wgsl?raw';
import blurRegionF16 from './blur-region.f16.wgsl?raw';
import spotlightF32 from './spotlight.wgsl?raw';
import spotlightF16 from './spotlight.f16.wgsl?raw';

async function expectComputePipelineValid(
	device: GPUDevice,
	code: string,
	label: string,
	entryPoint: string
): Promise<void> {
	device.pushErrorScope('validation');
	const module = device.createShaderModule({ code, label });
	const info = await module.getCompilationInfo();
	expect(
		info.messages.filter((message) => message.type === 'error').map((message) => message.message)
	).toEqual([]);
	device.createComputePipeline({
		label,
		layout: 'auto',
		compute: { module, entryPoint }
	});
	const validationError = await device.popErrorScope();
	expect(validationError).toBeNull();
}

describe('callout WGSL shaders', () => {
	it('compiles spotlight and blur-region pipelines in browser WebGPU', async (ctx) => {
		if (typeof navigator === 'undefined' || !navigator.gpu) {
			ctx.skip();
			return;
		}
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			ctx.skip();
			return;
		}

		const requiredFeatures: GPUFeatureName[] = adapter.features.has('shader-f16')
			? ['shader-f16']
			: [];
		const device = await adapter.requestDevice({ requiredFeatures });
		try {
			await expectComputePipelineValid(device, spotlightF32, 'spotlight-f32', 'main');
			await expectComputePipelineValid(
				device,
				blurRegionF32,
				'blur-region-f32-h',
				'horizontal_pass'
			);
			await expectComputePipelineValid(device, blurRegionF32, 'blur-region-f32-v', 'vertical_pass');

			if (device.features.has('shader-f16')) {
				await expectComputePipelineValid(device, spotlightF16, 'spotlight-f16', 'main');
				await expectComputePipelineValid(
					device,
					blurRegionF16,
					'blur-region-f16-h',
					'horizontal_pass'
				);
				await expectComputePipelineValid(
					device,
					blurRegionF16,
					'blur-region-f16-v',
					'vertical_pass'
				);
			}
		} finally {
			device.destroy();
		}
	});
});
