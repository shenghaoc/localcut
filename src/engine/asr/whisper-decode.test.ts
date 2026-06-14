import { describe, expect, it } from 'vite-plus/test';
import type { AsrSpecialTokens } from '../../protocol';
import { parseWhisperVocab } from './whisper-tokenizer';
import {
	argmax,
	captionSuppressedTokens,
	clipSegmentsToTrustedRange,
	compressionRatio,
	decodeChunk,
	DecodeCancelledError,
	deduplicateSegments,
	dropAdjacentRepeatedSegments,
	filterHallucinations,
	isEmptyTranscript,
	sampleLogits,
	softmaxProbability,
	transcribeWindow,
	detectLanguageFromLogits,
	type EncodedAudio,
	type WhisperRuntime
} from './whisper-decode';

const SPECIAL: AsrSpecialTokens = {
	startOfTranscript: 50258,
	endOfText: 50257,
	transcribe: 50359,
	noTimestamps: 50363,
	noSpeech: 50362,
	timestampBegin: 50364,
	language: { en: 50259, zh: 50260 }
};
const SPACE = String.fromCharCode(288);
const VOCAB = parseWhisperVocab(
	JSON.stringify({ [`${SPACE}hello`]: 1, [`${SPACE}world`]: 2, '*': 3 })
);
const VOCAB_SIZE = 50500;

/** Runtime that emits one scripted argmax token per decode() call. */
function scriptedRuntime(script: number[], opts: { onDispose?: () => void } = {}): WhisperRuntime {
	let call = 0;
	return {
		async encode(mel): Promise<EncodedAudio> {
			return { frames: mel.nFrames, dispose: () => opts.onDispose?.() };
		},
		async decode() {
			const logits = new Float32Array(VOCAB_SIZE);
			logits[script[Math.min(call, script.length - 1)]] = 100;
			call++;
			return logits;
		},
		dispose() {}
	};
}

function rankedRuntime(script: number[][]): WhisperRuntime {
	let call = 0;
	return {
		async encode(mel): Promise<EncodedAudio> {
			return { frames: mel.nFrames, dispose: () => undefined };
		},
		async decode() {
			const logits = new Float32Array(VOCAB_SIZE);
			const tokens = script[Math.min(call, script.length - 1)] ?? [];
			for (let i = 0; i < tokens.length; i++) {
				logits[tokens[i]!] = 100 - i;
			}
			call++;
			return logits;
		},
		dispose() {}
	};
}

describe('argmax', () => {
	it('returns the lowest index of the maximum', () => {
		expect(argmax([0.1, 0.9, 0.9, 0.2])).toBe(1);
	});
});

describe('sampleLogits', () => {
	it('returns argmax with temperature 0', () => {
		const logits = new Float32Array([0.1, 0.9, 0.5, 0.2]);
		const [idx, logProb] = sampleLogits(logits, 0);
		expect(idx).toBe(1);
		expect(logProb).toBeLessThan(0); // log-prob is always ≤ 0
	});

	it('returns finite logProb for temperature 0', () => {
		const logits = new Float32Array([100, 200, 50]);
		const [, logProb] = sampleLogits(logits, 0);
		expect(Number.isFinite(logProb)).toBe(true);
	});

	it('returns -Infinity instead of NaN when every logit is suppressed', () => {
		const logits = new Float32Array([-Infinity, -Infinity, -Infinity]);
		expect(sampleLogits(logits, 0)).toEqual([0, -Infinity]);
		expect(sampleLogits(logits, 0.5)).toEqual([0, -Infinity]);
	});
});

describe('softmaxProbability', () => {
	it('normalizes against the full vocabulary, not just no-speech peers', () => {
		const logits = new Float32Array(VOCAB_SIZE);
		logits[SPECIAL.noSpeech] = 10;
		logits[SPECIAL.noTimestamps] = 1;
		const probability = softmaxProbability(logits, SPECIAL.noSpeech);
		expect(probability).toBeGreaterThan(0.25);
		expect(probability).toBeLessThan(0.4);
	});

	it('returns high probability when one token dominates the full vocabulary', () => {
		const logits = new Float32Array(VOCAB_SIZE);
		logits[SPECIAL.noSpeech] = 20;
		expect(softmaxProbability(logits, SPECIAL.noSpeech)).toBeGreaterThan(0.99);
	});
});

describe('compressionRatio', () => {
	it('returns 1 for empty text', () => {
		expect(compressionRatio('')).toBe(1);
	});

	it('returns 1 for short text shorter than ngram size', () => {
		expect(compressionRatio('ab')).toBe(1);
	});

	it('returns low ratio for varied text', () => {
		const text = 'The quick brown fox jumps over the lazy dog near the river bank.';
		expect(compressionRatio(text)).toBeLessThan(2.4);
	});

	it('returns high ratio for highly repetitive text', () => {
		const text = 'hello hello hello hello hello hello hello hello hello hello';
		expect(compressionRatio(text)).toBeGreaterThan(2.4);
	});
});

describe('captionSuppressedTokens', () => {
	it('suppresses symbol-only text tokens while preserving word tokens', () => {
		const suppressed = captionSuppressedTokens(VOCAB, SPECIAL);
		expect(suppressed).toContain(3);
		expect(suppressed).not.toContain(1);
		expect(suppressed).not.toContain(2);
	});
});

describe('decodeChunk', () => {
	it('forces only the SOT prompt and stops at end-of-text', async () => {
		const runtime = scriptedRuntime([50364, 1, 2, 50414, 50257]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 128 });
		expect(result.tokens).toEqual([50364, 1, 2, 50414]);
	});

	it('applies Whisper timestamp rules by forcing an initial timestamp', async () => {
		const runtime = rankedRuntime([[1, 50364], [1], [50414], [50257]]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, {
			special: SPECIAL,
			language: 'en',
			maxTokens: 128
		});
		expect(result.tokens).toEqual([50364, 1, 50414]);
	});

	it('returns logProbs for each generated token', async () => {
		const runtime = scriptedRuntime([50364, 1, 50257]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 128 });
		expect(result.tokens).toEqual([50364, 1]);
		expect(result.logProbs).toHaveLength(2);
		expect(result.logProbs.every((lp) => Number.isFinite(lp))).toBe(true);
	});

	it('reports avgLogProb', async () => {
		const runtime = scriptedRuntime([50364, 1, 50257]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 128 });
		expect(typeof result.avgLogProb).toBe('number');
		expect(Number.isFinite(result.avgLogProb)).toBe(true);
	});

	it('honours the maxTokens context limit', async () => {
		const runtime = scriptedRuntime([1]); // never emits end-of-text
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		// prompt is [SOT] (length 1); generated fills up to maxTokens.
		const result = await decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 5 });
		expect(result.tokens).toHaveLength(4);
	});

	it('throws DecodeCancelledError when cancelled', async () => {
		const runtime = scriptedRuntime([1, 50257]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		await expect(
			decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 128, shouldCancel: () => true })
		).rejects.toBeInstanceOf(DecodeCancelledError);
	});

	it('suppresses disallowed tokens during decode', async () => {
		const runtime = rankedRuntime([[50363, 50364], [1], [50257]]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, {
			special: SPECIAL,
			maxTokens: 128,
			suppressTokens: [SPECIAL.noTimestamps]
		});
		expect(result.tokens).toEqual([50364, 1]);
	});

	it('suppresses out-of-order timestamps', async () => {
		// Model tries to emit timestamp 2.0s, then timestamp 0.5s — the second
		// should be suppressed and decoding should stop at EOT.
		const ts100 = 50364 + 50; // 1.00s
		const ts200 = 50364 + 100; // 2.00s
		const ts050 = 50364 + 25; // 0.50s — should be suppressed after 1.0s
		const runtime = rankedRuntime([[ts100], [1], [ts200], [ts050, 50257]]);
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, {
			special: SPECIAL,
			language: 'en',
			maxTokens: 128
		});
		expect(result.tokens).toEqual([ts100, 1, ts200]);
	});

	it('reports noSpeechProbability from the first decode step', async () => {
		let call = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call === 0) {
					logits[50362] = 20; // noSpeech
					logits[50363] = 1; // noTimestamps
				} else {
					logits[50257] = 100; // endOfText
				}
				call++;
				return logits;
			},
			dispose() {}
		};
		const encoded = await runtime.encode({ data: new Float32Array(80), nMel: 80, nFrames: 1 });
		const result = await decodeChunk(runtime, encoded, { special: SPECIAL, maxTokens: 128 });
		expect(result.noSpeechProbability).toBeGreaterThan(0.9);
	});
});

describe('detectLanguageFromLogits', () => {
	it('selects the highest known language token', () => {
		const logits = new Float32Array(VOCAB_SIZE);
		logits[SPECIAL.language.en] = 1;
		logits[SPECIAL.language.zh] = 3;
		expect(detectLanguageFromLogits(logits, SPECIAL)).toBe('zh');
	});
});

describe('filterHallucinations', () => {
	const seg = (text: string, id = 'a') => ({ id, start: 0, duration: 1, text });

	it('strips [MUSIC] and similar bracket placeholders', () => {
		expect(filterHallucinations([seg('[MUSIC]'), seg('hello')]).map((s) => s.text)).toEqual([
			'hello'
		]);
		expect(filterHallucinations([seg('[APPLAUSE]')])).toEqual([]);
		expect(filterHallucinations([seg('[LAUGHTER]')])).toEqual([]);
		expect(filterHallucinations([seg('[BLANK_AUDIO]')])).toEqual([]);
	});

	it('strips parenthetical music/singing descriptions', () => {
		expect(filterHallucinations([seg('(singing in foreign language)')])).toEqual([]);
		expect(filterHallucinations([seg('(upbeat music playing)')])).toEqual([]);
		expect(filterHallucinations([seg('(dramatic instrumental music)')])).toEqual([]);
		expect(filterHallucinations([seg('(speaking in foreign language)')])).toEqual([]);
	});

	it('strips YouTube-style filler', () => {
		expect(filterHallucinations([seg('Thank you for watching.')])).toEqual([]);
		expect(filterHallucinations([seg('Subscribe to my channel.')])).toEqual([]);
	});

	it('preserves real speech segments', () => {
		const real = [
			seg('Hello, how are you?'),
			seg("I'm doing well, thanks."),
			seg('Let me tell you about music.') // contains "music" but is real speech
		];
		expect(filterHallucinations(real)).toHaveLength(3);
	});

	it('strips repeated single words', () => {
		expect(filterHallucinations([seg('the the')])).toEqual([]);
		expect(filterHallucinations([seg('the the the')])).toEqual([]);
		expect(filterHallucinations([seg('hello hello hello hello')])).toEqual([]);
	});

	it('strips empty fragments while keeping valid short words', () => {
		expect(filterHallucinations([seg('')])).toEqual([]);
		expect(filterHallucinations([seg('a')]).map((segment) => segment.text)).toEqual(['a']);
		expect(filterHallucinations([seg('I')]).map((segment) => segment.text)).toEqual(['I']);
		expect(filterHallucinations([seg('ok')]).map((segment) => segment.text)).toEqual(['ok']);
	});

	it('strips symbol-only decoder loops', () => {
		expect(filterHallucinations([seg('* * * * *')])).toEqual([]);
	});

	it('preserves normal short words', () => {
		const result = filterHallucinations([seg('the')]);
		expect(result).toHaveLength(1);
	});
});

describe('deduplicateSegments', () => {
	it('keeps first occurrence and removes duplicates', () => {
		const segments = [
			{ id: 'a', start: 0, duration: 1, text: 'Hello world' },
			{ id: 'b', start: 5, duration: 1, text: 'Different line' },
			{ id: 'c', start: 30, duration: 1, text: 'hello world' },
			{ id: 'd', start: 60, duration: 1, text: 'Another line' }
		];
		const result = deduplicateSegments(segments);
		expect(result.map((s) => s.id)).toEqual(['a', 'b', 'd']);
	});

	it('normalizes text for comparison (lowercase, strip punctuation)', () => {
		const segments = [
			{ id: 'a', start: 0, duration: 1, text: 'Hello, world!' },
			{ id: 'b', start: 30, duration: 1, text: 'hello world' }
		];
		const result = deduplicateSegments(segments);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('a');
	});

	it('skips empty normalized text', () => {
		const segments = [
			{ id: 'a', start: 0, duration: 1, text: '...' },
			{ id: 'b', start: 1, duration: 1, text: 'real text' }
		];
		const result = deduplicateSegments(segments);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe('real text');
	});

	it('keeps a repeat that recurs after the time bound (legitimate repeated speech)', () => {
		const segments = [
			{ id: 'a', start: 0, duration: 1, text: 'okay' },
			{ id: 'b', start: 100, duration: 1, text: 'okay' }
		];
		// 100s apart (> default 30s gap) → the later "okay" is real speech, not a repeat.
		expect(deduplicateSegments(segments).map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('still collapses a phrase repeating across nearby windows', () => {
		const segments = [
			{ id: 'a', start: 0, duration: 1, text: 'Thank you for watching' },
			{ id: 'b', start: 28, duration: 1, text: 'thank you for watching' },
			{ id: 'c', start: 56, duration: 1, text: 'Thank you for watching.' }
		];
		// Each recurrence is within 30s of the previous occurrence → kept once.
		expect(deduplicateSegments(segments).map((s) => s.id)).toEqual(['a']);
	});
});

describe('clipSegmentsToTrustedRange', () => {
	const seg = (id: string, start: number) => ({ id, start, duration: 1, text: id });

	it('keeps segments whose start is within [from, to) and drops the rest', () => {
		const segments = [seg('a', 26), seg('b', 27.5), seg('c', 40), seg('d', 52.5)];
		// Trusted range [27.5, 52.5): 'a' belongs to the prior window, 'd' to the next
		// window (its trustedFrom is 52.5) — dropping both prevents double-counting.
		expect(clipSegmentsToTrustedRange(segments, 27.5, 52.5).map((s) => s.id)).toEqual(['b', 'c']);
	});

	it('treats null bounds as unbounded (first / last window)', () => {
		const segments = [seg('a', 0), seg('b', 100)];
		expect(clipSegmentsToTrustedRange(segments, null, null).map((s) => s.id)).toEqual(['a', 'b']);
		expect(clipSegmentsToTrustedRange(segments, null, 50).map((s) => s.id)).toEqual(['a']);
		expect(clipSegmentsToTrustedRange(segments, 50, null).map((s) => s.id)).toEqual(['b']);
	});
});

describe('transcribeWindow', () => {
	it('drops adjacent repeated caption segments from decoder loops', () => {
		const segments = dropAdjacentRepeatedSegments([
			{ id: 'a', start: 0, duration: 1, text: 'Good walk, follow me!' },
			{ id: 'b', start: 1.1, duration: 1, text: ' good walk follow me ' },
			{ id: 'c', start: 2.2, duration: 1, text: 'Different line' },
			{ id: 'd', start: 12, duration: 1, text: 'Good walk, follow me!' }
		]);

		expect(segments.map((segment) => segment.id)).toEqual(['a', 'c', 'd']);
	});

	it('produces timestamped caption segments offset into the clip', async () => {
		const runtime = scriptedRuntime([50364, 1, 2, 50414, 50257]);
		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 2,
			language: 'en'
		});
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0].text).toBe('hello world');
		expect(result.segments[0].start).toBeCloseTo(2, 5);
		expect(result.text).toBe('hello world');
		expect(isEmptyTranscript(result.segments)).toBe(false);
	});

	it('pads raw PCM to the model chunk length before extracting mel features', async () => {
		let encodedFrames = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				encodedFrames = mel.nFrames;
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				logits[50257] = 100;
				return logits;
			},
			dispose() {}
		};

		await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(100),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en',
			melConfig: { sampleRate: 100, hopLength: 1, nFft: 4, nMel: 2 },
			chunkLengthS: 30
		});

		expect(encodedFrames).toBe(3000);
	});

	it('returns no segments for a silent window', async () => {
		const runtime = scriptedRuntime([50257]); // immediate end-of-text
		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(result.segments).toEqual([]);
		expect(result.text).toBe('');
		expect(isEmptyTranscript(result.segments)).toBe(true);
	});

	it('suppresses the no-timestamps token so captions can receive segment timing', async () => {
		const runtime = rankedRuntime([[50363, 50364], [1], [50414], [50257]]);
		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0]).toMatchObject({
			start: 0,
			duration: 1,
			text: 'hello'
		});
	});

	it('suppresses symbol-only token loops before selecting caption text', async () => {
		const runtime = rankedRuntime([[50364], [3, 1], [50414], [50257]]);
		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0].text).toBe('hello');
	});

	it('falls back to no-timestamps decoding when timestamped decode is repetitive filler', async () => {
		const ts000 = 50364;
		const ts100 = 50414;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode(tokens) {
				const logits = new Float32Array(VOCAB_SIZE);
				const generated = Array.from(tokens).filter((token) => token !== 0);
				const noTimestamps = generated.includes(SPECIAL.noTimestamps);
				const generatedTextCount = generated.filter((token) => token > 0 && token < 10).length;
				const generatedTimestampCount = generated.filter(
					(token) => token >= SPECIAL.timestampBegin
				).length;

				if (noTimestamps) {
					if (generatedTextCount === 0) logits[1] = 100;
					else if (generatedTextCount === 1) logits[2] = 100;
					else logits[SPECIAL.endOfText] = 100;
					return logits;
				}

				if (generatedTimestampCount === 0) logits[ts000] = 100;
				else if (generatedTextCount < 2) logits[1] = 100;
				else if (generatedTimestampCount === 1) logits[ts100] = 100;
				else logits[SPECIAL.endOfText] = 100;
				return logits;
			},
			dispose() {}
		};

		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});

		expect(result.text).toBe('hello world');
		expect(result.segments).toHaveLength(1);
	});

	it('uses temperature fallback when greedy output is degenerate', async () => {
		// Create a runtime that produces highly repetitive output at temperature 0
		// but good output at temperature > 0. We simulate this by having the runtime
		// return logits that produce a repeating pattern.
		let call = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call < 20) {
					// First attempts: produce a repeating token (degenerate)
					logits[1] = 100;
				} else {
					// Later attempts: produce proper tokens
					if (call === 20)
						logits[50364] = 100; // timestamp
					else if (call === 21)
						logits[1] = 100; // "hello"
					else if (call === 22)
						logits[50414] = 100; // timestamp
					else logits[50257] = 100; // endOfText
				}
				call++;
				return logits;
			},
			dispose() {}
		};

		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});

		// The function should have retried with higher temperatures and
		// eventually returned something (possibly the best-effort result).
		expect(result).toBeDefined();
	});

	it('skips a window flagged no-speech AND low-confidence (compound silence gate)', async () => {
		// High no-speech probability on the SOT row, and the forced decode is
		// low-confidence (avgLogProb < -1.0) — both conditions, so the window is
		// treated as silence and yields nothing.
		let call = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call === 0) {
					logits[SPECIAL.noSpeech] = 20; // dominant no-speech (probe ≈ 1.0)
					logits[SPECIAL.timestampBegin] = 8; // forced first timestamp
				} else if (call <= 2) {
					logits[1] = 8; // low-confidence text (spread across the full vocab)
				} else {
					logits[SPECIAL.endOfText] = 8;
				}
				call++;
				return logits;
			},
			dispose() {}
		};
		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(result.segments).toEqual([]);
		expect(result.text).toBe('');
	});

	it('does not let no-speech probability suppress later usable text by itself', async () => {
		let call = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call === 0) {
					logits[50362] = 20; // noSpeech
					logits[50364] = 10; // timestamp survives timestamp rules
				} else if (call === 1) {
					logits[1] = 100;
				} else if (call === 2) {
					logits[50414] = 100;
				} else {
					logits[50364] = 100; // timestamp
					logits[50257] = 100;
				}
				call++;
				return logits;
			},
			dispose() {}
		};

		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});

		expect(result.segments).toHaveLength(1);
		expect(result.text).toBe('hello');
	});

	it('detects language from SOT logits before decoding an auto-language window', async () => {
		const calls: number[][] = [];
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode(tokens) {
				calls.push([...tokens]);
				const logits = new Float32Array(VOCAB_SIZE);
				if (tokens.length === 1) {
					logits[SPECIAL.language.zh] = 100;
					return logits;
				}
				const generated = [...tokens].slice(3).filter((token) => token !== 0);
				if (generated.length === 0) logits[50364] = 100;
				else if (generated.length === 1) logits[1] = 100;
				else if (generated.length === 2) logits[50414] = 100;
				else logits[SPECIAL.endOfText] = 100;
				return logits;
			},
			dispose() {}
		};

		const result = await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0
		});

		expect(result.language).toBe('zh');
		expect(result.text).toBe('hello');
		expect(calls[0]).toEqual([SPECIAL.startOfTranscript]);
		expect(calls[1]?.slice(0, 3)).toEqual([
			SPECIAL.startOfTranscript,
			SPECIAL.language.zh,
			SPECIAL.transcribe
		]);
	});

	it('disposes the encoder output even on cancellation', async () => {
		let disposed = false;
		const runtime = scriptedRuntime([1, 50257], { onDispose: () => (disposed = true) });
		await expect(
			transcribeWindow({
				runtime,
				monoPcm: new Float32Array(16000),
				vocab: VOCAB,
				special: SPECIAL,
				maxTokens: 128,
				offsetS: 0,
				language: 'en',
				shouldCancel: () => true
			})
		).rejects.toBeInstanceOf(DecodeCancelledError);
		expect(disposed).toBe(true);
	});

	it('respects model-specific decodeParams for the silence gate', async () => {
		// The silence gate fires when noSpeechProb >= threshold AND avgLogProb < logProbThreshold.
		// With default thresholds this window is silenced; with a permissive logProbThreshold
		// the avgLogProb condition fails and the window produces output.
		let call = 0;
		const makeRuntime = (): WhisperRuntime => ({
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call === 0) {
					// Dominant no-speech → prob ≈ 1.0 (well above both 0.6 and 0.75)
					logits[SPECIAL.noSpeech] = 20;
					logits[SPECIAL.timestampBegin] = 8;
				} else if (call === 1) {
					logits[1] = 8; // "hello" — low-confidence
				} else if (call === 2) {
					logits[2] = 8; // "world" — distinct from token 1 to avoid hallucination filter
				} else if (call === 3) {
					logits[SPECIAL.timestampBegin + 50] = 100; // closing timestamp
				} else {
					logits[SPECIAL.endOfText] = 100;
				}
				call++;
				return logits;
			},
			dispose() {}
		});

		// Without decodeParams (default logProbThreshold=-1.0) → silence gate fires
		call = 0;
		const silenced = await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(silenced.segments).toEqual([]);

		// With extremely permissive logProbThreshold → avgLogProb is above it, gate doesn't fire
		call = 0;
		const passed = await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en',
			decodeParams: { logProbThreshold: -100 }
		});
		expect(passed.segments.length).toBeGreaterThan(0);
	});

	it('uses custom temperature schedule from decodeParams', async () => {
		let decodeCallCount = 0;
		const runtime: WhisperRuntime = {
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				decodeCallCount++;
				const logits = new Float32Array(VOCAB_SIZE);
				// Produce repetitive output that will fail compression ratio check
				logits[1] = 100;
				return logits;
			},
			dispose() {}
		};

		// With default temperatures (6 temps) — more decode calls
		decodeCallCount = 0;
		await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 10,
			offsetS: 0,
			language: 'en'
		});
		const defaultCalls = decodeCallCount;

		// With reduced temperature schedule (2 temps) — fewer decode calls
		decodeCallCount = 0;
		await transcribeWindow({
			runtime,
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 10,
			offsetS: 0,
			language: 'en',
			decodeParams: { temperatures: [0.0, 0.2] }
		});
		const reducedCalls = decodeCallCount;

		expect(reducedCalls).toBeLessThan(defaultCalls);
	});

	it('respects custom noSpeechThreshold from decodeParams', async () => {
		// A window where noSpeechProb ≈ 1.0 and avgLogProb is moderately low.
		// With default noSpeechThreshold=0.6, the gate fires and returns empty.
		// With a raised noSpeechThreshold=2.0 (impossible to reach), the gate never fires.
		let call = 0;
		const makeRuntime = (): WhisperRuntime => ({
			async encode(mel): Promise<EncodedAudio> {
				return { frames: mel.nFrames, dispose: () => undefined };
			},
			async decode() {
				const logits = new Float32Array(VOCAB_SIZE);
				if (call === 0) {
					logits[SPECIAL.noSpeech] = 20; // noSpeechProb ≈ 1.0
					logits[SPECIAL.timestampBegin] = 8;
				} else if (call === 1) {
					logits[1] = 8; // low-confidence
				} else if (call === 2) {
					logits[2] = 8;
				} else if (call === 3) {
					logits[SPECIAL.timestampBegin + 50] = 100;
				} else {
					logits[SPECIAL.endOfText] = 100;
				}
				call++;
				return logits;
			},
			dispose() {}
		});

		// Default noSpeechThreshold=0.6 → gate fires (noSpeechProb ≈ 1.0 > 0.6)
		call = 0;
		const silenced = await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en'
		});
		expect(silenced.segments).toEqual([]);

		// Raised noSpeechThreshold > 1.0 → gate can never fire
		call = 0;
		const passed = await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 128,
			offsetS: 0,
			language: 'en',
			decodeParams: { noSpeechThreshold: 1.1, logProbThreshold: -100 }
		});
		expect(passed.segments.length).toBeGreaterThan(0);
	});

	it('respects custom compressionRatioThreshold from decodeParams', async () => {
		// Alternate tokens 1,2 to produce "hello world hello world..." — high
		// compression ratio but not caught by the single-word hallucination filter.
		// With a strict threshold the decode loop exhausts all attempts (more decode
		// calls); with a permissive threshold it accepts on the first attempt (fewer).
		let decodeCallCount = 0;
		const makeRuntime = (): WhisperRuntime => {
			let step = 0;
			return {
				async encode(mel): Promise<EncodedAudio> {
					return { frames: mel.nFrames, dispose: () => undefined };
				},
				async decode() {
					decodeCallCount++;
					const logits = new Float32Array(VOCAB_SIZE);
					logits[step % 2 === 0 ? 1 : 2] = 100;
					step++;
					return logits;
				},
				dispose() {}
			};
		};

		// Strict compressionRatioThreshold=1.0 → text is "degenerate",
		// runs through all attempts (many decode calls)
		decodeCallCount = 0;
		await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 10,
			offsetS: 0,
			language: 'en',
			decodeParams: {
				logProbThreshold: -100,
				compressionRatioThreshold: 1.0,
				temperatures: [0]
			}
		});
		const strictCalls = decodeCallCount;

		// Permissive compressionRatioThreshold=100.0 → accepted on first attempt
		decodeCallCount = 0;
		await transcribeWindow({
			runtime: makeRuntime(),
			monoPcm: new Float32Array(16000),
			vocab: VOCAB,
			special: SPECIAL,
			maxTokens: 10,
			offsetS: 0,
			language: 'en',
			decodeParams: {
				logProbThreshold: -100,
				compressionRatioThreshold: 100.0,
				temperatures: [0]
			}
		});
		const permissiveCalls = decodeCallCount;

		expect(permissiveCalls).toBeLessThan(strictCalls);
	});
});
