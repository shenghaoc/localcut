/**
 * Sentencepiece-style token decoder for Whisper-class models (Phase 29).
 * Handles special tokens, timestamp tokens, and multilingual vocab.
 * Pure TypeScript — unit-testable without WebNN or DOM.
 */
export interface TokenizerVocab {
	/** Token ID → text string. Indexed by token ID. */
	idToToken: string[];
	/** Token string → ID. */
	tokenToId: Map<string, number>;
}

/** Whisper special token prefixes and their IDs (will vary by model). */
export const WHISPER_SPECIAL_TOKENS: Record<string, string> = {
	START_OF_TRANSCRIPT: '<|startoftranscript|>',
	TRANSCRIBE: '<|transcribe|>',
	TRANSLATE: '<|translate|>',
	NO_TIMESTAMPS: '<|notimestamps|>',
	END_OF_TEXT: '<|endoftext|>',
	NO_SPEECH: '<|nospeech|>'
};

export const WHISPER_LANGUAGE_TOKENS: Record<string, string> = {
	zh: '<|zh|>',
	en: '<|en|>'
};

/** Build a timestamp token string from seconds. */
export function timestampToken(seconds: number): string {
	const secs = Math.min(Math.max(seconds, 0), 30);
	return `<|${secs.toFixed(2)}|>`;
}

/** Check if a token string is a timestamp token like <|0.00|> to <|30.00|>. */
export function isTimestampToken(token: string): boolean {
	return /^<\|(\d{1,2})\.(\d{2})\|>$/.test(token);
}

/** Parse a timestamp token string to seconds, or null if not a timestamp. */
export function parseTimestampToken(token: string): number | null {
	const match = token.match(/^<\|(\d{1,2})\.(\d{2})\|>$/);
	if (!match) return null;
	const secs = parseFloat(`${match[1]}.${match[2]}`);
	if (secs > 30) return null;
	return secs;
}

/** Build vocab from a JSON object mapping token strings to IDs. */
export function buildVocab(json: Record<string, number>): TokenizerVocab {
	const entries = Object.entries(json);
	const maxId = Math.max(...entries.map(([, id]) => id));
	const idToToken = new Array<string>(maxId + 1);
	const tokenToId = new Map<string, number>();
	for (const [token, id] of entries) {
		idToToken[id] = token;
		tokenToId.set(token, id);
	}
	return { idToToken, tokenToId };
}

/** Decode a sequence of token IDs into text, collapsing spaces and newlines. */
export function decodeTokens(
	vocab: TokenizerVocab,
	tokenIds: number[],
	options?: { stripSpecialTokens?: boolean }
): string {
	const strip = options?.stripSpecialTokens ?? true;
	const tokens = tokenIds.map((id) => vocab.idToToken[id] ?? '').filter(Boolean);

	const parts: string[] = [];
	for (const token of tokens) {
		if (strip && isSpecialToken(token)) continue;
		// Sentencepiece uses '▁' (U+2581) for leading space
		if (token.startsWith('▁') || token.startsWith('Ġ')) {
			parts.push(' ');
			parts.push(token.slice(1));
		} else {
			parts.push(token);
		}
	}
	return parts.join('').replace(/\s+/g, ' ').trim();
}

function isSpecialToken(token: string): boolean {
	return (
		token === '<|startoftranscript|>' ||
		token === '<|transcribe|>' ||
		token === '<|translate|>' ||
		token === '<|notimestamps|>' ||
		token === '<|endoftext|>' ||
		token === '<|nospeech|>' ||
		token === '<|zh|>' ||
		token === '<|en|>'
	);
}

/** Detect language from decoder start-of-sequence tokens. */
export function detectLanguageFromTokens(vocab: TokenizerVocab, tokenIds: number[]): string | null {
	for (const id of tokenIds.slice(0, 5)) {
		const token = vocab.idToToken[id] ?? '';
		if (token === '<|zh|>') return 'zh';
		if (token === '<|en|>') return 'en';
	}
	return null;
}

/** Fetch and parse a vocab.json from the given URL. */
export async function fetchVocab(url: string): Promise<TokenizerVocab> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch vocab: ${response.status}`);
	const json = await response.json();
	return buildVocab(json);
}
