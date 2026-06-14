/**
 * Portrait matting engine — Phase 31, LiteRT runtime.
 *
 * Lives in the pipeline worker on the compositor's own `GPUDevice` and runs
 * per-frame, zero-copy inference at playback/export time:
 *
 *   VideoFrame → importExternalTexture → preprocess WGSL (resize/normalize,
 *   NHWC pack into a GPU buffer) → LiteRT.js (`@litertjs/core`) WebGPU model
 *   with GPU-buffer tensor IO (`new Tensor(gpuBuffer, …)` in,
 *   `tensor.toGpuBuffer()` out) → resolve WGSL (alpha buffer → r8 texture +
 *   EMA temporal smoothing) → matte-apply / matte-blur in the Phase 12
 *   compositor.
 *
 * The shared-device zero-copy contract LiteRT makes possible (and ONNX Runtime
 * 1.26 could not — it ignored an injected `env.webgpu.device`): we call
 * `litert.setWebGpuDevice(this.device)` before compiling so the model computes
 * on the compositor's device, and GPU-buffer tensors keep the input and alpha
 * on that device with no CPU pixel round-trip.
 *
 * Licensing: the engine is model-agnostic but the deployed default must be
 * permissively licensed (MODNet, Apache-2.0). GPL-family models are rejected —
 * see .kiro/specs/phase-31-portrait-matting/design.md.
 *
 * Everything is local-only: the `.tflite` model loads same-origin on demand,
 * is manifest-validated and SHA-256-verified (Phase 28 conventions); video
 * frames never leave the device; there is no cloud fallback of any kind.
 */

import mattePreprocessSource from '../shaders/matte-preprocess.wgsl?raw';
import matteResolveSource from '../shaders/matte-resolve.wgsl?raw';
import type { MatteEngineStatusSnapshot, MatteModelStatus } from '../../protocol';
import { MatteCache, makeMatteCacheKey } from '../matte-cache';
import { validateManifest, verifyWeights } from './model-manifest';
import { loadLiteRtModule } from './litert-loader';

/** Same-origin manifest describing the deployed `.tflite` model. */
const MATTE_MANIFEST_URL = '/models/matte/manifest.json';

/** EMA history weight — the temporal-stability surrogate for single-frame
 *  models (R4). Fixed (also in test mode) so output is deterministic. */
const TEMPORAL_SMOOTHING = 0.5;

/** Reuse-cache budget. Correctness never depends on a hit (R3.3). */
const MATTE_CACHE_BYTES = 32 * 1024 * 1024;

// ── Minimal local typings for the @litertjs/core surface the engine uses ──
// (Narrowed from the untyped `litert-loader` boundary so the package's global
// TypedArray augmentation never enters the TypeScript program.)
interface LiteRtTensor {
	toGpuBuffer(): GPUBuffer;
	delete(): void;
}
interface LiteRtTensorDetails {
	readonly shape: Int32Array;
}
interface LiteRtCompiledModel {
	run(input: LiteRtTensor[]): Promise<LiteRtTensor[]>;
	getInputDetails(): readonly LiteRtTensorDetails[];
	delete(): void;
}
interface LiteRtTensorCtor {
	new (gpuBuffer: GPUBuffer, shape: number[], dataType: 'float32'): LiteRtTensor;
}
interface LiteRtApi {
	loadLiteRt(path: string, options?: { threads?: boolean; jspi?: boolean }): Promise<unknown>;
	setWebGpuDevice(device: GPUDevice): void;
	loadAndCompile(
		model: Uint8Array,
		options: { accelerator: 'webgpu' | 'wasm' }
	): Promise<LiteRtCompiledModel>;
	Tensor: LiteRtTensorCtor;
}

export interface MatteEngineOptions {
	device: GPUDevice;
	onStatus: (status: MatteEngineStatusSnapshot) => void;
	/** Same-origin directory the LiteRT WASM runtime loads from (`/litert/<sha>/`). */
	wasmPath: string;
	manifestUrl?: string;
	/** Determinism mode (R8): disables the reuse-last-while-busy shortcut so
	 *  repeated runs over a fixture produce identical alpha. */
	testMode?: boolean;
}

export interface MatteFrameRequest {
	clipId: string;
	/** Clip's pinned model (R1.2) — mismatch against the deployed model warns. */
	modelKey: string;
	/** Engine-owned clone; the engine closes it exactly once. */
	frame: VideoFrame;
	sourceTimeS: number;
	/** Expected source frame step (1/fps) for the discontinuity policy (R4.2). */
	frameStepS: number;
	quality: 'preview' | 'export';
}

interface ClipSession {
	history: GPUTexture;
	historyView: GPUTextureView;
	lastSourceTimeS: number | null;
}

interface LoadedModel {
	compiled: LiteRtCompiledModel;
	width: number;
	height: number;
	modelKey: string;
}

export class MatteEngine {
	private readonly device: GPUDevice;
	private readonly onStatus: (status: MatteEngineStatusSnapshot) => void;
	private readonly wasmPath: string;
	private readonly manifestUrl: string;
	private readonly testMode: boolean;

	private readonly cache: MatteCache;
	private readonly sessions = new Map<string, ClipSession>();
	private readonly lastView = new Map<string, GPUTextureView>();

	private api: LiteRtApi | null = null;
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

	constructor(options: MatteEngineOptions) {
		this.device = options.device;
		this.onStatus = options.onStatus;
		this.wasmPath = options.wasmPath;
		this.manifestUrl = options.manifestUrl ?? MATTE_MANIFEST_URL;
		this.testMode = options.testMode ?? false;
		this.cache = new MatteCache({ maxBytes: MATTE_CACHE_BYTES });
	}

	/**
	 * Returns the smoothed alpha matte view for one frame, running inference if
	 * needed. Preview returns the previous alpha (or null) instead of stalling
	 * when inference is busy or the model is still loading; export always waits.
	 * The engine takes ownership of `request.frame` and closes it exactly once.
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

		if (this.running) {
			if (request.quality === 'preview' && !this.testMode) {
				// Keep preview realtime: reuse the clip's previous alpha rather than
				// queueing behind in-flight inference.
				request.frame.close();
				return this.lastView.get(request.clipId) ?? null;
			}
			await this.running.catch(() => {});
		}

		const run = this.runInference(request, cacheKey).finally(() => {
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
			session.history.destroy();
			this.sessions.delete(clipId);
		}
		this.lastView.delete(clipId);
		this.cache.deleteByClip(clipId);
	}

	dispose(): void {
		this.disposed = true;
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
		this.model?.compiled.delete();
		this.model = null;
	}

	/** Re-reads load state after awaits (defeats control-flow narrowing). */
	private isLoaded(): boolean {
		return this.modelStatus === 'loaded';
	}

	private postStatus(): void {
		this.onStatus({
			probe: {
				webgpu: 'supported',
				// Honest capability: the non-WebGPU (wasm) fallback is specced but
				// not implemented yet — see tasks T4.1.
				wasm: 'unsupported',
				backend: 'webgpu'
			},
			modelStatus: this.modelStatus,
			backend: this.modelStatus === 'loaded' ? 'webgpu' : null,
			...(this.loadError ? { error: this.loadError } : {})
		});
	}

	private ensureModelLoaded(): Promise<void> {
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.loadModel().catch((error) => {
			this.modelStatus = 'failed';
			this.loadError = error instanceof Error ? error.message : String(error);
			this.loadPromise = null; // Allow retry on the next matted frame.
			this.postStatus();
		});
		return this.loadPromise;
	}

	private async loadModel(): Promise<void> {
		this.modelStatus = 'loading';
		this.loadError = undefined;
		this.postStatus();

		const api = (await loadLiteRtModule()) as LiteRtApi;
		// LiteRT loads its WASM through an emscripten module that resolves the
		// `.wasm` relative to the worker script URL by default; point `locateFile`
		// at the deployed runtime directory so the binary is fetched there.
		const wasmDir = this.wasmPath.endsWith('/') ? this.wasmPath : `${this.wasmPath}/`;
		(globalThis as unknown as { Module?: unknown }).Module = {
			locateFile: (file: string) =>
				file.startsWith('/') || /^https?:/.test(file) ? file : `${wasmDir}${file}`
		};
		// Non-threaded runtime: heavy compute runs on the WebGPU device, so the
		// harness build choice is not a hot path, and it avoids the threaded
		// build's pthread workers.
		await api.loadLiteRt(this.wasmPath, { threads: false });
		// Shared-device contract (R3.2): compile on the compositor's device so
		// GPU-buffer tensor IO delivers alpha without a CPU readback.
		api.setWebGpuDevice(this.device);
		this.api = api;

		const response = await fetch(this.manifestUrl);
		if (!response.ok) {
			throw new Error(`Matte model manifest fetch failed: HTTP ${response.status}`);
		}
		const rawManifest = (await response.json()) as Record<string, unknown>;
		const manifest = validateManifest(rawManifest);
		if (/gpl/i.test(manifest.license)) {
			// Hard gate, not a warning: this application is MIT-licensed and must
			// not direct users through GPL-family weights (design.md verdict).
			throw new Error(
				`Matte model "${manifest.id}" declares a GPL-family license (${manifest.license}); refusing to load.`
			);
		}
		const weightsRelative =
			typeof rawManifest.weightsUrl === 'string' ? rawManifest.weightsUrl : 'model.tflite';
		const weightsUrl = new URL(weightsRelative, new URL(this.manifestUrl, self.location.href));
		if (weightsUrl.origin !== self.location.origin) {
			throw new Error('Matte model weights must be same-origin.');
		}
		const weights = await fetch(weightsUrl);
		if (!weights.ok) {
			throw new Error(`Matte model weights fetch failed: HTTP ${weights.status}`);
		}
		const bytes = await weights.arrayBuffer();
		await verifyWeights(manifest, bytes);

		const compiled = await api.loadAndCompile(new Uint8Array(bytes), { accelerator: 'webgpu' });

		// Derive H/W from the model's NHWC input ([1, H, W, 3]); fall back to the
		// manifest. The model is authoritative — the preprocess pass must match it.
		const inputShape = compiled.getInputDetails()[0]?.shape;
		let width = manifest.inputWidth;
		let height = manifest.inputHeight;
		if (inputShape && inputShape.length === 4 && inputShape[3] === 3) {
			height = inputShape[1];
			width = inputShape[2];
		}

		this.model = { compiled, width, height, modelKey: manifest.id };
		this.modelStatus = 'loaded';
		this.postStatus();
	}

	private ensurePipelines(): void {
		if (this.preprocessPipeline) return;
		const device = this.device;
		this.preprocessPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: mattePreprocessSource }),
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
			size: 8,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.resolveUniform = device.createBuffer({
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
			const history = this.device.createTexture({
				size: { width: model.width, height: model.height },
				format: 'r8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
			});
			session = { history, historyView: history.createView(), lastSourceTimeS: null };
			this.sessions.set(clipId, session);
		}
		return session;
	}

	private touchSession(request: MatteFrameRequest): void {
		const session = this.sessions.get(request.clipId);
		if (session) session.lastSourceTimeS = request.sourceTimeS;
	}

	private async runInference(
		request: MatteFrameRequest,
		cacheKey: string
	): Promise<GPUTextureView | null> {
		const model = this.model!;
		const api = this.api!;
		const device = this.device;
		this.ensurePipelines();

		// Pin check (R1.2): warn once per clip on mismatch; never silently switch.
		if (request.modelKey !== model.modelKey && !this.pinWarned.has(request.clipId)) {
			this.pinWarned.add(request.clipId);
			this.loadError = `Clip pins matte model "${request.modelKey}" but "${model.modelKey}" is deployed; using the deployed model.`;
			this.postStatus();
			this.loadError = undefined;
		}

		const session = this.sessionFor(request.clipId);
		// Discontinuity policy (R4.2): seek / >1.5-frame jump / first frame resets
		// temporal history.
		const step = request.frameStepS > 0 ? request.frameStepS : 1 / 30;
		const reset =
			session.lastSourceTimeS === null ||
			Math.abs(request.sourceTimeS - session.lastSourceTimeS) > 1.5 * step;

		// NHWC input buffer: H*W*3 float32. STORAGE for the preprocess pass +
		// COPY_SRC/DST so LiteRT can import it as a GPU-buffer tensor.
		const inputFloats = model.width * model.height * 3;
		if (!this.inputBuffer) {
			this.inputBuffer = device.createBuffer({
				size: inputFloats * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
			});
		}

		// 1. Preprocess: external texture → normalized NHWC GPU buffer.
		device.queue.writeBuffer(
			this.preprocessUniform!,
			0,
			new Uint32Array([model.width, model.height])
		);
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
		// The source frame is consumed by the import above; close it now.
		try {
			request.frame.close();
		} catch {
			// Already closed.
		}

		// 2. Inference with GPU-buffer tensor IO — input wraps our preprocess
		// buffer (no upload), output stays a GPU buffer (no readback). Both live
		// on the shared compositor device.
		const inputTensor = new api.Tensor(
			this.inputBuffer,
			[1, model.height, model.width, 3],
			'float32'
		);
		let outputs: LiteRtTensor[];
		try {
			outputs = await this.compiledRun(model, inputTensor);
		} finally {
			// The tensor wrapped our buffer, so delete() does NOT release it.
			inputTensor.delete();
		}
		const alphaTensor = outputs[0];
		if (!alphaTensor) throw new Error('Matte model produced no output tensor.');
		const alphaBuffer = alphaTensor.toGpuBuffer();

		// 3. Resolve: raw alpha buffer + history → smoothed r8 alpha texture.
		const alphaTexture = device.createTexture({
			size: { width: model.width, height: model.height },
			format: 'r8unorm',
			usage:
				GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
		});
		const uniform = new ArrayBuffer(16);
		new Uint32Array(uniform, 0, 2).set([model.width, model.height]);
		new Float32Array(uniform, 8, 1)[0] = TEMPORAL_SMOOTHING;
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

		// Free LiteRT's output tensor (and its GPU buffer) only after the resolve
		// pass that reads it has finished on the GPU — avoids a use-after-free.
		void device.queue.onSubmittedWorkDone().then(() => {
			for (const tensor of outputs) tensor.delete();
		});

		session.lastSourceTimeS = request.sourceTimeS;
		// The cache owns alphaTexture from here (destroyed on eviction).
		this.cache.set(cacheKey, alphaTexture, model.width, model.height);
		const view = this.cache.get(cacheKey);
		if (view) this.lastView.set(request.clipId, view);
		return view;
	}

	/** Runs the compiled model's default signature with one positional input. */
	private compiledRun(model: LoadedModel, input: LiteRtTensor): Promise<LiteRtTensor[]> {
		return model.compiled.run([input]);
	}
}
