/**
 * Phase 40: bilingual sidecar export helpers (pure).
 *
 * Bilingual export reuses the existing Phase 22 caption sidecar path — it just
 * composes a language-suffixed file stem so the source and translated tracks
 * drop out as e.g. `clip.en.srt` and `clip.zh.srt`.
 */

/** Strip characters that don't belong in a download file name. */
function sanitizeStem(stem: string): string {
	const cleaned = stem
		.trim()
		.replace(/\.[^./\\]+$/, '') // drop a trailing extension if present
		.replace(/[/\\:*?"<>|]+/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned || 'captions';
}

/** Normalise a language value to a short tag suitable for a filename suffix. */
function languageTag(language: string | null | undefined, fallback: string): string {
	const tag = (language ?? '').trim().toLowerCase().split(/[\s(]/)[0];
	return tag || fallback;
}

/**
 * Compose a language-suffixed file stem, e.g. `("My Clip.srt", "zh") -> "My Clip.zh"`.
 * The existing exporter appends the format extension (`.srt` / `.vtt`).
 */
export function languageSuffixedStem(
	stem: string,
	language: string | null | undefined,
	fallback = 'src'
): string {
	return `${sanitizeStem(stem)}.${languageTag(language, fallback)}`;
}
