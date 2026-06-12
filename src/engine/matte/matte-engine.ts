/**
 * Portrait matting engine — Phase 31 (corrected plan).
 *
 * Lives in the pipeline worker on the compositor's own `GPUDevice` and runs
 * per-frame, zero-copy inference at playback/export time:
 *
 *   VideoFrame → importExternalTexture → preprocess WGSL (resize/normalize,
 *   NCHW pack into a GPU buffer) → onnxruntime-web WebGPU EP with GPU IO
 *   binding (`Tensor.fromGpuBuffer`, `preferredOutputLocation: 'gpu-buffer'`)
 *   → resolve WGSL (alpha buffer → r8 texture + EMA temporal smoothing)
 *   → matte-apply / matte-blur in the Phase 12 compositor.
 *
 * No CPU pixel round-trips anywhere. The inference session issues its own
 * command submissions (a separate subsystem from the compositor's
 * single-submission effect chain); alpha delivery into the compositor adds no
 * extra submission.
 *
 * Licensing: the engine is model-agnostic but the deployed default must be
 * permissively licensed (MODNet, Apache-2.0). GPL-family models (e.g. RVM)
 * are rejected — see .kiro/specs/phase-31-portrait-matting/design.md.
 *
 * Everything is local-only: weights load same-origin on demand, are
 * manifest-validated and SHA-256-verified (Phase 28 conventions); video
 * frames never leave the device; there is no cloud fallback of any kind.
 */

import mattePreprocessSource from '../shaders/matte-preprocess.wgsl?raw';
import matteResolveSource from '../shaders/matte-resolve.wgsl?raw';
import type { MatteEngineStatusSnapshot, MatteModelStatus } from '../../protocol';
import { MatteCache, makeMatteCacheKey } from '../matte-cache';
import { validateManifest, verifyWeights } from './model-manifest';

/**
 * Same-origin locations for the model manifest and the ORT WASM binaries.
 * Neither is bundled (Cloudflare Workers caps assets at 25 MiB) — deployments
 * that enable matting serve them under /models/ (see the
 * `strip-ort-wasm-assets` plugin in vite.config.ts).
 */
const MATTE_MANIFEST_URL = '/models/matte/manifest.json';
const ORT_WASM_BASE_PATH = '/models/ort/';

/** EMA history weight — the temporal-stability surrogate for single-frame
 *  models (R4). Fixed (also in test mode) so output is deterministic. */
const TEMPORAL_SMOOTHING = 0.5;

/** Reuse-cache budget. Correctness never depends on a hit (R3.3). */
const MATTE_CACHE_BYTES = 32 * 1024 * 1024;

export interface MatteEngineOptions {
	device: GPUDevice;
	onStatus: (status: MatteEngineStatusSnapshot) => void;
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
	session: import('onnxruntime-web').InferenceSession;
	inputName: string;
	outputName: string;
	width: number;
	height: number;
	modelKey: string;
}

type Ort = typeof import('onnxruntime-web');

/** Imports onnxruntime-web and points its WASM loader at the deployed path. */
async function loadOrt(): Promise<Ort> {
	const ortModule = await import('onnxruntime-web');
	if (ortModule.env?.wasm) {
		ortModule.env.wasm.wasmPaths = ORT_WASM_BASE_PATH;
	}
	return ortModule;
}

export class MatteEngine {
	private readonly device: GPUDevice;
	private readonly onStatus: (status: MatteEngineStatusSnapshot) => void;
	private readonly manifestUrl: string;
	private readonly testMode: boolean;

	private readonly cache: MatteCache;
	private readonly sessions = new Map<string, ClipSession>();
	private readonly lastView = new Map<string, GPUTextureView>();

	private ort: Ort | null = null;
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
		void this.model?.session.release();
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
				// Honest capability: the non-WebGPU fallback (MediaPipe selfie
				// segmenter) is specced but not implemented yet — see tasks T4.1.
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

		const ort = await loadOrt();
		// Shared-device contract (R3.2): the WebGPU EP must compute on the
		// compositor's device or GPU IO binding cannot deliver alpha without a
		// readback. ORT ≥1.26 accepts an externally created device before the
		// first session.
		(ort.env.webgpu as unknown as { device?: GPUDevice }).device = this.device;
		this.ort = ort;

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
			typeof rawManifest.weightsUrl === 'string' ? rawManifest.weightsUrl : 'model.onnx';
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

		const session = await ort.InferenceSession.create(bytes, {
			executionProviders: ['webgpu'],
			// Alpha stays on the GPU; the resolve pass consumes the buffer directly.
			preferredOutputLocation: 'gpu-buffer'
		} as import('onnxruntime-web').InferenceSession.SessionOptions);

		const inputName = session.inputNames[0];
		const outputName = session.outputNames[0];
		if (!inputName || !outputName) {
			void session.release();
			throw new Error('Matte model exposes no input/output tensors.');
		}

		this.model = {
			session,
			inputName,
			outputName,
			width: manifest.inputWidth,
			height: manifest.inputHeight,
			modelKey: manifest.id
		};
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
		const ort = this.ort!;
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

		const planeBytes = model.width * model.height * 4;
		if (!this.inputBuffer) {
			this.inputBuffer = device.createBuffer({
				size: 3 * planeBytes,
				usage: GPUBufferUsage.STORAGE
			});
		}

		let outputTensor: import('onnxruntime-web').Tensor | null = null;
		try {
			// 1. Preprocess: external texture → normalized NCHW GPU buffer.
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

			// 2. Inference with GPU IO binding — the tensor wraps our buffer, the
			// output stays in a GPU buffer (no CPU contact).
			const inputTensor = ort.Tensor.fromGpuBuffer(this.inputBuffer as never, {
				dataType: 'float32',
				dims: [1, 3, model.height, model.width]
			});
			const results = await model.session.run({ [model.inputName]: inputTensor });
			outputTensor = results[model.outputName] ?? null;
			if (!outputTensor) {
				throw new Error(`Matte model output "${model.outputName}" missing.`);
			}
			const alphaBuffer = outputTensor.gpuBuffer as GPUBuffer;

			// 3. Resolve: raw alpha buffer + history → smoothed r8 alpha texture.
			const alphaTexture = device.createTexture({
				size: { width: model.width, height: model.height },
				format: 'r8unorm',
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.COPY_SRC
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

			session.lastSourceTimeS = request.sourceTimeS;
			// The cache owns alphaTexture from here (destroyed on eviction).
			this.cache.set(cacheKey, alphaTexture, model.width, model.height);
			const view = this.cache.get(cacheKey);
			if (view) this.lastView.set(request.clipId, view);
			return view;
		} finally {
			outputTensor?.dispose();
			try {
				request.frame.close();
			} catch {
				// Already closed.
			}
		}
	}
}
