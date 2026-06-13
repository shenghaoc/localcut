import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_TITLE_STYLE,
	DEFAULT_TITLE_TEXT,
	TITLE_STYLE_KEYS,
	normalizeTitleContent,
	normalizeTitleStyle,
	titleContentHash,
	titleContentsEqual,
	titleStylesEqual,
	type TitleContent,
	type TitleStyle
} from './title';

/** A distinct, still-valid value per style field (none collapse to the default). */
const ALT_STYLE: { [K in keyof TitleStyle]: TitleStyle[K] } = {
	fontFamily: 'Some Other Font',
	fontSizePx: 123,
	color: '#123456',
	backgroundColor: '#abcdef',
	backgroundOpacity: 0.42,
	outlineColor: '#fedcba',
	outlineWidthPx: 7,
	shadowColor: '#0f0f0f',
	shadowBlurPx: 11,
	shadowOffsetXPx: 13,
	shadowOffsetYPx: -9,
	align: 'left'
};

function content(partial?: Partial<TitleContent>): TitleContent {
	return normalizeTitleContent(partial);
}

describe('normalizeTitleStyle', () => {
	it('fills defaults for missing fields', () => {
		expect(normalizeTitleStyle(undefined)).toEqual(DEFAULT_TITLE_STYLE);
		expect(normalizeTitleStyle({})).toEqual(DEFAULT_TITLE_STYLE);
	});

	it('floors font size and clamps opacity', () => {
		expect(normalizeTitleStyle({ fontSizePx: 0 }).fontSizePx).toBeGreaterThanOrEqual(8);
		expect(normalizeTitleStyle({ backgroundOpacity: 5 }).backgroundOpacity).toBe(1);
		expect(normalizeTitleStyle({ backgroundOpacity: -1 }).backgroundOpacity).toBe(0);
	});

	it('rejects malformed colours and aligns', () => {
		expect(normalizeTitleStyle({ color: 'not-a-color' }).color).toBe(DEFAULT_TITLE_STYLE.color);
		expect(normalizeTitleStyle({ color: '#ABCDEF' }).color).toBe('#abcdef');
		expect(normalizeTitleStyle({ align: 'middle' as never }).align).toBe('center');
		expect(normalizeTitleStyle({ align: 'right' }).align).toBe('right');
	});
});

describe('normalizeTitleContent', () => {
	it('defaults the text and style', () => {
		expect(normalizeTitleContent(undefined)).toEqual({
			text: DEFAULT_TITLE_TEXT,
			style: DEFAULT_TITLE_STYLE
		});
	});

	it('preserves an empty-string text (a valid edit)', () => {
		expect(normalizeTitleContent({ text: '' }).text).toBe('');
	});
});

describe('titleContentHash', () => {
	it('matches for identical content and ignores object identity', () => {
		expect(titleContentHash(content())).toBe(titleContentHash(content()));
		expect(titleContentHash(content({ text: 'Hello' }))).toBe(
			titleContentHash(content({ text: 'Hello' }))
		);
	});

	it('changes when the text changes (text-only edit must re-raster)', () => {
		expect(titleContentHash(content({ text: 'A' }))).not.toBe(
			titleContentHash(content({ text: 'B' }))
		);
	});

	it('changes when ANY style field changes', () => {
		const base = titleContentHash(content());
		for (const key of TITLE_STYLE_KEYS) {
			const mutated = content({ style: { ...DEFAULT_TITLE_STYLE, [key]: ALT_STYLE[key] } });
			expect(titleContentHash(mutated), `field ${key} should change the hash`).not.toBe(base);
		}
	});

	it('covers every style field in the key list', () => {
		expect(new Set(TITLE_STYLE_KEYS)).toEqual(new Set(Object.keys(DEFAULT_TITLE_STYLE)));
	});
});

describe('equality helpers', () => {
	it('titleStylesEqual is field-wise', () => {
		expect(titleStylesEqual(DEFAULT_TITLE_STYLE, { ...DEFAULT_TITLE_STYLE })).toBe(true);
		expect(
			titleStylesEqual(DEFAULT_TITLE_STYLE, { ...DEFAULT_TITLE_STYLE, color: '#000000' })
		).toBe(false);
	});

	it('titleContentsEqual compares text and style', () => {
		expect(titleContentsEqual(content({ text: 'X' }), content({ text: 'X' }))).toBe(true);
		expect(titleContentsEqual(content({ text: 'X' }), content({ text: 'Y' }))).toBe(false);
	});
});

describe('titleContentHash with extras (Phase 30)', () => {
	const c = content();

	it('returns the same hash when extras is undefined (backward-compatible)', () => {
		expect(titleContentHash(c)).toBe(titleContentHash(c, undefined));
	});

	it('returns a different hash when glow.color changes', () => {
		const base = titleContentHash(c);
		const withGlow = titleContentHash(c, { glow: { color: '#ff0000', blurPx: 10 } });
		expect(withGlow).not.toBe(base);
	});

	it('returns a different hash when glow.blurPx changes', () => {
		const a = titleContentHash(c, { glow: { color: '#ff0000', blurPx: 10 } });
		const b = titleContentHash(c, { glow: { color: '#ff0000', blurPx: 20 } });
		expect(a).not.toBe(b);
	});

	it('returns a different hash when pill.radiusPx changes', () => {
		const a = titleContentHash(c, {
			pill: { paddingXPx: 12, paddingYPx: 6, radiusPx: 8, color: '#000', opacity: 1 }
		});
		const b = titleContentHash(c, {
			pill: { paddingXPx: 12, paddingYPx: 6, radiusPx: 16, color: '#000', opacity: 1 }
		});
		expect(a).not.toBe(b);
	});

	it('returns stable hash for identical inputs', () => {
		const extras = { glow: { color: '#00ff00', blurPx: 15 } };
		expect(titleContentHash(c, extras)).toBe(titleContentHash(c, extras));
	});
});
