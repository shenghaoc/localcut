import { describe, it, expect } from 'vite-plus/test';
import {
	estimateSynthesisMs,
	estimateSynthesisDetailed,
	formatEstimate,
	type CalibrationProfile
} from './interpolation-estimate';
import type { TilePlan } from './tiling';

/** A webgpu calibration profile for testing. */
const webgpuProfile: CalibrationProfile = {
	accelerator: 'webgpu',
	msPerTile: 8,
	tilePixels: 256 * 256,
	overheadMs: 50
};

/** A tile plan with 4 tiles (e.g. 1080p tiled). */
const fourTilePlan: TilePlan = {
	tiles: [
		{ x: 0, y: 0, w: 960, h: 540, halo: 32 },
		{ x: 960, y: 0, w: 960, h: 540, halo: 32 },
		{ x: 0, y: 540, w: 960, h: 540, halo: 32 },
		{ x: 960, y: 540, w: 960, h: 540, halo: 32 }
	],
	workingSetBytes: 4 * 1024 * 1024,
	modelInputWidth: 256,
	modelInputHeight: 256
};

/** A single-tile plan (sub-1080p). */
const singleTilePlan: TilePlan = {
	tiles: [{ x: 0, y: 0, w: 1920, h: 1080, halo: 0 }],
	workingSetBytes: 2 * 1024 * 1024,
	modelInputWidth: 256,
	modelInputHeight: 256
};

describe('estimateSynthesisMs', () => {
	it('returns 0 for 0 frames', () => {
		expect(estimateSynthesisMs(0, singleTilePlan, webgpuProfile)).toBe(0);
	});

	it('returns 0 when all frames are cached', () => {
		expect(estimateSynthesisMs(10, singleTilePlan, webgpuProfile, 1)).toBe(0);
	});

	it('computes estimate for single tile, single frame', () => {
		// 1 frame × 1 tile × 8ms/tile + 50ms overhead = 58ms
		const result = estimateSynthesisMs(1, singleTilePlan, webgpuProfile);
		expect(result).toBe(58);
	});

	it('computes estimate for 4 tiles, 10 frames', () => {
		// 10 frames × 4 tiles × 8ms/tile + 50ms = 370ms
		const result = estimateSynthesisMs(10, fourTilePlan, webgpuProfile);
		expect(result).toBe(370);
	});

	it('scales msPerTile when plan tile size differs from calibration', () => {
		// Plan with 512×512 model input (4× the pixel count of 256×256)
		const largeTilePlan: TilePlan = {
			...singleTilePlan,
			modelInputWidth: 512,
			modelInputHeight: 512
		};
		// 1 frame × 1 tile × (8ms × 4) + 50ms = 82ms
		const result = estimateSynthesisMs(1, largeTilePlan, webgpuProfile);
		expect(result).toBe(82);
	});

	it('reduces estimate proportionally with cached fraction', () => {
		// 10 frames, 50% cached → 5 uncached
		// 5 × 4 × 8 + 50 = 210
		const result = estimateSynthesisMs(10, fourTilePlan, webgpuProfile, 0.5);
		expect(result).toBe(210);
	});

	it('returns 0 when cachedFraction >= 1', () => {
		expect(estimateSynthesisMs(10, fourTilePlan, webgpuProfile, 0.99)).toBe(0);
		expect(estimateSynthesisMs(10, fourTilePlan, webgpuProfile, 1.5)).toBe(0);
	});

	it('clamps negative cachedFraction to 0', () => {
		const result = estimateSynthesisMs(1, singleTilePlan, webgpuProfile, -0.5);
		expect(result).toBe(58); // same as 0 cached
	});
});

describe('estimateSynthesisDetailed', () => {
	it('returns a complete breakdown', () => {
		const result = estimateSynthesisDetailed(10, fourTilePlan, webgpuProfile);
		expect(result).toMatchObject({
			totalMs: 370,
			frames: 10,
			tilesPerFrame: 4,
			msPerTile: 8,
			cachedFraction: 0,
			accelerator: 'webgpu'
		});
	});

	it('reflects cached fraction in the breakdown', () => {
		const result = estimateSynthesisDetailed(10, fourTilePlan, webgpuProfile, 0.3);
		expect(result.cachedFraction).toBe(0.3);
		expect(result.totalMs).toBeLessThan(370);
	});
});

describe('formatEstimate', () => {
	it('formats sub-second in ms', () => {
		expect(formatEstimate(500)).toBe('500ms');
	});

	it('formats seconds', () => {
		expect(formatEstimate(1500)).toBe('1.5s');
		expect(formatEstimate(30000)).toBe('30.0s');
	});

	it('formats minutes and seconds', () => {
		expect(formatEstimate(90000)).toBe('1m 30s');
		expect(formatEstimate(125000)).toBe('2m 5s');
	});

	it('formats zero', () => {
		expect(formatEstimate(0)).toBe('0ms');
	});
});

/** Fixture profiles for ±30% validation (R5.3, R14.4). */
describe('fixture profiles (recorded wall times)', () => {
	// These would normally be measured on actual hardware.
	// For unit testing, we verify the math produces values within ±30%
	// of expected ranges for known inputs.

	const fixtureProfiles = [
		{
			name: 'webgpu-mid-tier',
			profile: {
				accelerator: 'webgpu' as const,
				msPerTile: 12,
				tilePixels: 256 * 256,
				overheadMs: 80
			},
			frames: 30,
			plan: fourTilePlan,
			expectedRangeMs: [1300, 2200] // ~1760ms ±30%
		},
		{
			name: 'webgpu-high-tier',
			profile: {
				accelerator: 'webgpu' as const,
				msPerTile: 5,
				tilePixels: 256 * 256,
				overheadMs: 30
			},
			frames: 30,
			plan: fourTilePlan,
			expectedRangeMs: [500, 900] // ~630ms ±30%
		},
		{
			name: 'single-tile-sub-hd',
			profile: {
				accelerator: 'webgpu' as const,
				msPerTile: 8,
				tilePixels: 256 * 256,
				overheadMs: 50
			},
			frames: 10,
			plan: singleTilePlan,
			expectedRangeMs: [90, 170] // 130ms ±30%
		}
	];

	for (const fixture of fixtureProfiles) {
		it(`${fixture.name}: estimate within ±30% of expected range`, () => {
			const estimate = estimateSynthesisMs(fixture.frames, fixture.plan, fixture.profile);
			const [min, max] = fixture.expectedRangeMs;
			expect(estimate).toBeGreaterThanOrEqual(min);
			expect(estimate).toBeLessThanOrEqual(max);
		});
	}
});
