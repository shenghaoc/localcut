import { describe, expect, it } from 'vite-plus/test';
import type { AsrSpecialTokens } from '../../protocol';
import {
	buildWhisperPrompt,
	decodeTextIds,
	idsToSegments,
	parseWhisperVocab,
	timestampSeconds
} from './whisper-tokenizer';

const SPECIAL: AsrSpecialTokens = {
	startOfTranscript: 50258,
	endOfText: 50257,
	transcribe: 50359,
	noTimestamps: 50363,
	noSpeech: 50362,
	timestampBegin: 50364,
	language: { en: 50259, zh: 50260 }
};

// GPT-2 byte-level: space (byte 32) encodes to char 'Ġ' (code point 288).
const SPACE = String.fromCharCode(288);
const VOCAB_JSON = JSON.stringify({ [`${SPACE}hello`]: 1, [`${SPACE}world`]: 2 });

describe('byte-level BPE decoding', () => {
	it('reverses the GPT-2 byte mapping to recover text', () => {
		const idToToken = parseWhisperVocab(VOCAB_JSON);
		expect(idToToken[1]).toBe(`${SPACE}hello`);
		expect(decodeTextIds(idToToken, [1, 2])).toBe(' hello world');
	});

	it('decodes multibyte UTF-8 by reassembling raw bytes', () => {
		// "é" is UTF-8 0xC3 0xA9; byte 0xC3=195 -> 'Ã' (printable), 0xA9=169 -> 'Â©'? handle via map.
		const eAcute = String.fromCharCode(195) + String.fromCharCode(169);
		const idToToken = parseWhisperVocab(JSON.stringify({ [eAcute]: 5 }));
		expect(decodeTextIds(idToToken, [5])).toBe('é');
	});
});

describe('buildWhisperPrompt', () => {
	it('forces only start-of-transcript when auto-detecting', () => {
		expect(buildWhisperPrompt(SPECIAL)).toEqual([50258]);
	});

	it('forces language + transcribe when a language is chosen', () => {
		expect(buildWhisperPrompt(SPECIAL, 'en')).toEqual([50258, 50259, 50359]);
		expect(buildWhisperPrompt(SPECIAL, 'fr')).toEqual([50258]); // unknown language ignored
	});
});

describe('timestampSeconds', () => {
	it('maps timestamp token ids to seconds and rejects non-timestamps', () => {
		expect(timestampSeconds(50364, SPECIAL)).toBe(0);
		expect(timestampSeconds(50414, SPECIAL)).toBeCloseTo(1, 5);
		expect(timestampSeconds(2, SPECIAL)).toBeNull();
	});
});

describe('idsToSegments', () => {
	const idToToken = parseWhisperVocab(VOCAB_JSON);

	it('builds timestamped segments and skips special tokens', () => {
		// <|en|> <|transcribe|> <|0.00|> hello world <|1.00|>
		const segments = idsToSegments([50259, 50359, 50364, 1, 2, 50414], idToToken, SPECIAL, 2, 30);
		expect(segments).toHaveLength(1);
		expect(segments[0].text).toBe('hello world');
		expect(segments[0].start).toBeCloseTo(2, 5);
		expect(segments[0].duration).toBeCloseTo(1, 5);
	});

	it('makes one window-spanning segment when no timestamps are emitted', () => {
		const segments = idsToSegments([1, 2], idToToken, SPECIAL, 0, 30);
		expect(segments).toHaveLength(1);
		expect(segments[0].text).toBe('hello world');
		expect(segments[0].duration).toBeCloseTo(30, 5);
	});

	it('clamps timestamp tokens that overshoot the extracted window', () => {
		// <|0.00|> hello world <|31.00|> with a 30 s extracted window.
		const segments = idsToSegments([50364, 1, 2, 51914], idToToken, SPECIAL, 2, 30);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			text: 'hello world',
			start: 2,
			duration: 30
		});
	});

	it('returns nothing for an all-special / empty sequence', () => {
		expect(idsToSegments([50258, 50259], idToToken, SPECIAL, 0, 30)).toEqual([]);
	});
});
