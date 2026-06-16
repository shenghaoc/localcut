/**
 * Concrete {@link WhisperRuntime} backed by ONNX Runtime Web (ORT), for the
 * `onnx-community/whisper-*` encoder/decoder ONNX pair:
 *
 *   encoder: float32 input_features[1, nMel, melFrames]      -> float32 last_hidden_state[1, frames, dModel]
 *   decoder: int64  input_ids[1, T], float32 encoder_hidden_states[1, frames, dModel] -> float32 logits[1, T, vocab]
 *
 * The decoder is the **no-past** graph (`decoder_model.onnx`): it takes no
 * `past_key_values` inputs, so each greedy step re-runs it with the full token
 * sequence and reads the logits row of the last position. That keeps the loop
 * identical to the LiteRT runtime's and lets `whisper-decode.ts` drive both
 * engines unchanged — at the cost of recomputing self-attention each step (a 30 s
 * window is ≤ {@link AsrOrtModelManifestSnapshot.maxDecodeTokens} tokens, so the
 * quadratic cost is small). A future KV-cache runtime can use the optional
 * `decoderWithPast` asset; this one deliberately does not, to avoid complicating
 * decode and to keep the download smaller.
 *
 * Execution provider: **WASM** (CPU tensors). ASR is not frame-coupled, so the
 * hard gate that forbids CPU fallback does not apply; the per-token decoder is
 * latency-bound by graph dispatch, where a GPU EP's per-call sync overhead and
 * patchier Whisper op coverage make WASM the robust default. The renderer's
 * `GPUDevice` is not available in this classic ASR worker anyway. The runtime is
 * built only inside the ASR worker on an explicit user load — never on the main
 * thread, never at startup — and reaches `onnxruntime-web` solely through
 * `ort-loader`'s dynamic import.
 */
import type { AsrAccelerator } from '../../protocol';
import type { EncodedAudio, MelInput, WhisperRuntime } from './whisper-decode';
import type { AsrOrtIoContract, AsrOrtModelManifestSnapshot } from './ort-whisper-manifest';
import type { OrtModelManifest } from '../ml/ort/ort-types';
import { createOrtSession, type OrtSessionHandle } from '../ml/ort/ort-session';
import { loadOrtWasm, type OrtModule } from '../ml/ort/ort-loader';

/** ORT tensor instance type, derived without naming the `onnxruntime-web`
 *  specifier here (keeps the runtime off the startup module graph). */
type OrtTensor = InstanceType<OrtModule['Tensor']>;

export interface OrtWhisperRuntimeOptions {
	/** Verified encoder ONNX bytes. */
	encoderBytes: Uint8Array;
	/** Verified decoder (no-past) ONNX bytes. */
	decoderBytes: Uint8Array;
	manifest: AsrOrtModelManifestSnapshot;
}

export interface OrtWhisperRuntime extends WhisperRuntime {
	readonly accelerator: AsrAccelerator;
}

interface OrtEncodedAudio extends EncodedAudio {
	hidden: OrtTensor;
}

/** Transpose frame-major mel (nFrames × nMel) to padded mel-major [nMel × frames]. */
function toMelMajor(mel: MelInput, nMel: number, frames: number): Float32Array {
	const out = new Float32Array(nMel * frames);
	const copyFrames = Math.min(mel.nFrames, frames);
	const copyMel = Math.min(mel.nMel, nMel);
	for (let m = 0; m < copyMel; m++) {
		for (let f = 0; f < copyFrames; f++) {
			out[m * frames + f] = mel.data[f * mel.nMel + m]!;
		}
	}
	return out;
}

/** Builds the minimal single-asset ORT manifest `createOrtSession` consumes. */
function toOrtModelManifest(
	manifest: AsrOrtModelManifestSnapshot,
	asset: AsrOrtModelManifestSnapshot['encoder'],
	id: string
): OrtModelManifest {
	return {
		id,
		version: manifest.version,
		license: manifest.license,
		source: manifest.source,
		format: 'onnx',
		model: asset,
		executionProviders: manifest.executionProviders,
		// ASR is never per-video-frame; WASM/CPU tensors are permitted.
		frameCoupled: false
	};
}

class OrtWhisperRuntimeImpl implements OrtWhisperRuntime {
	readonly accelerator: AsrAccelerator;
	private readonly ort: OrtModule;
	private readonly encoder: OrtSessionHandle;
	private readonly decoder: OrtSessionHandle;
	private readonly io: AsrOrtIoContract;
	private readonly nMel: number;
	private readonly melFrames: number;
	private readonly vocabSize: number;
	private disposed = false;

	constructor(params: {
		ort: OrtModule;
		encoder: OrtSessionHandle;
		decoder: OrtSessionHandle;
		manifest: AsrOrtModelManifestSnapshot;
	}) {
		this.ort = params.ort;
		this.encoder = params.encoder;
		this.decoder = params.decoder;
		this.io = params.manifest.io;
		this.nMel = params.manifest.audio.nMel;
		this.vocabSize = params.manifest.vocabSize;
		this.melFrames = Math.round(
			(params.manifest.audio.chunkLengthS * params.manifest.audio.sampleRate) /
				params.manifest.audio.hopLength
		);
		// EP list is identical for both sessions; report the active one.
		this.accelerator = params.encoder.primaryEp;
	}

	async encode(mel: MelInput): Promise<EncodedAudio> {
		const melMajor = toMelMajor(mel, this.nMel, this.melFrames);
		const input = new this.ort.Tensor('float32', melMajor, [1, this.nMel, this.melFrames]);
		let outputs: Record<string, OrtTensor>;
		try {
			outputs = await this.encoder.session.run({ [this.io.encoderInput]: input });
		} finally {
			input.dispose();
		}
		const hidden = outputs[this.io.encoderOutput];
		if (!hidden) {
			for (const tensor of Object.values(outputs)) tensor.dispose();
			throw new Error(`ONNX encoder produced no "${this.io.encoderOutput}" output`);
		}
		// Release any auxiliary outputs; only the hidden state is reused per decode step.
		for (const [name, tensor] of Object.entries(outputs)) {
			if (name !== this.io.encoderOutput) tensor.dispose();
		}
		const encoded: OrtEncodedAudio = {
			frames: this.melFrames,
			hidden,
			dispose: () => hidden.dispose()
		};
		return encoded;
	}

	async decode(tokens: Int32Array, encoded: EncodedAudio): Promise<Float32Array> {
		const hidden = (encoded as OrtEncodedAudio).hidden;
		const ids = this.makeInputIds(tokens);
		let outputs: Record<string, OrtTensor>;
		try {
			// Fetch only logits: the no-past decoder also emits `present.*` KV tensors
			// we never read, and naming the fetch skips copying them back to JS.
			outputs = await this.decoder.session.run(
				{ [this.io.decoderInputIds]: ids, [this.io.decoderEncoderHidden]: hidden },
				[this.io.decoderLogits]
			);
		} finally {
			ids.dispose();
		}
		const logitsTensor = outputs[this.io.decoderLogits];
		if (!logitsTensor) {
			for (const tensor of Object.values(outputs)) tensor.dispose();
			throw new Error(`ONNX decoder produced no "${this.io.decoderLogits}" output`);
		}
		try {
			// logits dims are [1, T, vocab]; the next token is predicted at the last row.
			const dims = logitsTensor.dims;
			const seq = dims.length >= 2 ? dims[dims.length - 2]! : tokens.length;
			const vocab = dims.length >= 1 ? dims[dims.length - 1]! : this.vocabSize;
			const raw = logitsTensor.data as unknown;
			const flat = raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>);
			const row = Math.max(0, seq - 1);
			const start = row * vocab;
			return flat.slice(start, start + vocab);
		} finally {
			logitsTensor.dispose();
		}
	}

	private makeInputIds(tokens: Int32Array): OrtTensor {
		const dims = [1, tokens.length];
		if (this.io.inputIdsDataType === 'int64') {
			// ORT int64 tensors need BigInt64Array; widen the int32 token ids.
			const big = new BigInt64Array(tokens.length);
			for (let i = 0; i < tokens.length; i++) big[i] = BigInt(tokens[i]!);
			return new this.ort.Tensor('int64', big, dims);
		}
		// `tokens` is already a fresh Int32Array per decode step (whisper-decode.ts
		// passes `Int32Array.from(...)`), so hand it to ORT directly — no extra copy.
		return new this.ort.Tensor('int32', tokens, dims);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		// release() is async; fire-and-forget — the worker is tearing the model down.
		void this.encoder.session.release();
		void this.decoder.session.release();
	}
}

/**
 * Creates ORT sessions for the encoder and no-past decoder and returns a
 * ready-to-run {@link WhisperRuntime}. Heavy and side-effecting (loads the ORT
 * WASM runtime, compiles two graphs): call only from the ASR worker on an
 * explicit user load. If the decoder session fails to build, the encoder session
 * is released so a failed load leaks nothing.
 */
export async function createOrtWhisperRuntime(
	options: OrtWhisperRuntimeOptions
): Promise<OrtWhisperRuntime> {
	const ort = await loadOrtWasm();
	const { manifest } = options;
	const encoder = await createOrtSession({
		modelBytes: options.encoderBytes,
		manifest: toOrtModelManifest(manifest, manifest.encoder, `${manifest.id}-encoder`)
	});
	let decoder: OrtSessionHandle;
	try {
		decoder = await createOrtSession({
			modelBytes: options.decoderBytes,
			manifest: toOrtModelManifest(manifest, manifest.decoder, `${manifest.id}-decoder`)
		});
	} catch (error) {
		void encoder.session.release();
		throw error;
	}
	return new OrtWhisperRuntimeImpl({ ort, encoder, decoder, manifest });
}
