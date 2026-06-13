/** Shared WebGPU pipeline construction helpers.
 *
 *  Every compute effect in the accelerated chain was creating its pipeline with
 *  the same `layout: 'auto'` + `createShaderModule` + `entryPoint: 'main'`
 *  boilerplate. This collapses that into one place so gpu.ts and effects.ts stay
 *  in sync and new stages don't re-paste the descriptor.
 */

/** Build a `main`-entry compute pipeline from WGSL source with auto layout. */
export function createComputePipeline(
	device: GPUDevice,
	code: string,
	label?: string
): GPUComputePipeline {
	return device.createComputePipeline({
		label,
		layout: 'auto',
		compute: {
			module: device.createShaderModule({ code, label }),
			entryPoint: 'main'
		}
	});
}
