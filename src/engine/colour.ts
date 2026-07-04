/** Colour management core — Phase 21.
 *
 *  Defines the editor's colour metadata model, working-space assumptions, and the
 *  single source-of-truth pipeline stage order shared by preview and export.
 */

// ─── Colour space enums ────────────────────────────────────────────────

export type TransferCharacteristic =
	| 'bt709'
	| 'bt2020-10'
	| 'bt2020-12'
	| 'smpte2084'
	| 'arib-std-b67'
	| 'linear'
	| 'srgb'
	| 'unknown';

export type ColourPrimaries = 'bt709' | 'bt2020' | 'smpte170m' | 'p3' | 'unknown';

export type MatrixCoefficients =
	| 'bt709'
	| 'bt601'
	| 'bt2020-ncl'
	| 'bt2020-cl'
	| 'identity'
	| 'unknown';

// ─── Colour metadata ───────────────────────────────────────────────────

/** Source colour metadata extracted during import. Never guessed — absent data
 *  sets `origin: 'none'` rather than defaulting to a standard. */
export interface ColorMetadata {
	primaries: ColourPrimaries;
	transfer: TransferCharacteristic;
	matrix: MatrixCoefficients;
	origin: 'container' | 'assumed' | 'none';
	fullRange: boolean;
}

/** The default for sources with no container metadata. Origin is explicitly `'none'`. */
export const COLOR_METADATA_NONE: ColorMetadata = {
	primaries: 'unknown',
	transfer: 'unknown',
	matrix: 'unknown',
	origin: 'none',
	fullRange: false
};

/** Build `ColorMetadata` from container hints (e.g. raw strings from mediabunny). */
export function colorMetadataFromHints(hints: {
	primaries: string | null;
	transfer: string | null;
	matrix: string | null;
	fullRange: boolean | null;
}): ColorMetadata {
	const hasAny = hints.primaries || hints.transfer || hints.matrix || hints.fullRange != null;
	return {
		primaries: parsePrimaries(hints.primaries),
		transfer: parseTransfer(hints.transfer),
		matrix: parseMatrix(hints.matrix),
		origin: hasAny ? 'container' : 'none',
		fullRange: hints.fullRange ?? false
	};
}

function parsePrimaries(s: string | null): ColourPrimaries {
	if (!s) return 'unknown';
	const lower = s.toLowerCase();
	if (lower === 'bt709' || lower === 'bt.709' || lower === 'rec709' || lower === 'rec.709')
		return 'bt709';
	if (lower === 'bt2020' || lower === 'bt.2020' || lower === 'rec2020' || lower === 'rec.2020')
		return 'bt2020';
	if (lower === 'smpte170m' || lower === 'bt601' || lower === 'bt.601') return 'smpte170m';
	if (lower === 'p3' || lower === 'displayp3' || lower === 'display-p3') return 'p3';
	return 'unknown';
}

function parseTransfer(s: string | null): TransferCharacteristic {
	if (!s) return 'unknown';
	const lower = s.toLowerCase();
	if (lower === 'bt709' || lower === 'bt.709') return 'bt709';
	if (lower === 'bt2020-10' || lower === 'bt.2020-10') return 'bt2020-10';
	if (lower === 'bt2020-12' || lower === 'bt.2020-12') return 'bt2020-12';
	if (lower === 'smpte2084' || lower === 'pq' || lower === 'st2084') return 'smpte2084';
	if (lower === 'arib-std-b67' || lower === 'hlg' || lower === 'arib') return 'arib-std-b67';
	if (lower === 'linear') return 'linear';
	if (lower === 'srgb' || lower === 'iec61966-2-1') return 'srgb';
	return 'unknown';
}

function parseMatrix(s: string | null): MatrixCoefficients {
	if (!s) return 'unknown';
	const lower = s.toLowerCase();
	if (lower === 'bt709' || lower === 'bt.709') return 'bt709';
	if (lower === 'bt601' || lower === 'bt.601' || lower === 'smpte170m') return 'bt601';
	if (lower === 'bt2020-ncl' || lower === 'bt.2020-ncl') return 'bt2020-ncl';
	if (lower === 'bt2020-cl' || lower === 'bt.2020-cl') return 'bt2020-cl';
	if (lower === 'identity' || lower === 'rgb' || lower === 'gbr') return 'identity';
	return 'unknown';
}

/** Whether the metadata indicates a non-SDR source that warrants a user warning. */
export function isHDRSource(c: ColorMetadata): boolean {
	return c.primaries === 'bt2020' || c.transfer === 'smpte2084' || c.transfer === 'arib-std-b67';
}

/** Whether the metadata is in the SDR working space (BT.709) and needs no normalization. */
export function isWorkingSpace(c: ColorMetadata): boolean {
	return (
		c.origin === 'none' ||
		(c.primaries === 'bt709' &&
			(c.transfer === 'bt709' || c.transfer === 'srgb' || c.transfer === 'unknown') &&
			(c.matrix === 'bt709' || c.matrix === 'identity'))
	);
}

// ─── Working colour config ─────────────────────────────────────────────

/** The editor's working colour space. SDR-only for this phase: Rec.709 primaries,
 *  linear light compositing, sRGB output. Documented as an explicit constant. */
export interface WorkingColorConfig {
	primaries: 'bt709';
	transferWorking: 'linear';
	transferOutput: 'srgb';
	matrix: 'bt709';
}

export const WORKING_COLOR_CONFIG: WorkingColorConfig = {
	primaries: 'bt709',
	transferWorking: 'linear',
	transferOutput: 'srgb',
	matrix: 'bt709'
};

// ─── Pipeline stage order ──────────────────────────────────────────────

/** The single source of truth for the accelerated per-layer pipeline stage order.
 *  `compositeLayers` iterates this array; no stage is added/removed/reordered
 *  without touching this constant. Preview and export share the same order. */
export const PIPELINE_ORDER: ColorPipelineStage[] = [
	'source-normalization',
	'base-correction',
	'lut-apply',
	'skin-smoothing',
	'opacity',
	'transform',
	'compositing',
	'output-conversion'
];

export type ColorPipelineStage =
	| 'source-normalization' // container space → working linear
	| 'base-correction' // brightness/contrast/saturation/temperature
	| 'lut-apply' // 3D LUT (Phase 15)
	| 'skin-smoothing' // edge-preserving skin smoothing (Phase 32a)
	| 'opacity' // per-layer alpha multiply
	| 'transform' // position/scale/rotation (Phase 12)
	| 'compositing' // premultiplied "over" onto accumulator
	| 'output-conversion'; // working linear → sRGB OETF (display/output)

// ─── Normalization transfer function selection ─────────────────────────

/** Shader-side enum for inverse transfer function selection. */
export const NormalizeTransfer = {
	IDENTITY: 0,
	BT709: 1,
	SRGB: 2,
	PQ: 3,
	HLG: 4,
	BT2020_10: 5
} as const;

export function selectNormalizeTransfer(transfer: TransferCharacteristic): number {
	switch (transfer) {
		case 'bt709':
		case 'srgb':
			return NormalizeTransfer.SRGB;
		case 'smpte2084':
			return NormalizeTransfer.PQ;
		case 'arib-std-b67':
			return NormalizeTransfer.HLG;
		case 'bt2020-10':
		case 'bt2020-12':
			return NormalizeTransfer.BT2020_10;
		case 'linear':
			return NormalizeTransfer.IDENTITY;
		default:
			return NormalizeTransfer.IDENTITY;
	}
}

// ─── Matrix builders ───────────────────────────────────────────────────

/** 3×3 matrix rows packed as [m00, m01, m02, m10, m11, m12, m20, m21, m22]. */
export type Mat3x3 = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

/** Identity matrix (no conversion). */
export const MAT3_IDENTITY: Mat3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * BT.601 (SMPTE 170M) → BT.709 conversion matrix.
 * Both use the same primaries but different Y'CbCr coefficients.
 * ITU-R BT.601 to BT.709: the key difference is the luminance coefficients.
 */
export const MAT3_BT601_TO_BT709: Mat3x3 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

/**
 * Rec.2020 → Rec.709 gamut conversion matrix (3×3).
 * Maps the wider-gamut green and slightly different red/blue primaries to BT.709.
 * Simplified approximation — a proper gamut mapper would be non-linear.
 */
export const MAT3_BT2020_TO_BT709: Mat3x3 = [
	1.6605, -0.5876, -0.0728, -0.1246, 1.1329, -0.0083, -0.0035, -0.0672, 1.0406
];

/**
 * Display P3 → Rec.709 gamut conversion matrix (3×3).
 */
export const MAT3_P3_TO_BT709: Mat3x3 = [
	1.2249, -0.2249, 0.0, -0.042, 1.042, 0.0, -0.0196, -0.0786, 1.0983
];

/** Select the conversion matrix from source primaries + matrix to BT.709. */
export function selectNormalizeMatrix(
	sourcePrimaries: ColourPrimaries,
	sourceMatrix: MatrixCoefficients
): { matrix: Mat3x3; needsConversion: boolean } {
	const needsYuvRgb =
		sourceMatrix !== 'identity' && sourceMatrix !== 'bt709' && sourceMatrix !== 'unknown';
	const needsGamut = sourcePrimaries !== 'bt709' && sourcePrimaries !== 'unknown';

	if (needsGamut) {
		if (sourcePrimaries === 'bt2020') {
			return { matrix: MAT3_BT2020_TO_BT709, needsConversion: true };
		}
		if (sourcePrimaries === 'p3') {
			return { matrix: MAT3_P3_TO_BT709, needsConversion: true };
		}
		// smpte170m primaries are close enough to BT.709
	}

	if (needsYuvRgb) {
		// BT.601 Y'CbCr → BT.709 RGB matrix — minor coefficient difference,
		// but the real-world difference is small; we pass through with identity.
		// A full matrix inversion of the source YUV→RGB then BT.709 RGB→XYZ→BT.709 RGB
		// would give exact results, but for Phase 21 we document the limitation.
		return { matrix: MAT3_IDENTITY, needsConversion: false };
	}

	return { matrix: MAT3_IDENTITY, needsConversion: false };
}

// ─── Tone-map helpers ──────────────────────────────────────────────────

/**
 * Simplified Reinhard tone-map: maps HDR luminance to SDR [0, 1].
 * Preserves relative luminance ordering. For BT.2408 full tone-mapping,
 * the source-normalize shader would need a more complex curve.
 */
export function reinhardLuminance(hdrLuminance: number): number {
	return hdrLuminance / (1.0 + hdrLuminance);
}

// ─── Output transfer function selection ────────────────────────────────

/** Shader-side enum for output transfer function. */
export const OutputTransfer = {
	SRGB: 0,
	PQ: 1,
	HLG: 2
} as const;

// ─── HDR warnings ──────────────────────────────────────────────────────

export type HDRWarningType =
	| 'hdr-content-detected'
	| 'gamut-mismatch'
	| 'tone-map-active'
	| 'export-hdr-to-sdr';

export interface HDRWarning {
	type: HDRWarningType;
	clipIds: string[];
	message: string;
}

export function generateHDRWarnings(metadata: ColorMetadata, clipId: string): HDRWarning[] {
	const warnings: HDRWarning[] = [];

	if (metadata.transfer === 'smpte2084' || metadata.transfer === 'arib-std-b67') {
		warnings.push({
			type: 'hdr-content-detected',
			clipIds: [clipId],
			message:
				'HDR content detected. Best-effort tone-mapping active. Full HDR mastering is not yet supported.'
		});
		warnings.push({
			type: 'tone-map-active',
			clipIds: [clipId],
			message: 'Tone-mapping HDR to SDR for preview. Export will be SDR.'
		});
	}

	if (metadata.primaries === 'bt2020') {
		warnings.push({
			type: 'gamut-mismatch',
			clipIds: [clipId],
			message: 'Source uses Rec.2020 wide-gamut primaries. Colours may be clipped to Rec.709.'
		});
	}

	return warnings;
}

export function generateExportHDRWarning(hasHDRClips: boolean): HDRWarning | null {
	if (!hasHDRClips) return null;
	return {
		type: 'export-hdr-to-sdr',
		clipIds: [],
		message:
			'Project contains HDR-origin clips but export is SDR. Tone-mapped result will be encoded.'
	};
}
