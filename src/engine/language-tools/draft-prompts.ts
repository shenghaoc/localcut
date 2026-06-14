/**
 * Phase 40: pure prompt builders and defensive parsing for draft generation.
 *
 * These functions build prompts and parse responses for the Summarizer and
 * LanguageModel (Prompt API). They are pure — no AI calls, no side effects.
 * Designed for simple delimited output that Gemini Nano can handle reliably.
 */

/**
 * Build a prompt for generating titles, hashtags, and social caption (文案).
 *
 * Uses simple numbered-list delimiters rather than JSON, because Gemini Nano
 * struggles with complex structured output.
 */
export function buildDraftPrompt(transcript: string): string {
	return `Based on the following video transcript, generate:

1. Three title options (one per line)
2. Five hashtags (space-separated, each starting with #)
3. A short social media caption in Chinese (文案, 1-2 sentences)

Transcript:
${transcript}

Respond in this exact format:
TITLES:
<title 1>
<title 2>
<title 3>
HASHTAGS:
#tag1 #tag2 #tag3 #tag4 #tag5
CAPTION:
<文案>`;
}

/** Parsed draft output from the Prompt API response. */
export interface ParsedDraft {
	titles: string[];
	hashtags: string[];
	caption: string;
}

/**
 * Defensively parse a draft response from the Prompt API.
 *
 * Expects the simple delimited format from `buildDraftPrompt()`.
 * Falls back gracefully if the model doesn't follow the format exactly.
 */
export function parseDraftResponse(response: string): ParsedDraft {
	const result: ParsedDraft = {
		titles: [],
		hashtags: [],
		caption: ''
	};

	// Split into sections by the known headers
	const titleMatch = response.match(/TITLES:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
	const hashtagMatch = response.match(/HASHTAGS:\s*([\s\S]*?)(?=CAPTION:|$)/i);
	const captionMatch = response.match(/CAPTION:\s*([\s\S]*?)$/i);

	if (titleMatch?.[1]) {
		result.titles = titleMatch[1]
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.slice(0, 3); // max 3 titles
	}

	if (hashtagMatch?.[1]) {
		const tagLine = hashtagMatch[1].trim();
		result.hashtags = tagLine
			.split(/\s+/)
			.filter(tag => tag.startsWith('#'))
			.slice(0, 5); // max 5 hashtags
	}

	if (captionMatch?.[1]) {
		result.caption = captionMatch[1].trim();
	}

	return result;
}

/**
 * Build a summarizer prompt context for chunk condensation.
 */
export function buildSummarizerOptions(): {
	type: 'key-points';
	format: 'plain-text';
} {
	return {
		type: 'key-points',
		format: 'plain-text'
	};
}
