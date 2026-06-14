import { describe, expect, it } from 'vite-plus/test';
import baseManifestRaw from '../../../public/models/whisper/manifest.json?raw';
import tinyManifestRaw from '../../../public/models/whisper/manifest-tiny.json?raw';
import { AsrManifestError, manifestAssets, validateAsrManifest } from './model-manifest';

const HEX64 = 'a'.repeat(64);

function validManifest(): Record<string, unknown> {
	return {
		id: 'whisper-base',
		version: '1.0.0',
		license: 'Apache-2.0',
		source: 'https://huggingface.co/litert-community/whisper-base',
		sizeBytes: 600,
		model: { url: '/models/whisper/model.tflite', sizeBytes: 500, checksum: `sha256-${HEX64}` },
		tokenizer: { url: '/models/whisper/vocab.json', sizeBytes: 100, checksum: `sha256-${HEX64}` },
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
		defaultLanguage: null
	};
}

describe('validateAsrManifest', () => {
	it('accepts a well-formed manifest and normalises it', () => {
		const manifest = validateAsrManifest(validManifest());
		expect(manifest.id).toBe('whisper-base');
		expect(manifest.model.checksum).toBe(`sha256-${HEX64}`);
		expect(manifest.maxDecodeTokens).toBe(128);
		expect(manifest.tokens.startOfTranscript).toBe(50258);
		expect(manifest.tokens.language.en).toBe(50259);
		expect(manifestAssets(manifest).map((entry) => entry.key)).toEqual(['model', 'tokenizer']);
	});

	it('rejects a non-object', () => {
		expect(() => validateAsrManifest(null)).toThrow(AsrManifestError);
	});

	it('requires non-empty provenance fields', () => {
		for (const field of ['id', 'version', 'license', 'source']) {
			const m = validManifest();
			m[field] = '';
			expect(() => validateAsrManifest(m)).toThrow(new RegExp(field));
		}
	});

	it('rejects a malformed asset checksum and a missing asset', () => {
		const m = validManifest();
		(m.model as Record<string, unknown>).checksum = 'sha256-XYZ';
		expect(() => validateAsrManifest(m)).toThrow(/model.checksum/);

		const m2 = validManifest();
		delete m2.tokenizer;
		expect(() => validateAsrManifest(m2)).toThrow(/tokenizer must be an object/);
	});

	it('requires sizeBytes to equal the sum of asset sizes', () => {
		const m = validManifest();
		m.sizeBytes = 599;
		expect(() => validateAsrManifest(m)).toThrow(/must equal the sum of asset sizes/);
	});

	it('enforces the fixed 16 kHz mono audio contract and a positive context length', () => {
		const m = validManifest();
		(m.audio as Record<string, unknown>).sampleRate = 44100;
		expect(() => validateAsrManifest(m)).toThrow(/audio.sampleRate must be 16000/);

		const m2 = validManifest();
		m2.maxDecodeTokens = 0;
		expect(() => validateAsrManifest(m2)).toThrow(/maxDecodeTokens must be a positive number/);
	});

	it('validates the special token table', () => {
		const m = validManifest();
		delete (m.tokens as Record<string, unknown>).timestampBegin;
		expect(() => validateAsrManifest(m)).toThrow(/tokens.timestampBegin/);

		const m2 = validManifest();
		(m2.tokens as { language: Record<string, unknown> }).language.en = 'fifty';
		expect(() => validateAsrManifest(m2)).toThrow(/tokens.language.en/);
	});

	it('requires a non-empty languages list and a valid defaultLanguage', () => {
		const m = validManifest();
		m.languages = [];
		expect(() => validateAsrManifest(m)).toThrow(/languages must be a non-empty array/);

		const m2 = validManifest();
		m2.defaultLanguage = 'fr';
		expect(() => validateAsrManifest(m2)).toThrow(/defaultLanguage must be one of languages/);
	});
});

describe('shipped manifests', () => {
	// Validate the real files the app loads, so a hand-edited manifest that drops a
	// required field (e.g. tokens.noSpeech, which the recovered tiny manifest lacked)
	// or whose sizeBytes no longer sums fails CI rather than only failing at runtime.
	for (const [name, raw] of [
		['manifest.json', baseManifestRaw],
		['manifest-tiny.json', tinyManifestRaw]
	] as const) {
		it(`public/models/whisper/${name} passes validation`, () => {
			const manifest = validateAsrManifest(JSON.parse(raw));
			expect(manifest.tokens.noSpeech).toBe(50362);
			expect(manifestAssets(manifest).map((entry) => entry.key)).toEqual(['model', 'tokenizer']);
		});
	}
});
