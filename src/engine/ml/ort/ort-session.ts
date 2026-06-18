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
 * - Wire device sharing. ORT does not adopt an externally-created `GPUDevice`:
 *   a `device` set on `ort.env.webgpu` is ignored and ORT creates its own
 *   internally (microsoft/onnxruntime#26107), so a buffer from any other device
 *   fails validation. A WebGPU session therefore always lets ORT bootstrap and
 *   own the device (`deviceOwner: 'ort-webgpu'`); the device ORT created — read
 *   back from `ort.env.webgpu.device` — is returned as `handle.device` for the
 *   renderer to adopt for its own passes. A WebNN `MLContext` (which *can* be
 *   pre-created from a `GPUDevice`) yields `'webnn-context'`.
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
import {
	loadOrtWasm,
	loadOrtWebGpu,
	loadOrtWebNN,
	ortWasmBasePath,
	type OrtModule
} from './ort-loader';

export interface CreateOrtSessionOptions {
	/** The validated ONNX model bytes (already digest-verified). */
	readonly modelBytes: Uint8Array;
	readonly manifest: OrtModelManifest;
	/** Optional EP override; still subject to the frame-coupled policy. */
	readonly executionProviders?: readonly OrtExecutionProvider[];
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
	/**
	 * The ORT-owned `GPUDevice` inference computes on, when the primary EP is
	 * WebGPU. The renderer adopts this for its own passes (ORT cannot adopt the
	 * renderer's device — see {@link OrtDeviceOwner}).
	 */
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
 * resources the caller supplied. A WebGPU session is always `ort-webgpu` — ORT
 * bootstraps and owns the device (it cannot adopt an externally-created one), and
 * the renderer adopts what ORT created. A WebNN-primary session reports
 * `webnn-context` only when an `MLContext` was supplied. Returns `undefined` for a
 * deviceless (WASM, or context-less WebNN) session.
 */
export function resolveDeviceOwner(
	primaryEp: OrtExecutionProvider,
	hasMlContext: boolean
): OrtDeviceOwner | undefined {
	if (primaryEp === 'webnn') return hasMlContext ? 'webnn-context' : undefined;
	if (primaryEp === 'webgpu') return 'ort-webgpu';
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

	// Point ORT at its same-origin, vendored WASM (no cross-origin CDN fetch under
	// COEP). Idempotent; must be set before the first session is created.
	ort.env.wasm.wasmPaths = ortWasmBasePath();

	const deviceOwner = resolveDeviceOwner(primaryEp, options.mlContext !== undefined);

	const tensorLocation =
		options.tensorLocation ?? options.manifest.tensorLocation ?? defaultTensorLocation(primaryEp);

	const sessionOptions: InferenceSession.SessionOptions = {
		executionProviders: buildEpConfig(eps, options),
		// Keep GPU/ML outputs on-device; 'cpu' is ORT's default so it is left unset.
		...(tensorLocation !== 'cpu' ? { preferredOutputLocation: tensorLocation } : {})
	};

	const session = await ort.InferenceSession.create(options.modelBytes, sessionOptions);

	// Expose the WebGPU device only when WebGPU is the active (primary) path: the
	// one ORT created and owns, for the renderer to adopt for its own passes.
	let device: GPUDevice | undefined;
	if (primaryEp === 'webgpu') {
		device = await ort.env.webgpu.device;
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
