/**
 * WebNN shared-context helper for the ORT-WebNN spike.
 *
 * The goal of the spike is a zero-readback WebNN path: create an `MLContext`
 * **from the renderer's `GPUDevice`** (`navigator.ml.createContext(gpuDevice)`),
 * hand that context to ORT's WebNN EP, and run a model with `MLTensor` IO so frame
 * data never round-trips through the CPU on the hot path. WebNN is opt-in per
 * model and only after operator-support proof (see docs/ML-RUNTIME.md); when it is
 * unavailable this helper reports `unsupported` cleanly rather than throwing.
 *
 * `@webgpu/types` does not declare WebNN, so a minimal local typing of the bit of
 * `navigator.ml` we touch is defined here; ORT itself treats `MLContext` as
 * `unknown` (its `TryGetGlobalType` falls back when the global isn't declared).
 */

/** The slice of the WebNN `ML` interface this helper uses. */
interface MlLike {
	createContext(gpuDevice: GPUDevice): Promise<unknown>;
	createContext(options?: unknown): Promise<unknown>;
}

interface NavigatorWithMl {
	readonly ml?: MlLike;
}

function navigatorMl(): MlLike | undefined {
	const nav =
		typeof navigator !== 'undefined' ? (navigator as Navigator & NavigatorWithMl) : undefined;
	return nav?.ml;
}

/** True when `navigator.ml.createContext` is present (WebNN is at least exposed). */
export function isWebnnAvailable(): boolean {
	return typeof navigatorMl()?.createContext === 'function';
}

export type WebNNContextResult =
	| { readonly supported: true; readonly context: unknown }
	| { readonly supported: false; readonly reason: string };

/**
 * Creates a WebNN `MLContext` bound to `device`, so ORT-WebNN inference shares the
 * renderer's GPU. Returns `{ supported: false, reason }` (never throws) when WebNN
 * is missing or context creation fails — the caller falls back to its WebGPU path.
 */
export async function createWebnnContextFromDevice(device: GPUDevice): Promise<WebNNContextResult> {
	const ml = navigatorMl();
	if (!ml || typeof ml.createContext !== 'function') {
		return { supported: false, reason: 'navigator.ml (WebNN) is unavailable in this context.' };
	}
	try {
		const context = await ml.createContext(device);
		if (!context) {
			return { supported: false, reason: 'navigator.ml.createContext returned no MLContext.' };
		}
		return { supported: true, context };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { supported: false, reason: `WebNN context creation failed: ${reason}` };
	}
}
