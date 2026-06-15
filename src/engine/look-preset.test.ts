import { describe, it, expect } from 'vite-plus/test';
import {
	parseLookPreset,
	serializeLookPreset,
	applyLookPresetToClip,
	isLookParamsNeutral,
	defaultLookParams,
	type LookPreset
} from './look-preset';
import { DEFAULT_CLIP_EFFECTS } from './effects';
import type { TimelineClip } from './timeline';

const validPreset: LookPreset = {
	lookSchemaVersion: 1,
	name: 'Test Look',
	params: {
		grainStrength: 0.5,
		grainSize: 2.0,
		halationThreshold: 0.8,
		halationRadius: 10,
		halationTintR: 1.0,
		halationTintG: 0.5,
		halationTintB: 0.2,
		vignetteAmount: 0.3,
		vignetteFeather: 0.6,
		vignetteRoundness: 1.2
	}
};

function makeClip(overrides?: Partial<TimelineClip>): TimelineClip {
	return {
		id: 'clip-1',
		sourceId: 'source-1',
		start: 0,
		duration: 5,
		inPoint: 0,
		effects: { ...DEFAULT_CLIP_EFFECTS },
		transform: {
			x: 0,
			y: 0,
			scale: 1,
			rotation: 0,
			opacity: 1,
			anchorX: 0.5,
			anchorY: 0.5,
			fit: 'fill'
		},
		audioFadeIn: 0,
		audioFadeOut: 0,
		...overrides
	};
}

describe('look-preset', () => {
	describe('parseLookPreset', () => {
		it('returns a valid LookPreset for a well-formed JSON object', () => {
			const result = parseLookPreset(validPreset);
			expect(result).not.toBeNull();
			expect(result!.lookSchemaVersion).toBe(1);
			expect(result!.name).toBe('Test Look');
			expect(result!.params.grainStrength).toBe(0.5);
		});

		it('returns null when lookSchemaVersion is missing', () => {
			expect(parseLookPreset({ name: 'test', params: validPreset.params })).toBeNull();
		});

		it('returns null when params is absent', () => {
			expect(parseLookPreset({ lookSchemaVersion: 1, name: 'test' })).toBeNull();
		});

		it('returns null when any param is non-finite', () => {
			const bad = {
				...validPreset,
				params: { ...validPreset.params, grainStrength: Number.NaN }
			};
			expect(parseLookPreset(bad)).toBeNull();
		});

		it('clamps out-of-range values after a valid parse', () => {
			const overRange = {
				...validPreset,
				params: { ...validPreset.params, grainStrength: 5.0, vignetteRoundness: -1 }
			};
			const result = parseLookPreset(overRange);
			expect(result).not.toBeNull();
			expect(result!.params.grainStrength).toBe(1);
			expect(result!.params.vignetteRoundness).toBe(0);
		});
	});

	describe('serializeLookPreset', () => {
		it('produces JSON that parseLookPreset round-trips', () => {
			const json = serializeLookPreset(validPreset);
			const parsed = parseLookPreset(JSON.parse(json));
			expect(parsed).not.toBeNull();
			expect(parsed!.name).toBe(validPreset.name);
			expect(parsed!.params).toEqual(validPreset.params);
		});
	});

	describe('applyLookPresetToClip', () => {
		it('merges params without mutating the input clip', () => {
			const clip = makeClip();
			const result = applyLookPresetToClip(validPreset, clip);
			expect(result.effects.grainStrength).toBe(0.5);
			expect(result.effects.grainSize).toBe(2.0);
			expect(clip.effects.grainStrength).toBe(0);
		});
	});

	describe('isLookParamsNeutral', () => {
		it('returns true for defaults', () => {
			expect(isLookParamsNeutral(defaultLookParams())).toBe(true);
		});

		it('returns false when any param is non-default', () => {
			const params = defaultLookParams();
			params.grainStrength = 0.1;
			expect(isLookParamsNeutral(params)).toBe(false);
		});
	});
});
