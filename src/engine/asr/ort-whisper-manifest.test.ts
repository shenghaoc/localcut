import { describe, expect, it } from 'vite-plus/test';
import baseManifestRaw from '../../../public/models/whisper-onnx/manifest.json?raw';
import tinyManifestRaw from '../../../public/models/whisper-onnx/manifest-tiny.json?raw';
import { AsrManifestError } from './model-manifest';
import {
	isOrtWhisperManifestDocument,
	ortWhisperManifestAssets,
	validateOrtWhisperManifest
} from './ort-whisper-manifest';
import { AssetIntegrityError, loadVerifiedAsset, sha256Hex, type AssetStore } from './asset-cache';
import type { ModelAssetSnapshot } from '../ml/asset-types';

const SHA = `sha256-${'a'.repeat(64)}`;

function validManifest(): Record<string, unknown> {
	return {
		id: 'whisper-base-onnx-int8',
		version: 'onnx-community-int8-2024',
		runtime: 'ort-whisper',
		format: 'onnx',
		license: 'Apache-2.0 / MIT',
		source: 'https://huggingface.co/onnx-community/whisper-base',
		provider: 'OpenAI · onnx-community',
		infoUrl: 'https://huggingface.co/onnx-community/whisper-base',
		executionProviders: ['wasm'],
		sizeBytes: 60,
		encoder: { url: '/_model/hf/o/enc.onnx', sizeBytes: 20, checksum: SHA },
		decoder: { url: '/_model/hf/o/dec.onnx', sizeBytes: 30, checksum: SHA },
		tokenizer: {
			url: '/_model/hf/openai/whisper-base/resolve/main/vocab.json',
			sizeBytes: 10,
			checksum: SHA
		},
		io: {
			encoderInput: 'input_features',
			encoderOutput: 'last_hidden_state',
			decoderInputIds: 'input_ids',
			decoderEncoderHidden: 'encoder_hidden_states',
			decoderLogits: 'logits',
			inputIdsDataType: 'int64'
		},
		audio: { sampleRate: 16000, channels: 1, hopLength: 160, nMel: 80, chunkLengthS: 30 },
		maxDecodeTokens: 128,
		vocabSize: 51865,
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
		decode: {
			logProbThreshold: -1.0,
			noSpeechThreshold: 0.6,
			compressionRatioThreshold: 2.4,
			temperatures: [0.0, 0.2]
		}
	};
}

describe('isOrtWhisperManifestDocument', () => {
	it('routes only manifests tagged runtime="ort-whisper" to the ORT path', () => {
		expect(isOrtWhisperManifestDocument(validManifest())).toBe(true);
		expect(isOrtWhisperManifestDocument({ runtime: 'legacy-whisper' })).toBe(false);
		// A manifest without the ORT runtime field is not claimed by the ORT path.
		expect(isOrtWhisperManifestDocument({ id: 'x', model: {} })).toBe(false);
		expect(isOrtWhisperManifestDocument(null)).toBe(false);
		expect(isOrtWhisperManifestDocument('ort-whisper')).toBe(false);
	});
});

describe('validateOrtWhisperManifest', () => {
	it('accepts a well-formed manifest and round-trips its fields', () => {
		const m = validateOrtWhisperManifest(validManifest());
		expect(m.runtime).toBe('ort-whisper');
		expect(m.format).toBe('onnx');
		expect(m.executionProviders).toEqual(['wasm']);
		expect(m.encoder.checksum).toBe(SHA);
		expect(m.decoder.sizeBytes).toBe(30);
		expect(m.decoderWithPast).toBeNull();
		expect(m.io.inputIdsDataType).toBe('int64');
		expect(m.io.encoderInput).toBe('input_features');
		expect(m.audio.nMel).toBe(80);
		expect(m.maxDecodeTokens).toBe(128);
		expect(m.tokens.language).toEqual({ en: 50259, zh: 50260 });
	});

	it('rejects non-objects and a missing/incorrect runtime or format', () => {
		expect(() => validateOrtWhisperManifest(null)).toThrow(AsrManifestError);
		expect(() =>
			validateOrtWhisperManifest({ ...validManifest(), runtime: 'legacy-whisper' })
		).toThrow(/runtime must be "ort-whisper"/);
		expect(() => validateOrtWhisperManifest({ ...validManifest(), format: 'json' })).toThrow(
			/format must be "onnx"/
		);
	});

	it('requires non-empty provenance strings', () => {
		for (const field of ['id', 'version', 'license', 'source'] as const) {
			const m = validManifest();
			m[field] = '';
			expect(() => validateOrtWhisperManifest(m)).toThrow(new RegExp(field));
		}
	});

	it('validates each ONNX/tokenizer asset (object, url, size, sha256 checksum)', () => {
		const missing = validManifest();
		delete missing['encoder'];
		expect(() => validateOrtWhisperManifest(missing)).toThrow(/encoder must be an object/);

		const badChecksum = validManifest();
		(badChecksum['decoder'] as Record<string, unknown>).checksum = 'md5-nope';
		expect(() => validateOrtWhisperManifest(badChecksum)).toThrow(/decoder.checksum/);

		const badSize = validManifest();
		(badSize['tokenizer'] as Record<string, unknown>).sizeBytes = 0;
		expect(() => validateOrtWhisperManifest(badSize)).toThrow(/tokenizer.sizeBytes/);
	});

	it('requires sizeBytes to equal the sum of downloaded assets', () => {
		const m = validManifest();
		m['sizeBytes'] = 59; // 20 + 30 + 10 = 60
		expect(() => validateOrtWhisperManifest(m)).toThrow(/must equal the sum/);
	});

	it('counts an optional decoderWithPast asset toward the size sum', () => {
		const m = validManifest();
		m['decoderWithPast'] = { url: '/_model/hf/o/dec_past.onnx', sizeBytes: 5, checksum: SHA };
		// 20 + 30 + 10 + 5 = 65
		expect(() => validateOrtWhisperManifest(m)).toThrow(/must equal the sum/);
		m['sizeBytes'] = 65;
		const parsed = validateOrtWhisperManifest(m);
		expect(parsed.decoderWithPast?.sizeBytes).toBe(5);
	});

	it('validates the execution-provider list', () => {
		const empty = validManifest();
		empty['executionProviders'] = [];
		expect(() => validateOrtWhisperManifest(empty)).toThrow(
			/executionProviders must be a non-empty/
		);

		const bad = validManifest();
		bad['executionProviders'] = ['cuda'];
		expect(() => validateOrtWhisperManifest(bad)).toThrow(/executionProviders\[0\]/);

		// A GPU EP is allowed for ASR (not frame-coupled), so this passes the policy.
		const webgpu = validManifest();
		webgpu['executionProviders'] = ['webgpu', 'wasm'];
		expect(validateOrtWhisperManifest(webgpu).executionProviders).toEqual(['webgpu', 'wasm']);
	});

	it('validates the IO contract names and input_ids dtype', () => {
		const m = validManifest();
		(m['io'] as Record<string, unknown>).decoderLogits = '';
		expect(() => validateOrtWhisperManifest(m)).toThrow(/io.decoderLogits/);

		const dtype = validManifest();
		(dtype['io'] as Record<string, unknown>).inputIdsDataType = 'float32';
		expect(() => validateOrtWhisperManifest(dtype)).toThrow(/io.inputIdsDataType/);
	});

	it('validates the audio contract (16 kHz mono)', () => {
		const m = validManifest();
		(m['audio'] as Record<string, unknown>).sampleRate = 44100;
		expect(() => validateOrtWhisperManifest(m)).toThrow(/audio.sampleRate must be 16000/);
	});

	describe('language token handling (en/zh)', () => {
		it('keeps the en/zh language token ids', () => {
			const m = validateOrtWhisperManifest(validManifest());
			expect(m.tokens.language.en).toBe(50259);
			expect(m.tokens.language.zh).toBe(50260);
			expect(m.languages).toEqual(['en', 'zh']);
		});

		it('rejects a non-integer language token id', () => {
			const m = validManifest();
			(m['tokens'] as { language: Record<string, unknown> }).language = { en: 50259, zh: 'x' };
			expect(() => validateOrtWhisperManifest(m)).toThrow(/tokens.language.zh/);
		});

		it('rejects a required special-token id that is missing', () => {
			const m = validManifest();
			delete (m['tokens'] as Record<string, unknown>).noSpeech;
			expect(() => validateOrtWhisperManifest(m)).toThrow(/tokens.noSpeech/);
		});

		it('rejects a defaultLanguage that is not in the language list', () => {
			const m = validManifest();
			m['defaultLanguage'] = 'fr';
			expect(() => validateOrtWhisperManifest(m)).toThrow(
				/defaultLanguage must be one of languages/
			);
		});

		it('accepts a defaultLanguage that is in the language list', () => {
			const m = validManifest();
			m['defaultLanguage'] = 'zh';
			expect(validateOrtWhisperManifest(m).defaultLanguage).toBe('zh');
		});
	});

	it('validates decode params through the shared validator', () => {
		const m = validManifest();
		(m['decode'] as Record<string, unknown>).temperatures = [0.2, 0.4]; // must start with 0
		expect(() => validateOrtWhisperManifest(m)).toThrow(/temperatures must start with 0/);
	});
});

describe('ortWhisperManifestAssets', () => {
	it('lists encoder, decoder, tokenizer in download order — never decoderWithPast', () => {
		const m = validManifest();
		m['decoderWithPast'] = { url: '/_model/hf/o/dec_past.onnx', sizeBytes: 5, checksum: SHA };
		m['sizeBytes'] = 65;
		const assets = ortWhisperManifestAssets(validateOrtWhisperManifest(m));
		expect(assets.map((a) => a.key)).toEqual(['encoder', 'decoder', 'tokenizer']);
	});
});

// Validate the real files the app loads — a hand-edited manifest that drops a
// required field or whose sizeBytes no longer sums fails CI, not just at runtime.
for (const [name, raw] of [
	['manifest.json', baseManifestRaw],
	['manifest-tiny.json', tinyManifestRaw]
] as const) {
	it(`public/models/whisper-onnx/${name} passes validation`, () => {
		const m = validateOrtWhisperManifest(JSON.parse(raw));
		expect(m.runtime).toBe('ort-whisper');
		expect(m.tokens.language).toMatchObject({ en: 50259, zh: 50260 });
		expect(m.tokens.noSpeech).toBe(50362);
		expect(m.io.inputIdsDataType).toBe('int64');
		expect(ortWhisperManifestAssets(m).map((a) => a.key)).toEqual([
			'encoder',
			'decoder',
			'tokenizer'
		]);
		// sizeBytes is authoritative for the download budget — must sum the assets.
		expect(m.sizeBytes).toBe(m.encoder.sizeBytes + m.decoder.sizeBytes + m.tokenizer.sizeBytes);
	});
}

// Corrupt cached ONNX assets must be dropped and re-fetched, never served silently.
describe('ONNX asset cache integrity (corruption behavior)', () => {
	function memStore(initial: Record<string, Uint8Array> = {}): AssetStore & { puts: string[] } {
		const map = new Map(Object.entries(initial));
		const puts: string[] = [];
		return {
			puts,
			async get(key) {
				return map.get(key) ?? null;
			},
			async put(key, bytes) {
				puts.push(key);
				map.set(key, bytes);
			}
		};
	}

	it('drops a corrupt cached encoder and re-downloads the verified bytes', async () => {
		const good = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const checksum = await sha256Hex(good);
		const asset: ModelAssetSnapshot = {
			url: '/_model/hf/onnx-community/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx',
			sizeBytes: good.byteLength,
			checksum
		};
		// Cache holds bytes that do NOT match the digest (e.g. a truncated/tampered file).
		const store = memStore({ [checksum]: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) });
		const fetchImpl = async () =>
			new Response(good, { status: 200, headers: { 'content-length': String(good.byteLength) } });

		const bytes = await loadVerifiedAsset(asset, { store, fetch: fetchImpl });
		expect(Array.from(bytes)).toEqual(Array.from(good));
		// Re-verified copy was written back to the cache.
		expect(store.puts).toContain(checksum);
	});

	it('throws AssetIntegrityError when the downloaded bytes do not match the digest', async () => {
		const asset: ModelAssetSnapshot = {
			url: '/_model/hf/onnx-community/whisper-base/resolve/main/onnx/decoder_model_quantized.onnx',
			sizeBytes: 4,
			checksum: `sha256-${'b'.repeat(64)}`
		};
		const wrong = new Uint8Array([1, 2, 3, 4]);
		const store = memStore();
		const fetchImpl = async () =>
			new Response(wrong, { status: 200, headers: { 'content-length': '4' } });

		await expect(loadVerifiedAsset(asset, { store, fetch: fetchImpl })).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
		// A failed-integrity download is never cached.
		expect(store.puts).toHaveLength(0);
	});
});
