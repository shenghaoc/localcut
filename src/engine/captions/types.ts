import type { TitleStyle } from '../title';
import { DEFAULT_TITLE_STYLE, normalizeTitleStyle } from '../title';
import { DEFAULT_TRANSFORM, normalizeTransform, type TransformParams } from '../transform';

export type CaptionFormat = 'srt' | 'webvtt';
export type CaptionAnchor =
	| 'bottom-center'
	| 'bottom-left'
	| 'bottom-right'
	| 'top-center'
	| 'custom';
export type CaptionLineWrap = 'balanced' | 'greedy';
export type CaptionPresetId = 'subtitle' | 'lower-third' | 'note';

export interface CaptionDiagnostic {
	code:
		| 'invalid-index'
		| 'invalid-timecode'
		| 'negative-duration'
		| 'overlap'
		| 'unsupported-setting'
		| 'empty-cue'
		| 'missing-header';
	severity: 'info' | 'warning' | 'error';
	cueIndex?: number;
	line?: number;
	message: string;
}

export interface CaptionStyle {
	presetId?: CaptionPresetId | null;
	overrides?: Partial<TitleStyle>;
	anchor: CaptionAnchor;
	insetPx?: { x: number; y: number };
	maxWidthPercent: number;
	lineWrap: CaptionLineWrap;
}

export interface CaptionSegment {
	id: string;
	start: number;
	duration: number;
	text: string;
	style?: Partial<CaptionStyle> | null;
}

export interface CaptionTrack {
	id: string;
	kind: 'caption';
	name: string;
	language?: string | null;
	segments: CaptionSegment[];
	defaultStyle: CaptionStyle;
	burnedIn: boolean;
	visible: boolean;
}

export interface CaptionImportResult {
	track: CaptionTrack;
	diagnostics: readonly CaptionDiagnostic[];
	format: CaptionFormat;
	recovered: boolean;
}

export type CaptionExportRange =
	| { mode: 'full-track' }
	| { mode: 'timeline-range'; startS: number; endS: number };

export interface CaptionExportSettings {
	trackId: string;
	formats: readonly CaptionFormat[];
	range: CaptionExportRange;
	fileStem: string;
}

export interface CaptionSidecarFile {
	fileName: string;
	mimeType: string;
	content: string;
}

export interface ParsedCaptionDocument {
	segments: CaptionSegment[];
	diagnostics: CaptionDiagnostic[];
	recovered: boolean;
}

export const DEFAULT_CAPTION_TRACK_NAME = 'Captions';

export const CAPTION_PRESETS: Record<
	CaptionPresetId,
	{
		label: string;
		style: Partial<TitleStyle>;
		anchor: CaptionAnchor;
		maxWidthPercent: number;
		lineWrap: CaptionLineWrap;
	}
> = {
	subtitle: {
		label: 'Subtitle',
		style: {
			fontFamily: DEFAULT_TITLE_STYLE.fontFamily,
			fontSizePx: 64,
			color: '#ffffff',
			backgroundColor: '#000000',
			backgroundOpacity: 0.35,
			outlineColor: '#000000',
			outlineWidthPx: 4,
			shadowColor: '#000000',
			shadowBlurPx: 0,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		anchor: 'bottom-center',
		maxWidthPercent: 72,
		lineWrap: 'balanced'
	},
	'lower-third': {
		label: 'Lower Third',
		style: {
			fontFamily: DEFAULT_TITLE_STYLE.fontFamily,
			fontSizePx: 52,
			color: '#ffffff',
			backgroundColor: '#000000',
			backgroundOpacity: 0.48,
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 12,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 2,
			align: 'left'
		},
		anchor: 'bottom-left',
		maxWidthPercent: 48,
		lineWrap: 'greedy'
	},
	note: {
		label: 'Note',
		style: {
			fontFamily: DEFAULT_TITLE_STYLE.fontFamily,
			fontSizePx: 46,
			color: '#ffffff',
			backgroundColor: '#000000',
			backgroundOpacity: 0.42,
			outlineColor: '#000000',
			outlineWidthPx: 0,
			shadowColor: '#000000',
			shadowBlurPx: 8,
			shadowOffsetXPx: 0,
			shadowOffsetYPx: 0,
			align: 'center'
		},
		anchor: 'top-center',
		maxWidthPercent: 56,
		lineWrap: 'greedy'
	}
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
	presetId: 'subtitle',
	overrides: {},
	anchor: CAPTION_PRESETS.subtitle.anchor,
	insetPx: { x: 64, y: 56 },
	maxWidthPercent: CAPTION_PRESETS.subtitle.maxWidthPercent,
	lineWrap: CAPTION_PRESETS.subtitle.lineWrap
};

export function cloneCaptionStyle(style: CaptionStyle): CaptionStyle {
	return {
		presetId: style.presetId ?? null,
		overrides: style.overrides ? { ...style.overrides } : {},
		anchor: style.anchor,
		insetPx: style.insetPx ? { ...style.insetPx } : undefined,
		maxWidthPercent: style.maxWidthPercent,
		lineWrap: style.lineWrap
	};
}

export function normalizeCaptionStyle(style: Partial<CaptionStyle> | undefined): CaptionStyle {
	const presetId =
		style?.presetId === 'subtitle' ||
		style?.presetId === 'lower-third' ||
		style?.presetId === 'note'
			? style.presetId
			: DEFAULT_CAPTION_STYLE.presetId;
	const preset = CAPTION_PRESETS[presetId ?? 'subtitle'];
	const anchor =
		style?.anchor === 'bottom-center' ||
		style?.anchor === 'bottom-left' ||
		style?.anchor === 'bottom-right' ||
		style?.anchor === 'top-center' ||
		style?.anchor === 'custom'
			? style.anchor
			: preset.anchor;
	return {
		presetId,
		overrides: style?.overrides ? { ...style.overrides } : {},
		anchor,
		insetPx: {
			x: Math.max(0, Math.round(style?.insetPx?.x ?? DEFAULT_CAPTION_STYLE.insetPx!.x)),
			y: Math.max(0, Math.round(style?.insetPx?.y ?? DEFAULT_CAPTION_STYLE.insetPx!.y))
		},
		maxWidthPercent: Math.min(100, Math.max(20, style?.maxWidthPercent ?? preset.maxWidthPercent)),
		lineWrap:
			style?.lineWrap === 'greedy' || style?.lineWrap === 'balanced'
				? style.lineWrap
				: preset.lineWrap
	};
}

export function normalizeCaptionSegment(segment: CaptionSegment): CaptionSegment {
	return {
		id: segment.id,
		start: Math.max(0, segment.start),
		duration: Math.max(0.05, segment.duration),
		text: segment.text,
		style: segment.style
			? {
					...(segment.style.presetId !== undefined
						? { presetId: segment.style.presetId ?? null }
						: {}),
					...(segment.style.overrides ? { overrides: { ...segment.style.overrides } } : {}),
					...(segment.style.anchor !== undefined ? { anchor: segment.style.anchor } : {}),
					...(segment.style.insetPx ? { insetPx: { ...segment.style.insetPx } } : {}),
					...(segment.style.maxWidthPercent !== undefined
						? { maxWidthPercent: segment.style.maxWidthPercent }
						: {}),
					...(segment.style.lineWrap !== undefined ? { lineWrap: segment.style.lineWrap } : {})
				}
			: undefined
	};
}

export function cloneCaptionSegment(segment: CaptionSegment): CaptionSegment {
	return {
		id: segment.id,
		start: segment.start,
		duration: segment.duration,
		text: segment.text,
		style: segment.style ? normalizeCaptionSegment(segment).style : undefined
	};
}

export function sortCaptionSegments(segments: readonly CaptionSegment[]): CaptionSegment[] {
	return [...segments].sort((a, b) =>
		a.start === b.start ? a.id.localeCompare(b.id) : a.start - b.start
	);
}

export function normalizeCaptionTrack(track: CaptionTrack): CaptionTrack {
	return {
		id: track.id,
		kind: 'caption',
		name: track.name.trim() || DEFAULT_CAPTION_TRACK_NAME,
		language: track.language ?? null,
		segments: sortCaptionSegments(track.segments.map(normalizeCaptionSegment)),
		defaultStyle: normalizeCaptionStyle(track.defaultStyle),
		burnedIn: track.burnedIn,
		visible: track.visible
	};
}

export function cloneCaptionTrack(track: CaptionTrack): CaptionTrack {
	return {
		id: track.id,
		kind: 'caption',
		name: track.name,
		language: track.language ?? null,
		segments: track.segments.map(cloneCaptionSegment),
		defaultStyle: cloneCaptionStyle(track.defaultStyle),
		burnedIn: track.burnedIn,
		visible: track.visible
	};
}

export function createCaptionTrack(partial: {
	id: string;
	name?: string;
	language?: string | null;
	segments?: readonly CaptionSegment[];
	defaultStyle?: Partial<CaptionStyle>;
	burnedIn?: boolean;
	visible?: boolean;
}): CaptionTrack {
	return normalizeCaptionTrack({
		id: partial.id,
		kind: 'caption',
		name: partial.name ?? DEFAULT_CAPTION_TRACK_NAME,
		language: partial.language ?? null,
		segments: [...(partial.segments ?? [])],
		defaultStyle: normalizeCaptionStyle(partial.defaultStyle),
		burnedIn: partial.burnedIn ?? false,
		visible: partial.visible ?? true
	});
}

export function captionSegmentEnd(segment: CaptionSegment): number {
	return segment.start + segment.duration;
}

export function effectiveCaptionStyle(
	trackStyle: CaptionStyle,
	segmentStyle?: Partial<CaptionStyle> | null
): CaptionStyle {
	const base = normalizeCaptionStyle(trackStyle);
	if (!segmentStyle) return base;
	return normalizeCaptionStyle({
		presetId: segmentStyle.presetId ?? base.presetId,
		overrides: { ...base.overrides, ...segmentStyle.overrides },
		anchor: segmentStyle.anchor ?? base.anchor,
		insetPx: segmentStyle.insetPx ?? base.insetPx,
		maxWidthPercent: segmentStyle.maxWidthPercent ?? base.maxWidthPercent,
		lineWrap: segmentStyle.lineWrap ?? base.lineWrap
	});
}

export function resolveCaptionTitleStyle(style: CaptionStyle): TitleStyle {
	const normalized = normalizeCaptionStyle(style);
	const preset = CAPTION_PRESETS[normalized.presetId ?? 'subtitle'];
	return normalizeTitleStyle({
		...preset.style,
		...normalized.overrides
	});
}

export function captionAnchorTransform(style: CaptionStyle): TransformParams {
	const normalized = normalizeCaptionStyle(style);
	const insetX = (normalized.insetPx?.x ?? 0) / 960;
	const insetY = (normalized.insetPx?.y ?? 0) / 540;
	switch (normalized.anchor) {
		case 'bottom-left':
			return normalizeTransform({
				...DEFAULT_TRANSFORM,
				x: -0.5 + insetX,
				y: 0.78 - insetY,
				anchorX: -0.5,
				anchorY: 0.5
			});
		case 'bottom-right':
			return normalizeTransform({
				...DEFAULT_TRANSFORM,
				x: 0.5 - insetX,
				y: 0.78 - insetY,
				anchorX: 0.5,
				anchorY: 0.5
			});
		case 'top-center':
			return normalizeTransform({
				...DEFAULT_TRANSFORM,
				x: 0,
				y: -0.78 + insetY,
				anchorX: 0,
				anchorY: -0.5
			});
		case 'custom':
			return normalizeTransform(DEFAULT_TRANSFORM);
		case 'bottom-center':
		default:
			return normalizeTransform({
				...DEFAULT_TRANSFORM,
				x: 0,
				y: 0.78 - insetY,
				anchorX: 0,
				anchorY: 0.5
			});
	}
}
