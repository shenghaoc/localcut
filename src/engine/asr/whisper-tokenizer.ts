/**
 * Whisper tokenizer for decoding (Phase 29). Whisper uses GPT-2-style
 * **byte-level BPE**: each `vocab.json` token string is a sequence of "byte
 * characters" (the GPT-2 bytes→unicode mapping), so turning token ids back into
 * text requires reversing that mapping to raw bytes and UTF-8 decoding — naive
 * string concatenation would mangle multibyte text. Only the id→token map is
 * needed for decoding (merges are an encoding-only concern), plus the special
 * token ids, which are model-specific and supplied via the manifest.
 *
 * Pure and unit-testable: no model, no DOM.
 */
import type { AsrSpecialTokens, CaptionSegmentSnapshot } from '../../protocol';

/** GPT-2 `bytes_to_unicode`: maps each of the 256 bytes to a printable char. */
function buildByteDecoder(): Map<string, number> {
	const bs: number[] = [];
	const add = (from: number, to: number) => {
		for (let c = from; c <= to; c++) bs.push(c);
	};
	add('!'.charCodeAt(0), '~'.charCodeAt(0));
	add('¡'.charCodeAt(0), '¬'.charCodeAt(0));
	add('®'.charCodeAt(0), 'ÿ'.charCodeAt(0));
	const cs = [...bs];
	let n = 0;
	for (let b = 0; b < 256; b++) {
		if (!bs.includes(b)) {
			bs.push(b);
			cs.push(256 + n);
			n += 1;
		}
	}
	const decoder = new Map<string, number>();
	for (let i = 0; i < bs.length; i++) decoder.set(String.fromCharCode(cs[i]), bs[i]);
	return decoder;
}

const BYTE_DECODER = buildByteDecoder();

/** Parses a `vocab.json` (token string → id) into an id → token-string array. */
export function parseWhisperVocab(text: string): string[] {
	const json = JSON.parse(text) as Record<string, number>;
	let maxId = 0;
	for (const id of Object.values(json)) if (id > maxId) maxId = id;
	const idToToken = new Array<string>(maxId + 1).fill('');
	for (const [token, id] of Object.entries(json)) idToToken[id] = token;
	return idToToken;
}

/**
 * Decodes text token ids to a string via byte-level BPE. Ids outside the vocab
 * (special/timestamp tokens) are skipped — the caller is expected to pass only
 * text tokens.
 */
export function decodeTextIds(idToToken: readonly string[], ids: readonly number[]): string {
	let chars = '';
	for (const id of ids) {
		const token = idToToken[id];
		if (token) chars += token;
	}
	const bytes = new Uint8Array(chars.length);
	for (let i = 0; i < chars.length; i++) {
		bytes[i] = BYTE_DECODER.get(chars[i]) ?? 0;
	}
	return new TextDecoder('utf-8').decode(bytes);
}

/** Timestamp tokens encode seconds: `(id − timestampBegin) × 0.02`. */
export function timestampSeconds(id: number, special: AsrSpecialTokens): number | null {
	return id >= special.timestampBegin ? (id - special.timestampBegin) * 0.02 : null;
}

/**
 * Builds the forced decoder prompt. With no language this returns only
 * `<|sot|>` so a caller can run Whisper language detection; once a language is
 * known it forces `<|sot|> <|lang|> <|transcribe|>`. Timestamps are left enabled
 * so the model emits timestamp tokens for segment timing.
 */
export function buildWhisperPrompt(special: AsrSpecialTokens, language?: string | null): number[] {
	const prompt = [special.startOfTranscript];
	if (language && special.language[language] !== undefined) {
		prompt.push(special.language[language], special.transcribe);
	}
	return prompt;
}

/**
 * Converts generated token ids (excluding the forced prompt) into caption
 * segments. Whisper emits `<|t_start|> … text … <|t_end|>` runs; this walks the
 * timestamp tokens to bound each segment and byte-decodes the text between them.
 * When the model emits no timestamps, the whole window becomes one segment.
 */
export function idsToSegments(
	ids: readonly number[],
	idToToken: readonly string[],
	special: AsrSpecialTokens,
	offsetS: number,
	windowSeconds: number
): CaptionSegmentSnapshot[] {
	const segments: CaptionSegmentSnapshot[] = [];
	let segStart: number | null = null;
	let textIds: number[] = [];
	let index = 0;
	const clampToWindow = (seconds: number): number => Math.min(Math.max(seconds, 0), windowSeconds);

	const flush = (endS: number): void => {
		if (textIds.length === 0) return;
		const text = decodeTextIds(idToToken, textIds).trim();
		const start = clampToWindow(segStart ?? 0);
		const end = clampToWindow(endS);
		textIds = [];
		if (!text || end <= start) return;
		segments.push({
			id: `asr-seg-${index++}`,
			start: offsetS + start,
			duration: end - start,
			text
		});
	};

	for (const id of ids) {
		const ts = timestampSeconds(id, special);
		if (ts !== null) {
			flush(ts);
			segStart = clampToWindow(ts);
			continue;
		}
		if (id >= special.endOfText) continue; // sot / language / transcribe / notimestamps
		textIds.push(id);
	}
	flush(windowSeconds);
	return segments;
}
