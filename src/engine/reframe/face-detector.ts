/**
 * Face detection interface and LiteRT.js (`@litertjs/core`) implementation.
 *
 * Mirrors the DTLN/Whisper LiteRT runtimes: the `@litertjs/core` module is
 * reached through the untyped `../asr/litert-loader` boundary so its global
 * TypedArray augmentation never enters the TypeScript program, the WASM is
 * served same-origin from `public/litert/`, and the accelerator falls back
 * (WebNN → WebGPU/WASM) on a per-device compile failure. The output-decode and
 * NMS are pure functions so they are unit-testable without the runtime.
 */

import { loadLiteRtModule } from '../asr/litert-loader';
import type { ReframeModelManifest } from './model-manifest';

export type ReframeAccelerator = 'wasm' | 'webgpu' | 'webnn';

export interface FaceDetection {
	/** Normalised left edge in [0,1]. */
	x: number;
	/** Normalised top edge in [0,1]. */
	y: number;
	/** Normalised width. */
	width: number;
	/** Normalised height. */
	height: number;
	confidence: number;
}

export interface FaceDetector {
	detect(imageData: ImageData): Promise<FaceDetection[]>;
	dispose(): void;
}

export interface FaceDetectorOptions {
	/** Minimum (post-sigmoid) confidence to keep a detection. */
	scoreThreshold: number;
	/** IoU above which overlapping detections are merged by NMS. */
	iouThreshold: number;
}

export const DEFAULT_FACE_DETECTOR_OPTIONS: FaceDetectorOptions = {
	scoreThreshold: 0.5,
	iouThreshold: 0.3
};

/** Maximum longest edge for analysis frames. */
const MAX_ANALYSIS_EDGE = 512;
/** LiteRT models are exported with a single default serving signature. */
const SIGNATURE = 'serving_default';

function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

/** IoU of two normalised left/top/width/height boxes. */
function iouLTWH(a: FaceDetection, b: FaceDetection): number {
	const ax2 = a.x + a.width;
	const ay2 = a.y + a.height;
	const bx2 = b.x + b.width;
	const by2 = b.y + b.height;
	const ix1 = Math.max(a.x, b.x);
	const iy1 = Math.max(a.y, b.y);
	const ix2 = Math.min(ax2, bx2);
	const iy2 = Math.min(ay2, by2);
	if (ix2 <= ix1 || iy2 <= iy1) return 0;
	const inter = (ix2 - ix1) * (iy2 - iy1);
	const union = a.width * a.height + b.width * b.height - inter;
	return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression, highest confidence first. */
function nonMaxSuppression(boxes: FaceDetection[], iouThreshold: number): FaceDetection[] {
	const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
	const kept: FaceDetection[] = [];
	for (const box of sorted) {
		if (kept.every((k) => iouLTWH(k, box) < iouThreshold)) kept.push(box);
	}
	return kept;
}

/**
 * Decode a single-stage face detector's output tensor into normalised
 * detections. The bundled TFLite model (T15.2) must conform to this contract: a
 * flat `Float32Array` shaped `[N, stride]` (a leading batch dim of 1 is allowed,
 * i.e. `[1, N, stride]`), `stride >= 5`, each row `[scoreLogit, cx, cy, w, h,
 * ...extra]` with `cx`/`cy`/`w`/`h` the box centre and size normalised to
 * `[0,1]` — i.e. a model exported with its anchor decode + NMS folded in. Scores
 * pass through a sigmoid; rows below `scoreThreshold` are dropped, and the
 * survivors are de-duplicated with greedy IoU NMS. Returns boxes in
 * left/top/width/height form.
 */
export function decodeFaceDetections(
	output: Float32Array | number[],
	dims: readonly number[],
	options: FaceDetectorOptions = DEFAULT_FACE_DETECTOR_OPTIONS
): FaceDetection[] {
	// Collapse an optional leading batch dim of 1.
	const shape = dims.length === 3 && dims[0] === 1 ? dims.slice(1) : dims;
	if (shape.length !== 2 || shape[1] < 5) return [];
	const count = shape[0];
	const stride = shape[1];
	const detections: FaceDetection[] = [];
	for (let i = 0; i < count; i++) {
		const base = i * stride;
		const confidence = sigmoid(output[base]);
		if (confidence < options.scoreThreshold) continue;
		const cx = output[base + 1];
		const cy = output[base + 2];
		const w = output[base + 3];
		const h = output[base + 4];
		if (!(w > 0) || !(h > 0)) continue;
		detections.push({
			x: cx - w / 2,
			y: cy - h / 2,
			width: w,
			height: h,
			confidence
		});
	}
	return nonMaxSuppression(detections, options.iouThreshold);
}

/**
 * Downscale an ImageData so its longest edge is at most `maxEdge`.
 * Returns the original if already small enough.
 */
export function downscaleForAnalysis(
	imageData: ImageData,
	maxEdge: number = MAX_ANALYSIS_EDGE
): ImageData {
	const { width, height } = imageData;
	const longest = Math.max(width, height);
	if (longest <= maxEdge) return imageData;

	const scale = maxEdge / longest;
	const newW = Math.round(width * scale);
	const newH = Math.round(height * scale);

	// OffscreenCanvas is always available in the worker context.
	try {
		const canvas = new OffscreenCanvas(newW, newH);
		const ctx = canvas.getContext('2d');
		if (!ctx) return imageData;
		const srcCanvas = new OffscreenCanvas(width, height);
		const srcCtx = srcCanvas.getContext('2d');
		if (!srcCtx) return imageData;
		srcCtx.putImageData(imageData, 0, 0);
		ctx.drawImage(srcCanvas, 0, 0, newW, newH);
		return ctx.getImageData(0, 0, newW, newH);
	} catch {
		return imageData;
	}
}

/**
 * Resize an ImageData to a square `size × size` NHWC float32 tensor in [0,1]
 * (`[1, size, size, 3]`), the conventional input layout for TFLite vision
 * models. Browser-only (OffscreenCanvas); the analyser runs this in the worker.
 */
export function toModelInput(imageData: ImageData, size: number): Float32Array {
	const src = new OffscreenCanvas(imageData.width, imageData.height);
	const srcCtx = src.getContext('2d');
	const dst = new OffscreenCanvas(size, size);
	const dstCtx = dst.getContext('2d');
	if (!srcCtx || !dstCtx) throw new Error('Failed to acquire 2D context for model input.');
	srcCtx.putImageData(imageData, 0, 0);
	dstCtx.drawImage(src, 0, 0, size, size);
	const { data } = dstCtx.getImageData(0, 0, size, size);
	const out = new Float32Array(size * size * 3);
	for (let p = 0; p < size * size; p++) {
		out[p * 3] = data[p * 4] / 255;
		out[p * 3 + 1] = data[p * 4 + 1] / 255;
		out[p * 3 + 2] = data[p * 4 + 2] / 255;
	}
	return out;
}

// ── Minimal local typings for the @litertjs/core surface we use ──
interface LiteRtTensor {
	data(): Promise<ArrayLike<number>>;
	delete(): void;
}
interface LiteRtCompiledModel {
	run(signatureName: string, input: LiteRtTensor[]): Promise<LiteRtTensor[]>;
	delete(): void;
}
interface LiteRtLoadOptions {
	threads?: boolean;
	jspi?: boolean;
}
interface LiteRtCompileOptions {
	accelerator: string;
	webNNOptions?: { devicePreference: string };
}
interface LiteRtApi {
	loadLiteRt(path: string, options?: LiteRtLoadOptions): Promise<unknown>;
	loadAndCompile(model: Uint8Array, options: LiteRtCompileOptions): Promise<LiteRtCompiledModel>;
	Tensor: { fromTypedArray(data: Float32Array | Int32Array, shape: number[]): LiteRtTensor };
}

let liteRtLoaded = false;

function loadOptions(acc: ReframeAccelerator): LiteRtLoadOptions {
	return acc === 'webnn' ? { threads: false, jspi: true } : { threads: false };
}

function compileOptionCandidates(acc: ReframeAccelerator): LiteRtCompileOptions[] {
	if (acc !== 'webnn') return [{ accelerator: acc }];
	return (['npu', 'gpu', 'cpu'] as const).map((devicePreference) => ({
		accelerator: acc,
		webNNOptions: { devicePreference }
	}));
}

export interface LiteRtFaceDetectorOptions {
	/** Directory the LiteRT.js WASM runtime loads from (served same-origin). */
	wasmPath: string;
	accelerator: ReframeAccelerator;
	/** Verified TFLite model file bytes (integrity checked by the caller). */
	modelBytes: Uint8Array;
	manifest: ReframeModelManifest;
	detectorOptions?: FaceDetectorOptions;
}

/**
 * Compile a TFLite face-detection model into a {@link FaceDetector} via LiteRT.js,
 * trying the requested accelerator and transparently falling back to `wasm` if
 * accelerated compilation fails on this device. Heavy and side-effecting — call
 * only from the analysis worker after the model bytes are verified.
 */
export async function createLiteRtFaceDetector(
	options: LiteRtFaceDetectorOptions
): Promise<FaceDetector> {
	const api = (await loadLiteRtModule()) as LiteRtApi;

	// Emscripten resolves the .wasm relative to the worker script unless given a
	// locator; point it at the served WASM directory instead.
	const wasmDir = options.wasmPath.endsWith('/') ? options.wasmPath : `${options.wasmPath}/`;
	(globalThis as unknown as { Module?: unknown }).Module = {
		locateFile: (file: string) =>
			file.startsWith('/') || /^https?:/.test(file) ? file : `${wasmDir}${file}`
	};

	let accelerator = options.accelerator;
	if (!liteRtLoaded) {
		try {
			await api.loadLiteRt(options.wasmPath, loadOptions(accelerator));
			liteRtLoaded = true;
		} catch (error) {
			if (accelerator === 'wasm') throw error;
			await api.loadLiteRt(options.wasmPath, loadOptions('wasm'));
			accelerator = 'wasm';
			liteRtLoaded = true;
		}
	}

	let model: LiteRtCompiledModel | null = null;
	let lastError: unknown;
	for (const compileOpts of compileOptionCandidates(accelerator)) {
		try {
			model = await api.loadAndCompile(options.modelBytes, compileOpts);
			break;
		} catch (error) {
			lastError = error;
		}
	}
	if (!model) {
		if (accelerator === 'wasm') throw lastError;
		model = await api.loadAndCompile(options.modelBytes, { accelerator: 'wasm' });
	}

	const compiled = model;
	const inputSize = options.manifest.inputSize;
	const stride = options.manifest.outputStride;
	const detectorOptions = options.detectorOptions ?? DEFAULT_FACE_DETECTOR_OPTIONS;

	return {
		async detect(imageData: ImageData): Promise<FaceDetection[]> {
			const input = toModelInput(imageData, inputSize);
			const inputTensor = api.Tensor.fromTypedArray(input, [1, inputSize, inputSize, 3]);
			let outputs: LiteRtTensor[];
			try {
				outputs = await compiled.run(SIGNATURE, [inputTensor]);
			} finally {
				inputTensor.delete();
			}
			try {
				const raw = await outputs[0]!.data();
				const flat = raw instanceof Float32Array ? raw : Float32Array.from(raw);
				const count = stride > 0 ? Math.floor(flat.length / stride) : 0;
				return decodeFaceDetections(flat, [count, stride], detectorOptions);
			} finally {
				for (const t of outputs) t.delete();
			}
		},
		dispose() {
			compiled.delete();
		}
	};
}

/**
 * Create a face detector that returns canned detections keyed by frame index
 * (R11.2 injection seam) — no LiteRT runtime, for unit tests.
 */
export function createMockFaceDetector(detections: Map<string, FaceDetection[]>): FaceDetector {
	let frameIndex = 0;
	return {
		async detect(): Promise<FaceDetection[]> {
			const key = `frame_${frameIndex++}`;
			return detections.get(key) ?? [];
		},
		dispose() {}
	};
}
