/** Phase 32b: Beauty params tests. */

import { describe, expect, it } from 'vite-plus/test';
import {
	normalizeBeautyEffect,
	isBeautyActive,
	effectiveStrength,
	packBeautyUniform,
	packLandmarkBuffer,
	LANDMARK_FLOATS,
	SUBTLE_PRESET,
	BEAUTY_CLAMP_RANGES
} from './beauty-params';
import { DEFAULT_BEAUTY_EFFECT } from '../../protocol';

describe('normalizeBeautyEffect', () => {
	it('returns defaults for undefined input', () => {
		const result = normalizeBeautyEffect(undefined);
		expect(result.enabled).toBe(false);
		expect(result.modelId).toBe('facemesh-onnx-primary-v1');
		expect(result.masterStrength).toBe(DEFAULT_BEAUTY_EFFECT.masterStrength);
		expect(result.jawSlim).toBe(DEFAULT_BEAUTY_EFFECT.jawSlim);
	});

	it('preserves a valid ONNX manifest model id', () => {
		const result = normalizeBeautyEffect({ modelId: 'candidate-facemesh-onnx' });
		expect(result.modelId).toBe('candidate-facemesh-onnx');
	});

	it('clamps values to valid ranges', () => {
		const result = normalizeBeautyEffect({
			masterStrength: 2.0,
			jawSlim: -0.5,
			eyeEnlarge: 1.5,
			noseWidth: 0.5,
			mouth: 0.0
		});
		expect(result.masterStrength).toBe(BEAUTY_CLAMP_RANGES.masterStrength.max);
		expect(result.jawSlim).toBe(BEAUTY_CLAMP_RANGES.jawSlim.min);
		expect(result.eyeEnlarge).toBe(BEAUTY_CLAMP_RANGES.eyeEnlarge.max);
		expect(result.noseWidth).toBe(0.5);
		expect(result.mouth).toBe(0.0);
	});

	it('handles non-finite values with defaults', () => {
		const result = normalizeBeautyEffect({
			masterStrength: NaN,
			jawSlim: Infinity,
			eyeEnlarge: -Infinity
		});
		expect(result.masterStrength).toBe(DEFAULT_BEAUTY_EFFECT.masterStrength);
		expect(result.jawSlim).toBe(DEFAULT_BEAUTY_EFFECT.jawSlim);
		expect(result.eyeEnlarge).toBe(DEFAULT_BEAUTY_EFFECT.eyeEnlarge);
	});

	it('preserves valid values', () => {
		const result = normalizeBeautyEffect({
			enabled: true,
			masterStrength: 0.7,
			jawSlim: 0.4,
			eyeEnlarge: 0.2,
			noseWidth: 0.15,
			mouth: 0.1
		});
		expect(result.enabled).toBe(true);
		expect(result.masterStrength).toBe(0.7);
		expect(result.jawSlim).toBe(0.4);
		expect(result.eyeEnlarge).toBe(0.2);
		expect(result.noseWidth).toBe(0.15);
		expect(result.mouth).toBe(0.1);
	});
});

describe('isBeautyActive', () => {
	it('returns false for undefined', () => {
		expect(isBeautyActive(undefined)).toBe(false);
	});

	it('returns false for disabled', () => {
		expect(isBeautyActive({ ...DEFAULT_BEAUTY_EFFECT, enabled: false })).toBe(false);
	});

	it('returns false when all sub-params are zero', () => {
		expect(
			isBeautyActive({
				...DEFAULT_BEAUTY_EFFECT,
				enabled: true,
				masterStrength: 0.5,
				jawSlim: 0,
				eyeEnlarge: 0,
				noseWidth: 0,
				mouth: 0
			})
		).toBe(false);
	});

	it('returns true when enabled with non-zero params', () => {
		expect(
			isBeautyActive({
				...DEFAULT_BEAUTY_EFFECT,
				enabled: true,
				masterStrength: 0.5,
				jawSlim: 0.3
			})
		).toBe(true);
	});
});

describe('effectiveStrength', () => {
	it('returns 0 when masterStrength is 0', () => {
		expect(
			effectiveStrength({
				...DEFAULT_BEAUTY_EFFECT,
				masterStrength: 0,
				jawSlim: 1
			})
		).toBe(0);
	});

	it('returns masterStrength × max sub-param', () => {
		expect(
			effectiveStrength({
				...DEFAULT_BEAUTY_EFFECT,
				masterStrength: 0.5,
				jawSlim: 0.3,
				eyeEnlarge: 0.8,
				noseWidth: 0.1,
				mouth: 0.2
			})
		).toBeCloseTo(0.5 * 0.8);
	});
});

describe('packBeautyUniform', () => {
	it('packs 16 floats', () => {
		const buf = packBeautyUniform(DEFAULT_BEAUTY_EFFECT);
		expect(buf.length).toBe(16);
		expect(buf[0]).toBeCloseTo(DEFAULT_BEAUTY_EFFECT.masterStrength);
		expect(buf[1]).toBeCloseTo(DEFAULT_BEAUTY_EFFECT.jawSlim);
		expect(buf[2]).toBeCloseTo(DEFAULT_BEAUTY_EFFECT.eyeEnlarge);
		expect(buf[3]).toBeCloseTo(DEFAULT_BEAUTY_EFFECT.noseWidth);
		expect(buf[4]).toBeCloseTo(DEFAULT_BEAUTY_EFFECT.mouth);
	});
});

describe('packLandmarkBuffer', () => {
	it('pads short buffers to LANDMARK_FLOATS', () => {
		const short = new Float32Array(100);
		short[0] = 0.5;
		const result = packLandmarkBuffer(short);
		expect(result.length).toBe(LANDMARK_FLOATS);
		expect(result[0]).toBe(0.5);
	});

	it('returns full buffers as-is', () => {
		const full = new Float32Array(LANDMARK_FLOATS);
		full[0] = 0.5;
		const result = packLandmarkBuffer(full);
		expect(result).toBe(full);
	});
});

describe('SUBTLE_PRESET', () => {
	it('has all required fields', () => {
		expect(SUBTLE_PRESET.masterStrength).toBe(0.5);
		expect(SUBTLE_PRESET.jawSlim).toBe(0.3);
		expect(SUBTLE_PRESET.eyeEnlarge).toBe(0.15);
		expect(SUBTLE_PRESET.noseWidth).toBe(0.1);
		expect(SUBTLE_PRESET.mouth).toBe(0.1);
	});
});
