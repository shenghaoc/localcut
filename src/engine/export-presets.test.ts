import { describe, it, expect } from 'vite-plus/test';
import {
	BUILT_IN_PRESETS,
	mergePresetsWithBuiltIns,
	createPresetFromSettings,
	presetToSettings,
	updatePreset,
	deletePreset,
	duplicatePreset,
	findPresetByName,
	validateOutputTemplate,
	expandOutputTemplate,
	sanitizeOutputFileNameBase,
	buildTemplateContext,
	clonePresetDoc,
	parseExportPresetDoc,
	resolvePlatformPresetCodec
} from './export-presets';
import type { ExportPresetDoc, ExportSettings } from '../protocol';

const baseSettings: ExportSettings = {
	preset: 'quality',
	codec: 'h264',
	container: 'mp4',
	width: 1920,
	height: 1080,
	fps: 30,
	videoBitrate: 10_000_000
};

function makePreset(overrides?: Partial<ExportPresetDoc>): ExportPresetDoc {
	return {
		id: 'test-1',
		name: 'Test Preset',
		builtIn: false,
		codec: 'h264',
		container: 'mp4',
		width: 1920,
		height: 1080,
		fps: 30,
		videoBitrate: 10_000_000,
		preset: 'quality',
		...overrides
	};
}

describe('export-presets', () => {
	describe('mergePresetsWithBuiltIns', () => {
		it('returns built-ins when no user presets exist', () => {
			const merged = mergePresetsWithBuiltIns([]);
			expect(merged.length).toBe(BUILT_IN_PRESETS.length);
			expect(merged.every((p) => p.builtIn)).toBe(true);
		});

		it('user preset shadows a built-in by name', () => {
			const user = makePreset({ name: '1080p H.264 Quality', builtIn: false, videoBitrate: 999 });
			const merged = mergePresetsWithBuiltIns([user]);
			const matching = merged.filter((p) => p.name === '1080p H.264 Quality');
			expect(matching.length).toBe(1);
			expect(matching[0]!.videoBitrate).toBe(999);
		});

		it('user presets appear after non-shadowed built-ins', () => {
			const user = makePreset({ name: 'Custom', builtIn: false });
			const merged = mergePresetsWithBuiltIns([user]);
			expect(merged.length).toBe(BUILT_IN_PRESETS.length + 1);
			expect(merged[merged.length - 1]!.name).toBe('Custom');
		});
	});

	describe('createPresetFromSettings', () => {
		it('creates a preset from settings', () => {
			const preset = createPresetFromSettings('My Preset', baseSettings, '{project}_{codec}');
			expect(preset.name).toBe('My Preset');
			expect(preset.builtIn).toBe(false);
			expect(preset.codec).toBe('h264');
			expect(preset.outputTemplate).toBe('{project}_{codec}');
			expect(preset.id).toBeTruthy();
		});
	});

	describe('presetToSettings', () => {
		it('converts a preset to ExportSettings', () => {
			const preset = makePreset();
			const settings = presetToSettings(preset);
			expect(settings.codec).toBe('h264');
			expect(settings.width).toBe(1920);
			expect(settings.range).toBeUndefined();
		});
	});

	describe('CRUD', () => {
		it('updatePreset replaces matching preset', () => {
			const presets = [makePreset({ id: 'a' }), makePreset({ id: 'b' })];
			const updated = updatePreset(presets, { ...presets[0]!, name: 'Renamed' });
			expect(updated[0]!.name).toBe('Renamed');
			expect(updated[1]!.id).toBe('b');
		});

		it('deletePreset removes by id', () => {
			const presets = [makePreset({ id: 'a' }), makePreset({ id: 'b' })];
			const after = deletePreset(presets, 'a');
			expect(after.length).toBe(1);
			expect(after[0]!.id).toBe('b');
		});

		it('deletePreset does not remove built-ins', () => {
			const presets = [makePreset({ id: 'a', builtIn: true })];
			const after = deletePreset(presets, 'a');
			expect(after.length).toBe(1);
			expect(after[0]!.id).toBe('a');
			expect(after[0]!.builtIn).toBe(true);
		});

		it('duplicatePreset creates a copy with unique name', () => {
			const presets = [makePreset({ id: 'a', name: 'Original' })];
			const { presets: after, newPreset } = duplicatePreset(presets, 'a');
			expect(after.length).toBe(2);
			expect(newPreset).not.toBeNull();
			expect(newPreset!.name).toBe('Original Copy');
			expect(newPreset!.id).not.toBe('a');
		});

		it('duplicatePreset handles name collisions', () => {
			const presets = [
				makePreset({ id: 'a', name: 'Original' }),
				makePreset({ id: 'b', name: 'Original Copy' })
			];
			const { newPreset } = duplicatePreset(presets, 'a');
			expect(newPreset!.name).toBe('Original Copy 2');
		});

		it('duplicatePreset returns null for missing preset', () => {
			const { newPreset } = duplicatePreset([], 'nonexistent');
			expect(newPreset).toBeNull();
		});

		it('findPresetByName finds matching preset', () => {
			const presets = [makePreset({ name: 'Alpha' }), makePreset({ name: 'Beta' })];
			expect(findPresetByName(presets, 'Beta')?.name).toBe('Beta');
			expect(findPresetByName(presets, 'Gamma')).toBeUndefined();
		});
	});

	describe('OutputNameTemplate', () => {
		it('validates known variables', () => {
			expect(validateOutputTemplate('{project}_{codec}')).toBeNull();
			expect(validateOutputTemplate('{date}-{time}')).toBeNull();
		});

		it('rejects unknown variables', () => {
			const err = validateOutputTemplate('{project}_{unknown}');
			expect(err).toContain('unknown');
		});

		it('rejects empty template', () => {
			expect(validateOutputTemplate('')).not.toBeNull();
		});

		it('expands all variables', () => {
			const ctx = buildTemplateContext('MyProject', 'Quality', 'h264', undefined, undefined, 1);
			const result = expandOutputTemplate(
				'{project}_{preset}_{codec}_{date}_{time}_{range}_{index}',
				ctx
			);
			expect(result).toContain('MyProject');
			expect(result).toContain('Quality');
			expect(result).toContain('H264');
			expect(result).toContain('full');
			expect(result).toContain('1');
		});

		it('formats range correctly', () => {
			const ctx = buildTemplateContext('P', 'Q', 'vp9', 90, 120, 2);
			const result = expandOutputTemplate('{range}', ctx);
			expect(result).toBe('01m30s-02m00s');
		});

		it('uses "Untitled" for missing project name', () => {
			const ctx = buildTemplateContext(undefined, 'Q', 'h264', undefined, undefined, 1);
			const result = expandOutputTemplate('{project}', ctx);
			expect(result).toBe('Untitled');
		});

		it('sanitizes file-system unsafe template output', () => {
			expect(sanitizeOutputFileNameBase('Scene/01:VP9?final*.')).toBe('Scene_01_VP9_final_');
			expect(sanitizeOutputFileNameBase('   ')).toBe('export');
		});
	});

	describe('clonePresetDoc', () => {
		it('returns a shallow copy', () => {
			const original = makePreset();
			const cloned = clonePresetDoc(original);
			expect(cloned).toEqual(original);
			expect(cloned).not.toBe(original);
		});
	});

	describe('parseExportPresetDoc', () => {
		it('parses valid preset', () => {
			const input = makePreset();
			const parsed = parseExportPresetDoc(input);
			expect(parsed).not.toBeNull();
			expect(parsed!.name).toBe('Test Preset');
		});

		it('returns null for invalid codec', () => {
			expect(parseExportPresetDoc({ ...makePreset(), codec: 'invalid' })).toBeNull();
		});

		it('returns null for missing name', () => {
			const { name: _, ...rest } = makePreset();
			expect(parseExportPresetDoc(rest)).toBeNull();
		});

		it('returns null for non-object', () => {
			expect(parseExportPresetDoc(null)).toBeNull();
			expect(parseExportPresetDoc('string')).toBeNull();
		});

		it('parses optional outputTemplate', () => {
			const input = { ...makePreset(), outputTemplate: '{project}' };
			const parsed = parseExportPresetDoc(input);
			expect(parsed!.outputTemplate).toBe('{project}');
		});

		it('parses optional targetLufs', () => {
			const parsed = parseExportPresetDoc({ ...makePreset(), targetLufs: -14 });
			expect(parsed!.targetLufs).toBe(-14);
		});
	});
});

describe('Phase 39: platform presets', () => {
	const ids = [
		'builtin-douyin-1080p30',
		'builtin-shorts-1080p30',
		'builtin-shorts-1080p60',
		'builtin-reels-1080p30',
		'builtin-xhs-1080p30',
		'builtin-xhs-square-1080p30'
	];

	it('includes all six platform presets', () => {
		for (const id of ids) {
			const p = BUILT_IN_PRESETS.find((x) => x.id === id);
			expect(p).toBeDefined();
			expect(p!.width).toBeGreaterThan(0);
			expect(p!.height).toBeGreaterThan(0);
			expect(p!.targetLufs).toBe(-14);
		}
	});
});

describe('resolvePlatformPresetCodec', () => {
	it('returns h264/mp4 when supported', () => {
		const p = BUILT_IN_PRESETS.find((x) => x.id === 'builtin-douyin-1080p30')!;
		const probe = {
			codecs: { h264Encode: 'supported', vp9Encode: 'supported' }
		} as unknown as import('../protocol').CapabilityProbeResult;
		expect(resolvePlatformPresetCodec(p, probe)).toEqual({ codec: 'h264', container: 'mp4' });
	});

	it('falls back to vp9 when h264 unsupported', () => {
		const p = BUILT_IN_PRESETS.find((x) => x.id === 'builtin-douyin-1080p30')!;
		const probe = {
			codecs: { h264Encode: 'unsupported', vp9Encode: 'supported' }
		} as unknown as import('../protocol').CapabilityProbeResult;
		expect(resolvePlatformPresetCodec(p, probe)).toEqual({ codec: 'vp9', container: 'webm' });
	});

	it('blocks when both unsupported', () => {
		const p = BUILT_IN_PRESETS.find((x) => x.id === 'builtin-douyin-1080p30')!;
		const probe = {
			codecs: { h264Encode: 'unsupported', vp9Encode: 'unsupported' }
		} as unknown as import('../protocol').CapabilityProbeResult;
		const r = resolvePlatformPresetCodec(p, probe);
		expect('blocked' in r).toBe(true);
	});
});
