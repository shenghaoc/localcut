/**
 * ONNX Runtime Web (ORT) DTLN inference runtime. Loads the two upstream
 * `model_*.onnx` graphs (STFT-domain masking + learned-transform enhancement)
 * and manages their recurrent-state tensors across frames.
 *
 * Drop-in alternative to {@link file://./dtln-runtime.ts} (LiteRT): it exposes
 * the same `runModel1` / `runModel2` / `resetState` / `destroy` surface and the
 * same `accelerator` label, so the shared worker core
 * ({@link file://./cleanup-worker-core.ts}) drives either backend unchanged.
 *
 * Unlike the frame-coupled video models, DTLN's tensors are tiny (≤ 512 floats),
 * so this runtime uses **CPU tensors** and pins the `wasm` execution provider by
 * default — there is no zero-copy GPU benefit to chase here. It still goes
 * through the foundation's lazy `onnxruntime-web` loader and same-origin WASM
 * path ({@link file://../ml/ort/ort-loader.ts}), so ORT never enters the startup
 * bundle and is fetched from `/_ort/` under COEP.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import type { OrtExecutionProvider } from '../ml/ort/ort-types';
import { resolveExecutionProviders } from '../ml/ort/ep-policy';
import {
	loadOrtWasm,
	loadOrtWebGpu,
	loadOrtWebNN,
	ortWasmBasePath,
	type OrtModule
} from '../ml/ort/ort-loader';
import type { CleanupAccelerator } from '../../protocol';
import { DTLN_BLOCK_LEN, DTLN_FREQ_BINS } from './dtln-dsp';
import type { OnnxCleanupIo } from './onnx-model-manifest';

export interface DtlnOrtRuntimeOptions {
	model1Bytes: Uint8Array;
	model2Bytes: Uint8Array;
	stateShape: number[];
	io: OnnxCleanupIo;
	executionProviders: OrtExecutionProvider[];
}

/** Picks the smallest ORT build that covers the resolved EP list. */
function loadOrtFor(eps: readonly OrtExecutionProvider[]): Promise<OrtModule> {
	if (eps.includes('webnn')) return loadOrtWebNN();
	if (eps.includes('webgpu')) return loadOrtWebGpu();
	return loadOrtWasm();
}

/** Copies an ORT tensor's payload into a freshly owned Float32Array. */
function toFloat32(value: Tensor | undefined, name: string): Float32Array {
	if (!value) throw new Error(`DTLN ONNX model produced no "${name}" output`);
	const data = value.data;
	if (data instanceof Float32Array) return new Float32Array(data);
	throw new Error(`DTLN ONNX output "${name}" is not float32`);
}

function assertTensorNames(
	session: InferenceSession,
	wanted: readonly string[],
	io: 'input' | 'output',
	model: string
): void {
	const have = new Set(io === 'input' ? session.inputNames : session.outputNames);
	for (const name of wanted) {
		if (!have.has(name)) {
			throw new Error(
				`DTLN ONNX ${model} is missing ${io} "${name}" (has ${io}s: ${[...have].join(', ')})`
			);
		}
	}
}

export class DtlnOrtRuntime {
	private constructor(
		private readonly ort: OrtModule,
		private readonly session1: InferenceSession,
		private readonly session2: InferenceSession,
		readonly accelerator: CleanupAccelerator,
		private readonly stateShape: number[],
		private readonly io: OnnxCleanupIo,
		private state1: Float32Array,
		private state2: Float32Array
	) {}

	static async create(options: DtlnOrtRuntimeOptions): Promise<DtlnOrtRuntime> {
		// Audio cleanup is not frame-coupled, so the EP policy permits a `wasm`
		// (CPU) provider — the opposite of the matte/interpolation gate.
		const eps = resolveExecutionProviders({
			frameCoupled: false,
			executionProviders: options.executionProviders
		});
		const ort = await loadOrtFor(eps);
		// Same-origin, version-pinned WASM runtime (no cross-origin CDN under COEP).
		// Idempotent; must be set before the first session is created.
		ort.env.wasm.wasmPaths = ortWasmBasePath();

		const sessionOptions: InferenceSession.SessionOptions = { executionProviders: [...eps] };
		let session1: InferenceSession | null = null;
		let session2: InferenceSession | null = null;
		try {
			session1 = await ort.InferenceSession.create(options.model1Bytes, sessionOptions);
			session2 = await ort.InferenceSession.create(options.model2Bytes, sessionOptions);
		} catch (error) {
			void session1?.release();
			void session2?.release();
			throw error;
		}

		const { model1, model2 } = options.io;
		try {
			assertTensorNames(session1, [model1.magnitudeInput, model1.stateInput], 'input', 'model1');
			assertTensorNames(session1, [model1.maskOutput, model1.stateOutput], 'output', 'model1');
			assertTensorNames(session2, [model2.frameInput, model2.stateInput], 'input', 'model2');
			assertTensorNames(session2, [model2.frameOutput, model2.stateOutput], 'output', 'model2');
		} catch (error) {
			void session1.release();
			void session2.release();
			throw error;
		}

		const stateSize = options.stateShape.reduce((a, b) => a * b, 1);
		return new DtlnOrtRuntime(
			ort,
			session1,
			session2,
			eps[0]!,
			options.stateShape,
			options.io,
			new Float32Array(stateSize),
			new Float32Array(stateSize)
		);
	}

	resetState(): void {
		this.state1.fill(0);
		this.state2.fill(0);
	}

	async runModel1(magnitude: Float32Array): Promise<Float32Array> {
		const { magnitudeInput, stateInput, maskOutput, stateOutput } = this.io.model1;
		const input = new this.ort.Tensor('float32', magnitude, [1, 1, DTLN_FREQ_BINS]);
		const state = new this.ort.Tensor('float32', this.state1.slice(), this.stateShape);
		const outputs = await this.session1.run({ [magnitudeInput]: input, [stateInput]: state });
		this.state1 = toFloat32(outputs[stateOutput], stateOutput);
		return toFloat32(outputs[maskOutput], maskOutput).slice(0, DTLN_FREQ_BINS);
	}

	async runModel2(estimated: Float32Array): Promise<Float32Array> {
		const { frameInput, stateInput, frameOutput, stateOutput } = this.io.model2;
		const input = new this.ort.Tensor('float32', estimated, [1, 1, DTLN_BLOCK_LEN]);
		const state = new this.ort.Tensor('float32', this.state2.slice(), this.stateShape);
		const outputs = await this.session2.run({ [frameInput]: input, [stateInput]: state });
		this.state2 = toFloat32(outputs[stateOutput], stateOutput);
		return toFloat32(outputs[frameOutput], frameOutput).slice(0, DTLN_BLOCK_LEN);
	}

	destroy(): void {
		// `release()` is async; the worker calls destroy() synchronously, so fire and
		// forget — the sessions hold only WASM heap, freed on the next macrotask.
		void this.session1.release();
		void this.session2.release();
	}
}
