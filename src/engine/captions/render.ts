import { TITLE_RASTER_WIDTH } from '../titles';
import { captionAnchorTransform, resolveCaptionTitleStyle } from './types';
import { activeCaptionSegmentsAt, resolvedCaptionStyle } from './model';
import type { CaptionTrack } from './types';
import type { TitleContent } from '../title';
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

export function activeCaptionPayloadsAt(
	tracks: readonly CaptionTrack[],
	time: number,
	customPresets: readonly CaptionAnimStylePreset[] = []
): Array<{
	trackId: string;
	segmentId: string;
	content: TitleContent;
	transform: TransformParams;
	animUniforms: CaptionAnimUniforms;
	textureId: string;
}> {
	return activeCaptionSegmentsAt(tracks, time).map(({ track, segment }) => {
		const style = resolvedCaptionStyle(track, segment);
		const preset = resolveAnimPreset(style.presetId, customPresets);
		const payload = captionTitlePayload(track, segment.id, segment.text);

		// Compute animation uniforms for the current time.
		const animUniforms = computeCaptionAnimUniforms(preset, segment.start, segment.duration, time);

		// Karaoke: if words are present and a highlightColor is set, check if we
		// should use the highlight texture variant.
		let textureId = captionTextureId(track.id, segment.id);
		if (segment.words && segment.words.length > 0 && preset.highlightColor) {
			const activeWordIdx = karaokeActiveWordIndex(segment.words, time);
			if (activeWordIdx >= 0) {
				textureId = captionTextureId(track.id, segment.id, 'highlight');
			}
		}

		return {
			trackId: track.id,
			segmentId: segment.id,
			content: payload.content,
			transform: payload.transform,
			animUniforms,
			textureId
		};
	});
}
