import { describe, it, expect } from 'vite-plus/test';
import {
	colorMetadataFromHints,
	isHDRSource,
	isWorkingSpace,
	COLOR_METADATA_NONE,
	selectNormalizeTransfer,
	NormalizeTransfer,
	selectNormalizeMatrix,
	MAT3_IDENTITY,
	MAT3_BT2020_TO_BT709,
	MAT3_P3_TO_BT709,
	WORKING_COLOR_CONFIG,
	PIPELINE_ORDER,
	OutputTransfer,
	generateHDRWarnings,
	generateExportHDRWarning
} from './colour';

describe('ColorMetadata', () => {
	it('defaults to origin=none for empty hints', () => {
		const meta = colorMetadataFromHints({
			primaries: null,
			transfer: null,
			matrix: null,
			fullRange: null
		});
		expect(meta.origin).toBe('none');
		expect(meta.primaries).toBe('unknown');
		expect(meta.transfer).toBe('unknown');
		expect(meta.matrix).toBe('unknown');
		expect(meta.fullRange).toBe(false);
	});

	it('sets origin=container when metadata is present', () => {
		const meta = colorMetadataFromHints({
			primaries: 'bt709',
			transfer: 'bt709',
			matrix: 'bt709',
			fullRange: true
		});
		expect(meta.origin).toBe('container');
		expect(meta.primaries).toBe('bt709');
		expect(meta.transfer).toBe('bt709');
		expect(meta.matrix).toBe('bt709');
		expect(meta.fullRange).toBe(true);
	});

	it('detects HDR source by transfer', () => {
		const hdr = colorMetadataFromHints({
			primaries: 'bt709',
			transfer: 'smpte2084',
			matrix: null,
			fullRange: null
		});
		expect(isHDRSource(hdr)).toBe(true);
	});

	it('detects HDR source by primaries', () => {
		const hdr = colorMetadataFromHints({
			primaries: 'bt2020',
			transfer: 'bt709',
			matrix: null,
			fullRange: null
		});
		expect(isHDRSource(hdr)).toBe(true);
	});

	it('detects SDR as not HDR', () => {
		const sdr = colorMetadataFromHints({
			primaries: 'bt709',
			transfer: 'bt709',
			matrix: 'bt709',
			fullRange: true
		});
		expect(isHDRSource(sdr)).toBe(false);
	});

	it('treats unknown metadata as working space', () => {
		expect(isWorkingSpace(COLOR_METADATA_NONE)).toBe(true);
	});

	it('treats BT.709 as working space', () => {
		const sdr = colorMetadataFromHints({
			primaries: 'bt709',
			transfer: 'bt709',
			matrix: 'bt709',
			fullRange: true
		});
		expect(isWorkingSpace(sdr)).toBe(true);
	});
});

describe('NormalizeTransfer selection', () => {
	it('selects identity for linear', () => {
		expect(selectNormalizeTransfer('linear')).toBe(NormalizeTransfer.IDENTITY);
	});

	it('selects PQ for smpte2084', () => {
		expect(selectNormalizeTransfer('smpte2084')).toBe(NormalizeTransfer.PQ);
	});

	it('selects HLG for arib-std-b67', () => {
		expect(selectNormalizeTransfer('arib-std-b67')).toBe(NormalizeTransfer.HLG);
	});

	it('selects SRGB for bt709 and srgb', () => {
		expect(selectNormalizeTransfer('bt709')).toBe(NormalizeTransfer.SRGB);
		expect(selectNormalizeTransfer('srgb')).toBe(NormalizeTransfer.SRGB);
	});

	it('defaults to identity for unknown', () => {
		expect(selectNormalizeTransfer('unknown')).toBe(NormalizeTransfer.IDENTITY);
	});
});

describe('Normalize matrix selection', () => {
	it('returns identity for BT.709 source', () => {
		const result = selectNormalizeMatrix('bt709', 'bt709');
		expect(result.needsConversion).toBe(false);
		expect(result.matrix).toEqual(MAT3_IDENTITY);
	});

	it('returns BT.2020→BT.709 matrix for BT.2020 source', () => {
		const result = selectNormalizeMatrix('bt2020', 'bt709');
		expect(result.needsConversion).toBe(true);
		expect(result.matrix).toEqual(MAT3_BT2020_TO_BT709);
	});

	it('returns P3→BT.709 matrix for P3 source', () => {
		const result = selectNormalizeMatrix('p3', 'bt709');
		expect(result.needsConversion).toBe(true);
		expect(result.matrix).toEqual(MAT3_P3_TO_BT709);
	});

	it('returns identity for unknown primaries', () => {
		const result = selectNormalizeMatrix('unknown', 'bt709');
		expect(result.needsConversion).toBe(false);
		expect(result.matrix).toEqual(MAT3_IDENTITY);
	});
});

describe('Pipeline order', () => {
	it('PIPELINE_ORDER contains all 7 stages exactly once', () => {
		const stages = new Set(PIPELINE_ORDER);
		expect(stages.size).toBe(7);
		expect(PIPELINE_ORDER.length).toBe(7);
	});

	it('starts with source-normalization', () => {
		expect(PIPELINE_ORDER[0]).toBe('source-normalization');
	});

	it('ends with output-conversion', () => {
		expect(PIPELINE_ORDER[PIPELINE_ORDER.length - 1]).toBe('output-conversion');
	});

	it('has compositing before output-conversion', () => {
		const compIdx = PIPELINE_ORDER.indexOf('compositing');
		const outIdx = PIPELINE_ORDER.indexOf('output-conversion');
		expect(compIdx).toBeLessThan(outIdx);
	});

	it('has base-correction before lut-apply', () => {
		const baseIdx = PIPELINE_ORDER.indexOf('base-correction');
		const lutIdx = PIPELINE_ORDER.indexOf('lut-apply');
		expect(baseIdx).toBeLessThan(lutIdx);
	});

	it('has opacity before transform', () => {
		const opIdx = PIPELINE_ORDER.indexOf('opacity');
		const xfIdx = PIPELINE_ORDER.indexOf('transform');
		expect(opIdx).toBeLessThan(xfIdx);
	});
});

describe('WorkingColorConfig', () => {
	it('is BT.709 primaries, linear working, sRGB output', () => {
		expect(WORKING_COLOR_CONFIG.primaries).toBe('bt709');
		expect(WORKING_COLOR_CONFIG.transferWorking).toBe('linear');
		expect(WORKING_COLOR_CONFIG.transferOutput).toBe('srgb');
		expect(WORKING_COLOR_CONFIG.matrix).toBe('bt709');
	});
});

describe('OutputTransfer', () => {
	it('defines SRGB as 0', () => {
		expect(OutputTransfer.SRGB).toBe(0);
	});
});

describe('HDR warnings', () => {
	it('generates warnings for PQ content', () => {
		const meta = colorMetadataFromHints({
			primaries: 'bt2020',
			transfer: 'smpte2084',
			matrix: null,
			fullRange: null
		});
		const warnings = generateHDRWarnings(meta, 'clip-1');
		expect(warnings.length).toBeGreaterThanOrEqual(2);
		expect(warnings.some((w) => w.type === 'hdr-content-detected')).toBe(true);
		expect(warnings.some((w) => w.type === 'tone-map-active')).toBe(true);
	});

	it('generates gamut warning for BT.2020 primaries', () => {
		const meta = colorMetadataFromHints({
			primaries: 'bt2020',
			transfer: 'bt709',
			matrix: null,
			fullRange: null
		});
		const warnings = generateHDRWarnings(meta, 'clip-1');
		expect(warnings.some((w) => w.type === 'gamut-mismatch')).toBe(true);
	});

	it('generates no warnings for BT.709 SDR content', () => {
		const meta = colorMetadataFromHints({
			primaries: 'bt709',
			transfer: 'bt709',
			matrix: 'bt709',
			fullRange: true
		});
		const warnings = generateHDRWarnings(meta, 'clip-1');
		expect(warnings.length).toBe(0);
	});

	it('generates export warning when HDR clips exist', () => {
		const warning = generateExportHDRWarning(true);
		expect(warning).not.toBeNull();
		expect(warning!.type).toBe('export-hdr-to-sdr');
	});

	it('generates no export warning when no HDR clips', () => {
		expect(generateExportHDRWarning(false)).toBeNull();
	});
});

describe('BT.709 matrix identity check', () => {
	it('MAT3_IDENTITY has ones on diagonal', () => {
		expect(MAT3_IDENTITY[0]).toBe(1);
		expect(MAT3_IDENTITY[4]).toBe(1);
		expect(MAT3_IDENTITY[8]).toBe(1);
	});

	it('MAT3_IDENTITY has zeros off diagonal', () => {
		expect(MAT3_IDENTITY[1]).toBe(0);
		expect(MAT3_IDENTITY[2]).toBe(0);
		expect(MAT3_IDENTITY[3]).toBe(0);
	});
});
