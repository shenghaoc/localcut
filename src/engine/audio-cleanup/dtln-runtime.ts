/**
 * LiteRT-based DTLN inference runtime. Loads two TFLite models (STFT-domain
 * masking + learned-transform enhancement) and manages their LSTM state
 * tensors across frames.
 *
 * Follows the same untyped-boundary pattern as the ASR runtime: the
 * `@litertjs/core` module is loaded via `litert-loader.js` so its global
 * TypedArray augmentation never enters the TypeScript program.
 */

import { loadLiteRtModule } from '../asr/litert-loader';
import { DTLN_BLOCK_LEN, DTLN_FREQ_BINS } from './dtln-dsp';

export type CleanupAccelerator = 'wasm' | 'webgpu' | 'webnn';

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
	Tensor: {
		fromTypedArray(data: Float32Array | Int32Array, shape: number[]): LiteRtTensor;
	};
}

const SIGNATURE = 'serving_default';
let liteRtLoaded = false;

export interface DtlnRuntimeOptions {
	wasmPath: string;
	accelerator: CleanupAccelerator;
	model1Bytes: Uint8Array;
	model2Bytes: Uint8Array;
	stateShape: number[];
}

function loadOptions(acc: CleanupAccelerator): LiteRtLoadOptions {
	return acc === 'webnn' ? { threads: false, jspi: true } : { threads: false };
}

function compileOptionCandidates(acc: CleanupAccelerator): LiteRtCompileOptions[] {
	if (acc !== 'webnn') return [{ accelerator: acc }];
	return (['npu', 'gpu', 'cpu'] as const).map((devicePreference) => ({
		accelerator: acc,
		webNNOptions: { devicePreference }
	}));
}

export class DtlnRuntime {
	private constructor(
		private readonly api: LiteRtApi,
		private readonly compiled1: LiteRtCompiledModel,
		private readonly compiled2: LiteRtCompiledModel,
		readonly accelerator: CleanupAccelerator,
		private readonly stateShape: number[],
		private state1: Float32Array,
		private state2: Float32Array
	) {}

	static async create(options: DtlnRuntimeOptions): Promise<DtlnRuntime> {
		const api = (await loadLiteRtModule()) as LiteRtApi;

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
			} catch {
				if (accelerator !== 'wasm') {
					await api.loadLiteRt(options.wasmPath, loadOptions('wasm'));
					accelerator = 'wasm';
					liteRtLoaded = true;
				}
			}
		}

		let compiled1: LiteRtCompiledModel | null = null;
		let compiled2: LiteRtCompiledModel | null = null;
		let lastError: unknown;
		for (const compileOpts of compileOptionCandidates(accelerator)) {
			try {
				compiled1 = await api.loadAndCompile(options.model1Bytes, compileOpts);
				compiled2 = await api.loadAndCompile(options.model2Bytes, compileOpts);
				break;
			} catch (error) {
				lastError = error;
				compiled1?.delete();
				compiled1 = null;
			}
		}
		if (!compiled1 || !compiled2) {
			if (accelerator === 'wasm') throw lastError;
			try {
				compiled1 = await api.loadAndCompile(options.model1Bytes, { accelerator: 'wasm' });
				compiled2 = await api.loadAndCompile(options.model2Bytes, { accelerator: 'wasm' });
			} catch (error) {
				compiled1?.delete();
				compiled2?.delete();
				throw error;
			}
			accelerator = 'wasm';
		}

		const stateSize = options.stateShape.reduce((a, b) => a * b, 1);
		const state1 = new Float32Array(stateSize);
		const state2 = new Float32Array(stateSize);

		return new DtlnRuntime(
			api,
			compiled1,
			compiled2,
			accelerator,
			options.stateShape,
			state1,
			state2
		);
	}

	resetState(): void {
		this.state1.fill(0);
		this.state2.fill(0);
	}

	async runModel1(magnitude: Float32Array): Promise<Float32Array> {
		const inputTensor = this.api.Tensor.fromTypedArray(magnitude, [1, 1, DTLN_FREQ_BINS]);
		const stateTensor = this.api.Tensor.fromTypedArray(
			new Float32Array(this.state1),
			this.stateShape
		);

		let outputs: LiteRtTensor[];
		try {
			outputs = await this.compiled1.run(SIGNATURE, [inputTensor, stateTensor]);
		} finally {
			inputTensor.delete();
			stateTensor.delete();
		}

		try {
			const maskData = await outputs[0]!.data();
			const mask = maskData instanceof Float32Array ? maskData : Float32Array.from(maskData);
			const stateData = await outputs[1]!.data();
			this.state1 =
				stateData instanceof Float32Array
					? new Float32Array(stateData)
					: Float32Array.from(stateData);
			return mask.slice(0, DTLN_FREQ_BINS);
		} finally {
			for (const t of outputs) t.delete();
		}
	}

	async runModel2(estimated: Float32Array): Promise<Float32Array> {
		const inputTensor = this.api.Tensor.fromTypedArray(estimated, [1, 1, DTLN_BLOCK_LEN]);
		const stateTensor = this.api.Tensor.fromTypedArray(
			new Float32Array(this.state2),
			this.stateShape
		);

		let outputs: LiteRtTensor[];
		try {
			outputs = await this.compiled2.run(SIGNATURE, [inputTensor, stateTensor]);
		} finally {
			inputTensor.delete();
			stateTensor.delete();
		}

		try {
			const enhancedData = await outputs[0]!.data();
			const enhanced =
				enhancedData instanceof Float32Array ? enhancedData : Float32Array.from(enhancedData);
			const stateData = await outputs[1]!.data();
			this.state2 =
				stateData instanceof Float32Array
					? new Float32Array(stateData)
					: Float32Array.from(stateData);
			return enhanced.slice(0, DTLN_BLOCK_LEN);
		} finally {
			for (const t of outputs) t.delete();
		}
	}

	destroy(): void {
		this.compiled1.delete();
		this.compiled2.delete();
	}
}
