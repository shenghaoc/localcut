/**
 * ORT/ONNX face detector for Smart Reframe (Phase 33 follow-up).
 *
 * Loads a digest-pinned face-detector ONNX model through the Phase-105 ORT
 * foundation:
 *
 *   manifest (fetch + validate) → ORT model bytes
 *   (`loadOrtModelAsset`, SHA-256 + OPFS cache) → {@link createOrtSession}
 *   (WebGPU / WebNN / WASM under the EP policy) → preprocess (ImageData →
 *   normalised Float32 tensor) → `session.run` → {@link decodeRawBboxOutput}
 *   or {@link decodeAnchorOffsetOutput} → normalised `FaceDetection[]`.
 *
 * The detector implements the shared {@link FaceDetector} interface, so it
 * slots into the Smart Reframe analysis worker without changing the
 * saliency/tracking/keyframe pipeline. The shipped manifest pins UltraFace
 * RFB-320; any load failure maps to the saliency fallback.
 *
 * Constraints:
 * - **No startup model load.** `onnxruntime-web` is reached only through
 *   `ort-loader.ts`'s dynamic imports, the same as Phase 37 interpolation.
 * - **No cloud inference, no telemetry, no image uploads.** Model bytes arrive
 *   through the same-origin `/_model/*` proxy and OPFS; inference runs on the
 *   user's device in the analysis worker.
 * - **WASM EP is size-gated.** A face detector running on WASM blocks the
 *   worker for the duration of `session.run`; the gate keeps that window
 *   short enough that cancellation between frames stays responsive.
 */
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web';
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtModelAsset, createOrtOpfsAssetStore } from '../ml/ort/ort-asset-loader';
import { loadOrtWasm } from '../ml/ort/ort-loader';
import type { OrtExecutionProvider, OrtModelAsset } from '../ml/ort/ort-types';
import type { FaceDetection, FaceDetector } from './face-detector';
import {
	decodeAnchorOffsetOutput,
	decodeRawBboxOutput,
	type AnchorOffsetDecodeConfig,
	type AnchorPrior,
	type RawBboxDecodeConfig
} from './face-detector-ort-decode';
import {
	inputTensorBytes,
	validateReframeFaceDetectorManifest,
	type FaceDetectorIoContract,
	type ReframeFaceDetectorManifest
} from './face-detector-ort-manifest';

/**
 * Largest input tensor permitted on the WASM execution provider. A
 * BlazeFace-class 128×128×3×fp32 input is 192 KiB; YuNet 320×320×3×fp32 is
 * ~1.2 MiB. SCRFD 640×640×3×fp32 (~4.7 MiB) is rejected on WASM — its session
 * latency would block the analysis worker too long for cancellation to feel
 * snappy. WebGPU / WebNN have no such gate.
 */
export const WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES = 2 * 1024 * 1024;

/** Injection seams (mostly for unit tests; production paths use the defaults). */
export interface OrtFaceDetectorPorts {
	/** Fetch the manifest JSON. Defaults to {@link fetch} → `.json()`. */
	fetchManifest?: (url: string) => Promise<unknown>;
	/** Load ORT model bytes. Defaults to {@link loadOrtModelAsset}. */
	loadModelBytes?: (asset: OrtModelAsset) => Promise<Uint8Array>;
	/** Create the ORT session. Defaults to {@link createOrtSession}. */
	createSession?: typeof createOrtSession;
	/** Resize ImageData to the model's input shape. Defaults to an internal
	 *  OffscreenCanvas helper; tests inject a deterministic stub. */
	resizeImageData?: (image: ImageData, width: number, height: number) => Promise<Uint8ClampedArray>;
}

export interface CreateOrtFaceDetectorOptions extends OrtFaceDetectorPorts {
	manifestUrl: string;
}

/** Error raised when the ORT face-detector path cannot load. The reframe worker
 *  catches it and keeps analysis on saliency. */
export class OrtFaceDetectorUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OrtFaceDetectorUnavailableError';
	}
}

/**
 * Build a fully-loaded ORT-backed {@link FaceDetector}. Throws
 * {@link OrtFaceDetectorUnavailableError} when the manifest is a template, the
 * EP policy is violated, the WASM size gate trips, or the network/decode path
 * fails — the caller maps these to its saliency fallback.
 */
export async function createOrtFaceDetector(
	options: CreateOrtFaceDetectorOptions
): Promise<FaceDetector> {
	const fetchManifest = options.fetchManifest ?? defaultFetchManifest;
	const loadModelBytes = options.loadModelBytes ?? defaultLoadModelBytes;
	const createSession = options.createSession ?? createOrtSession;
	const resizeImageData = options.resizeImageData ?? createDefaultResizeImageData();

	const manifestRaw = await fetchManifest(options.manifestUrl);
	let manifest: ReframeFaceDetectorManifest;
	try {
		manifest = validateReframeFaceDetectorManifest(manifestRaw);
	} catch (error) {
		throw new OrtFaceDetectorUnavailableError(
			error instanceof Error ? error.message : String(error)
		);
	}

	const modelBytes = await loadModelBytes(manifest.model);

	let handle: OrtSessionHandle;
	try {
		handle = await createSession({
			modelBytes,
			manifest,
			// Force CPU outputs so `readNumericTensor` can decode them in TS.
			// On webgpu/webnn primary EPs the session wrapper would otherwise
			// default to `gpu-buffer`/`ml-tensor`, which don't expose a
			// TypedArray `.data`. Since detection runs at a low analysis fps
			// (default 2 fps) the readback overhead is negligible.
			tensorLocation: 'cpu'
		});
	} catch (error) {
		throw new OrtFaceDetectorUnavailableError(
			`ORT face detector session creation failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	try {
		// `wasm` anywhere in the resolved EP list could be exercised — either as
		// the primary EP or as the fallback ORT picks when a GPU-class EP fails
		// to init. Gate the input tensor size against the WASM budget in either
		// case so the analysis worker stays responsive.
		assertWasmEpAllowed(manifest.io, handle.executionProviders);
	} catch (error) {
		await safeRelease(handle.session);
		throw error;
	}

	return new OrtFaceDetector(handle, manifest, resizeImageData);
}

/**
 * Enforce the WASM input-tensor-size budget so a large detector can never run
 * on the WASM EP — including when WASM is a *fallback* behind webgpu/webnn in
 * the resolved EP list. WebGPU-only / WebNN-only sessions are unconstrained.
 * Throws {@link OrtFaceDetectorUnavailableError} so the caller treats it as
 * "no detector available" and falls back to saliency.
 */
export function assertWasmEpAllowed(
	io: FaceDetectorIoContract,
	executionProviders: readonly OrtExecutionProvider[]
): void {
	if (!executionProviders.includes('wasm')) return;
	const bytes = inputTensorBytes(io);
	if (bytes > WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES) {
		throw new OrtFaceDetectorUnavailableError(
			`ORT face detector WASM EP forbidden: input tensor ${bytes} bytes ` +
				`exceeds the ${WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES}-byte budget for ` +
				`worker-responsive inference. Vendor a smaller detector, or remove ` +
				`'wasm' from the manifest's executionProviders.`
		);
	}
}

class OrtFaceDetector implements FaceDetector {
	constructor(
		private readonly handle: OrtSessionHandle,
		private readonly manifest: ReframeFaceDetectorManifest,
		private readonly resize: NonNullable<OrtFaceDetectorPorts['resizeImageData']>
	) {}

	async detect(imageData: ImageData): Promise<FaceDetection[]> {
		if (imageData.width === 0 || imageData.height === 0) return [];
		const io = this.manifest.io;
		const decode = this.manifest.decode;
		const resized = await this.resize(imageData, io.inputWidth, io.inputHeight);
		const tensorData = normalizePixelsToTensor(resized, io);

		const { Tensor } = await loadOrtTensor();
		const dims =
			io.layout === 'nchw'
				? [1, io.inputChannels, io.inputHeight, io.inputWidth]
				: [1, io.inputHeight, io.inputWidth, io.inputChannels];
		const input = new Tensor('float32', tensorData, dims);

		const feeds: Record<string, OrtTensor> = { [io.inputName]: input as unknown as OrtTensor };
		let outputs: Readonly<Record<string, OrtTensor>>;
		try {
			outputs = await this.handle.session.run(feeds);
		} finally {
			// session.run may reject (device loss, IO mismatch, …); dispose the
			// input tensor on every path so a failed detect() does not leak
			// CPU/GPU/ML buffers ORT may have allocated.
			disposeTensor(input);
		}
		try {
			// xywh-pixel boxes are in the *model input* pixel space (the
			// inputWidth × inputHeight tensor the model saw), not the analysis
			// frame the user supplied — pass the model dims so a centered box
			// at x=64 in a 128px detector normalises to 0.5, not 0.125.
			return decodeOutputs(outputs, decode, io.inputWidth, io.inputHeight);
		} finally {
			// Dispose every returned output tensor — over a long analysis these
			// otherwise accumulate one allocation per sampled frame.
			for (const tensor of Object.values(outputs)) disposeTensor(tensor);
		}
	}

	dispose(): void {
		void safeRelease(this.handle.session);
	}
}

function decodeOutputs(
	outputs: Readonly<Record<string, OrtTensor>>,
	decode: ReframeFaceDetectorManifest['decode'],
	sourceWidth: number,
	sourceHeight: number
): FaceDetection[] {
	const boxes = readNumericTensor(outputs, decode.boxesOutputName, 'boxes');
	const scores = readNumericTensor(outputs, decode.scoresOutputName, 'scores');
	if (decode.type === 'raw-bbox') {
		const config: RawBboxDecodeConfig = {
			type: 'raw-bbox',
			boxFormat: decode.boxFormat,
			scoreThreshold: decode.scoreThreshold,
			iouThreshold: decode.iouThreshold,
			maxDetections: decode.maxDetections,
			...(decode.applySigmoid !== undefined ? { applySigmoid: decode.applySigmoid } : {}),
			...(decode.scoreStride !== undefined ? { scoreStride: decode.scoreStride } : {}),
			...(decode.scoreIndex !== undefined ? { scoreIndex: decode.scoreIndex } : {})
		};
		return decodeRawBboxOutput(boxes, scores, config, sourceWidth, sourceHeight);
	}
	// Anchor priors come from a session output named by `decode.anchorsOutputName`
	// (laid out [N × 4] as `cx, cy, width, height` per candidate, normalised).
	// Without that name we cannot decode anchor-offset predictions — abort
	// cleanly so the caller keeps analysis on saliency.
	if (!decode.anchorsOutputName) {
		throw new OrtFaceDetectorUnavailableError(
			'anchor-offset decoder requires decode.anchorsOutputName so anchor ' +
				'priors can be read from the session results.'
		);
	}
	const anchorData = readNumericTensor(outputs, decode.anchorsOutputName, 'anchors');
	const anchors = readAnchorPriors(anchorData);
	const config: AnchorOffsetDecodeConfig = {
		type: 'anchor-offset',
		anchors,
		scoreThreshold: decode.scoreThreshold,
		iouThreshold: decode.iouThreshold,
		maxDetections: decode.maxDetections,
		...(decode.applySigmoid !== undefined ? { applySigmoid: decode.applySigmoid } : {}),
		...(decode.scoreStride !== undefined ? { scoreStride: decode.scoreStride } : {}),
		...(decode.scoreIndex !== undefined ? { scoreIndex: decode.scoreIndex } : {}),
		...(decode.variance !== undefined ? { variance: decode.variance } : {})
	};
	return decodeAnchorOffsetOutput(boxes, scores, config);
}

/** Parse a flat anchor-prior buffer `[cx, cy, w, h, …]` into structured priors. */
function readAnchorPriors(data: ArrayLike<number>): AnchorPrior[] {
	const count = Math.floor(data.length / 4);
	const priors: AnchorPrior[] = [];
	for (let i = 0; i < count; i++) {
		const offset = i * 4;
		priors.push({
			cx: data[offset] as number,
			cy: data[offset + 1] as number,
			width: data[offset + 2] as number,
			height: data[offset + 3] as number
		});
	}
	return priors;
}

function readNumericTensor(
	outputs: Readonly<Record<string, OrtTensor>>,
	name: string,
	role: string
): ArrayLike<number> {
	const tensor = outputs[name];
	if (!tensor) {
		throw new OrtFaceDetectorUnavailableError(
			`ORT face detector ${role} output "${name}" missing from session results.`
		);
	}
	const data = tensor.data;
	if (
		!(
			data instanceof Float32Array ||
			data instanceof Float64Array ||
			data instanceof Int32Array ||
			data instanceof Int16Array ||
			data instanceof Uint8Array ||
			data instanceof Uint16Array
		)
	) {
		throw new OrtFaceDetectorUnavailableError(
			`ORT face detector ${role} tensor "${name}" has unsupported dtype ${tensor.type}.`
		);
	}
	return data as ArrayLike<number>;
}

/** ORT-runtime tensor handles expose an optional `dispose()`. Call it
 *  defensively so a missing method on a stubbed tensor never throws. */
function disposeTensor(tensor: unknown): void {
	const maybe = tensor as { dispose?: () => void } | null | undefined;
	maybe?.dispose?.();
}

/** Input pixel formats the preprocessor can handle. The source ImageData is
 *  always 4-channel RGBA; for `inputChannels = 3` we drop alpha, for `4` we
 *  pass alpha through, for `1` we use the red channel (no luminance
 *  conversion — face detectors almost always take RGB, and a single-channel
 *  graph is uncommon enough that gray comes from the model's own preprocess). */
const SUPPORTED_INPUT_CHANNELS: ReadonlySet<number> = new Set([1, 3, 4]);

/**
 * Normalise an RGBA pixel buffer at `(io.inputWidth × io.inputHeight)` into the
 * float32 tensor the model expects. Pure — no DOM/Canvas access, no
 * `onnxruntime-web` import — so the layout/normalisation contract is unit
 * testable on synthetic byte arrays. Hot-path: the per-channel normalisation
 * is inlined per `inputRange` so the inner loop does no function calls or
 * array-bounds checks (called once per analysis frame).
 */
export function normalizePixelsToTensor(
	pixels: ArrayLike<number>,
	io: FaceDetectorIoContract
): Float32Array {
	const { inputWidth: w, inputHeight: h, inputChannels: c, layout, inputRange } = io;
	if (!SUPPORTED_INPUT_CHANNELS.has(c)) {
		throw new Error(
			`normalizePixelsToTensor: inputChannels=${c} unsupported (preprocessor only handles RGB/RGBA/gray).`
		);
	}
	const pixelCount = w * h;
	if (pixels.length < pixelCount * 4) {
		throw new Error(
			`normalizePixelsToTensor: pixel buffer too small (got ${pixels.length}, want ≥ ${pixelCount * 4}).`
		);
	}
	const out = new Float32Array(pixelCount * c);
	// Precompute per-channel mean/std so the hot loop reads from a tight
	// Float32Array, not the (often readonly) manifest arrays.
	const meanSrc = io.mean ?? [0, 0, 0, 0];
	const stdSrc = io.std ?? [1, 1, 1, 1];
	const meanArr = new Float32Array(c);
	const stdArr = new Float32Array(c);
	for (let i = 0; i < c; i++) {
		meanArr[i] = meanSrc[i] ?? 0;
		stdArr[i] = stdSrc[i] ?? 1;
	}
	const isNchw = layout === 'nchw';
	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
		const src = pixelIndex * 4;
		for (let channel = 0; channel < c; channel++) {
			const byte = pixels[src + channel] as number;
			const unit = byte / 255;
			let value: number;
			if (inputRange === 'unit') {
				value = unit;
			} else if (inputRange === 'signed-unit') {
				value = unit * 2 - 1;
			} else {
				// mean-std: `(unit − mean) / std`, with the std=0 → 0 guard.
				const s = stdArr[channel]!;
				value = s !== 0 ? (unit - meanArr[channel]!) / s : 0;
			}
			if (isNchw) {
				out[channel * pixelCount + pixelIndex] = value;
			} else {
				out[pixelIndex * c + channel] = value;
			}
		}
	}
	return out;
}

async function defaultFetchManifest(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new OrtFaceDetectorUnavailableError(
			`ORT face-detector manifest fetch failed: HTTP ${response.status}`
		);
	}
	return await response.json();
}

async function defaultLoadModelBytes(asset: OrtModelAsset): Promise<Uint8Array> {
	const store = await createOrtOpfsAssetStore();
	return loadOrtModelAsset(asset, { store });
}

function createDefaultResizeImageData(): NonNullable<OrtFaceDetectorPorts['resizeImageData']> {
	/** Reusable canvas + 2D context scoped to one detector instance. The Smart
	 *  Reframe worker is single-threaded per analysis and resizes to a fixed
	 *  model-input size for every frame, so allocating a fresh canvas each call
	 *  would churn the worker's heap. Keeping this in the closure avoids a
	 *  module-global canvas shared across future detector instances. */
	let resizeCanvas: OffscreenCanvas | null = null;
	let resizeCtx: OffscreenCanvasRenderingContext2D | null = null;

	return async function resizeImageData(
		image: ImageData,
		width: number,
		height: number
	): Promise<Uint8ClampedArray> {
		// createImageBitmap accepts ImageData; subsequent drawImage onto a
		// model-size OffscreenCanvas scales it. Both APIs exist in DedicatedWorker.
		if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
			throw new OrtFaceDetectorUnavailableError(
				'ORT face detector requires createImageBitmap + OffscreenCanvas (not available in this context).'
			);
		}
		const bitmap = await createImageBitmap(image);
		try {
			if (!resizeCanvas || resizeCanvas.width !== width || resizeCanvas.height !== height) {
				resizeCanvas = new OffscreenCanvas(width, height);
				resizeCtx = resizeCanvas.getContext('2d', { willReadFrequently: true });
			}
			const ctx = resizeCtx;
			if (!ctx) {
				throw new OrtFaceDetectorUnavailableError(
					'ORT face detector could not obtain a 2D context for resize.'
				);
			}
			ctx.drawImage(bitmap, 0, 0, width, height);
			return ctx.getImageData(0, 0, width, height).data;
		} finally {
			bitmap.close();
		}
	};
}

async function loadOrtTensor(): Promise<{ Tensor: typeof OrtTensor }> {
	// `Tensor` is on `ort.Tensor` for every ORT build (WebGPU / WebNN / WASM);
	// the smallest WASM build is enough to construct a CPU input tensor. In
	// production the WebGPU build is typically already cached from the session,
	// so this is a no-op dynamic-import lookup, not a second runtime download.
	const ort = await loadOrtWasm();
	return { Tensor: ort.Tensor as unknown as typeof OrtTensor };
}

async function safeRelease(session: InferenceSession): Promise<void> {
	try {
		await session.release();
	} catch {
		// Session may already be released or never fully initialised; swallow.
	}
}
