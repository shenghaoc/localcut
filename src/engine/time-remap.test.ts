import { describe, expect, it } from 'vite-plus/test';
import {
	buildRemapLUT,
	identityRemap,
	REMAP_LUT_STEP_S,
	REMAP_SPEED_MAX,
	REMAP_SPEED_MIN,
	remapOutputToSource,
	type RemapKeyframe
} from './time-remap';

describe('constants', () => {
	it('REMAP_SPEED_MIN is 0.25', () => {
		expect(REMAP_SPEED_MIN).toBe(0.25);
	});

	it('REMAP_SPEED_MAX is 4.0', () => {
		expect(REMAP_SPEED_MAX).toBe(4.0);
	});

	it('REMAP_LUT_STEP_S is 1/120', () => {
		expect(REMAP_LUT_STEP_S).toBeCloseTo(1 / 120, 10);
	});
});

describe('identityRemap', () => {
	it('returns null', () => {
		expect(identityRemap()).toBeNull();
	});
});

describe('buildRemapLUT', () => {
	it('with no keyframes returns identity (1x speed, outputDurationS = sourceDurationS)', () => {
		const sourceDurationS = 10;
		const lut = buildRemapLUT([], sourceDurationS);

		expect(lut.outputDurationS).toBe(sourceDurationS);
		expect(lut.sourceDurationS).toBe(sourceDurationS);
		expect(lut.outTimesS.length).toBe(2);
		expect(lut.srcTimesS.length).toBe(2);
		expect(lut.outTimesS[0]).toBe(0);
		expect(lut.outTimesS[1]).toBe(sourceDurationS);
		expect(lut.srcTimesS[0]).toBe(0);
		expect(lut.srcTimesS[1]).toBe(sourceDurationS);
	});

	it('with zero sourceDurationS returns identity', () => {
		const lut = buildRemapLUT([], 0);

		expect(lut.outputDurationS).toBe(0);
		expect(lut.sourceDurationS).toBe(0);
	});

	it('single constant 2x ramp: outputDurationS ~ sourceDurationS / 2', () => {
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 2, easing: 'linear' },
			{ outTimeS: 100, speed: 2, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		expect(lut.outputDurationS).toBeCloseTo(sourceDurationS / 2, 1e-3);
		expect(lut.sourceDurationS).toBe(sourceDurationS);
	});

	it('0.5x ramp: outputDurationS ~ 2 * sourceDurationS', () => {
		const sourceDurationS = 5;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 0.5, easing: 'linear' },
			{ outTimeS: 100, speed: 0.5, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		expect(lut.outputDurationS).toBeCloseTo(2 * sourceDurationS, 1e-3);
	});

	it('hold easing: source time advances linearly within the hold segment', () => {
		// Speed 1 for hold segment means source advances 1:1 with output
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 1, easing: 'hold' },
			{ outTimeS: 20, speed: 1, easing: 'hold' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		// At hold speed 1, outputDurationS should equal sourceDurationS
		expect(lut.outputDurationS).toBeCloseTo(sourceDurationS, 1e-3);

		// Sample a few interior points — source time should track output time linearly
		const sampleOut = sourceDurationS * 0.3;
		const srcTime = remapOutputToSource(lut, sampleOut);
		expect(srcTime).toBeCloseTo(sampleOut, 1e-3);
	});

	it('hold easing at 2x speed: source advances twice as fast as output', () => {
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 2, easing: 'hold' },
			{ outTimeS: 20, speed: 2, easing: 'hold' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		// 2x hold: outputDurationS ~ sourceDurationS / 2
		expect(lut.outputDurationS).toBeCloseTo(5, 1e-3);

		// At output 2.5s, source should be ~5s
		const srcTime = remapOutputToSource(lut, 2.5);
		expect(srcTime).toBeCloseTo(5, 1e-3);
	});

	it('LUT arrays are Float64Array', () => {
		const lut = buildRemapLUT([], 5);
		expect(lut.outTimesS).toBeInstanceOf(Float64Array);
		expect(lut.srcTimesS).toBeInstanceOf(Float64Array);
	});

	it('LUT arrays are same length', () => {
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 1.5, easing: 'linear' },
			{ outTimeS: 50, speed: 0.5, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, 10);
		expect(lut.outTimesS.length).toBe(lut.srcTimesS.length);
	});

	it('LUT srcTimesS starts at 0 and ends at sourceDurationS', () => {
		const sourceDurationS = 7.5;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 1.5, easing: 'linear' },
			{ outTimeS: 50, speed: 1.5, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);
		expect(lut.srcTimesS[0]).toBe(0);
		expect(lut.srcTimesS[lut.srcTimesS.length - 1]).toBeCloseTo(sourceDurationS, 1e-9);
	});
});

describe('remapOutputToSource', () => {
	it('on identity LUT returns outTimeS unchanged', () => {
		const lut = buildRemapLUT([], 10);
		for (const t of [0, 1, 3.5, 7, 10]) {
			expect(remapOutputToSource(lut, t)).toBeCloseTo(t, 1e-9);
		}
	});

	it('at outTimeS = 0 returns 0', () => {
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 2, easing: 'linear' },
			{ outTimeS: 100, speed: 2, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, 10);
		expect(remapOutputToSource(lut, 0)).toBe(0);
	});

	it('at outTimeS = outputDurationS returns sourceDurationS', () => {
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 2, easing: 'linear' },
			{ outTimeS: 100, speed: 2, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);
		expect(remapOutputToSource(lut, lut.outputDurationS)).toBeCloseTo(sourceDurationS, 1e-9);
	});

	it('monotone: increasing outTimeS produces increasing srcTimeS', () => {
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 1.5, easing: 'linear' },
			{ outTimeS: 30, speed: 0.5, easing: 'ease' },
			{ outTimeS: 60, speed: 2, easing: 'linear' }
		];
		const sourceDurationS = 10;
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		// Generate a random-ish increasing sequence of output times
		const steps = 50;
		const outTimes: number[] = [];
		for (let i = 0; i <= steps; i++) {
			outTimes.push((i / steps) * lut.outputDurationS);
		}

		const srcTimes = outTimes.map((t) => remapOutputToSource(lut, t));

		for (let i = 1; i < srcTimes.length; i++) {
			expect(srcTimes[i]!).toBeGreaterThanOrEqual(srcTimes[i - 1]! - 1e-9);
		}
	});

	it('clamping: outTimeS > outputDurationS returns sourceDurationS', () => {
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 1, easing: 'linear' },
			{ outTimeS: 100, speed: 1, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		expect(remapOutputToSource(lut, lut.outputDurationS + 100)).toBeCloseTo(sourceDurationS, 1e-9);
		expect(remapOutputToSource(lut, 9999)).toBeCloseTo(sourceDurationS, 1e-9);
	});

	it('clamping: outTimeS < 0 returns 0', () => {
		const lut = buildRemapLUT([], 10);
		expect(remapOutputToSource(lut, -5)).toBe(0);
	});

	it('2x speed: halfway through output corresponds to full source', () => {
		const sourceDurationS = 10;
		const keyframes: RemapKeyframe[] = [
			{ outTimeS: 0, speed: 2, easing: 'linear' },
			{ outTimeS: 100, speed: 2, easing: 'linear' }
		];
		const lut = buildRemapLUT(keyframes, sourceDurationS);

		// At half the output duration, we should have consumed all source
		const midOut = lut.outputDurationS / 2;
		expect(remapOutputToSource(lut, midOut)).toBeCloseTo(sourceDurationS / 2, 1e-2);
	});
});
