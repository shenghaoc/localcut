/**
 * Portrait matting engine — Phase 31, ORT/ONNX backend.
 *
 * The retained matte backend runs an ONNX matting/segmentation model on **ONNX
 * Runtime Web (ORT-WebGPU)**, built on the shared ORT foundation
 * (`src/engine/ml/ort/`). See {@link file://./matte-backend.ts} and
 * docs/ML-RUNTIME.md.
 *
 * Per-frame pipeline (zero-copy, no CPU pixel round-trip):
 *
 *   VideoFrame → importExternalTexture → matte-onnx-preprocess WGSL
 *   (resize / normalize → NCHW|NHWC float32 GPUBuffer) →
 *   `ort.Tensor.fromGpuBuffer` → `session.run` (output `gpu-buffer`) →
 *   matte-resolve WGSL (raw alpha buffer → rgba8unorm texture + EMA temporal
 *   smoothing) → matte-apply / matte-blur in the Phase 12 compositor.
 *
 * Foundation pieces it reuses verbatim:
 * - {@link createOrtSession} lets ORT bootstrap and own the `GPUDevice`
 *   (`deviceOwner: 'ort-webgpu'`; ORT cannot adopt an externally-created device —
 *   microsoft/onnxruntime#26107) and pins the manifest EPs under the frame-coupled
 *   gate — a per-frame matte can never resolve to WASM/CPU. The engine runs its
 *   own preprocess/resolve passes on ORT's device (`handle.device`); the worker
 *   adopts the renderer to that device before the engine reports loaded, so the
 *   compositor binds matte output on the same device.
 * - {@link loadOrtModelAsset} fetches the ONNX bytes through the trusted-host
 *   `/_model/*` proxy, SHA-256-verifies them, and OPFS-caches by digest.
 * - The temporal contract ({@link MATTE_TEMPORAL_SMOOTHING},
 *   {@link shouldResetMatteHistory}) and the resolve shader preserve the shipped
 *   EMA smoothing and recurrent-state reset behaviour.
 *
 * Local-only: the ONNX model loads on demand, manifest-validated and digest-pinned;
 * frames never leave the device; no WASM/CPU full-frame fallback and no cloud.
 */

import matteOnnxPreprocessSource from '../shaders/matte-onnx-preprocess.wgsl?raw';
import matteResolveSource from '../shaders/matte-resolve.wgsl?raw';
import type { Tensor as OrtTensor } from 'onnxruntime-web';
import type { MatteEngineStatusSnapshot, MatteModelStatus } from '../../protocol';
import { MatteCache, makeMatteCacheKey } from '../matte-cache';
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtWebGpu, type OrtModule } from '../ml/ort/ort-loader';
import { createOrtOpfsAssetStore, loadOrtModelAsset } from '../ml/ort/ort-asset-loader';
import {
	MatteOnnxManifestError,
	validateMatteOnnxManifest,
	type MatteOnnxIoContract,
	type MatteOnnxModelManifestSnapshot
} from './matte-onnx-model';
import { MATTE_TEMPORAL_SMOOTHING, shouldResetMatteHistory } from './matte-temporal';
import type { MatteBackendEngine, MatteFrameRequest } from './matte-backend';

/** Same-origin manifest describing the ONNX matte model. */
const MATTE_ONNX_MANIFEST_URL = '/models/matte-onnx/manifest.json';

/** Reuse-cache budget. Correctness never depends on a hit. */
const MATTE_CACHE_BYTES = 32 * 1024 * 1024;

export interface MatteOnnxEngineOptions {
	onStatus: (status: MatteEngineStatusSnapshot) => void;
	onDeviceReady?: (device: GPUDevice) => Promise<void>;
	manifestUrl?: string;
	/** Determinism mode (R8): disables the reuse-last-while-busy shortcut so
	 *  repeated runs over a fixture produce identical alpha. */
	testMode?: boolean;
}

interface ClipSession {
	history: GPUTexture;
	historyView: GPUTextureView;
	lastSourceTimeS: number | null;
	/** True when the last displayed frame for this clip came from the reuse cache,
	 *  so the GPU history texture no longer matches it; the next inference resets
	 *  rather than blending fresh alpha against stale history (after a seek). */
	historyStale: boolean;
}

interface LoadedModel {
	handle: OrtSessionHandle;
	io: MatteOnnxIoContract;
	manifest: MatteOnnxModelManifestSnapshot;
	width: number;
	height: number;
	/** Preprocess normalization `rgb * normScale + normBias`, derived from inputRange. */
	normScale: number;
	normBias: number;
	/** Preprocess layout flag: 0 = NCHW, 1 = NHWC. */
	layoutFlag: number;
	/** ONNX input tensor dims in the model's layout ([1,3,H,W] or [1,H,W,3]). */
	inputDims: number[];
}

export class MatteOnnxEngine implements MatteBackendEngine {
	/**
	 * The worker adopts the renderer onto ORT's device before the model is marked
	 * loaded, so returned alpha views are renderer-device views.
	 */
	readonly compositesOnRendererDevice = true;
	/** ORT-owned device, set once the session is created in {@link loadModel};
	 *  the renderer adopts it before the model is marked loaded. */
	private device: GPUDevice | null = null;
	private readonly onStatus: (status: MatteEngineStatusSnapshot) => void;
	private readonly onDeviceReady?: (device: GPUDevice) => Promise<void>;
	private readonly manifestUrl: string;
	private readonly testMode: boolean;

	private readonly cache: MatteCache;
	private readonly sessions = new Map<string, ClipSession>();
	private readonly lastView = new Map<string, GPUTextureView>();

	private ort: OrtModule | null = null;
	private model: LoadedModel | null = null;
	private modelStatus: MatteModelStatus = 'not-loaded';
	private loadError: string | undefined;
	private loadPromise: Promise<void> | null = null;
	private pinWarned = new Set<string>();

	private preprocessPipeline: GPUComputePipeline | null = null;
	private resolvePipeline: GPUComputePipeline | null = null;
	private preprocessUniform: GPUBuffer | null = null;
	private resolveUniform: GPUBuffer | null = null;
	private inputBuffer: GPUBuffer | null = null;
	private frameSampler: GPUSampler | null = null;

	/** Serializes inference; the GPU input buffer and history textures are shared state. */
	private running: Promise<GPUTextureView | null> | null = null;
	private disposed = false;

	constructor(options: MatteOnnxEngineOptions) {
		this.onStatus = options.onStatus;
		this.onDeviceReady = options.onDeviceReady;
		this.manifestUrl = options.manifestUrl ?? MATTE_ONNX_MANIFEST_URL;
		this.testMode = options.testMode ?? false;
		this.cache = new MatteCache({ maxBytes: MATTE_CACHE_BYTES });
	}

	/**
	 * Returns the smoothed alpha matte view for one frame, running inference if
	 * needed. Preview returns the previous alpha (or null) instead of stalling when
	 * inference is busy or the model is still loading; export always waits. The
	 * engine takes ownership of `request.frame` and closes it exactly once.
	 */
	async matteViewFor(request: MatteFrameRequest): Promise<GPUTextureView | null> {
		if (this.disposed) {
			request.frame.close();
			return null;
		}

		const cacheKey = `${makeMatteCacheKey(request.clipId, request.sourceTimeS)}:${request.modelKey}`;
		const cached = this.cache.get(cacheKey);
		if (cached) {
			request.frame.close();
			this.touchSession(request);
			return cached;
		}

		if (this.modelStatus !== 'loaded') {
			const loading = this.ensureModelLoaded();
			if (request.quality === 'preview') {
				// Never stall playback on a model download — unmatted until ready.
				request.frame.close();
				return null;
			}
			await loading;
			if (!this.isLoaded()) {
				request.frame.close();
				return null;
			}
		}

		// Keep preview realtime: reuse the clip's previous alpha rather than queueing
		// behind in-flight inference.
		if (this.running && request.quality === 'preview' && !this.testMode) {
			request.frame.close();
			return this.lastView.get(request.clipId) ?? null;
		}

		// Serialize inference. The previous run is awaited *inside* this run's promise
		// and `this.running` is published synchronously, so a later caller chains off
		// this run instead of starting a second `runInference` concurrently on the
		// shared input/uniform GPU buffers (which would corrupt the in-flight frame).
		const previous = this.running;
		const run = (async (): Promise<GPUTextureView | null> => {
			if (previous) await previous.catch(() => {});
			if (this.disposed) {
				request.frame.close();
				return null;
			}
			return this.runInference(request, cacheKey);
		})().finally(() => {
			if (this.running === run) this.running = null;
		});
		this.running = run;
		return run;
	}

	/** Drops a clip's temporal state (R4.2 reset triggers beyond the time policy). */
	resetClip(clipId: string): void {
		const session = this.sessions.get(clipId);
		if (session) {
			session.lastSourceTimeS = null;
		}
	}

	/** Releases a clip's session, history texture, and cached alpha frames. */
	deleteClip(clipId: string): void {
		const session = this.sessions.get(clipId);
		if (session) {
			this.sessions.delete(clipId);
			this.retireSession(session);
		}
		this.lastView.delete(clipId);
		this.cache.deleteByClip(clipId);
	}

	/**
	 * Destroys a removed session's history texture — but not while an inference run
	 * is in flight, because that run (which captured this session before the delete)
	 * still binds `historyView` and copies into `history` in its resolve pass;
	 * destroying it mid-flight is a WebGPU validation error / device-loss path.
	 * Runs are serialized, so once `this.running` settles no run references this
	 * session (a later frame for the same clip gets a fresh session via sessionFor).
	 */
	private retireSession(session: ClipSession): void {
		const running = this.running;
		if (running) {
			void running.catch(() => {}).then(() => session.history.destroy());
		} else {
			session.history.destroy();
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		// Set `disposed` first (blocks new inference at the matteViewFor guard), then
		// let any in-flight runInference finish its GPU submission and drain the queue
		// so destroying buffers/textures never races an executing pass.
		await this.running?.catch(() => {});
		try {
			await this.device?.queue.onSubmittedWorkDone();
		} catch {
			// Device may be lost; its resources are already invalid — tear down anyway.
		}
		for (const session of this.sessions.values()) {
			session.history.destroy();
		}
		this.sessions.clear();
		this.lastView.clear();
		this.cache.clear();
		this.inputBuffer?.destroy();
		this.inputBuffer = null;
		this.preprocessUniform?.destroy();
		this.preprocessUniform = null;
		this.resolveUniform?.destroy();
		this.resolveUniform = null;
		try {
			await this.model?.handle.session.release();
		} catch {
			// Session may already be gone.
		}
		this.model = null;
		this.ort = null;
		this.device = null;
	}

	/** Re-reads load state after awaits (defeats control-flow narrowing). */
	private isLoaded(): boolean {
		return this.modelStatus === 'loaded';
	}

	private postStatus(): void {
		this.onStatus({
			probe: {
				webgpu: 'supported',
				// Matte is frame-coupled and must stay on ORT-WebGPU; WASM is
				// intentionally reported unavailable rather than probed as a fallback.
				wasm: 'unsupported',
				backend: 'webgpu'
			},
			modelStatus: this.modelStatus,
			backend: this.modelStatus === 'loaded' ? 'webgpu' : null,
			...(this.loadError ? { error: this.loadError } : {})
		});
	}

	/** Triggers a lazy, idempotent model load. Resolves when loaded or failed. */
	ensureModelLoaded(): Promise<void> {
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.loadModel().catch((error) => {
			this.modelStatus = 'failed';
			// A placeholder/template (or otherwise invalid) manifest is the "no
			// compatible model configured" state; surface it as a clear, non-alarming
			// message rather than an error spew.
			const permanent = error instanceof MatteOnnxManifestError;
			this.loadError = permanent
				? 'No compatible ONNX matte model configured.'
				: error instanceof Error
					? error.message
					: String(error);
			// A manifest/template/license rejection is permanent — keep `loadPromise`
			// resolved so `matteViewFor` (which calls this every frame while not
			// loaded) stops refetching and revalidating the same invalid manifest.
			// Only a transient failure (e.g. a network blip) clears it to allow retry.
			if (!permanent) this.loadPromise = null;
			this.postStatus();
		});
		return this.loadPromise;
	}

	private async loadModel(): Promise<void> {
		this.modelStatus = 'loading';
		this.loadError = undefined;
		this.postStatus();

		const response = await fetch(this.manifestUrl);
		if (!response.ok) {
			throw new Error(`ONNX matte manifest fetch failed: HTTP ${response.status}`);
		}
		// Throws MatteOnnxManifestError on a template/invalid manifest or a GPL
		// license — caught by ensureModelLoaded → "no model configured".
		const manifest = validateMatteOnnxManifest(await response.json());

		const store = await createOrtOpfsAssetStore();
		const modelBytes = await loadOrtModelAsset(manifest.model, { store });

		const ort = await loadOrtWebGpu();
		// ORT bootstraps and owns the WebGPU device — it ignores an injected one
		// (microsoft/onnxruntime#26107). The frame-coupled EP policy forbids any
		// WASM/CPU fallback, and 'gpu-buffer' output keeps the alpha on-device (no
		// readback). The engine's own preprocess/resolve passes then run on
		// handle.device; the renderer adopts it before the model is marked loaded.
		const handle = await createOrtSession({
			modelBytes,
			manifest,
			tensorLocation: 'gpu-buffer'
		});
		// dispose() may have run during any of the awaits above; don't strand the
		// session on a dead engine (it would never be released).
		if (this.disposed) {
			await handle.session.release();
			return;
		}
		if (!handle.device) {
			await handle.session.release();
			throw new Error('ORT-WebGPU matte session exposed no GPUDevice.');
		}
		try {
			await this.onDeviceReady?.(handle.device);
		} catch (error) {
			await handle.session.release();
			throw error;
		}
		this.device = handle.device;

		const io = manifest.io;
		// Map the declared input range to a linear `rgb * scale + bias` normalize
		// Preserve the normalization convention from the manifest.
		const [normScale, normBias] = io.inputRange === 'unit' ? [1, 0] : [2, -1];
		const layoutFlag = io.layout === 'nchw' ? 0 : 1;
		const inputDims =
			io.layout === 'nchw'
				? [1, io.inputChannels, io.inputHeight, io.inputWidth]
				: [1, io.inputHeight, io.inputWidth, io.inputChannels];

		this.ort = ort;
		this.model = {
			handle,
			io,
			manifest,
			width: io.inputWidth,
			height: io.inputHeight,
			normScale,
			normBias,
			layoutFlag,
			inputDims
		};
		this.modelStatus = 'loaded';
		this.postStatus();
	}

	private ensurePipelines(): void {
		if (this.preprocessPipeline) return;
		// Set in loadModel before any inference reaches ensurePipelines.
		const device = this.device!;
		this.preprocessPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: matteOnnxPreprocessSource }),
				entryPoint: 'main'
			}
		});
		this.resolvePipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: matteResolveSource }),
				entryPoint: 'main'
			}
		});
		this.preprocessUniform = device.createBuffer({
			// 4×u32 (dims + layout + pad) then 2×f32 (normScale, normBias).
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.resolveUniform = device.createBuffer({
			// 2×u32 (dims) + f32 (smoothing) + u32 (reset).
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.frameSampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
	}

	private sessionFor(clipId: string): ClipSession {
		let session = this.sessions.get(clipId);
		if (!session) {
			const model = this.model!;
			const history = this.device!.createTexture({
				size: { width: model.width, height: model.height },
				// Must match alphaTexture's format for copyTextureToTexture; rgba8unorm
				// because r8unorm cannot be a storage texture (the resolve write target).
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
			});
			session = {
				history,
				historyView: history.createView(),
				lastSourceTimeS: null,
				historyStale: false
			};
			this.sessions.set(clipId, session);
		}
		return session;
	}

	/**
	 * Records a cache-served frame as the clip's last displayed frame. The cached
	 * alpha is NOT copied into the history texture, so it marks history stale: the
	 * next inferred frame must reset rather than blend against whatever inference
	 * last wrote (which, after a scrub/seek, is not the preceding displayed frame).
	 */
	private touchSession(request: MatteFrameRequest): void {
		const session = this.sessions.get(request.clipId);
		if (session) {
			session.lastSourceTimeS = request.sourceTimeS;
			session.historyStale = true;
		}
	}

	private async runInference(
		request: MatteFrameRequest,
		cacheKey: string
	): Promise<GPUTextureView | null> {
		// The engine owns request.frame and must release it exactly once. The body
		// frees it eagerly right after the preprocess import (so the scarce VideoFrame
		// isn't held across the inference wait); this guarded finally still releases it
		// if an earlier step throws (lost device, buffer allocation), and the flag stops
		// a late failure from double-closing a frame the eager path already shut.
		let frameClosed = false;
		const closeFrame = (): void => {
			if (frameClosed) return;
			frameClosed = true;
			request.frame.close();
		};
		try {
			return await this.runInferenceBody(request, cacheKey, closeFrame);
		} finally {
			closeFrame();
		}
	}

	private async runInferenceBody(
		request: MatteFrameRequest,
		cacheKey: string,
		closeFrame: () => void
	): Promise<GPUTextureView | null> {
		// Model-independent GPU setup first, so a device failure here surfaces before
		// any model/session work (and the frame-owning wrapper still releases the frame).
		this.ensurePipelines();
		const model = this.model!;
		const ort = this.ort!;
		const device = this.device!;
		const io = model.io;

		// Pin check (R1.2): warn once per clip on mismatch; never silently switch.
		if (request.modelKey !== model.manifest.id && !this.pinWarned.has(request.clipId)) {
			this.pinWarned.add(request.clipId);
			this.loadError = `Clip pins matte model "${request.modelKey}" but "${model.manifest.id}" is deployed; using the deployed model.`;
			this.postStatus();
			this.loadError = undefined;
		}

		const session = this.sessionFor(request.clipId);
		// Discontinuity policy: reset when source time jumps or
		// the last displayed frame was a cache hit (history is stale — see touchSession),
		// so fresh alpha never blends against pre-seek history.
		const reset =
			session.historyStale ||
			shouldResetMatteHistory(session.lastSourceTimeS, request.sourceTimeS, request.frameStepS);

		// Input buffer in the model's layout: W*H*C float32. STORAGE for the
		// preprocess pass + COPY_SRC/DST so ORT can wrap it as a GPU-buffer tensor.
		const inputFloats = model.width * model.height * io.inputChannels;
		if (!this.inputBuffer) {
			this.inputBuffer = device.createBuffer({
				size: inputFloats * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
			});
		}

		// 1. Preprocess: external texture → normalized NCHW|NHWC GPU buffer.
		const preUniform = new ArrayBuffer(32);
		new Uint32Array(preUniform, 0, 4).set([model.width, model.height, model.layoutFlag, 0]);
		new Float32Array(preUniform, 16, 2).set([model.normScale, model.normBias]);
		device.queue.writeBuffer(this.preprocessUniform!, 0, preUniform);
		const external = device.importExternalTexture({ source: request.frame });
		const preEncoder = device.createCommandEncoder();
		const prePass = preEncoder.beginComputePass();
		prePass.setPipeline(this.preprocessPipeline!);
		prePass.setBindGroup(
			0,
			device.createBindGroup({
				layout: this.preprocessPipeline!.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.preprocessUniform! } },
					{ binding: 1, resource: external },
					{ binding: 2, resource: { buffer: this.inputBuffer } },
					{ binding: 3, resource: this.frameSampler! }
				]
			})
		);
		prePass.dispatchWorkgroups(Math.ceil(model.width / 8), Math.ceil(model.height / 8));
		prePass.end();
		device.queue.submit([preEncoder.finish()]);
		// The source frame is consumed by the import above; free it now (before the
		// inference wait). Routed through the caller's guard so it closes exactly once.
		closeFrame();

		// 2. ORT inference with GPU-buffer tensor IO — input wraps our preprocess
		// buffer (no upload), output stays a GPU buffer (no readback). Both live on
		// ORT's own device, which the renderer adopted before the model was marked loaded.
		const inputTensor = ort.Tensor.fromGpuBuffer(this.inputBuffer, {
			dataType: 'float32',
			dims: model.inputDims
		});
		const feeds: Record<string, OrtTensor> = {
			[io.inputName]: inputTensor as unknown as OrtTensor
		};
		let alphaBuffer: GPUBuffer;
		// All output tensors (a model may have more than the alpha); disposed after
		// the resolve pass reads the alpha, or immediately if validation below throws.
		let outputs: OrtTensor[] = [];
		try {
			const results = await model.handle.session.run(feeds);
			outputs = Object.values(results);
			const outputTensor = results[io.outputName];
			if (!outputTensor) throw new Error(`ONNX matte output "${io.outputName}" missing.`);
			// The resolve pass reads exactly width*height single-channel alpha values at
			// y*W+x offsets, so a model whose output isn't that size would silently
			// corrupt the matte (wrong offsets) or read past the buffer. Validate the
			// produced shape against the declared single-channel contract and fail
			// clearly instead.
			const dims = outputTensor.dims as readonly number[];
			const produced = dims.reduce((a, b) => a * b, 1);
			const expected = model.width * model.height;
			if (produced !== expected) {
				throw new Error(
					`ONNX matte output "${io.outputName}" produced ${produced} values (dims [${dims.join(', ')}]); ` +
						`expected ${expected} for single-channel ${model.width}×${model.height} alpha.`
				);
			}
			// 'gpu-buffer' output: a single-channel [1,1,H,W]|[1,H,W,1] alpha buffer
			// the resolve pass binds directly (no intermediate copy, no getData).
			alphaBuffer = outputTensor.gpuBuffer as GPUBuffer;
			if (!alphaBuffer) throw new Error('ONNX matte output is not a GPU buffer.');
		} catch (error) {
			// A successful run whose output failed validation still produced tensors —
			// dispose them all before rethrowing so no GPU/CPU tensor is leaked.
			for (const tensor of outputs) tensor.dispose();
			throw error;
		} finally {
			// The input tensor wraps our reused buffer; ORT does not own/destroy it.
			inputTensor.dispose();
		}

		// 3. Resolve: raw alpha buffer + history → smoothed alpha texture.
		const alphaTexture = device.createTexture({
			size: { width: model.width, height: model.height },
			// rgba8unorm, not r8unorm: r8unorm is not a storage-capable format, so it
			// cannot be the resolve pass's STORAGE_BINDING write target. Alpha is .r.
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
		});
		// Until the resolve pass is submitted, a WebGPU failure (device loss /
		// validation in createBindGroup/submit) must free both the texture just
		// created and the ORT output tensors — nothing else owns them yet. Once
		// submitted, the GPU owns the read, so the tensors are freed by
		// onSubmittedWorkDone and the cache owns the texture.
		let submitted = false;
		try {
			const uniform = new ArrayBuffer(16);
			new Uint32Array(uniform, 0, 2).set([model.width, model.height]);
			new Float32Array(uniform, 8, 1)[0] = MATTE_TEMPORAL_SMOOTHING;
			new Uint32Array(uniform, 12, 1)[0] = reset ? 1 : 0;
			device.queue.writeBuffer(this.resolveUniform!, 0, uniform);

			const resolveEncoder = device.createCommandEncoder();
			const resolvePass = resolveEncoder.beginComputePass();
			resolvePass.setPipeline(this.resolvePipeline!);
			resolvePass.setBindGroup(
				0,
				device.createBindGroup({
					layout: this.resolvePipeline!.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: this.resolveUniform! } },
						{ binding: 1, resource: { buffer: alphaBuffer } },
						{ binding: 2, resource: session.historyView },
						{ binding: 3, resource: alphaTexture.createView() }
					]
				})
			);
			resolvePass.dispatchWorkgroups(Math.ceil(model.width / 8), Math.ceil(model.height / 8));
			resolvePass.end();
			// Next frame's history = this frame's smoothed alpha.
			resolveEncoder.copyTextureToTexture(
				{ texture: alphaTexture },
				{ texture: session.history },
				{ width: model.width, height: model.height }
			);
			device.queue.submit([resolveEncoder.finish()]);
			submitted = true;

			// Free ORT's output tensors (and their GPU buffers) only after the resolve
			// pass that reads the alpha has finished on the GPU — avoids a use-after-free.
			// `.finally` (not `.then`) so a device-loss rejection still disposes them.
			void device.queue.onSubmittedWorkDone().finally(() => {
				for (const tensor of outputs) tensor.dispose();
			});

			session.lastSourceTimeS = request.sourceTimeS;
			// History now matches this displayed frame again (fresh alpha was written).
			session.historyStale = false;
			// The cache owns alphaTexture from here (destroyed on eviction).
			this.cache.set(cacheKey, alphaTexture, model.width, model.height);
		} catch (error) {
			alphaTexture.destroy();
			// Pre-submit: the GPU never took the read, so dispose the output tensors
			// here. Post-submit, onSubmittedWorkDone owns their disposal.
			if (!submitted) {
				for (const tensor of outputs) tensor.dispose();
			}
			throw error;
		}
		const view = this.cache.get(cacheKey);
		if (view) this.lastView.set(request.clipId, view);
		return view;
	}
}
