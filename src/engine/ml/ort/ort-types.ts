/**
 * Shared, runtime-free types for the ONNX Runtime Web (ORT) model platform.
 *
 * This module is the single source of truth for the small vocabulary the rest of
 * the ORT foundation (loader, manifest, asset loader, session, EP policy) and the
 * diagnostics layer share. It must stay dependency-free — importing it never pulls
 * `onnxruntime-web` into a bundle, which is what keeps the WebGPU/WebNN runtimes
 * lazy (see {@link file://./ort-loader.ts}).
 *
 * ORT is the repo's model runtime. LiteRT/TFLite is the legacy path being retired
 * feature-by-feature as license-verified ONNX models land; no new feature targets
 * it. See docs/ML-RUNTIME.md.
 */

/**
 * Execution providers the foundation supports. ORT exposes more (cpu, webgl,
 * dml, …) but the client-compute editor only ever targets these three:
 *
 * - `webgpu` — primary for full-frame / video-coupled models (zero-copy
 *   GPU-buffer tensor IO on a shared `GPUDevice`).
 * - `webnn`  — opt-in per model, only after operator-support proof.
 * - `wasm`   — small, non-frame-coupled models only.
 */
export type OrtExecutionProvider = 'webgpu' | 'webnn' | 'wasm';

/**
 * Where a tensor's bytes live. The names match ORT's `Tensor.DataLocation`
 * subset the foundation uses; `gpu-buffer` and `ml-tensor` keep frame data off
 * the CPU on the hot path, `cpu` is for diagnostics / small models only.
 */
export type OrtTensorLocation = 'cpu' | 'gpu-buffer' | 'ml-tensor';

/**
 * Which subsystem owns the `GPUDevice` (or `MLContext`) a session computes on.
 * Reported in diagnostics so a device-sharing regression is visible:
 *
 * - `ort-webgpu`     — ORT created and owns the WebGPU device. ORT does **not**
 *   adopt an externally-created `GPUDevice`: a `device` set on `env.webgpu` is
 *   ignored and ORT creates its own (microsoft/onnxruntime#26107). This is the
 *   only WebGPU path: ORT bootstraps the device and the renderer adopts
 *   `env.webgpu.device` for its own passes — never the other way round.
 * - `webnn-context`  — a WebNN `MLContext` (which *can* be pre-created from the
 *   renderer's `GPUDevice`) owns the compute path.
 */
export type OrtDeviceOwner = 'ort-webgpu' | 'webnn-context';

/** Model serialization format. Only ONNX is accepted by the foundation. */
export type OrtModelFormat = 'onnx';

/** One downloadable, digest-verified ONNX model file. */
export interface OrtModelAsset {
	/** Same-origin or allowlisted-host URL the bytes are fetched from. */
	readonly url: string;
	readonly sizeBytes: number;
	/** `sha256-<64 hex>` digest of the bytes; verified before any session use. */
	readonly checksum: string;
}

/**
 * A validated ONNX model manifest. Mirrors the LiteRT manifests' provenance +
 * integrity contract (license/source/size/SHA) and adds ORT-specific runtime
 * policy: the pinned, ordered execution providers and whether the model is
 * frame-coupled (which forbids a WASM/CPU fallback — see {@link file://./ep-policy.ts}).
 */
export interface OrtModelManifest {
	readonly id: string;
	readonly version: string;
	readonly license: string;
	readonly source: string;
	readonly format: OrtModelFormat;
	/** The single ONNX graph file. */
	readonly model: OrtModelAsset;
	/**
	 * Pinned, ordered execution-provider preference. ORT tries them in order; the
	 * foundation never silently appends `wasm` (which is ORT's own default).
	 */
	readonly executionProviders: readonly OrtExecutionProvider[];
	/**
	 * True for full-frame / video-coupled models (matte, interpolation, reframe).
	 * Frame-coupled models must never fall back to WASM or CPU tensors.
	 */
	readonly frameCoupled: boolean;
	/** ONNX opset version, when the manifest declares it. */
	readonly opset?: number;
	/** Preferred tensor IO location; defaults derived by the session wrapper. */
	readonly tensorLocation?: OrtTensorLocation;
	/** Optional human-facing model-card link for a future picker. */
	readonly infoUrl?: string;
}
