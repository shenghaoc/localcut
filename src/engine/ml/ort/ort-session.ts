/**
 * Thin wrapper around `InferenceSession.create` that applies the foundation's
 * pinned execution-provider policy and reports device ownership.
 *
 * Responsibilities:
 * - Resolve the EP list through {@link resolveExecutionProviders} so a
 *   frame-coupled model can never silently drop to WASM/CPU.
 * - Load the matching ORT build lazily (WebGPU / `all`-with-WebNN / WASM).
 * - Pin the EP list verbatim into `SessionOptions` — ORT's own implicit WASM
 *   fallback is never appended.
 * - Wire device sharing: inject the renderer's `GPUDevice` when provided
 *   (`deviceOwner: 'renderer'`), otherwise read back the device ORT created
 *   (`deviceOwner: 'ort-webgpu'`); a WebNN `MLContext` yields `'webnn-context'`.
 *
 * Types come from `onnxruntime-web` via `import type` (erased); the runtime is
 * reached only through {@link file://./ort-loader.ts}'s dynamic imports.
 */
import type { InferenceSession } from 'onnxruntime-web';
import type {
	OrtDeviceOwner,
	OrtExecutionProvider,
	OrtModelManifest,
	OrtTensorLocation
} from './ort-types';
import { resolveExecutionProviders } from './ep-policy';
import { loadOrtWasm, loadOrtWebGpu, loadOrtWebNN, type OrtModule } from './ort-loader';

export interface CreateOrtSessionOptions {
	/** The validated ONNX model bytes (already digest-verified). */
	readonly modelBytes: Uint8Array;
	readonly manifest: OrtModelManifest;
	/** Optional EP override; still subject to the frame-coupled policy. */
	readonly executionProviders?: readonly OrtExecutionProvider[];
	/**
	 * Renderer-owned `GPUDevice` to inject into ORT's WebGPU backend. When set,
	 * inference shares the compositor's device (`deviceOwner: 'renderer'`). Must be
	 * provided before the first WebGPU session is created.
	 */
	readonly device?: GPUDevice;
	/** WebNN `MLContext` (e.g. created from a `GPUDevice`) for the WebNN EP. */
	readonly mlContext?: unknown;
	/** WebNN device type; required by ORT when an `MLContext` is supplied. */
	readonly webnnDeviceType?: 'cpu' | 'gpu' | 'npu';
	/** Preferred IO/output tensor location; defaults are derived from the EP. */
	readonly tensorLocation?: OrtTensorLocation;
}

export interface OrtSessionHandle {
	readonly session: InferenceSession;
	/** The pinned EP list actually handed to ORT (order preserved). */
	readonly executionProviders: readonly OrtExecutionProvider[];
	readonly primaryEp: OrtExecutionProvider;
	readonly tensorLocation: OrtTensorLocation;
	/** Undefined for a WASM-only (deviceless) session. */
	readonly deviceOwner?: OrtDeviceOwner;
	/** The `GPUDevice` inference computes on, when the primary EP is WebGPU. */
	readonly device?: GPUDevice;
}

type EpConfig = NonNullable<InferenceSession.SessionOptions['executionProviders']>[number];

/** Picks the smallest ORT build that covers the resolved EP list. */
function loadOrtFor(eps: readonly OrtExecutionProvider[]): Promise<OrtModule> {
	if (eps.includes('webnn')) return loadOrtWebNN();
	if (eps.includes('webgpu')) return loadOrtWebGpu();
	return loadOrtWasm();
}

/**
 * Resolves which subsystem owns the compute device from the *primary* EP and the
 * resources the caller supplied. Pure and order-independent so the WebNN case is
 * never masked by a fallback WebGPU device: a `['webnn', 'webgpu']` model given
 * both an `MLContext` and a renderer `GPUDevice` still reports `webnn-context`,
 * because WebNN is the active path and a WebGPU device may be injected only as a
 * fallback. Returns `undefined` for a deviceless (WASM, or context-less WebNN)
 * session.
 */
export function resolveDeviceOwner(
	primaryEp: OrtExecutionProvider,
	hasDevice: boolean,
	hasMlContext: boolean
): OrtDeviceOwner | undefined {
	if (primaryEp === 'webnn') return hasMlContext ? 'webnn-context' : undefined;
	if (primaryEp === 'webgpu') return hasDevice ? 'renderer' : 'ort-webgpu';
	return undefined;
}

function defaultTensorLocation(primaryEp: OrtExecutionProvider): OrtTensorLocation {
	switch (primaryEp) {
		case 'webgpu':
			return 'gpu-buffer';
		case 'webnn':
			return 'ml-tensor';
		case 'wasm':
			return 'cpu';
	}
}

function buildEpConfig(
	eps: readonly OrtExecutionProvider[],
	options: CreateOrtSessionOptions
): EpConfig[] {
	return eps.map((ep): EpConfig => {
		if (ep === 'webnn') {
			const deviceType = options.webnnDeviceType ?? 'gpu';
			return options.mlContext !== undefined
				? { name: 'webnn', deviceType, context: options.mlContext }
				: { name: 'webnn', deviceType };
		}
		return ep;
	});
}

/**
 * Creates an ORT session under the foundation's policy and returns it alongside
 * the resolved EP/tensor-location/device-ownership facts (for diagnostics).
 * Throws {@link OrtEpPolicyError} before loading anything if the EP list violates
 * the frame-coupled rule.
 */
export async function createOrtSession(
	options: CreateOrtSessionOptions
): Promise<OrtSessionHandle> {
	const eps = resolveExecutionProviders({
		frameCoupled: options.manifest.frameCoupled,
		executionProviders: options.executionProviders ?? options.manifest.executionProviders
	});
	const primaryEp = eps[0]!;
	const ort = await loadOrtFor(eps);

	const deviceOwner = resolveDeviceOwner(
		primaryEp,
		options.device !== undefined,
		options.mlContext !== undefined
	);
	// Inject the renderer's device whenever WebGPU may run (primary or fallback);
	// must be set before the first session. This does not change ownership: a
	// WebNN-primary session still reports `webnn-context` above.
	if (eps.includes('webgpu') && options.device) {
		ort.env.webgpu.device = options.device;
	}

	const tensorLocation =
		options.tensorLocation ?? options.manifest.tensorLocation ?? defaultTensorLocation(primaryEp);

	const sessionOptions: InferenceSession.SessionOptions = {
		executionProviders: buildEpConfig(eps, options),
		// Keep GPU/ML outputs on-device; 'cpu' is ORT's default so it is left unset.
		...(tensorLocation !== 'cpu' ? { preferredOutputLocation: tensorLocation } : {})
	};

	const session = await ort.InferenceSession.create(options.modelBytes, sessionOptions);

	// Expose the WebGPU device only when WebGPU is the active (primary) path: the
	// caller's device when injected, otherwise the one ORT created and owns.
	let device: GPUDevice | undefined;
	if (primaryEp === 'webgpu') {
		device = options.device ?? (await ort.env.webgpu.device);
	}

	return {
		session,
		executionProviders: eps,
		primaryEp,
		tensorLocation,
		...(deviceOwner ? { deviceOwner } : {}),
		...(device ? { device } : {})
	};
}
