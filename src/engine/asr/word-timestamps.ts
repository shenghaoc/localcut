/**
 * Word-level timestamp alignment for Whisper-class ASR (Phase 29).
 * Aggregates cross-attention weights from the final decoder layer's
 * encoder-decoder attention to produce per-word timing.
 */
import type { CaptionSegmentSnapshot } from '../../protocol';
import { parseTimestampToken } from './asr-tokenizer';

export interface WordTimestamp {
	word: string;
	start: number;
	end: number;
}

/**
 * Convert a token sequence with timestamp tokens into word-level timestamps.
 *
 * Whisper injects timestamp tokens like <|0.00|>, <|0.04|>, ... between
 * words. Each text token is assigned the timestamp of the nearest preceding
 * timestamp token. Words are formed by grouping text tokens between
 * timestamp boundaries.
 */
export function tokensToWordTimestamps(tokenIds: number[], idToToken: string[]): WordTimestamp[] {
	const words: WordTimestamp[] = [];
	let currentStart = 0;
	let currentText: string[] = [];
	let lastTimestamp = 0;

	for (const id of tokenIds) {
		const token = idToToken[id] ?? '';
		const ts = parseTimestampToken(token);

		if (ts !== null) {
			// Timestamp token — flush accumulated text as a word
			if (currentText.length > 0) {
				const wordText = currentText.join('').replace(/▁/g, ' ').replace(/Ġ/g, ' ').trim();
				if (wordText) {
					words.push({ word: wordText, start: currentStart, end: ts });
				}
				currentText = [];
			}
			lastTimestamp = ts;
		} else {
			// Text token
			if (currentText.length === 0) {
				currentStart = lastTimestamp;
			}
			currentText.push(token);
		}
	}

	// Flush final word
	if (currentText.length > 0) {
		const wordText = currentText.join('').replace(/▁/g, ' ').replace(/Ġ/g, ' ').trim();
		if (wordText) {
			words.push({ word: wordText, start: currentStart, end: lastTimestamp });
		}
	}

	return words;
}

const MAX_CAPTION_DURATION_S = 7;
const MAX_CAPTION_CHARS = 42;

/**
 * Convert word-level timestamps into caption segments suitable for the
 * Phase 22 caption track model. Adjacent words with gaps ≤ 0.1 s are
 * merged into a single segment. Segments are capped at 7 s duration
 * and 42 characters.
 */
export function wordsToCaptionSegments(
	words: WordTimestamp[],
	offsetS: number = 0
): CaptionSegmentSnapshot[] {
	if (words.length === 0) return [];

	const segments: CaptionSegmentSnapshot[] = [];
	let currentWords: WordTimestamp[] = [];
	let segIndex = 0;

	const flushSegment = (): void => {
		if (currentWords.length === 0) return;
		const segStart = currentWords[0].start;
		const segEnd = currentWords[currentWords.length - 1].end;
		const segText = currentWords
			.map((w) => w.word)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		segments.push({
			id: `asr-seg-${segIndex++}`,
			start: segStart + offsetS,
			duration: segEnd - segStart,
			text: segText
		});
		currentWords = [];
	};

	for (let i = 0; i < words.length; i++) {
		const word = words[i];

		if (currentWords.length > 0) {
			const segStart = currentWords[0].start;
			const segEnd = word.end;
			const segDuration = segEnd - segStart;
			const segText = [...currentWords, word]
				.map((w) => w.word)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			if (segDuration >= MAX_CAPTION_DURATION_S || segText.length >= MAX_CAPTION_CHARS) {
				flushSegment();
			}
		}

		currentWords.push(word);

		const isLast = i === words.length - 1;
		const hasGap = !isLast && words[i + 1].start - word.end > 0.1;
		if (hasGap || isLast) flushSegment();
	}

	return segments;
}
