/**
 * Frame interpolation availability (Phase 37, R1). Pure, unit-testable
 * function that maps the existing capability probe result to an
 * interpolation-specific availability state.
 *
 * This must NOT alter `CapabilityTierV2` derivation or any existing
 * tier/branching logic (R1.1). It gates only interpolation.
 */

import type { CapabilityTierV2, InterpolationAvailability } from '../../protocol';

export type { InterpolationAvailability } from '../../protocol';

/**
 * Derive interpolation availability from the capability tier.
 *
 * ORT-WebGPU is the only viable path for GPU-coupled interpolation in v1
 * (R1.2). ORT-WASM/CPU is not wired as a fallback because it would be a
 * multi-minute hang per frame.
 *
 * @param tier - The existing capability tier from the Phase 8/26 probe.
 * @param hasWebGpuDevice - Whether a usable WebGPU device was obtained.
 * @param hasUsableOrtWebGpu - Whether ORT-WebGPU is available for the shared renderer device.
 */
export function deriveInterpolationAvailability(
	tier: CapabilityTierV2,
	hasWebGpuDevice: boolean = true,
	hasUsableOrtWebGpu: boolean = true
): InterpolationAvailability {
	if (!hasWebGpuDevice || !hasUsableOrtWebGpu) {
		return {
			state: 'unavailable',
			reason: !hasWebGpuDevice
				? 'No WebGPU device available for frame interpolation.'
				: 'ORT-WebGPU execution provider not available for frame interpolation.'
		};
	}

	switch (tier) {
		case 'core-webgpu':
			return { state: 'preview-and-export', accelerator: 'webgpu' };

		case 'compatibility-webgpu':
			return {
				state: 'export-only',
				accelerator: 'webgpu',
				reason:
					'Frame interpolation preview requires the accelerated tier. Export is available but will be slow.'
			};

		case 'limited-webcodecs':
		case 'shell-only':
			return {
				state: 'unavailable',
				reason: `Frame interpolation requires WebGPU (current tier: ${tier}). The feature is hidden.`
			};
	}
}

/**
 * Whether interpolation controls should be visible at all.
 */
export function isInterpolationVisible(availability: InterpolationAvailability): boolean {
	return availability.state !== 'unavailable';
}

/**
 * Whether a bounded preview segment can be generated.
 */
export function canPreviewInterpolation(availability: InterpolationAvailability): boolean {
	return availability.state === 'preview-and-export';
}

/**
 * Whether fps-upconvert export is available.
 */
export function canExportInterpolation(availability: InterpolationAvailability): boolean {
	return availability.state === 'preview-and-export' || availability.state === 'export-only';
}

/**
 * Human-readable reason why interpolation is limited or unavailable.
 */
export function interpolationReason(availability: InterpolationAvailability): string | null {
	if ('reason' in availability) return availability.reason;
	return null;
}
