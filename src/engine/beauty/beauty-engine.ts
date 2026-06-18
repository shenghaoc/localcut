/**
 * Beauty runtime engine — Phase 32b, ORT/ONNX.
 *
 * Lives in the pipeline worker. Loads a face **detector** + dense **landmark**
 * ONNX pair on the Phase-105 ORT foundation (`src/engine/ml/ort/`). ORT bootstraps
 * and owns the `GPUDevice` (`deviceOwner: 'ort-webgpu'`; ORT ignores an injected
 * device — microsoft/onnxruntime#26107); both sessions and the engine's own
 * preprocess passes run on it (`handle.device`), and the renderer adopts that
 * device for the compositor's beauty-warp pass. It runs a cadence-gated per-frame
 * solve:
 *
 *   VideoFrame → importExternalTexture → beauty-preprocess WGSL (ROI resize/
 *   normalize → NHWC GPUBuffer) → `ort.Tensor.fromGpuBuffer` → detector
 *   `session.run` → primary-face select → landmark `session.run` → small landmark
 *   readback → One-Euro smooth → landmark ring → timestamp interpolation →
 *   `Float32Array` consumed by `beauty-warp.wgsl` in the compositor.
 *
 * Local-only: ONNX bytes load on explicit user action, manifest-validated and
 * SHA-256/OPFS-pinned through `loadOrtModelAsset`; frames never leave the device;
 * the frame-coupled EP policy forbids a WASM/CPU full-frame realtime fallback.
 *
 * Until a license-verified detector/landmark pair is vendored, the shipped
 * `manifest.json` is a `template` — `validateBeautyManifest` rejects it, so
 * `ensureModelLoaded` resolves to `failed` with "No compatible beauty model
 * configured" and the feature stays gated (R1.3, R7.1).
 */

import type { Tensor as OrtTensor } from 'onnxruntime-web';
import beautyPreprocessSource from '../shaders/beauty-preprocess.wgsl?raw';
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtWebGpu, type OrtModule } from '../ml/ort/ort-loader';
import {
	createOrtOpfsAssetStore,
	loadOrtModelAsset,
	type LoadOrtModelAssetDeps
} from '../ml/ort/ort-asset-loader';
import type { OrtExecutionProvider, OrtModelManifest } from '../ml/ort/ort-types';
import type { BeautyEffectSnapshot } from '../../protocol';
import {
	BeautyManifestError,
	validateBeautyManifest,
	type BeautyModelAsset,
	type BeautyModelManifest
} from './model-manifest';
import { LANDMARK_COUNT, LANDMARK_FLOATS } from './beauty-params';
import {
	DETECTOR_FLOATS,
	DETECTOR_SIZE,
	LANDMARK_INPUT_FLOATS,
	LANDMARK_INPUT_SIZE
} from './preprocess';
import {
	advanceCadence,
	createCadenceState,
	DEFAULT_CADENCE_CONFIG,
	type CadenceState
} from './cadence';
import {
	createLandmarkRing,
	interpolateLandmarks,
	pushSample,
	resetRing,
	type LandmarkRing
} from './landmark-track';
import {
	applyOneEuro,
	createOneEuroState,
	DEFAULT_ONE_EURO,
	resetOneEuroState,
	type OneEuroState
} from './one-euro';
import {
	acknowledgeRamp,
	createPrimaryFaceState,
	updatePrimaryFace,
	type FaceCandidate,
	type PrimaryFaceState
} from './primary-face';

/** Same-origin manifest describing the deployed beauty ONNX models. */
export const DEFAULT_BEAUTY_MANIFEST_URL = '/models/beauty/manifest.json';

/** Status surfaced to the UI/diagnostics — mirrors `BeautyModelStatus`. */
export type BeautyEngineStatus = 'not-loaded' | 'loading' | 'loaded' | 'failed';

/** Streaming download progress for a model asset. */
export interface BeautyLoadProgress {
	/** Bytes received across all assets so far. */
	downloadedBytes: number;
	/** Total declared bytes across all assets. */
	totalBytes: number;
	/** Whether the most recent asset was served from the OPFS cache. */
	cached: boolean;
}

/** One cadence solve's result, in full-frame normalized landmark coords. */
export interface BeautyRawSolve {
	/** Primary-face landmarks (`LANDMARK_FLOATS`, full-frame normalized) or `null` when no usable face. */
	landmarks: Float32Array | null;
	confidence: number;
	faceId: string;
	/** True on handoff / confidence loss / scene loss: reset history and ramp to identity. */
	reset: boolean;
}

/** Per-frame inference (detector → primary-face → landmark). Injectable for tests. */
export type BeautyInferenceFn = (
	frame: VideoFrame,
	timeS: number,
	primary: PrimaryFaceState
) => Promise<BeautyRawSolve | null>;

export interface BeautyEngineOptions {
	manifestUrl?: string;
	onStatus?: (status: BeautyEngineStatus, error?: string) => void;
	onProgress?: (progress: BeautyLoadProgress) => void;
	/** Timeline fps used to derive the solve cadence (defaults to 30). */
	projectFps?: number;
	/** Override the GPU/ORT inference path (tests inject synthetic landmarks). */
	inference?: BeautyInferenceFn;
}

/** Per-clip temporal state for the cadence-gated solve + interpolation. */
interface BeautyClipState {
	cadence: CadenceState;
	ring: LandmarkRing;
	euro: OneEuroState;
	primary: PrimaryFaceState;
	/** One-Euro output buffer (reused each solve; single-flight so never raced). */
	smoothed: Float32Array;
	/** Per-frame interpolation output handed to the compositor (reused, no per-frame alloc). */
	out: Float32Array;
	lastSolveT: number;
	hasSolved: boolean;
}

interface LoadedSession {
	handle: OrtSessionHandle;
	asset: BeautyModelAsset;
}

interface LoadedModels {
	detector: LoadedSession;
	landmarks: LoadedSession;
	manifest: BeautyModelManifest;
}

/** Build a frame-coupled WebGPU ORT manifest for one beauty asset. */
function ortManifestForAsset(
	beautyManifest: BeautyModelManifest,
	asset: BeautyModelAsset
): OrtModelManifest {
	return {
		id: `${beautyManifest.id}:${asset.role}`,
		version: beautyManifest.version,
		license: asset.license,
		source: asset.source,
		format: 'onnx',
		// Per-frame face inference on ORT's own device: WebGPU-only, no WASM/CPU
		// full-frame fallback (R1.1/R1.2). Inputs and outputs stay on GPU buffers.
		frameCoupled: true,
		executionProviders: ['webgpu'],
		tensorLocation: 'gpu-buffer',
		model: { url: asset.url, sizeBytes: asset.sizeBytes, checksum: asset.checksum }
	};
}

export class BeautyEngine {
	/** ORT-owned device, set once the sessions are created in {@link loadModels};
	 *  the engine's own preprocess passes run on it and the renderer adopts it. */
	private device: GPUDevice | null = null;
	private readonly manifestUrl: string;
	private readonly onStatus?: (status: BeautyEngineStatus, error?: string) => void;
	private readonly onProgress?: (progress: BeautyLoadProgress) => void;

	private readonly projectFps: number;
	private readonly inference: BeautyInferenceFn;
	/** True when inference was injected (tests): allow solving without a real model load. */
	private readonly inferenceInjected: boolean;

	private ort: OrtModule | null = null;
	private models: LoadedModels | null = null;
	private status: BeautyEngineStatus = 'not-loaded';
	private loadError: string | undefined;
	private loadPromise: Promise<void> | null = null;
	private disposed = false;

	/** Per-clip temporal state (ring/one-euro/primary/cadence). */
	private readonly clipStates = new Map<string, BeautyClipState>();
	/** Engine-wide single-flight: the GPU preprocess buffers are shared, so only one
	 *  solve runs at a time; other frames interpolate the latest ring (matte pattern). */
	private running: Promise<void> | null = null;

	// GPU preprocess resources (created lazily on the first solve).
	private preprocessPipeline: GPUComputePipeline | null = null;
	private preprocessUniform: GPUBuffer | null = null;
	private detectorInputBuf: GPUBuffer | null = null;
	private landmarkInputBuf: GPUBuffer | null = null;
	private frameSampler: GPUSampler | null = null;
	/** Reused full-frame landmark scratch (single-flight, so never raced). */
	private readonly rawScratch = new Float32Array(LANDMARK_FLOATS);

	constructor(options: BeautyEngineOptions) {
		this.manifestUrl = options.manifestUrl ?? DEFAULT_BEAUTY_MANIFEST_URL;
		this.onStatus = options.onStatus;
		this.onProgress = options.onProgress;
		this.projectFps = options.projectFps ?? 30;
		this.inferenceInjected = options.inference !== undefined;
		this.inference =
			options.inference ?? ((frame, timeS, primary) => this.gpuInfer(frame, timeS, primary));
	}

	getStatus(): BeautyEngineStatus {
		return this.status;
	}

	getModelManifest(): BeautyModelManifest | null {
		return this.models?.manifest ?? null;
	}

	/** ORT execution provider actually selected for the loaded sessions. */
	getExecutionProvider(): OrtExecutionProvider | null {
		return this.models?.detector.handle.primaryEp ?? null;
	}

	/** Triggers a lazy, idempotent model load. Resolves when loaded or failed. */
	ensureModelLoaded(): Promise<void> {
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.loadModels().catch((error) => {
			this.status = 'failed';
			// A placeholder/template manifest is the "no compatible model configured"
			// state; surface it as a clear, non-alarming message (R1.3).
			this.loadError =
				error instanceof BeautyManifestError
					? 'No compatible beauty model configured.'
					: error instanceof Error
						? error.message
						: String(error);
			this.loadPromise = null; // allow retry
			this.onStatus?.(this.status, this.loadError);
		});
		return this.loadPromise;
	}

	private async loadModels(): Promise<void> {
		this.status = 'loading';
		this.loadError = undefined;
		this.onStatus?.(this.status);

		const response = await fetch(this.manifestUrl);
		if (!response.ok) {
			throw new Error(`Beauty model manifest fetch failed: HTTP ${response.status}`);
		}
		// Throws BeautyManifestError on a placeholder/template manifest or an invalid
		// shape — caught by ensureModelLoaded → "No compatible beauty model configured".
		const manifest = validateBeautyManifest(await response.json());

		const store = await createOrtOpfsAssetStore();
		const totalBytes = manifest.sizeBytes;
		let downloadedBytes = 0;

		const loadAsset = async (asset: BeautyModelAsset): Promise<LoadedSession> => {
			let assetReceived = 0;
			let cached = false;
			const deps: LoadOrtModelAssetDeps = {
				store: store ?? undefined,
				onProgress: ({ receivedBytes }) => {
					assetReceived = receivedBytes;
					this.onProgress?.({
						downloadedBytes: downloadedBytes + assetReceived,
						totalBytes,
						cached
					});
				},
				onSource: (source) => {
					cached = source === 'cache';
				}
			};
			const modelBytes = await loadOrtModelAsset(
				{ url: asset.url, sizeBytes: asset.sizeBytes, checksum: asset.checksum },
				deps
			);
			downloadedBytes += asset.sizeBytes;
			this.onProgress?.({ downloadedBytes, totalBytes, cached });
			const handle = await createOrtSession({
				modelBytes,
				manifest: ortManifestForAsset(manifest, asset),
				tensorLocation: 'gpu-buffer'
			});
			return { handle, asset };
		};

		// Sequential: detector first (cheaper, gates landmark relevance), then landmarks.
		const detector = await loadAsset(manifest.assets.detector);
		// If the landmark load fails (network / session creation), the detector session
		// is already created — release it before rethrowing so it can't leak.
		let landmarks: LoadedSession;
		try {
			landmarks = await loadAsset(manifest.assets.landmarks);
		} catch (error) {
			await detector.handle.session.release();
			throw error;
		}

		if (this.disposed) {
			await detector.handle.session.release();
			await landmarks.handle.session.release();
			return;
		}
		if (!detector.handle.device) {
			await detector.handle.session.release();
			await landmarks.handle.session.release();
			throw new Error('ORT-WebGPU beauty session exposed no GPUDevice.');
		}
		// Both sessions ran on ORT's own device; adopt it for the engine's preprocess
		// passes (the renderer adopts the same device for beauty-warp compositing).
		this.device = detector.handle.device;
		this.ort = await loadOrtWebGpu();
		this.models = { detector, landmarks, manifest };
		this.status = 'loaded';
		this.onStatus?.(this.status);
	}

	/** Access the loaded ORT module + sessions for the per-frame solve path. */
	getLoaded(): { ort: OrtModule; models: LoadedModels } | null {
		if (this.status !== 'loaded' || !this.ort || !this.models) return null;
		return { ort: this.ort, models: this.models };
	}

	/**
	 * Cadence-gated per-frame solve. Returns the smoothed, timestamp-interpolated
	 * primary-face landmarks (`LANDMARK_FLOATS`, full-frame normalized) for `timeS`,
	 * or `null` when no model is loaded / no face is tracked yet — in which case the
	 * compositor's beauty pass degrades to identity. The engine **takes ownership of
	 * `frame` and closes it exactly once**. The returned buffer is reused per clip
	 * (no per-frame allocation); the caller must consume it before the next call.
	 */
	async solveFrame(request: {
		clipId: string;
		frame: VideoFrame;
		timeS: number;
		beauty: BeautyEffectSnapshot;
		quality: 'preview' | 'export';
	}): Promise<Float32Array | null> {
		const { clipId, frame, timeS } = request;
		if (this.status !== 'loaded' && !this.inferenceInjected) {
			frame.close();
			return null;
		}
		const state = this.getClipState(clipId);
		// Solve this frame only when the cadence allows AND no solve is in flight
		// (shared GPU buffers → engine-wide single-flight). Other frames interpolate.
		const solveNow = state.cadence.shouldSolve && this.running === null;
		advanceCadence(state.cadence);
		if (solveNow) {
			const dt = state.hasSolved ? Math.max(0, timeS - state.lastSolveT) : 0;
			this.running = this.runSolve(state, frame, timeS, dt).finally(() => {
				this.running = null;
			});
		} else {
			frame.close();
		}
		const faceId = interpolateLandmarks(state.ring, timeS, state.out);
		return faceId ? state.out : null;
	}

	/** Drop a clip's temporal state on delete/teardown so history can't bleed across clips. */
	deleteClip(clipId: string): void {
		this.clipStates.delete(clipId);
	}

	private getClipState(clipId: string): BeautyClipState {
		let state = this.clipStates.get(clipId);
		if (!state) {
			state = {
				cadence: createCadenceState({ ...DEFAULT_CADENCE_CONFIG, projectFps: this.projectFps }),
				ring: createLandmarkRing(),
				euro: createOneEuroState(),
				primary: createPrimaryFaceState(),
				smoothed: new Float32Array(LANDMARK_FLOATS),
				out: new Float32Array(LANDMARK_FLOATS),
				lastSolveT: 0,
				hasSolved: false
			};
			this.clipStates.set(clipId, state);
		}
		return state;
	}

	/** Run one inference + temporal update; owns and closes `frame`. */
	private async runSolve(
		state: BeautyClipState,
		frame: VideoFrame,
		timeS: number,
		dt: number
	): Promise<void> {
		try {
			const solve = await this.inference(frame, timeS, state.primary);
			if (!solve) return;
			if (solve.reset) {
				resetRing(state.ring);
				resetOneEuroState(state.euro);
			}
			if (solve.landmarks) {
				applyOneEuro(state.euro, solve.landmarks, dt, DEFAULT_ONE_EURO, state.smoothed);
				pushSample(state.ring, {
					t: timeS,
					faceId: solve.faceId,
					confidence: solve.confidence,
					landmarks: state.smoothed
				});
				state.lastSolveT = timeS;
				state.hasSolved = true;
			}
		} catch {
			// A failed solve degrades to identity; the next cadence frame retries.
		} finally {
			frame.close();
		}
	}

	/**
	 * Built-in GPU/ORT inference: `importExternalTexture` → beauty-preprocess WGSL →
	 * `Tensor.fromGpuBuffer` → detector `run` → primary-face select → landmark `run`
	 * → small landmark readback. Output coordinate conventions (decoded boxes/scores,
	 * normalized landmarks) follow the manifest tensor contracts and are confirmed
	 * when a license-verified model is vendored (see public/models/beauty/README.md).
	 */
	private async gpuInfer(
		frame: VideoFrame,
		timeS: number,
		primary: PrimaryFaceState
	): Promise<BeautyRawSolve | null> {
		const loaded = this.getLoaded();
		if (!loaded) return null;
		const { models } = loaded;
		this.ensurePreprocess();

		const det = await this.runModel(
			models.detector.handle,
			models.detector.asset,
			frame,
			[0, 0, 1, 1],
			DETECTOR_SIZE,
			this.detectorInputBuf!
		);
		const candidates = decodeCandidates(det.boxes, det.scores, timeS);
		const selected = updatePrimaryFace(primary, candidates, timeS);
		const reset = primary.rampToIdentity;
		if (reset) acknowledgeRamp(primary);
		if (!selected) return { landmarks: null, confidence: 0, faceId: '', reset };

		const roi = expandBox(selected.box);
		const lm = await this.runModel(
			models.landmarks.handle,
			models.landmarks.asset,
			frame,
			roi,
			LANDMARK_INPUT_SIZE,
			this.landmarkInputBuf!
		);
		if (!lm.landmarks) {
			return { landmarks: null, confidence: selected.confidence, faceId: selected.faceId, reset };
		}
		mapRoiToFull(lm.landmarks, roi, this.rawScratch);
		return {
			landmarks: this.rawScratch,
			confidence: selected.confidence,
			faceId: selected.faceId,
			reset
		};
	}

	private ensurePreprocess(): void {
		if (this.preprocessPipeline) return;
		// Set in loadModels; gpuInfer (the only caller path) requires a loaded model.
		const device = this.device!;
		this.preprocessPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: beautyPreprocessSource }),
				entryPoint: 'main'
			}
		});
		this.preprocessUniform = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
		this.detectorInputBuf = device.createBuffer({ size: DETECTOR_FLOATS * 4, usage });
		this.landmarkInputBuf = device.createBuffer({ size: LANDMARK_INPUT_FLOATS * 4, usage });
		this.frameSampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
	}

	/** One model pass: preprocess the ROI into `inputBuf`, run ORT, read outputs back by semantic. */
	private async runModel(
		handle: OrtSessionHandle,
		asset: BeautyModelAsset,
		frame: VideoFrame,
		roi: [number, number, number, number],
		size: number,
		inputBuf: GPUBuffer
	): Promise<Record<string, Float32Array>> {
		const device = this.device!;
		const ort = this.ort!;
		const uni = new ArrayBuffer(32);
		new Uint32Array(uni, 0, 2).set([size, size]);
		new Float32Array(uni, 8, 6).set([1, 0, roi[0], roi[1], roi[2], roi[3]]);
		device.queue.writeBuffer(this.preprocessUniform!, 0, uni);
		const external = device.importExternalTexture({ source: frame });
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.preprocessPipeline!);
		pass.setBindGroup(
			0,
			device.createBindGroup({
				layout: this.preprocessPipeline!.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.preprocessUniform! } },
					{ binding: 1, resource: external },
					{ binding: 2, resource: { buffer: inputBuf } },
					{ binding: 3, resource: this.frameSampler! }
				]
			})
		);
		pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
		pass.end();
		device.queue.submit([encoder.finish()]);

		const inputTensor = ort.Tensor.fromGpuBuffer(inputBuf, {
			dataType: 'float32',
			dims: [1, size, size, 3]
		});
		const feeds: Record<string, OrtTensor> = {
			[asset.inputs[0]!.name]: inputTensor as unknown as OrtTensor
		};
		const out: Record<string, Float32Array> = {};
		try {
			const results = await handle.session.run(feeds);
			for (const contract of asset.outputs) {
				const tensor = results[contract.name];
				if (!tensor) continue;
				const data = await tensor.getData(true);
				out[contract.semantic] =
					data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
			}
		} finally {
			(inputTensor as unknown as OrtTensor).dispose();
		}
		return out;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		try {
			await Promise.resolve(this.running);
		} catch {
			// a failed in-flight solve is fine; we are tearing down
		}
		try {
			await this.device?.queue.onSubmittedWorkDone();
		} catch {
			// device may be lost; tear down anyway
		}
		const release = async (s: LoadedSession | undefined): Promise<void> => {
			try {
				await s?.handle.session.release();
			} catch {
				// session may already be gone
			}
		};
		await release(this.models?.detector);
		await release(this.models?.landmarks);
		this.preprocessUniform?.destroy();
		this.preprocessUniform = null;
		this.detectorInputBuf?.destroy();
		this.detectorInputBuf = null;
		this.landmarkInputBuf?.destroy();
		this.landmarkInputBuf = null;
		this.preprocessPipeline = null;
		this.frameSampler = null;
		this.clipStates.clear();
		this.models = null;
		this.ort = null;
		this.device = null;
		this.status = 'not-loaded';
	}
}

const DETECTOR_SCORE_THRESHOLD = 0.5;

/**
 * Decode detector outputs into face candidates. Assumes the ONNX graph emits
 * **decoded** boxes `[x, y, w, h]` (normalized full-frame) and per-box scores
 * (confidence in [0,1]; raw logits are tolerated via sigmoid). The exact
 * convention is confirmed per vendored model (README). Face IDs are index-based
 * — adequate for the v1 single-primary-face policy.
 */
export function decodeCandidates(
	boxes: Float32Array | undefined,
	scores: Float32Array | undefined,
	t: number
): FaceCandidate[] {
	if (!boxes || !scores) return [];
	const n = Math.min(scores.length, Math.floor(boxes.length / 4));
	const out: FaceCandidate[] = [];
	for (let i = 0; i < n; i++) {
		let s = scores[i]!;
		if (s < 0 || s > 1) s = 1 / (1 + Math.exp(-s));
		if (s < DETECTOR_SCORE_THRESHOLD) continue;
		const x = boxes[i * 4]!;
		const y = boxes[i * 4 + 1]!;
		const w = boxes[i * 4 + 2]!;
		const h = boxes[i * 4 + 3]!;
		if (![x, y, w, h].every((v) => Number.isFinite(v))) continue;
		out.push({ faceId: `face-${i}`, confidence: s, box: [x, y, Math.abs(w), Math.abs(h)], t });
	}
	return out;
}

/** Expand a face box by `margin` and clamp to the unit square → `[x0, y0, x1, y1]`. */
export function expandBox(
	box: [number, number, number, number],
	margin = 0.25
): [number, number, number, number] {
	const [x, y, w, h] = box;
	const ex = w * margin;
	const ey = h * margin;
	return [
		Math.max(0, x - ex),
		Math.max(0, y - ey),
		Math.min(1, x + w + ex),
		Math.min(1, y + h + ey)
	];
}

/**
 * Map ROI-local landmarks (normalized [0,1] within the ROI, x/y/z interleaved)
 * into full-frame normalized coords, writing into `out` (`LANDMARK_FLOATS`).
 */
export function mapRoiToFull(
	roiLandmarks: Float32Array,
	roi: [number, number, number, number],
	out: Float32Array
): void {
	const [x0, y0, x1, y1] = roi;
	const rw = x1 - x0;
	const rh = y1 - y0;
	const n = Math.min(LANDMARK_COUNT, Math.floor(roiLandmarks.length / 3));
	for (let i = 0; i < n; i++) {
		out[i * 3] = x0 + (roiLandmarks[i * 3] ?? 0) * rw;
		out[i * 3 + 1] = y0 + (roiLandmarks[i * 3 + 1] ?? 0) * rh;
		out[i * 3 + 2] = roiLandmarks[i * 3 + 2] ?? 0;
	}
}
