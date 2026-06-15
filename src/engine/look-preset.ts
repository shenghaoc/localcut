import type { ClipEffectParams } from './effects';
import { DEFAULT_CLIP_EFFECTS } from './effects';
import type { TimelineClip } from './timeline';

export type LookParams = Pick<
	ClipEffectParams,
	| 'grainStrength'
	| 'grainSize'
	| 'halationThreshold'
	| 'halationRadius'
	| 'halationTintR'
	| 'halationTintG'
	| 'halationTintB'
	| 'vignetteAmount'
	| 'vignetteFeather'
	| 'vignetteRoundness'
>;

export interface LookPresetLutRef {
	fileName: string;
	fingerprint: string;
}

export interface LookPreset {
	lookSchemaVersion: 1;
	name: string;
	params: LookParams;
	lut?: LookPresetLutRef;
}

export function defaultLookParams(): LookParams {
	return {
		grainStrength: DEFAULT_CLIP_EFFECTS.grainStrength,
		grainSize: DEFAULT_CLIP_EFFECTS.grainSize,
		halationThreshold: DEFAULT_CLIP_EFFECTS.halationThreshold,
		halationRadius: DEFAULT_CLIP_EFFECTS.halationRadius,
		halationTintR: DEFAULT_CLIP_EFFECTS.halationTintR,
		halationTintG: DEFAULT_CLIP_EFFECTS.halationTintG,
		halationTintB: DEFAULT_CLIP_EFFECTS.halationTintB,
		vignetteAmount: DEFAULT_CLIP_EFFECTS.vignetteAmount,
		vignetteFeather: DEFAULT_CLIP_EFFECTS.vignetteFeather,
		vignetteRoundness: DEFAULT_CLIP_EFFECTS.vignetteRoundness
	};
}

export function isLookParamsNeutral(params: LookParams): boolean {
	const defaults = defaultLookParams();
	return (
		params.grainStrength === defaults.grainStrength &&
		params.grainSize === defaults.grainSize &&
		params.halationThreshold === defaults.halationThreshold &&
		params.halationRadius === defaults.halationRadius &&
		params.halationTintR === defaults.halationTintR &&
		params.halationTintG === defaults.halationTintG &&
		params.halationTintB === defaults.halationTintB &&
		params.vignetteAmount === defaults.vignetteAmount &&
		params.vignetteFeather === defaults.vignetteFeather &&
		params.vignetteRoundness === defaults.vignetteRoundness
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(obj: Record<string, unknown>, key: string): string | undefined {
	const value = obj[key];
	return typeof value === 'string' ? value : undefined;
}

function finiteNumber(obj: Record<string, unknown>, key: string): number | undefined {
	const value = obj[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampFinite(v: number | undefined, lo: number, hi: number, fallback: number): number {
	if (v === undefined || !Number.isFinite(v)) return fallback;
	return Math.max(lo, Math.min(hi, v));
}

const LOOK_PARAM_RANGES: Record<keyof LookParams, [number, number]> = {
	grainStrength: [0, 1],
	grainSize: [0.5, 4.0],
	halationThreshold: [0, 1],
	halationRadius: [0, 64],
	halationTintR: [0, 1],
	halationTintG: [0, 1],
	halationTintB: [0, 1],
	vignetteAmount: [0, 1],
	vignetteFeather: [0, 1],
	vignetteRoundness: [0, 2]
};

export function parseLookPreset(json: unknown): LookPreset | null {
	if (!isRecord(json)) return null;
	if (json.lookSchemaVersion !== 1) return null;
	const name = requiredString(json, 'name');
	if (name === undefined) return null;
	if (!isRecord(json.params)) return null;

	const defaults = defaultLookParams();
	const params: LookParams = {
		grainStrength: clampFinite(
			finiteNumber(json.params, 'grainStrength'),
			...LOOK_PARAM_RANGES.grainStrength,
			defaults.grainStrength
		),
		grainSize: clampFinite(
			finiteNumber(json.params, 'grainSize'),
			...LOOK_PARAM_RANGES.grainSize,
			defaults.grainSize
		),
		halationThreshold: clampFinite(
			finiteNumber(json.params, 'halationThreshold'),
			...LOOK_PARAM_RANGES.halationThreshold,
			defaults.halationThreshold
		),
		halationRadius: clampFinite(
			finiteNumber(json.params, 'halationRadius'),
			...LOOK_PARAM_RANGES.halationRadius,
			defaults.halationRadius
		),
		halationTintR: clampFinite(
			finiteNumber(json.params, 'halationTintR'),
			...LOOK_PARAM_RANGES.halationTintR,
			defaults.halationTintR
		),
		halationTintG: clampFinite(
			finiteNumber(json.params, 'halationTintG'),
			...LOOK_PARAM_RANGES.halationTintG,
			defaults.halationTintG
		),
		halationTintB: clampFinite(
			finiteNumber(json.params, 'halationTintB'),
			...LOOK_PARAM_RANGES.halationTintB,
			defaults.halationTintB
		),
		vignetteAmount: clampFinite(
			finiteNumber(json.params, 'vignetteAmount'),
			...LOOK_PARAM_RANGES.vignetteAmount,
			defaults.vignetteAmount
		),
		vignetteFeather: clampFinite(
			finiteNumber(json.params, 'vignetteFeather'),
			...LOOK_PARAM_RANGES.vignetteFeather,
			defaults.vignetteFeather
		),
		vignetteRoundness: clampFinite(
			finiteNumber(json.params, 'vignetteRoundness'),
			...LOOK_PARAM_RANGES.vignetteRoundness,
			defaults.vignetteRoundness
		)
	};

	const result: LookPreset = { lookSchemaVersion: 1, name, params };

	if (isRecord(json.lut)) {
		const fileName = requiredString(json.lut, 'fileName');
		const fingerprint = requiredString(json.lut, 'fingerprint');
		if (fileName !== undefined && fingerprint !== undefined) {
			result.lut = { fileName, fingerprint };
		}
	}

	return result;
}

export function serializeLookPreset(preset: LookPreset): string {
	return JSON.stringify(preset, null, 2);
}

export function applyLookPresetToClip(preset: LookPreset, clip: TimelineClip): TimelineClip {
	return {
		...clip,
		effects: {
			...clip.effects,
			...preset.params
		}
	};
}
