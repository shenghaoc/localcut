/**
 * Concrete {@link WhisperRuntime} backed by LiteRT.js (`@litertjs/core`), for the
 * single-file `litert-community/whisper-*` models that expose two signatures:
 *
 *   encode: float32[1, nMel, nFrames]                          -> float32[1, frames, dModel]
 *   decode: float32[1, frames, dModel], int32[1, T], float32[1,1,T,T] -> float32[1, T, vocab]
 *
 * The decode signature is run with a **constant lower-triangular additive causal
 * mask** (0 on/below the diagonal, a large finite negative above — never
 * `-Infinity`, which would NaN), exactly as Google's `litert-samples` ASR sample
 * does. Each greedy step writes the whole T-length token buffer and reads the
 * logits row of the last filled position.
 *
 * Two design constraints carry over from the earlier design: the WASM is served
 * same-origin from a build-scoped `public/litert/<sha>/` directory, and
 * `@litertjs/core` is reached through the untyped `litert-loader` boundary so
 * its global TypedArray type augmentation never enters the TypeScript program.
 */
import type { AsrAccelerator, AsrModelManifestSnapshot } from '../../protocol';
import type { EncodedAudio, MelInput, WhisperRuntime } from './whisper-decode';
import { loadLiteRtModule } from './litert-loader';

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
interface LiteRtWebNNOptions {
	devicePreference: 'npu' | 'gpu' | 'cpu';
}
interface LiteRtCompileOptions {
	accelerator: AsrAccelerator;
	webNNOptions?: LiteRtWebNNOptions;
}
interface LiteRtApi {
	loadLiteRt(path: string, options?: LiteRtLoadOptions): Promise<unknown>;
	loadAndCompile(model: Uint8Array, options: LiteRtCompileOptions): Promise<LiteRtCompiledModel>;
	Tensor: { fromTypedArray(data: Float32Array | Int32Array, shape: number[]): LiteRtTensor };
}

const ENCODE_SIGNATURE = 'encode';
const DECODE_SIGNATURE = 'decode';
/** Large finite negative for masked-out attention (NOT -Infinity — avoids NaN). */
const MASK_NEG = -3.4e38;

export interface LiteRtRuntimeOptions {
	/** Directory (or .js file) the LiteRT.js WASM runtime loads from. */
	wasmPath: string;
	accelerator: AsrAccelerator;
	/** The single TFLite model file bytes. */
	modelBytes: Uint8Array;
	manifest: AsrModelManifestSnapshot;
}

export interface LiteRtWhisperRuntime extends WhisperRuntime {
	readonly accelerator: AsrAccelerator;
}

interface EncodedAudioWithState extends EncodedAudio {
	hidden: LiteRtTensor;
}

/** Transpose frame-major mel (nFrames × nMel) to padded mel-major [nMel × frames]. */
function toMelMajor(mel: MelInput, nMel: number, frames: number): Float32Array {
	const out = new Float32Array(nMel * frames);
	const copyFrames = Math.min(mel.nFrames, frames);
	const copyMel = Math.min(mel.nMel, nMel);
	for (let m = 0; m < copyMel; m++) {
		for (let f = 0; f < copyFrames; f++) {
			out[m * frames + f] = mel.data[f * mel.nMel + m];
		}
	}
	return out;
}

/** Constant [1,1,T,T] additive causal mask: 0 where col ≤ row, MASK_NEG above. */
function buildCausalMask(t: number): Float32Array {
	const mask = new Float32Array(t * t).fill(MASK_NEG);
	for (let r = 0; r < t; r++) {
		for (let c = 0; c <= r; c++) mask[r * t + c] = 0;
	}
	return mask;
}

export function liteRtLoadOptionsForAccelerator(accelerator: AsrAccelerator): LiteRtLoadOptions {
	return accelerator === 'webnn' ? { threads: false, jspi: true } : { threads: false };
}

function sameLoadOptions(a: LiteRtLoadOptions, b: LiteRtLoadOptions): boolean {
	return a.threads === b.threads && a.jspi === b.jspi;
}

export function liteRtCompileOptionsForAccelerator(
	accelerator: AsrAccelerator
): LiteRtCompileOptions {
	return accelerator === 'webnn'
		? { accelerator, webNNOptions: { devicePreference: 'npu' } }
		: { accelerator };
}

function liteRtCompileOptionCandidates(accelerator: AsrAccelerator): LiteRtCompileOptions[] {
	if (accelerator !== 'webnn') return [liteRtCompileOptionsForAccelerator(accelerator)];
	return (['npu', 'gpu', 'cpu'] as const).map((devicePreference) => ({
		accelerator,
		webNNOptions: { devicePreference }
	}));
}

class LiteRtRuntimeImpl implements LiteRtWhisperRuntime {
	readonly accelerator: AsrAccelerator;
	private readonly api: LiteRtApi;
	private readonly model: LiteRtCompiledModel;
	private readonly nMel: number;
	private readonly melFrames: number;
	private readonly vocabSize: number;
	private readonly maxTokens: number;
	private readonly maskTensor: LiteRtTensor;

	constructor(params: {
		api: LiteRtApi;
		model: LiteRtCompiledModel;
		accelerator: AsrAccelerator;
		manifest: AsrModelManifestSnapshot;
	}) {
		this.api = params.api;
		this.model = params.model;
		this.accelerator = params.accelerator;
		this.vocabSize = params.manifest.vocabSize;
		this.maxTokens = params.manifest.maxDecodeTokens;
		this.nMel = params.manifest.audio.nMel;
		this.melFrames = Math.round(
			(params.manifest.audio.chunkLengthS * params.manifest.audio.sampleRate) /
				params.manifest.audio.hopLength
		);
		this.maskTensor = params.api.Tensor.fromTypedArray(buildCausalMask(this.maxTokens), [
			1,
			1,
			this.maxTokens,
			this.maxTokens
		]);
	}

	async encode(mel: MelInput): Promise<EncodedAudio> {
		const melMajor = toMelMajor(mel, this.nMel, this.melFrames);
		const input = this.api.Tensor.fromTypedArray(melMajor, [1, this.nMel, this.melFrames]);
		let outputs: LiteRtTensor[];
		try {
			outputs = await this.model.run(ENCODE_SIGNATURE, [input]);
		} finally {
			input.delete();
		}
		const hidden = outputs[0];
		const encoded: EncodedAudioWithState = {
			frames: this.melFrames,
			hidden,
			dispose: () => hidden.delete()
		};
		return encoded;
	}

	async decode(tokens: Int32Array, encoded: EncodedAudio): Promise<Float32Array> {
		const hidden = (encoded as EncodedAudioWithState).hidden;
		const length = Math.min(tokens.length, this.maxTokens);
		const buffer = new Int32Array(this.maxTokens);
		buffer.set(tokens.subarray(0, length));
		const tokenTensor = this.api.Tensor.fromTypedArray(buffer, [1, this.maxTokens]);
		let outputs: LiteRtTensor[] | null = null;

		try {
			outputs = await this.model.run(DECODE_SIGNATURE, [hidden, tokenTensor, this.maskTensor]);
			const logitsTensor = outputs[0];
			const data = await logitsTensor.data();
			const flat = data instanceof Float32Array ? data : Float32Array.from(data);
			// Logits are [1, maxTokens, vocab]; the next token is predicted at the
			// last filled row (length − 1).
			const row = length - 1;
			const start = row * this.vocabSize;
			const logits = flat.slice(start, start + this.vocabSize);
			return logits;
		} finally {
			tokenTensor.delete();
			if (outputs) {
				for (const tensor of outputs) tensor.delete();
			}
		}
	}

	dispose(): void {
		this.maskTensor.delete();
		this.model.delete();
	}
}

function ownCompiledModel(params: {
	api: LiteRtApi;
	model: LiteRtCompiledModel;
	accelerator: AsrAccelerator;
	manifest: AsrModelManifestSnapshot;
}): LiteRtWhisperRuntime {
	try {
		return new LiteRtRuntimeImpl(params);
	} catch (error) {
		params.model.delete();
		throw error;
	}
}

/**
 * Loads the LiteRT.js WASM runtime and compiles the Whisper model into a
 * ready-to-run {@link WhisperRuntime}. Tries the requested accelerator and, if
 * accelerated compilation fails on this device, transparently falls back to
 * `wasm`.
 * Heavy and side-effecting: call only from the ASR worker on explicit user load.
 */
export async function createLiteRtWhisperRuntime(
	options: LiteRtRuntimeOptions
): Promise<LiteRtWhisperRuntime> {
	const api = (await loadLiteRtModule()) as LiteRtApi;

	// @litertjs loads its WASM through an emscripten module but passes no file
	// locator, so emscripten's default `locateFile` resolves the `.wasm` relative
	// to the worker script URL (`/assets/…`) rather than the WASM directory. Set a
	// `locateFile` on the global `Module` (which the loader hands to the emscripten
	// factory) so the binary is fetched from `wasmPath` instead.
	const wasmDir = options.wasmPath.endsWith('/') ? options.wasmPath : `${options.wasmPath}/`;
	(globalThis as unknown as { Module?: unknown }).Module = {
		locateFile: (file: string) =>
			file.startsWith('/') || /^https?:/.test(file) ? file : `${wasmDir}${file}`
	};

	// Force the non-threaded (MODULARIZE) WASM build: the threaded build uses
	// `importScripts` for its pthread workers and a relaxed-SIMD path that is more
	// fragile to load. WebGPU/WebNN run heavy compute on-device accelerators when
	// available, so this harness choice is not a hot path. WebNN additionally
	// requires the JSPI build per LiteRT.js.
	let loadedAccelerator = options.accelerator;
	let loadedOptions = liteRtLoadOptionsForAccelerator(options.accelerator);
	try {
		await api.loadLiteRt(options.wasmPath, loadedOptions);
	} catch (error) {
		if (options.accelerator !== 'webnn') throw error;
		loadedOptions = liteRtLoadOptionsForAccelerator('wasm');
		await api.loadLiteRt(options.wasmPath, loadedOptions);
		loadedAccelerator = 'wasm';
	}

	let model: LiteRtCompiledModel;
	let accelerator: AsrAccelerator;
	try {
		let lastError: unknown;
		for (const compileOptions of liteRtCompileOptionCandidates(loadedAccelerator)) {
			try {
				model = await api.loadAndCompile(options.modelBytes, compileOptions);
				accelerator = loadedAccelerator;
				return ownCompiledModel({
					api,
					model,
					accelerator,
					manifest: options.manifest
				});
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError;
	} catch (error) {
		if (loadedAccelerator === 'wasm') throw error;
		const wasmOptions = liteRtLoadOptionsForAccelerator('wasm');
		if (!sameLoadOptions(loadedOptions, wasmOptions)) {
			await api.loadLiteRt(options.wasmPath, wasmOptions);
			loadedOptions = wasmOptions;
		}
		model = await api.loadAndCompile(
			options.modelBytes,
			liteRtCompileOptionsForAccelerator('wasm')
		);
		accelerator = 'wasm';
	}

	return ownCompiledModel({ api, model, accelerator, manifest: options.manifest });
}
