/**
 * Frame-interpolation engine — Phase 37, ORT/ONNX runtime.
 *
 * Lives in the pipeline worker and synthesises an intermediate frame `F_t` from a
 * bracketing pair `(F0, F1)` and a fractional `tau ∈ (0,1)`, zero-copy, on the ORT
 * (`onnxruntime-web`) **WebGPU** execution provider:
 *
 *   F0,F1 VideoFrame → importExternalTexture → interp-preprocess WGSL
 *   (per-tile resize/normalize → GPUBuffer in the model's layout) →
 *   `ort.Tensor.fromGpuBuffer` → `session.run` (output `gpu-buffer`) →
 *   interp-postprocess WGSL (output buffer → tile region of the output texture) →
 *   compositor/encoder.
 *
 * Built entirely on the Phase-105 ORT foundation (`src/engine/ml/ort/`):
 * - {@link createOrtSession} pins the manifest's execution providers under the
 *   frame-coupled gate (a per-frame model can never resolve to WASM/CPU) and
 *   **injects the renderer's `GPUDevice`** (`env.webgpu.device = device`), so ORT
 *   computes on the compositor's device — the device-sharing path proven by the
 *   foundation's `ort-device-ownership.browser.test.ts`.
 * - {@link loadOrtModelAsset} fetches the ONNX bytes through the trusted-host
 *   `/_model/*` proxy, SHA-256-verifies them, and OPFS-caches by digest.
 * - The synthesis path keeps tensors on-device: `fromGpuBuffer` inputs, a
 *   `gpu-buffer` output read straight into the postprocess pass. **No `getData()`.**
 *
 * Local-only: the ONNX model loads on demand, manifest-validated and digest-pinned;
 * frames never leave the device; no WASM/CPU full-frame fallback and no cloud.
 *
 * The exact ONNX input order/names/layout/timestep come from the manifest `io`
 * contract and are confirmed when a model is vendored + validated (R9 gate).
 */

import interpPreprocessSource from '../shaders/interp-preprocess.wgsl?raw';
import interpPostprocessSource from '../shaders/interp-postprocess.wgsl?raw';
import type { Tensor as OrtTensor } from 'onnxruntime-web';
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtWebGpu, type OrtModule } from '../ml/ort/ort-loader';
import { createOrtOpfsAssetStore, loadOrtModelAsset } from '../ml/ort/ort-asset-loader';
import {
	InterpolationManifestError,
	validateInterpolationManifest,
	type InterpolationModelManifestSnapshot,
	type ManifestIoContract
} from './interpolation-model';
import type { Tile, TilePlan } from './tiling';

/** Same-origin manifest describing the deployed interpolation ONNX model. */
export const DEFAULT_INTERPOLATION_MANIFEST_URL = '/models/interpolation/manifest.json';

/** RIFE/FILM-class ONNX models take/produce unit-range [0,1] RGB. Pinned to the model. */
const NORM_SCALE = 1;
const NORM_BIAS = 0;
const OUT_SCALE = 1;
const OUT_BIAS = 0;

/** Status surfaced to the UI/diagnostics. */
export type InterpolationEngineStatus = 'not-loaded' | 'loading' | 'loaded' | 'failed';

export interface InterpolationEngineOptions {
	/** The renderer/compositor `GPUDevice`; injected into ORT so inference shares it. */
	device: GPUDevice;
	manifestUrl?: string;
	onStatus?: (status: InterpolationEngineStatus, error?: string) => void;
}

interface LoadedModel {
	handle: OrtSessionHandle;
	io: ManifestIoContract;
	manifest: InterpolationModelManifestSnapshot;
}

export class InterpolationEngine {
	private readonly device: GPUDevice;
	private readonly manifestUrl: string;
	private readonly onStatus?: (status: InterpolationEngineStatus, error?: string) => void;

	private ort: OrtModule | null = null;
	private model: LoadedModel | null = null;
	private status: InterpolationEngineStatus = 'not-loaded';
	private loadError: string | undefined;
	private loadPromise: Promise<void> | null = null;
	private disposed = false;

	/** Serializes synthesis; the input/uniform GPU buffers are shared instance state. */
	private running: Promise<GPUTexture> | null = null;

	private preprocessPipeline: GPUComputePipeline | null = null;
	private postprocessPipeline: GPUComputePipeline | null = null;
	private preprocessUniform: GPUBuffer | null = null;
	private postprocessUniform: GPUBuffer | null = null;
	private input0Buffer: GPUBuffer | null = null;
	private input1Buffer: GPUBuffer | null = null;
	private frameSampler: GPUSampler | null = null;

	constructor(options: InterpolationEngineOptions) {
		this.device = options.device;
		this.manifestUrl = options.manifestUrl ?? DEFAULT_INTERPOLATION_MANIFEST_URL;
		this.onStatus = options.onStatus;
	}

	getStatus(): InterpolationEngineStatus {
		return this.status;
	}

	getModelManifest(): InterpolationModelManifestSnapshot | null {
		return this.model?.manifest ?? null;
	}

	/** ORT execution provider actually selected for the loaded session. */
	getExecutionProvider(): 'webgpu' | 'webnn' | 'wasm' | null {
		return this.model?.handle.primaryEp ?? null;
	}

	/** Triggers a lazy, idempotent model load. Resolves when loaded or failed. */
	ensureModelLoaded(): Promise<void> {
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.loadModel().catch((error) => {
			this.status = 'failed';
			// A placeholder/template manifest is the "no compatible model configured"
			// state (R2.4); surface it as a clear, non-alarming message.
			this.loadError =
				error instanceof InterpolationManifestError
					? 'No compatible interpolation model configured.'
					: error instanceof Error
						? error.message
						: String(error);
			this.loadPromise = null; // allow retry
			this.onStatus?.(this.status, this.loadError);
		});
		return this.loadPromise;
	}

	private async loadModel(): Promise<void> {
		this.status = 'loading';
		this.loadError = undefined;
		this.onStatus?.(this.status);

		const response = await fetch(this.manifestUrl);
		if (!response.ok) {
			throw new Error(`Interpolation model manifest fetch failed: HTTP ${response.status}`);
		}
		// Throws InterpolationManifestError on a placeholder/template manifest (R2.4)
		// or invalid ONNX/EP policy — caught by ensureModelLoaded → "no model".
		const manifest = validateInterpolationManifest(await response.json());

		const store = await createOrtOpfsAssetStore();
		const modelBytes = await loadOrtModelAsset(manifest.model, { store });

		const ort = await loadOrtWebGpu();
		// Inject the renderer's device so ORT computes on the compositor's device
		// (deviceOwner: 'renderer'); the frame-coupled EP policy forbids any WASM/CPU
		// fallback, and 'gpu-buffer' output keeps the synthesized frame on-device.
		const handle = await createOrtSession({
			modelBytes,
			manifest,
			device: this.device,
			tensorLocation: 'gpu-buffer'
		});
		if (this.disposed) {
			await handle.session.release();
			return;
		}
		this.ort = ort;
		this.model = { handle, io: manifest.io, manifest };
		this.status = 'loaded';
		this.onStatus?.(this.status);
	}

	/**
	 * Synthesise an intermediate frame at `tau`, tiled per `plan` (R3, R4). Returns
	 * an `rgba8unorm` output texture the caller owns (and `.destroy()`s). The engine
	 * BORROWS `frame0`/`frame1` — the caller closes them once after all `tau` for the
	 * interval. Throws if the model is not loaded; callers gate on {@link getStatus}.
	 */
	async synthesise(
		frame0: VideoFrame,
		frame1: VideoFrame,
		tau: number,
		fullWidth: number,
		fullHeight: number,
		plan: TilePlan
	): Promise<GPUTexture> {
		if (this.status !== 'loaded' || !this.model || !this.ort) {
			throw new Error('Interpolation model is not loaded.');
		}

		// Serialize synthesis. The input/uniform GPU buffers are shared instance
		// state, so two overlapping `synthesise` calls would race on them and corrupt
		// each other's in-flight frame. The previous run is awaited *inside* this
		// run's promise and `this.running` is published synchronously, so a concurrent
		// caller chains off this run instead of starting a second `runSynthesis`.
		const previous = this.running;
		const run = (async (): Promise<GPUTexture> => {
			if (previous) await previous.catch(() => {});
			if (this.disposed || this.status !== 'loaded' || !this.model || !this.ort) {
				throw new Error('Interpolation model is not loaded.');
			}
			return this.runSynthesis(frame0, frame1, tau, fullWidth, fullHeight, plan);
		})().finally(() => {
			if (this.running === run) this.running = null;
		});
		this.running = run;
		return run;
	}

	private async runSynthesis(
		frame0: VideoFrame,
		frame1: VideoFrame,
		tau: number,
		fullWidth: number,
		fullHeight: number,
		plan: TilePlan
	): Promise<GPUTexture> {
		this.ensurePipelines();
		const output = this.device.createTexture({
			size: { width: fullWidth, height: fullHeight },
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
		});
		try {
			for (const tile of plan.tiles) {
				await this.synthesiseTile(frame0, frame1, tau, tile, plan, fullWidth, fullHeight, output);
			}
		} catch (error) {
			output.destroy();
			throw error;
		}
		return output;
	}

	private layoutFlag(): number {
		return this.model!.io.layout === 'nchw' ? 0 : 1;
	}

	private tensorDims(plan: TilePlan): number[] {
		const c = this.model!.io.inputChannels;
		return this.model!.io.layout === 'nchw'
			? [1, c, plan.modelInputHeight, plan.modelInputWidth]
			: [1, plan.modelInputHeight, plan.modelInputWidth, c];
	}

	private async synthesiseTile(
		frame0: VideoFrame,
		frame1: VideoFrame,
		tau: number,
		tile: Tile,
		plan: TilePlan,
		fullWidth: number,
		fullHeight: number,
		output: GPUTexture
	): Promise<void> {
		const device = this.device;
		const ort = this.ort!;
		const model = this.model!;
		const io = model.io;
		const modelW = plan.modelInputWidth;
		const modelH = plan.modelInputHeight;
		const elements = modelW * modelH * io.inputChannels;
		const inputBytes = elements * 4;

		if (!this.input0Buffer) {
			// STORAGE | COPY_SRC | COPY_DST is the usage ORT requires to wrap a buffer
			// as a GPU-buffer input tensor.
			const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
			this.input0Buffer = device.createBuffer({ size: inputBytes, usage });
			this.input1Buffer = device.createBuffer({ size: inputBytes, usage });
		}

		// Tile source region (core + halo) in normalized full-frame coords; the
		// sampler clamps to edge where the halo extends past the frame.
		const srcU0 = (tile.x - tile.halo) / fullWidth;
		const srcV0 = (tile.y - tile.halo) / fullHeight;
		const srcU1 = (tile.x + tile.w + tile.halo) / fullWidth;
		const srcV1 = (tile.y + tile.h + tile.halo) / fullHeight;

		// 1. Preprocess: both external textures → two normalized tensor buffers.
		const preUniform = new ArrayBuffer(48);
		new Uint32Array(preUniform, 0, 3).set([modelW, modelH, this.layoutFlag()]);
		new Float32Array(preUniform, 16, 6).set([NORM_SCALE, NORM_BIAS, srcU0, srcV0, srcU1, srcV1]);
		device.queue.writeBuffer(this.preprocessUniform!, 0, preUniform);
		const external0 = device.importExternalTexture({ source: frame0 });
		const external1 = device.importExternalTexture({ source: frame1 });
		const preEncoder = device.createCommandEncoder();
		const prePass = preEncoder.beginComputePass();
		prePass.setPipeline(this.preprocessPipeline!);
		prePass.setBindGroup(
			0,
			device.createBindGroup({
				layout: this.preprocessPipeline!.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.preprocessUniform! } },
					{ binding: 1, resource: external0 },
					{ binding: 2, resource: external1 },
					{ binding: 3, resource: { buffer: this.input0Buffer } },
					{ binding: 4, resource: { buffer: this.input1Buffer! } },
					{ binding: 5, resource: this.frameSampler! }
				]
			})
		);
		prePass.dispatchWorkgroups(Math.ceil(modelW / 8), Math.ceil(modelH / 8));
		prePass.end();
		device.queue.submit([preEncoder.finish()]);

		// 2. ORT inference with GPU-buffer tensor IO (no upload/readback). The tiny
		// `tau` scalar is a CPU tensor (allowed; not a full-frame transfer).
		const dims = this.tensorDims(plan);
		const img0 = ort.Tensor.fromGpuBuffer(this.input0Buffer, { dataType: 'float32', dims });
		const img1 = ort.Tensor.fromGpuBuffer(this.input1Buffer!, { dataType: 'float32', dims });
		const feeds: Record<string, OrtTensor> = {
			[io.input0Name]: img0 as unknown as OrtTensor,
			[io.input1Name]: img1 as unknown as OrtTensor
		};
		if (io.timestepName) {
			feeds[io.timestepName] = new ort.Tensor('float32', new Float32Array([tau]), [1]);
		}
		let frameBuffer: GPUBuffer;
		let outputTensor: OrtTensor;
		try {
			const results = await model.handle.session.run(feeds);
			outputTensor = results[io.outputName]!;
			if (!outputTensor) throw new Error(`Interpolation output "${io.outputName}" missing.`);
			frameBuffer = outputTensor.gpuBuffer as GPUBuffer;
		} finally {
			// Input tensors wrap our reused buffers; ORT does not own/destroy them.
			img0.dispose();
			img1.dispose();
		}

		// 3. Postprocess: model output buffer → tile core region of the output texture.
		const denom = (v: number, hi: number): number => (hi > 0 ? v / hi : 0);
		const tileSrcW = tile.w + 2 * tile.halo;
		const tileSrcH = tile.h + 2 * tile.halo;
		const coreU0 = denom(tile.halo, tileSrcW);
		const coreU1 = denom(tile.halo + tile.w, tileSrcW);
		const coreV0 = denom(tile.halo, tileSrcH);
		const coreV1 = denom(tile.halo + tile.h, tileSrcH);
		const destW = Math.min(tile.w, fullWidth - tile.x);
		const destH = Math.min(tile.h, fullHeight - tile.y);

		const postUniform = new ArrayBuffer(64);
		new Uint32Array(postUniform, 0, 3).set([modelW, modelH, this.layoutFlag()]);
		new Float32Array(postUniform, 16, 2).set([OUT_SCALE, OUT_BIAS]);
		new Uint32Array(postUniform, 24, 4).set([tile.x, tile.y, destW, destH]);
		new Float32Array(postUniform, 40, 4).set([coreU0, coreV0, coreU1, coreV1]);
		device.queue.writeBuffer(this.postprocessUniform!, 0, postUniform);

		const postEncoder = device.createCommandEncoder();
		const postPass = postEncoder.beginComputePass();
		postPass.setPipeline(this.postprocessPipeline!);
		postPass.setBindGroup(
			0,
			device.createBindGroup({
				layout: this.postprocessPipeline!.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.postprocessUniform! } },
					{ binding: 1, resource: { buffer: frameBuffer } },
					{ binding: 2, resource: output.createView() }
				]
			})
		);
		postPass.dispatchWorkgroups(Math.ceil(destW / 8), Math.ceil(destH / 8));
		postPass.end();
		device.queue.submit([postEncoder.finish()]);

		// Release ORT's output tensor (and its GPU buffer) only after the postprocess
		// pass that reads it has finished on the GPU — avoids a use-after-free.
		void device.queue.onSubmittedWorkDone().then(() => outputTensor.dispose());
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		// Set `disposed` first (blocks new synthesis at the run-promise guard), then
		// let any in-flight `runSynthesis` finish its GPU submissions and drain the
		// queue, so destroying the shared buffers never races an executing pass.
		await this.running?.catch(() => {});
		try {
			await this.device.queue.onSubmittedWorkDone();
		} catch {
			// device may be lost; tear down anyway
		}
		this.input0Buffer?.destroy();
		this.input0Buffer = null;
		this.input1Buffer?.destroy();
		this.input1Buffer = null;
		this.preprocessUniform?.destroy();
		this.preprocessUniform = null;
		this.postprocessUniform?.destroy();
		this.postprocessUniform = null;
		try {
			await this.model?.handle.session.release();
		} catch {
			// session may already be gone
		}
		this.model = null;
		this.ort = null;
		this.status = 'not-loaded';
	}

	private ensurePipelines(): void {
		if (this.preprocessPipeline) return;
		const device = this.device;
		this.preprocessPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: interpPreprocessSource }),
				entryPoint: 'main'
			}
		});
		this.postprocessPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: interpPostprocessSource }),
				entryPoint: 'main'
			}
		});
		this.preprocessUniform = device.createBuffer({
			size: 48,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.postprocessUniform = device.createBuffer({
			size: 64,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.frameSampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
	}
}
