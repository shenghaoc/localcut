/**
 * Beauty runtime engine — Phase 32b, ORT/ONNX.
 *
 * Lives in the pipeline worker. Loads a face **detector** + dense **landmark**
 * ONNX pair on the Phase-105 ORT foundation (`src/engine/ml/ort/`), creating both
 * sessions on the **renderer's `GPUDevice`** (`createOrtSession({ device })`, so
 * `deviceOwner: 'renderer'`), and runs a cadence-gated per-frame solve:
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
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtWebGpu, type OrtModule } from '../ml/ort/ort-loader';
import {
	createOrtOpfsAssetStore,
	loadOrtModelAsset,
	type LoadOrtModelAssetDeps
} from '../ml/ort/ort-asset-loader';
import type { OrtExecutionProvider, OrtModelManifest } from '../ml/ort/ort-types';
import {
	BeautyManifestError,
	validateBeautyManifest,
	type BeautyModelAsset,
	type BeautyModelManifest
} from './model-manifest';

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

export interface BeautyEngineOptions {
	/** The renderer/compositor `GPUDevice`; injected into ORT so inference shares it. */
	device: GPUDevice;
	manifestUrl?: string;
	onStatus?: (status: BeautyEngineStatus, error?: string) => void;
	onProgress?: (progress: BeautyLoadProgress) => void;
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
		// Per-frame face inference on the compositor device: WebGPU-only, no WASM/CPU
		// full-frame fallback (R1.1/R1.2). Inputs and outputs stay on GPU buffers.
		frameCoupled: true,
		executionProviders: ['webgpu'],
		tensorLocation: 'gpu-buffer',
		model: { url: asset.url, sizeBytes: asset.sizeBytes, checksum: asset.checksum }
	};
}

export class BeautyEngine {
	private readonly device: GPUDevice;
	private readonly manifestUrl: string;
	private readonly onStatus?: (status: BeautyEngineStatus, error?: string) => void;
	private readonly onProgress?: (progress: BeautyLoadProgress) => void;

	private ort: OrtModule | null = null;
	private models: LoadedModels | null = null;
	private status: BeautyEngineStatus = 'not-loaded';
	private loadError: string | undefined;
	private loadPromise: Promise<void> | null = null;
	private disposed = false;

	constructor(options: BeautyEngineOptions) {
		this.device = options.device;
		this.manifestUrl = options.manifestUrl ?? DEFAULT_BEAUTY_MANIFEST_URL;
		this.onStatus = options.onStatus;
		this.onProgress = options.onProgress;
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
				device: this.device,
				tensorLocation: 'gpu-buffer'
			});
			return { handle, asset };
		};

		// Sequential: detector first (cheaper, gates landmark relevance), then landmarks.
		const detector = await loadAsset(manifest.assets.detector);
		const landmarks = await loadAsset(manifest.assets.landmarks);

		if (this.disposed) {
			await detector.handle.session.release();
			await landmarks.handle.session.release();
			return;
		}
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

	async dispose(): Promise<void> {
		this.disposed = true;
		try {
			await this.device.queue.onSubmittedWorkDone();
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
		this.models = null;
		this.ort = null;
		this.status = 'not-loaded';
	}

	/** Borrow an ORT input tensor wrapping a GPU buffer (caller disposes). */
	wrapGpuInput(buffer: GPUBuffer, dims: number[]): OrtTensor {
		const ort = this.ort;
		if (!ort) throw new Error('Beauty model is not loaded.');
		return ort.Tensor.fromGpuBuffer(buffer, { dataType: 'float32', dims }) as unknown as OrtTensor;
	}
}
