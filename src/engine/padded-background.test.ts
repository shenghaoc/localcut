import { describe, it, expect } from 'vite-plus/test';
import {
	DEFAULT_PADDED_BACKGROUND,
	normalizePaddedBackground,
	parsePaddedBackground,
	shadowCacheKey
} from './padded-background';

describe('normalizePaddedBackground', () => {
	it('fills all defaults for empty input', () => {
		const result = normalizePaddedBackground({});
		expect(result.insetMargin).toBe(DEFAULT_PADDED_BACKGROUND.insetMargin);
		expect(result.cornerRadius).toBe(DEFAULT_PADDED_BACKGROUND.cornerRadius);
		expect(result.shadowOpacity).toBe(DEFAULT_PADDED_BACKGROUND.shadowOpacity);
		expect(result.shadowRadius).toBe(DEFAULT_PADDED_BACKGROUND.shadowRadius);
		expect(result.shadowOffsetY).toBe(DEFAULT_PADDED_BACKGROUND.shadowOffsetY);
		expect(result.background.kind).toBe('gradient');
	});

	it('clamps insetMargin to [0, 0.4]', () => {
		expect(normalizePaddedBackground({ insetMargin: -1 }).insetMargin).toBe(0);
		expect(normalizePaddedBackground({ insetMargin: 1 }).insetMargin).toBe(0.4);
	});

	it('clamps cornerRadius to [0, 64]', () => {
		expect(normalizePaddedBackground({ cornerRadius: -10 }).cornerRadius).toBe(0);
		expect(normalizePaddedBackground({ cornerRadius: 100 }).cornerRadius).toBe(64);
	});
});

describe('parsePaddedBackground', () => {
	it('accepts a valid gradient params object', () => {
		const result = parsePaddedBackground({
			insetMargin: 0.1,
			cornerRadius: 20,
			shadowOpacity: 0.5,
			shadowRadius: 30,
			shadowOffsetY: 10,
			background: { kind: 'gradient', stops: [{ color: '#ff0000', pos: 0 }], angleDeg: 45 }
		});
		expect(result).not.toBeNull();
		expect(result!.background.kind).toBe('gradient');
	});

	it('rejects missing background', () => {
		expect(parsePaddedBackground({ insetMargin: 0.1 })).toBeNull();
	});

	it('rejects invalid background kind', () => {
		expect(parsePaddedBackground({ background: { kind: 'invalid' } })).toBeNull();
	});
});

describe('shadowCacheKey', () => {
	it('returns different strings for different shadowRadius', () => {
		const k1 = shadowCacheKey(24, 16, 1920, 1080);
		const k2 = shadowCacheKey(32, 16, 1920, 1080);
		expect(k1).not.toBe(k2);
	});

	it('returns different strings for different cornerRadius', () => {
		const k1 = shadowCacheKey(24, 16, 1920, 1080);
		const k2 = shadowCacheKey(24, 0, 1920, 1080);
		expect(k1).not.toBe(k2);
	});

	it('returns same string for same inputs', () => {
		const k1 = shadowCacheKey(24, 16, 1920, 1080);
		const k2 = shadowCacheKey(24, 16, 1920, 1080);
		expect(k1).toBe(k2);
	});
});

describe('round-trip', () => {
	it('parsePaddedBackground -> normalizePaddedBackground round-trips', () => {
		const normalized = normalizePaddedBackground({});
		const json = JSON.stringify(normalized);
		const parsed = parsePaddedBackground(JSON.parse(json));
		expect(parsed).not.toBeNull();
		expect(parsed).toEqual(normalized);
	});
});
