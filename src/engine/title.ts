/** Title-clip text + style model and content hashing — Phase 14.
 *
 * Pure, GPU-free: timeline.ts and project.ts import these types for the
 * source-less `kind: 'title'` clip, and titles.ts derives a raster cache key
 * from {@link titleContentHash}. The hash must cover the text AND every style
 * field — a text-only edit must re-raster, and a stale texture silently showing
 * old text is the failure mode the keying exists to prevent (R2.3).
 */

export type TitleAlign = 'left' | 'center' | 'right';

/**
 * Title style. Sizes/offsets are pixels in the raster's reference height
 * ({@link TITLE_RASTER_HEIGHT}); the resulting texture is laid out by the Phase
 * 12 transform like any other layer, so absolute pixels stay resolution-stable.
 */
export interface TitleStyle {
	fontFamily: string;
	fontSizePx: number;
	color: string;
	/** Background box behind the text; opacity 0 paints no box. */
	backgroundColor: string;
	backgroundOpacity: number;
	outlineColor: string;
	outlineWidthPx: number;
	shadowColor: string;
	shadowBlurPx: number;
	shadowOffsetXPx: number;
	shadowOffsetYPx: number;
	align: TitleAlign;
}

export interface TitleContent {
	text: string;
	style: TitleStyle;
}

/** Reference raster height; the 2D canvas is sized to a 16:9 box at this height. */
export const TITLE_RASTER_HEIGHT = 1080;

export const DEFAULT_TITLE_TEXT = 'Title';

/** Default placement length for a freshly added title clip (still-like). */
export const DEFAULT_TITLE_DURATION_S = 5;

export const DEFAULT_TITLE_STYLE: TitleStyle = {
	fontFamily: 'LocalCut Sans',
	fontSizePx: 96,
	color: '#ffffff',
	backgroundColor: '#000000',
	backgroundOpacity: 0,
	outlineColor: '#000000',
	outlineWidthPx: 0,
	shadowColor: '#000000',
	shadowBlurPx: 0,
	shadowOffsetXPx: 0,
	shadowOffsetYPx: 0,
	align: 'center'
};

/** Stable list of style keys, sorted so the hash order is deterministic. */
export const TITLE_STYLE_KEYS = Object.keys(DEFAULT_TITLE_STYLE).sort() as (keyof TitleStyle)[];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Accepts `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` (any case); anything else falls back. */
function normalizeColor(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)
		? trimmed.toLowerCase()
		: fallback;
}

function normalizeAlign(value: unknown): TitleAlign {
	return value === 'left' || value === 'right' || value === 'center'
		? value
		: DEFAULT_TITLE_STYLE.align;
}

export function normalizeTitleStyle(partial: Partial<TitleStyle> | undefined): TitleStyle {
	const fontFamily =
		typeof partial?.fontFamily === 'string' && partial.fontFamily.trim().length > 0
			? partial.fontFamily.trim()
			: DEFAULT_TITLE_STYLE.fontFamily;
	return {
		fontFamily,
		// Floor the size so a zero/negative value never collapses the raster.
		fontSizePx: clamp(finiteOr(partial?.fontSizePx, DEFAULT_TITLE_STYLE.fontSizePx), 8, 512),
		color: normalizeColor(partial?.color, DEFAULT_TITLE_STYLE.color),
		backgroundColor: normalizeColor(partial?.backgroundColor, DEFAULT_TITLE_STYLE.backgroundColor),
		backgroundOpacity: clamp(
			finiteOr(partial?.backgroundOpacity, DEFAULT_TITLE_STYLE.backgroundOpacity),
			0,
			1
		),
		outlineColor: normalizeColor(partial?.outlineColor, DEFAULT_TITLE_STYLE.outlineColor),
		outlineWidthPx: clamp(
			finiteOr(partial?.outlineWidthPx, DEFAULT_TITLE_STYLE.outlineWidthPx),
			0,
			64
		),
		shadowColor: normalizeColor(partial?.shadowColor, DEFAULT_TITLE_STYLE.shadowColor),
		shadowBlurPx: clamp(finiteOr(partial?.shadowBlurPx, DEFAULT_TITLE_STYLE.shadowBlurPx), 0, 128),
		shadowOffsetXPx: clamp(
			finiteOr(partial?.shadowOffsetXPx, DEFAULT_TITLE_STYLE.shadowOffsetXPx),
			-128,
			128
		),
		shadowOffsetYPx: clamp(
			finiteOr(partial?.shadowOffsetYPx, DEFAULT_TITLE_STYLE.shadowOffsetYPx),
			-128,
			128
		),
		align: normalizeAlign(partial?.align)
	};
}

/** Partial title input: text and/or a partial style patch (fields default). */
export interface TitleContentInput {
	text?: string;
	style?: Partial<TitleStyle>;
}

export function normalizeTitleContent(partial: TitleContentInput | undefined): TitleContent {
	return {
		text: typeof partial?.text === 'string' ? partial.text : DEFAULT_TITLE_TEXT,
		style: normalizeTitleStyle(partial?.style)
	};
}

export function titleStylesEqual(a: TitleStyle, b: TitleStyle): boolean {
	return TITLE_STYLE_KEYS.every((key) => a[key] === b[key]);
}

export function titleContentsEqual(a: TitleContent, b: TitleContent): boolean {
	return a.text === b.text && titleStylesEqual(a.style, b.style);
}

export function cloneTitleContent(content: TitleContent): TitleContent {
	return { text: content.text, style: { ...content.style } };
}

/**
 * Content hash for the raster cache key. Built from the text plus every style
 * field (via {@link TITLE_STYLE_KEYS}) so changing any one of them invalidates
 * the cached texture; identical content reuses it. Derived generically from the
 * key list so a newly added style field is automatically covered.
 */
export function titleContentHash(content: TitleContent): string {
	const style = normalizeTitleStyle(content.style);
	const parts = [`text=${content.text}`];
	for (const key of TITLE_STYLE_KEYS) parts.push(`${key}=${String(style[key])}`);
	// NUL separator so free-form text can't masquerade as a following field=value
	// pair and collide with a different style set.
	return parts.join('\u0000');
}
