import { TITLE_RASTER_WIDTH } from '../titles';
import { CAPTION_PRESETS, captionAnchorTransform, normalizeCaptionStyle } from './types';
import { activeCaptionSegmentsAt, resolvedCaptionStyle } from './model';
import type { CaptionPresetId, CaptionTrack } from './types';
import type { TitleContent, TitleRasterExtras, TitleStyle } from '../title';
import { normalizeTitleStyle } from '../title';
import type { TransformParams } from '../transform';
import type { CaptionAnimStylePreset } from './anim-style';
import { resolveAnimPreset } from './anim-style';
import type { CaptionAnimUniforms } from './animation-curves';
import { computeCaptionAnimUniforms, karaokeActiveWordIndex } from './animation-curves';

/**
 * Tokenise text into segments for line wrapping. For space-delimited scripts
 * (Latin, Cyrillic, ...) each token is a word. For scripts without word
 * separators (CJK), `Intl.Segmenter` returns one token per grapheme cluster
 * so the wrapper can break at every character boundary — without it a
 * `split(/\s+/)` would produce a single mega-word, and `wrapGreedy` would
 * emit a single ultra-long line. Falls back to character-by-character
 * splitting when `Intl.Segmenter` is missing (older browsers).
 */
function tokeniseForWrap(text: string): string[] {
	const trimmed = text.trim();
	if (trimmed.length === 0) return [];
	const whitespaceTokens = trimmed.split(/\s+/).filter(Boolean);
	// If splitting by whitespace produced multiple tokens that already fit
	// reasonable line lengths, prefer the simple whitespace path so Latin
	// captions wrap by word as before.
	if (whitespaceTokens.length > 1) return whitespaceTokens;
	// Single mega-token: either a one-word Latin caption (in which case the
	// downstream length check is a no-op) or a CJK caption with no spaces.
	// Use Intl.Segmenter to break at grapheme boundaries; fall back to
	// `Array.from` which iterates code points (handles surrogate pairs).
	const segmenter =
		typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
			? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
			: null;
	if (segmenter) {
		return [...segmenter.segment(trimmed)].map((s) => s.segment);
	}
	return Array.from(trimmed);
}

/**
 * Greedy line-fill wrapper. Joins consecutive tokens with a space when both
 * tokens contain whitespace-separated words (so Latin captions read as
 * "Hello world"), and concatenates with no separator otherwise (so CJK
 * captions read as `你好世界` without spurious spaces).
 */
function wrapGreedy(text: string, maxChars: number): string {
	const tokens = tokeniseForWrap(text);
	if (tokens.length === 0) return '';
	const useSpaces = tokens.length === 1 ? false : /\s/.test(text);
	const separator = useSpaces ? ' ' : '';
	const lines: string[] = [];
	let line = tokens[0]!;
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		const candidate = line + separator + token;
		if (candidate.length <= maxChars) {
			line = candidate;
		} else {
			lines.push(line);
			line = token;
		}
	}
	lines.push(line);
	return lines.join('\n');
}

function wrapBalanced(text: string, maxChars: number): string {
	const greedy = wrapGreedy(text, maxChars).split('\n');
	if (greedy.length <= 1) return greedy.join('\n');
	const tokens = tokeniseForWrap(text);
	const useSpaces = tokens.length === 1 ? false : /\s/.test(text);
	const separator = useSpaces ? ' ' : '';
	const perLine = Math.ceil(tokens.length / greedy.length);
	const lines: string[] = [];
	for (let offset = 0; offset < tokens.length; offset += perLine) {
		lines.push(tokens.slice(offset, offset + perLine).join(separator));
	}
	return lines
		.map((line) => (line.length > maxChars ? wrapGreedy(line, maxChars) : line))
		.join('\n');
}

/**
 * Caption raster cache key.
 *
 * - No variant → the full-line raster (subtitle, lower-third, all non-karaoke
 *   presets, and karaoke segments when no word is currently active).
 * - `highlight:<idx>` → the karaoke-active-word variant where word `idx`
 *   (zero-based, per the segment-level `words` array) is drawn in the
 *   preset's `highlightColor`. The active word index is part of the key on
 *   purpose: it lets the worker pre-rasterise every per-word variant at
 *   sync time so the playback hot path never invokes Canvas2D.
 */
export function captionTextureId(
	trackId: string,
	segmentId: string,
	variant?: 'highlight' | `highlight:${number}`
): string {
	return variant ? `caption:${trackId}:${segmentId}:${variant}` : `caption:${trackId}:${segmentId}`;
}

/**
 * Map a segment-level word index (over the raw `segment.words` array) onto a
 * (lineIndex, wordIndex) coordinate in the wrapped raster text. Returns null
 * when the index falls past the last wrapped word — that happens when the
 * caption text was edited but word timings are stale, and the caller should
 * fall back to the full-line raster rather than highlight an out-of-range word.
 *
 * captionTitlePayload wraps text without reordering, so the wrapped raster's
 * word order matches the input segment.text word order. We only need to find
 * which wrapped line absorbs the requested word.
 */
export function mapWordToWrappedLine(
	wrappedText: string,
	segmentWordIndex: number
): { lineIndex: number; wordIndex: number } | null {
	if (segmentWordIndex < 0) return null;
	const lines = wrappedText.split('\n');
	let wordsBeforeLine = 0;
	for (let i = 0; i < lines.length; i++) {
		// Whitespace-token counting: matches the rasterizer's per-word render
		// path for Latin / space-delimited scripts. For CJK content the wrap
		// step has already produced character-granular lines, but the mapper
		// can't distinguish "this preset's `words` array is per-character" from
		// "per-word", so it stays conservative and counts whitespace tokens.
		// Per-character CJK karaoke needs a richer data model (segment.words
		// carrying explicit substring positions) and is tracked separately.
		const wordsOnThisLine = lines[i]!.trim().split(/\s+/).filter(Boolean).length;
		if (segmentWordIndex < wordsBeforeLine + wordsOnThisLine) {
			return { lineIndex: i, wordIndex: segmentWordIndex - wordsBeforeLine };
		}
		wordsBeforeLine += wordsOnThisLine;
	}
	return null;
}

export interface CaptionPayload {
	trackId: string;
	segmentId: string;
	content: TitleContent;
	transform: TransformParams;
	animUniforms: CaptionAnimUniforms;
	textureId: string;
	/**
	 * Raster extras for this segment. Glow/pill come from the preset; the
	 * `highlightWord` field is populated for karaoke when the active word
	 * intersects `time`. Callers feed this into `rasterizeTitleToCanvas` /
	 * `titleContentHash` so the highlight variant texture renders with the
	 * active word in the preset's `highlightColor`.
	 */
	extras?: TitleRasterExtras;
}

export function activeCaptionPayloadsAt(
	tracks: readonly CaptionTrack[],
	time: number,
	customPresets: readonly CaptionAnimStylePreset[] = []
): CaptionPayload[] {
	return activeCaptionSegmentsAt(tracks, time).map(({ track, segment }) => {
		const style = normalizeCaptionStyle(resolvedCaptionStyle(track, segment));
		const preset = resolveAnimPreset(style.presetId, customPresets);

		// Three-layer style precedence (lowest → highest):
		//   1. CAPTION_PRESETS[layoutId].style — Phase 22 layout defaults
		//   2. preset.titleStyle               — Phase 30 visual look
		//   3. style.overrides                 — user edits in TranscriptPanel
		// The earlier merge order put preset.titleStyle ON TOP of payload.content.style
		// (which already baked in user overrides), clobbering anything the user had
		// set on the track/segment. Fix: rebuild the merge here so user overrides win.
		const layoutPresetId: CaptionPresetId =
			style.presetId != null && style.presetId in CAPTION_PRESETS
				? (style.presetId as CaptionPresetId)
				: 'subtitle';
		const layoutPresetStyle = CAPTION_PRESETS[layoutPresetId].style;
		const titleStyle: TitleStyle = normalizeTitleStyle({
			...layoutPresetStyle,
			...preset.titleStyle,
			...(style.overrides ?? {})
		});

		// Wrap the segment text using the resolved title style + caption layout.
		const approxCharsPerLine = Math.max(
			12,
			Math.floor(
				(TITLE_RASTER_WIDTH * (style.maxWidthPercent / 100)) /
					Math.max(24, titleStyle.fontSizePx * 0.58)
			)
		);
		const wrapped =
			style.lineWrap === 'balanced'
				? wrapBalanced(segment.text, approxCharsPerLine)
				: wrapGreedy(segment.text, approxCharsPerLine);
		const content: TitleContent = { text: wrapped, style: titleStyle };
		const transform = captionAnchorTransform(style);

		// Compute animation uniforms for the current time.
		const animUniforms = computeCaptionAnimUniforms(preset, segment.start, segment.duration, time);

		// Preset-derived raster extras (glow / pill). The karaoke highlight word
		// is added below when applicable; it changes the cache key so the
		// rasterizer produces a distinct texture per active word.
		const baseExtras: TitleRasterExtras | undefined =
			preset.glow || preset.pill
				? {
						...(preset.glow ? { glow: preset.glow } : {}),
						...(preset.pill ? { pill: preset.pill } : {})
					}
				: undefined;

		// Karaoke: if words are present and a highlightColor is set, check if we
		// should use the highlight texture variant + supply per-word colouring.
		// The textureId encodes the active word index so each variant gets its
		// own cache slot — that lets the worker pre-rasterise every variant at
		// sync time and read it from cache on the playback hot path, without
		// invoking Canvas2D per frame.
		let textureId = captionTextureId(track.id, segment.id);
		let extras = baseExtras;
		if (segment.words && segment.words.length > 0 && preset.highlightColor) {
			const activeWordIdx = karaokeActiveWordIndex(segment.words, time);
			const mapped = activeWordIdx >= 0 ? mapWordToWrappedLine(content.text, activeWordIdx) : null;
			// Only swap to the highlight variant when the word index actually maps
			// to a wrapped line. Out-of-range mappings happen when the rendered
			// text was edited but word timings were not — fall back to the full
			// line raster rather than rasterising with an out-of-range index.
			if (mapped) {
				textureId = captionTextureId(track.id, segment.id, `highlight:${activeWordIdx}`);
				extras = {
					...(baseExtras ?? {}),
					highlightWord: {
						wordIndex: mapped.wordIndex,
						lineIndex: mapped.lineIndex,
						color: preset.highlightColor
					}
				};
			}
		}

		return {
			trackId: track.id,
			segmentId: segment.id,
			content,
			transform,
			animUniforms,
			textureId,
			extras
		};
	});
}

/**
 * Soft cap on per-segment karaoke variants to pre-rasterise. Each variant is a
 * full-resolution Canvas2D raster + RGBA texture (~8 MB at 1920×1080). Past
 * this many words on a single segment we stop pre-allocating to avoid eating
 * the GPU/host memory on pathological inputs (e.g. an SRT with a 500-word
 * cue treated as karaoke). When a segment exceeds the cap, only the
 * full-line raster is emitted — karaoke degrades to "highlight whichever
 * word is active when the hot path can read its cache slot" rather than the
 * pristine pre-roll case.
 */
export const KARAOKE_VARIANT_CAP_PER_SEGMENT = 100;

/**
 * How the worker labels caption raster cache keys. The edit-path uses the
 * shared `caption:` namespace; the export path uses a unique `export-caption:`
 * prefix per render job so a concurrent edit-path sync can't evict textures
 * an in-flight export still needs.
 */
export interface CaptionTextureIdMaker {
	(trackId: string, segmentId: string): string;
	withVariant?: (trackId: string, segmentId: string, variant: `highlight:${number}`) => string;
}

/**
 * Enumerate every caption raster texture the pipeline needs ready for the
 * current project state. Used by the worker's edit-path sync (and the export
 * setup) to pre-rasterise caption textures off the playback hot path. Returns
 * one entry per visible burned-in segment, plus up to
 * `KARAOKE_VARIANT_CAP_PER_SEGMENT` extra entries per karaoke segment — one
 * per word — so the playback path can swap variants by simple cache get.
 *
 * `idMaker` lets callers namespace the textureIds (e.g. the export path uses
 * `export-caption:<exportId>:…`). Pass `captionTextureId` for the edit path
 * or a closure that prepends an export id for the export path. The closure
 * may attach `withVariant` to namespace the per-word variants as well; when
 * absent, the helper falls back to `${idMaker(...)}:highlight:${i}` so the
 * variant always rides on the base id.
 */
export function enumerateCaptionRasterTargets(
	tracks: readonly CaptionTrack[],
	customPresets: readonly CaptionAnimStylePreset[] = [],
	idMaker: CaptionTextureIdMaker = captionTextureId
): Array<{ textureId: string; content: TitleContent; extras?: TitleRasterExtras }> {
	const targets: Array<{ textureId: string; content: TitleContent; extras?: TitleRasterExtras }> =
		[];
	const variantId = (trackId: string, segmentId: string, idx: number): string =>
		idMaker.withVariant
			? idMaker.withVariant(trackId, segmentId, `highlight:${idx}`)
			: `${idMaker(trackId, segmentId)}:highlight:${idx}`;
	for (const track of tracks) {
		if (!track.visible || !track.burnedIn) continue;
		for (const segment of track.segments) {
			// Sample the payload at the segment midpoint to get the resolved style
			// + base extras (text-only fields; animUniforms / textureId variant
			// are evaluated below). The midpoint avoids the enter/exit edges
			// where overlap-clamped animation curves can swap textures.
			const sampleAt = segment.start + segment.duration / 2;
			const payloads = activeCaptionPayloadsAt([track], sampleAt, customPresets);
			const baseline = payloads.find((p) => p.segmentId === segment.id);
			if (!baseline) continue;

			// Strip karaoke-specific extras so the full-line variant gets a
			// dedicated raster (`highlightWord` would otherwise tint a word in
			// the base raster — wrong texture for the "no active word" case).
			const baselineExtras: TitleRasterExtras | undefined =
				baseline.extras?.glow || baseline.extras?.pill
					? {
							...(baseline.extras.glow ? { glow: baseline.extras.glow } : {}),
							...(baseline.extras.pill ? { pill: baseline.extras.pill } : {})
						}
					: undefined;

			// Always include the full-line raster — used whenever karaoke is
			// not currently spotlighting a word, and for every non-karaoke preset.
			targets.push({
				textureId: idMaker(track.id, segment.id),
				content: baseline.content,
				extras: baselineExtras
			});

			// Pre-rasterise every karaoke word variant so the hot path is a
			// pure cache read. resolveAnimPreset / highlightColor must be set
			// for variants to exist at all.
			const style = normalizeCaptionStyle(resolvedCaptionStyle(track, segment));
			const preset = resolveAnimPreset(style.presetId, customPresets);
			if (!segment.words || segment.words.length === 0 || !preset.highlightColor) continue;
			const cap = Math.min(segment.words.length, KARAOKE_VARIANT_CAP_PER_SEGMENT);
			if (segment.words.length > KARAOKE_VARIANT_CAP_PER_SEGMENT) {
				console.warn(
					`CaptionTrack ${track.id} segment ${segment.id}: karaoke word count (${segment.words.length}) exceeds variant cap (${KARAOKE_VARIANT_CAP_PER_SEGMENT}); only the first ${KARAOKE_VARIANT_CAP_PER_SEGMENT} word variants will be pre-rasterised.`
				);
			}
			for (let i = 0; i < cap; i++) {
				const mapped = mapWordToWrappedLine(baseline.content.text, i);
				if (!mapped) continue;
				targets.push({
					textureId: variantId(track.id, segment.id, i),
					content: baseline.content,
					extras: {
						...(baselineExtras?.glow ? { glow: baselineExtras.glow } : {}),
						...(baselineExtras?.pill ? { pill: baselineExtras.pill } : {}),
						highlightWord: {
							wordIndex: mapped.wordIndex,
							lineIndex: mapped.lineIndex,
							color: preset.highlightColor
						}
					}
				});
			}
		}
	}
	return targets;
}
