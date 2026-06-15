/**
 * Execution-provider policy for ORT sessions.
 *
 * The architectural hard gate is unchanged from the LiteRT path: the accelerated,
 * full-frame pipeline must not silently degrade to CPU. For ORT that means a
 * **frame-coupled** model (matte, frame interpolation, reframe — anything that
 * runs per video frame) may never resolve to the `wasm` execution provider, and
 * must pin at least one GPU-class EP (`webgpu` or `webnn`). WASM/CPU is reserved
 * for small, non-frame-coupled models (see docs/ML-RUNTIME.md).
 *
 * This module is pure (no `onnxruntime-web` import): it decides the EP list; the
 * session wrapper turns that list into ORT `SessionOptions`.
 */
import type { OrtExecutionProvider } from './ort-types';

/** Execution providers that keep tensors off the CPU on the hot path. */
export const GPU_CLASS_EPS: readonly OrtExecutionProvider[] = ['webgpu', 'webnn'];

/** Execution providers a frame-coupled model is forbidden from resolving to. */
export const FRAME_COUPLED_FORBIDDEN_EPS: readonly OrtExecutionProvider[] = ['wasm'];

export class OrtEpPolicyError extends Error {
	constructor(message: string) {
		super(`ORT execution-provider policy violation: ${message}`);
		this.name = 'OrtEpPolicyError';
	}
}

/** True for EPs that keep frame data on an accelerator (`webgpu` / `webnn`). */
export function isGpuClassEp(ep: OrtExecutionProvider): boolean {
	return GPU_CLASS_EPS.includes(ep);
}

/** True unless `ep` is forbidden for frame-coupled features (i.e. `wasm`). */
export function isFrameCoupledSafeEp(ep: OrtExecutionProvider): boolean {
	return !FRAME_COUPLED_FORBIDDEN_EPS.includes(ep);
}

export interface ResolveEpInput {
	/** Whether the model runs per video frame (forbids WASM/CPU fallback). */
	readonly frameCoupled: boolean;
	/** The pinned, ordered EP preference (from the manifest or an override). */
	readonly executionProviders: readonly OrtExecutionProvider[];
}

/**
 * Returns the pinned EP list to hand to ORT, or throws {@link OrtEpPolicyError}.
 *
 * The list is returned verbatim (order preserved, no implicit `wasm` append).
 * For a frame-coupled model it is rejected unless every EP is accelerator-class —
 * a single `wasm` entry (or a list with no GPU-class EP) is a hard error, never a
 * silent drop to CPU.
 */
export function resolveExecutionProviders(input: ResolveEpInput): OrtExecutionProvider[] {
	const eps = input.executionProviders;
	if (eps.length === 0) {
		throw new OrtEpPolicyError('at least one execution provider must be pinned');
	}
	if (input.frameCoupled) {
		const forbidden = eps.filter((ep) => !isFrameCoupledSafeEp(ep));
		if (forbidden.length > 0) {
			throw new OrtEpPolicyError(
				`frame-coupled models must not use [${forbidden.join(', ')}]; ` +
					'full-frame inference may never fall back to WASM/CPU tensors'
			);
		}
		if (!eps.some(isGpuClassEp)) {
			throw new OrtEpPolicyError(
				`frame-coupled models must pin a GPU-class provider (${GPU_CLASS_EPS.join(' or ')}); ` +
					`got [${eps.join(', ')}]`
			);
		}
	}
	return [...eps];
}
