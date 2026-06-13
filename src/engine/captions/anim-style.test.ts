import { describe, expect, it } from 'vite-plus/test';
import {
	ANIM_CAPTION_PRESETS,
	ANIM_CAPTION_PRESET_DEFAULTS,
	MAX_PRESET_FILE_BYTES,
	resolveAnimPreset,
	validateCaptionAnimPreset
} from './anim-style';

describe('anim-style', () => {
	describe('ANIM_CAPTION_PRESETS', () => {
		it('contains at least 10 built-in presets', () => {
			expect(ANIM_CAPTION_PRESETS.length).toBeGreaterThanOrEqual(10);
		});

		it('all built-in presets pass validation', () => {
			for (const preset of ANIM_CAPTION_PRESETS) {
				const result = validateCaptionAnimPreset(preset);
				expect(result.ok).toBe(true);
			}
		});

		it('each built-in has a stable id, non-empty label, and builtIn: true', () => {
			const ids = new Set<string>();
			for (const preset of ANIM_CAPTION_PRESETS) {
				expect(preset.id.length).toBeGreaterThan(0);
				expect(preset.label.length).toBeGreaterThan(0);
				expect(preset.builtIn).toBe(true);
				expect(ids.has(preset.id)).toBe(false);
				ids.add(preset.id);
			}
		});

		it('includes the 10 required preset IDs', () => {
			const required = [
				'subtitle',
				'lower-third',
				'note',
				'bold-outline',
				'neon-glow',
				'karaoke',
				'cinematic',
				'pop-card',
				'bounce-card',
				'slide-news'
			];
			const ids = ANIM_CAPTION_PRESETS.map((p) => p.id);
			for (const id of required) {
				expect(ids).toContain(id);
			}
		});
	});

	describe('ANIM_CAPTION_PRESET_DEFAULTS', () => {
		it('covers every optional field', () => {
			expect(ANIM_CAPTION_PRESET_DEFAULTS.insetPx).toBeDefined();
			expect(ANIM_CAPTION_PRESET_DEFAULTS.glow).toBeUndefined();
			expect(ANIM_CAPTION_PRESET_DEFAULTS.pill).toBeUndefined();
			expect(ANIM_CAPTION_PRESET_DEFAULTS.animation).toBeUndefined();
			expect(ANIM_CAPTION_PRESET_DEFAULTS.highlightColor).toBeUndefined();
		});
	});

	describe('resolveAnimPreset', () => {
		it('returns the subtitle fallback for an unknown ID', () => {
			const preset = resolveAnimPreset('nonexistent', []);
			expect(preset.id).toBe('subtitle');
		});

		it('returns the subtitle fallback for null/undefined', () => {
			expect(resolveAnimPreset(null, []).id).toBe('subtitle');
			expect(resolveAnimPreset(undefined, []).id).toBe('subtitle');
		});

		it('finds a built-in preset by ID', () => {
			const preset = resolveAnimPreset('neon-glow', []);
			expect(preset.id).toBe('neon-glow');
		});

		it('finds a custom preset by ID', () => {
			const custom = {
				...ANIM_CAPTION_PRESETS[0]!,
				id: 'custom-1',
				label: 'Custom',
				builtIn: false
			};
			const preset = resolveAnimPreset('custom-1', [custom]);
			expect(preset.id).toBe('custom-1');
		});

		it('prefers built-in over custom when IDs collide', () => {
			const custom = {
				...ANIM_CAPTION_PRESETS[0]!,
				id: 'subtitle',
				label: 'Custom Subtitle',
				builtIn: false
			};
			const preset = resolveAnimPreset('subtitle', [custom]);
			expect(preset.builtIn).toBe(true);
		});
	});

	describe('validateCaptionAnimPreset', () => {
		it('accepts a valid preset', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 1,
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced',
				builtIn: false
			});
			expect(result.ok).toBe(true);
		});

		it('rejects a non-object', () => {
			const result = validateCaptionAnimPreset('not an object');
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('(root)');
		});

		it('rejects missing captionStyleSchemaVersion', () => {
			const result = validateCaptionAnimPreset({
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('captionStyleSchemaVersion');
		});

		it('rejects wrong captionStyleSchemaVersion (0)', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 0,
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('captionStyleSchemaVersion');
		});

		it('rejects wrong captionStyleSchemaVersion (2)', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 2,
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('captionStyleSchemaVersion');
		});

		it('rejects wrong captionStyleSchemaVersion (string)', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 'foo',
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('captionStyleSchemaVersion');
		});

		it('rejects missing anchor', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 1,
				label: 'Test',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('anchor');
		});

		it('rejects animation.durationS below minimum', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 1,
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced',
				animation: { enter: 'none', exit: 'none', durationS: 0.04 }
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('animation.durationS');
		});

		it('rejects animation.durationS above maximum', () => {
			const result = validateCaptionAnimPreset({
				captionStyleSchemaVersion: 1,
				label: 'Test',
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced',
				animation: { enter: 'none', exit: 'none', durationS: 1.01 }
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.field).toBe('animation.durationS');
		});

		it('preserves a string id (callers that want a fresh UUID overwrite after)', () => {
			const raw = {
				captionStyleSchemaVersion: 1,
				id: 'my-preset-id',
				label: 'Imported',
				builtIn: true,
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			};
			const result = validateCaptionAnimPreset(raw);
			expect(result.ok).toBe(true);
			if (result.ok) {
				// `id` survives validation; project-doc parsing relies on this so
				// segment.style.presetId references resolve. The file-import flow
				// overwrites with a fresh UUID after validation returns.
				expect(result.value.id).toBe('my-preset-id');
				// builtIn is taken from raw as-is (caller forces false after validation).
			}
		});

		it('defaults id to empty string when the raw record omits it', () => {
			const raw = {
				captionStyleSchemaVersion: 1,
				label: 'No id',
				builtIn: false,
				anchor: 'bottom-center',
				maxWidthPercent: 80,
				lineWrap: 'balanced'
			};
			const result = validateCaptionAnimPreset(raw);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.id).toBe('');
		});
	});

	describe('MAX_PRESET_FILE_BYTES (R4.6)', () => {
		it('is exactly 64 KiB', () => {
			expect(MAX_PRESET_FILE_BYTES).toBe(64 * 1024);
		});

		it('every built-in preset serializes well under the cap', () => {
			for (const preset of ANIM_CAPTION_PRESETS) {
				const json = JSON.stringify(preset);
				expect(json.length).toBeLessThan(MAX_PRESET_FILE_BYTES);
			}
		});
	});
});
