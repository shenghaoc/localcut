/**
 * Phase 40: pure transcript and segment helpers.
 *
 * These functions operate on caption segment data only — no AI calls, no
 * side effects, no DOM. Unit-testable with plain data.
 */
import type { CaptionSegmentSnapshot } from '../../protocol';

/**
 * Assemble a transcript string from caption segments.
 * Concatenates trimmed, non-empty segment text in order, separated by spaces.
 */
export function assembleTranscript(
	segments: readonly CaptionSegmentSnapshot[]
): string {
	return segments
		.map(s => s.text.trim())
		.filter(Boolean)
		.join(' ');
}

/**
 * Build translated segments by copying timing from the source and replacing
 * text with the translated version. Preserves count and order 1:1.
 *
 * This is the core timing-invariant helper: `start` and `duration` are
 * copied verbatim; only `text` changes.
 */
export function buildTranslatedSegments(
	sourceSegments: readonly CaptionSegmentSnapshot[],
	translatedTexts: readonly string[]
): CaptionSegmentSnapshot[] {
	if (sourceSegments.length !== translatedTexts.length) {
		throw new Error(
			`Timing invariant violation: ${sourceSegments.length} source segments ` +
			`but ${translatedTexts.length} translated texts`
		);
	}
	return sourceSegments.map((source, i) => ({
		id: '', // will be assigned by the worker's createTranslatedCaptionTrack
		start: source.start,
		duration: source.duration,
		text: translatedTexts[i]
	}));
}

/**
 * Select a dominant language from a sample of detected languages.
 * Returns 'zh' or 'en' based on the most common detection.
 */
export function dominantLanguage(
	detections: readonly { detectedLanguage: string; confidence: number }[]
): 'zh' | 'en' {
	let zhScore = 0;
	let enScore = 0;
	for (const d of detections) {
		if (d.detectedLanguage.startsWith('zh')) zhScore += d.confidence;
		else if (d.detectedLanguage.startsWith('en')) enScore += d.confidence;
	}
	return zhScore >= enScore ? 'zh' : 'en';
}

/**
 * Return the opposite language for bilingual zh/en translation.
 */
export function oppositeLanguage(lang: 'zh' | 'en'): 'zh' | 'en' {
	return lang === 'zh' ? 'en' : 'zh';
}
