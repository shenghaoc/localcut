import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Shared fakes for the mocked ORT foundation. `vi.hoisted` makes them available to
// the (hoisted) `vi.mock` factories below without importing onnxruntime-web.
const h = vi.hoisted(() => {
	class FakeTensor {
		disposed = false;
		constructor(
			readonly type: string,
			readonly data: unknown,
			readonly dims: readonly number[]
		) {}
		dispose() {
			this.disposed = true;
		}
	}
	interface RunCall {
		feeds: Record<string, FakeTensor>;
		fetches?: readonly string[];
	}
	return {
		FakeTensor,
		runCalls: [] as RunCall[],
		sessions: [] as Array<{ released: boolean }>,
		createSessionArgs: [] as Array<{ manifest: { frameCoupled: boolean; model: { url: string } } }>
	};
});

vi.mock('../ml/ort/ort-loader', () => ({
	loadOrtWasm: vi.fn(async () => ({ Tensor: h.FakeTensor })),
	ortWasmBasePath: () => '/_ort/'
}));

vi.mock('../ml/ort/ort-session', () => ({
	createOrtSession: vi.fn(
		async (opts: { manifest: { frameCoupled: boolean; model: { url: string } } }) => {
			h.createSessionArgs.push(opts);
			const released = { released: false };
			h.sessions.push(released);
			const session = {
				async run(
					feeds: Record<string, InstanceType<typeof h.FakeTensor>>,
					fetches?: readonly string[]
				) {
					h.runCalls.push({ feeds, fetches });
					if ('input_features' in feeds) {
						return {
							last_hidden_state: new h.FakeTensor(
								'float32',
								new Float32Array([5, 6, 7, 8]),
								[1, 2, 2]
							)
						};
					}
					const ids = feeds['input_ids']!;
					const T = ids.dims[1]!;
					const vocab = 4;
					const data = new Float32Array(T * vocab);
					// Row r filled with [r*10, r*10+1, r*10+2, r*10+3] so the last row is recognisable.
					for (let r = 0; r < T; r++) {
						for (let c = 0; c < vocab; c++) data[r * vocab + c] = r * 10 + c;
					}
					return { logits: new h.FakeTensor('float32', data, [1, T, vocab]) };
				},
				async release() {
					released.released = true;
				}
			};
			return { session, primaryEp: 'wasm', executionProviders: ['wasm'], tensorLocation: 'cpu' };
		}
	)
}));

import { createOrtWhisperRuntime } from './whisper-ort-runtime';
import type { AsrOrtModelManifestSnapshot } from './ort-whisper-manifest';
import type { MelInput } from './whisper-decode';
import runtimeSource from './whisper-ort-runtime.ts?raw';
import workerSource from './asr-worker.ts?raw';
import manifestSource from './ort-whisper-manifest.ts?raw';

const SHA = `sha256-${'0'.repeat(64)}`;

function manifest(): AsrOrtModelManifestSnapshot {
	return {
		id: 'm',
		version: '1',
		license: 'l',
		source: 'https://huggingface.co/x',
		runtime: 'ort-whisper',
		format: 'onnx',
		provider: null,
		infoUrl: null,
		executionProviders: ['wasm'],
		sizeBytes: 3,
		encoder: { url: '/_model/hf/x/enc.onnx', sizeBytes: 1, checksum: SHA },
		decoder: { url: '/_model/hf/x/dec.onnx', sizeBytes: 1, checksum: SHA },
		decoderWithPast: null,
		tokenizer: { url: '/_model/hf/x/vocab.json', sizeBytes: 1, checksum: SHA },
		io: {
			encoderInput: 'input_features',
			encoderOutput: 'last_hidden_state',
			decoderInputIds: 'input_ids',
			decoderEncoderHidden: 'encoder_hidden_states',
			decoderLogits: 'logits',
			inputIdsDataType: 'int64'
		},
		// melFrames = round(0.02 * 16000 / 160) = 2
		audio: { sampleRate: 16000, channels: 1, hopLength: 160, nMel: 2, chunkLengthS: 0.02 },
		maxDecodeTokens: 8,
		vocabSize: 4,
		encoderFramesPerSecond: 50,
		tokens: {
			startOfTranscript: 50258,
			endOfText: 50257,
			transcribe: 50359,
			noTimestamps: 50363,
			noSpeech: 50362,
			timestampBegin: 50364,
			language: { en: 50259, zh: 50260 }
		},
		languages: ['en', 'zh'],
		defaultLanguage: null,
		decode: null
	};
}

const bytes = () => new Uint8Array([1]);

beforeEach(() => {
	h.runCalls.length = 0;
	h.sessions.length = 0;
	h.createSessionArgs.length = 0;
});

describe('createOrtWhisperRuntime', () => {
	it('builds non-frame-coupled encoder + decoder sessions and reports the EP', async () => {
		const rt = await createOrtWhisperRuntime({
			encoderBytes: bytes(),
			decoderBytes: bytes(),
			manifest: manifest()
		});
		expect(rt.accelerator).toBe('wasm');
		expect(h.createSessionArgs).toHaveLength(2);
		expect(h.createSessionArgs[0]!.manifest.frameCoupled).toBe(false);
		expect(h.createSessionArgs[0]!.manifest.model.url).toContain('enc.onnx');
		expect(h.createSessionArgs[1]!.manifest.model.url).toContain('dec.onnx');
		rt.dispose();
	});

	it('encode transposes mel to mel-major [1, nMel, melFrames] and disposes the input', async () => {
		const rt = await createOrtWhisperRuntime({
			encoderBytes: bytes(),
			decoderBytes: bytes(),
			manifest: manifest()
		});
		// frame-major (2 frames × 2 mel): f0=[1,2], f1=[3,4]
		const mel: MelInput = { data: new Float32Array([1, 2, 3, 4]), nMel: 2, nFrames: 2 };
		const encoded = await rt.encode(mel);
		expect(encoded.frames).toBe(2);

		const inputFeatures = h.runCalls[0]!.feeds['input_features']!;
		expect(inputFeatures.dims).toEqual([1, 2, 2]);
		// mel-major: m0=[f0,f1]=[1,3], m1=[2,4] → [1,3,2,4]
		expect(Array.from(inputFeatures.data as Float32Array)).toEqual([1, 3, 2, 4]);
		// The transient input tensor is released; the hidden state is retained for decode.
		expect(inputFeatures.disposed).toBe(true);
		const hidden = (encoded as unknown as { hidden: InstanceType<typeof h.FakeTensor> }).hidden;
		expect(hidden.disposed).toBe(false);

		encoded.dispose();
		expect(hidden.disposed).toBe(true);
		rt.dispose();
	});

	it('decode builds int64 input_ids, feeds the hidden state, fetches only logits, returns the last row', async () => {
		const rt = await createOrtWhisperRuntime({
			encoderBytes: bytes(),
			decoderBytes: bytes(),
			manifest: manifest()
		});
		const encoded = await rt.encode({ data: new Float32Array([1, 2, 3, 4]), nMel: 2, nFrames: 2 });
		const hidden = (encoded as unknown as { hidden: InstanceType<typeof h.FakeTensor> }).hidden;

		const logits = await rt.decode(Int32Array.from([50258, 50259, 7]), encoded);

		const dec = h.runCalls[1]!;
		const ids = dec.feeds['input_ids']!;
		expect(ids.type).toBe('int64');
		expect(ids.dims).toEqual([1, 3]);
		expect(Array.from(ids.data as BigInt64Array)).toEqual([50258n, 50259n, 7n]);
		// The retained encoder output is reused as the cross-attention input.
		expect(dec.feeds['encoder_hidden_states']).toBe(hidden);
		// Only logits are fetched — the no-past decoder also emits present.* KV tensors.
		expect(dec.fetches).toEqual(['logits']);
		// logits[r][c] = r*10+c; T=3 ⇒ last row (r=2) is [20,21,22,23].
		expect(Array.from(logits)).toEqual([20, 21, 22, 23]);
		// The transient input_ids tensor is released after the run.
		expect(ids.disposed).toBe(true);

		encoded.dispose();
		rt.dispose();
	});

	it('dispose releases both sessions and is idempotent', async () => {
		const rt = await createOrtWhisperRuntime({
			encoderBytes: bytes(),
			decoderBytes: bytes(),
			manifest: manifest()
		});
		expect(h.sessions).toHaveLength(2);
		rt.dispose();
		expect(h.sessions[0]!.released).toBe(true);
		expect(h.sessions[1]!.released).toBe(true);
		expect(() => rt.dispose()).not.toThrow();
	});
});

// The ORT ASR path must never pull the multi-MB onnxruntime-web runtime into the
// startup module graph: it reaches it only through `ort-loader`'s dynamic import.
describe('ORT ASR stays off the startup module graph', () => {
	const STATIC_ORT = /^import\s+(?!type\b)[^;]*from\s+['"]onnxruntime-web/m;
	const ANY_ORT = /(?:from\s+['"]onnxruntime-web|import\(\s*['"]onnxruntime-web)/;

	it('the ORT Whisper runtime reaches onnxruntime-web only via the lazy ort-loader', () => {
		expect(runtimeSource).not.toMatch(STATIC_ORT);
		expect(runtimeSource).not.toMatch(ANY_ORT);
		expect(runtimeSource).toContain("from '../ml/ort/ort-loader'");
	});

	it('the ASR worker and ONNX manifest module never import onnxruntime-web', () => {
		expect(workerSource).not.toMatch(ANY_ORT);
		expect(manifestSource).not.toMatch(ANY_ORT);
	});
});
