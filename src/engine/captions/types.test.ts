/** Caption types / preset unit tests — Phase 44 T9.4. */

import { describe, it, expect } from 'vite-plus/test';
import { normalizeCaptionStyle, CAPTION_PRESETS, type CaptionPresetId } from './types';

describe('normalizeCaptionStyle', () => {
	it('screencast preset returns fontFamily containing Courier New', () => {
		const style = normalizeCaptionStyle({ presetId: 'screencast' });
		expect(style.presetId).toBe('screencast');
		// The overrides are empty; the fontFamily comes from the preset via resolveCaptionTitleStyle.
		// But normalizeCaptionStyle doesn't merge preset style into overrides — it just
		// validates the presetId. Check the preset itself:
		const preset = CAPTION_PRESETS['screencast'];
		expect(preset.style.fontFamily).toContain('Courier New');
	});

	it('unknown presetId falls back to subtitle defaults without throwing', () => {
		const style = normalizeCaptionStyle({
			presetId: 'nonexistent-future-preset' as CaptionPresetId
		});
		// The presetId is kept as-is (custom-preset string path), but layout defaults
		// fall back to 'subtitle'.
		expect(style.anchor).toBe('bottom-center');
		expect(style.maxWidthPercent).toBe(72);
		expect(style.lineWrap).toBe('balanced');
	});

	it('screencast preset anchor is bottom-center', () => {
		expect(CAPTION_PRESETS['screencast'].anchor).toBe('bottom-center');
	});

	it('screencast preset maxWidthPercent is 64', () => {
		expect(CAPTION_PRESETS['screencast'].maxWidthPercent).toBe(64);
	});

	it('screencast preset lineWrap is greedy', () => {
		expect(CAPTION_PRESETS['screencast'].lineWrap).toBe('greedy');
	});

	it('screencast preset backgroundOpacity is 0.8', () => {
		expect(CAPTION_PRESETS['screencast'].style.backgroundOpacity).toBe(0.8);
	});
});
