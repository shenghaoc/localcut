import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isApplePlatform, modifierGlyphs } from './platform';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('isApplePlatform (layered, deprecation-safe probe)', () => {
	it('prefers navigator.userAgentData.platform when present (Chromium)', () => {
		// Modern hint says macOS even though the deprecated string disagrees:
		// the hint wins.
		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'macOS' },
			platform: 'Win32',
			userAgent: 'Mozilla/5.0 (Windows NT 10.0)'
		});
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'Windows' },
			platform: 'MacIntel',
			userAgent: 'Mozilla/5.0 (Macintosh)'
		});
		expect(isApplePlatform()).toBe(false);
	});

	it('treats iOS as an Apple platform (hardware keyboards on iPad/iPhone)', () => {
		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'iOS' },
			platform: 'Win32',
			userAgent: 'Mozilla/5.0 (Windows NT 10.0)'
		});
		expect(isApplePlatform()).toBe(true);
	});

	it("falls back to legacy checks when the hint is 'Unknown' (privacy/spoofing)", () => {
		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'Unknown' },
			platform: 'MacIntel',
			userAgent: 'Mozilla/5.0 (Macintosh)'
		});
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'Unknown' },
			platform: 'Win32',
			userAgent: 'Mozilla/5.0 (Windows NT 10.0)'
		});
		expect(isApplePlatform()).toBe(false);
	});

	it('falls back to deprecated navigator.platform when userAgentData is absent (Firefox/Safari)', () => {
		vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
		expect(isApplePlatform()).toBe(false);
	});

	it('detects iOS devices via the platform string', () => {
		vi.stubGlobal('navigator', { platform: 'iPhone', userAgent: '' });
		expect(isApplePlatform()).toBe(true);
	});

	it('falls back to the user-agent string when platform is empty', () => {
		vi.stubGlobal('navigator', {
			platform: '',
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)'
		});
		expect(isApplePlatform()).toBe(true);
	});

	it('returns false when navigator is null (some SSR/test setups)', () => {
		vi.stubGlobal('navigator', null);
		expect(isApplePlatform()).toBe(false);
	});
});

describe('modifierGlyphs', () => {
	it('returns Apple glyphs when on an Apple platform', () => {
		expect(modifierGlyphs(true)).toEqual({ mod: '⌘', shift: '⇧', del: '⌫' });
	});

	it('returns PC glyphs otherwise', () => {
		expect(modifierGlyphs(false)).toEqual({ mod: 'Ctrl', shift: 'Shift', del: 'Del' });
	});
});
