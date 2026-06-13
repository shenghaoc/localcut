import { TITLE_RASTER_WIDTH } from '../titles';
import { captionAnchorTransform, resolveCaptionTitleStyle } from './types';
import { activeCaptionSegmentsAt, resolvedCaptionStyle } from './model';
import type { CaptionTrack } from './types';
import type { TitleContent, TitleRasterExtras, TitleStyle } from '../title';
import { normalizeTitleStyle } from '../title';
import type { TransformParams } from '../transform';
import type { CaptionAnimStylePreset } from './anim-style';
import { resolveAnimPreset } from './anim-style';
import type { CaptionAnimUniforms } from './animation-curves';
import { computeCaptionAnimUniforms, karaokeActiveWordIndex } from './animation-curves';

function wrapGreedy(text: string, maxChars: number): string {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	const lines: string[] = [];
	let line = words[0]!;
	for (let index = 1; index < words.length; index += 1) {
		const word = words[index]!;
		const candidate = `${line} ${word}`;
		if (candidate.length <= maxChars) {
			line = candidate;
		} else {
			lines.push(line);
			line = word;
		}
	}
	lines.push(line);
	return lines.join('\n');
}

function wrapBalanced(text: string, maxChars: number): string {
	const greedy = wrapGreedy(text, maxChars).split('\n');
	if (greedy.length <= 1) return greedy.join('\n');
	const words = text.trim().split(/\s+/).filter(Boolean);
	const perLine = Math.ceil(words.length / greedy.length);
	const lines: string[] = [];
	for (let offset = 0; offset < words.length; offset += perLine) {
		lines.push(words.slice(offset, offset + perLine).join(' '));
	}
	return lines
		.map((line) => (line.length > maxChars ? wrapGreedy(line, maxChars) : line))
		.join('\n');
}

export function captionTextureId(
	trackId: string,
	segmentId: string,
	variant?: 'highlight'
): string {
	return variant ? `caption:${trackId}:${segmentId}:${variant}` : `caption:${trackId}:${segmentId}`;
}

export function captionTitlePayload(
	track: CaptionTrack,
	segmentId: string,
	text: string
): { content: TitleContent; transform: TransformParams } {
	const segment = track.segments.find((item) => item.id === segmentId);
	if (!segment) {
		return {
			content: { text, style: resolveCaptionTitleStyle(track.defaultStyle) },
			transform: captionAnchorTransform(track.defaultStyle)
		};
	}
	const style = resolvedCaptionStyle(track, segment);
	const titleStyle = resolveCaptionTitleStyle(style);
	const approxCharsPerLine = Math.max(
		12,
		Math.floor(
			(TITLE_RASTER_WIDTH * (style.maxWidthPercent / 100)) /
				Math.max(24, titleStyle.fontSizePx * 0.58)
		)
	);
	const wrapped =
		style.lineWrap === 'balanced'
			? wrapBalanced(text, approxCharsPerLine)
			: wrapGreedy(text, approxCharsPerLine);
	return {
		content: {
			text: wrapped,
			style: titleStyle
		},
		transform: captionAnchorTransform(style)
	};
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
		const style = resolvedCaptionStyle(track, segment);
		const preset = resolveAnimPreset(style.presetId, customPresets);
		const payload = captionTitlePayload(track, segment.id, segment.text);

		// captionTitlePayload resolves the title style via CAPTION_PRESETS, whose
		// Phase 30 entries are layout-only (every visual style is a copy of the
		// subtitle style). The Phase 30 preset's actual look — colour, font
		// size, outline — lives on CaptionAnimStylePreset.titleStyle and must be
		// layered on top so neon-glow renders cyan, bold-outline gets its 6 px
		// stroke, and custom presets use their stored titleStyle.
		const mergedStyle: TitleStyle = normalizeTitleStyle({
			...payload.content.style,
			...preset.titleStyle
		});
		const content: TitleContent = { text: payload.content.text, style: mergedStyle };

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
		let textureId = captionTextureId(track.id, segment.id);
		let extras = baseExtras;
		if (segment.words && segment.words.length > 0 && preset.highlightColor) {
			const activeWordIdx = karaokeActiveWordIndex(segment.words, time);
			if (activeWordIdx >= 0) {
				// Map the per-segment word index onto the wrapped raster's line/word
				// coordinates. captionTitlePayload wraps text without reordering, so
				// the wrapped raster's word order matches the input segment.text
				// word order; we just need to find which wrapped line that word
				// ended up on.
				const wrappedLines = content.text.split('\n');
				let wordsBeforeLine = 0;
				let targetLineIdx = 0;
				let targetWordWithinLine = activeWordIdx;
				for (let i = 0; i < wrappedLines.length; i++) {
					const wordsOnThisLine = wrappedLines[i]!.trim().split(/\s+/).filter(Boolean).length;
					if (activeWordIdx < wordsBeforeLine + wordsOnThisLine) {
						targetLineIdx = i;
						targetWordWithinLine = activeWordIdx - wordsBeforeLine;
						break;
					}
					wordsBeforeLine += wordsOnThisLine;
				}
				textureId = captionTextureId(track.id, segment.id, 'highlight');
				extras = {
					...(baseExtras ?? {}),
					highlightWord: {
						wordIndex: targetWordWithinLine,
						lineIndex: targetLineIdx,
						color: preset.highlightColor
					}
				};
			}
		}

		return {
			trackId: track.id,
			segmentId: segment.id,
			content,
			transform: payload.transform,
			animUniforms,
			textureId,
			extras
		};
	});
}
