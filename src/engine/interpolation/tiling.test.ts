import { describe, it, expect } from 'vite-plus/test';
import {
	planTiles,
	estimateWorkingSetBytes,
	stitchRegion,
	verifyStitchCoverage,
	type ModelIoContract,
	type VramBudget
} from './tiling';

/** Default FILM-like model contract for testing. */
const filmModel: ModelIoContract = {
	inputWidth: 256,
	inputHeight: 256,
	inputChannels: 3,
	bytesPerElement: 2, // FP16
	flowOutput: true,
	maxDisplacement: 32
};

/** A generous VRAM budget (512 MB). */
const generousBudget: VramBudget = {
	maxBytes: 512 * 1024 * 1024,
	safety: 0.75
};

/** A tight VRAM budget (1 MB). */
const tightBudget: VramBudget = {
	maxBytes: 1 * 1024 * 1024,
	safety: 0.75
};

describe('planTiles', () => {
	it('returns a single tile when the frame fits in one model input', () => {
		const result = planTiles(192, 108, filmModel, generousBudget);
		if ('refuse' in result) throw new Error(`Expected TilePlan, got refuse: ${result.refuse}`);
		expect(result.tiles).toHaveLength(1);
		expect(result.tiles[0]).toMatchObject({ x: 0, y: 0, w: 192, h: 108, halo: 0 });
	});

	it('tiles a 1080p frame into a grid', () => {
		const result = planTiles(1920, 1080, filmModel, generousBudget);
		if ('refuse' in result) throw new Error(`Expected TilePlan, got refuse: ${result.refuse}`);
		expect(result.tiles.length).toBeGreaterThan(1);

		// All tiles should have halo = maxDisplacement
		for (const tile of result.tiles) {
			expect(tile.halo).toBe(filmModel.maxDisplacement);
		}
	});

	it('tiles a 4K frame into more tiles than 1080p', () => {
		const result1080 = planTiles(1920, 1080, filmModel, generousBudget);
		const result4k = planTiles(3840, 2160, filmModel, generousBudget);
		if ('refuse' in result1080 || 'refuse' in result4k) throw new Error('Expected TilePlan');
		expect(result4k.tiles.length).toBeGreaterThan(result1080.tiles.length);
	});

	it('refuses when a single tile exceeds the budget', () => {
		const result = planTiles(1920, 1080, filmModel, tightBudget);
		expect('refuse' in result).toBe(true);
		if ('refuse' in result) {
			expect(result.refuse).toContain('VRAM');
		}
	});

	it('working set stays within budget for generous budget', () => {
		const result = planTiles(1920, 1080, filmModel, generousBudget);
		if ('refuse' in result) throw new Error('Expected TilePlan');
		expect(result.workingSetBytes).toBeLessThanOrEqual(
			generousBudget.maxBytes * generousBudget.safety
		);
	});

	it('returns model input dimensions', () => {
		const result = planTiles(1920, 1080, filmModel, generousBudget);
		if ('refuse' in result) throw new Error('Expected TilePlan');
		expect(result.modelInputWidth).toBe(filmModel.inputWidth);
		expect(result.modelInputHeight).toBe(filmModel.inputHeight);
	});
});

describe('estimateWorkingSetBytes', () => {
	it('computes a positive working set', () => {
		const bytes = estimateWorkingSetBytes(256, 256, filmModel);
		expect(bytes).toBeGreaterThan(0);
	});

	it('includes flow output when model produces it', () => {
		const withFlow = estimateWorkingSetBytes(256, 256, filmModel);
		const withoutFlow = estimateWorkingSetBytes(256, 256, {
			...filmModel,
			flowOutput: false
		});
		expect(withFlow).toBeGreaterThan(withoutFlow);
	});

	it('scales with input resolution', () => {
		const small = estimateWorkingSetBytes(128, 128, filmModel);
		const large = estimateWorkingSetBytes(256, 256, filmModel);
		expect(large).toBeGreaterThan(small);
	});

	it('scales with bytesPerElement', () => {
		const fp16 = estimateWorkingSetBytes(256, 256, { ...filmModel, bytesPerElement: 2 });
		const fp32 = estimateWorkingSetBytes(256, 256, { ...filmModel, bytesPerElement: 4 });
		expect(fp32).toBe(fp16 * 2);
	});
});

describe('stitchRegion', () => {
	it('returns the tile region when tile is within frame bounds', () => {
		const tile = { x: 100, y: 100, w: 50, h: 50, halo: 10 };
		const region = stitchRegion(tile, 1920, 1080);
		expect(region).toEqual({ x: 100, y: 100, w: 50, h: 50 });
	});

	it('clamps to frame bounds at edges', () => {
		const tile = { x: 1900, y: 1060, w: 50, h: 50, halo: 10 };
		const region = stitchRegion(tile, 1920, 1080);
		expect(region.x).toBe(1900);
		expect(region.y).toBe(1060);
		expect(region.w).toBe(20); // 1920 - 1900
		expect(region.h).toBe(20); // 1080 - 1060
	});

	it('clamps negative coordinates to 0', () => {
		const tile = { x: -5, y: -5, w: 50, h: 50, halo: 10 };
		const region = stitchRegion(tile, 1920, 1080);
		expect(region.x).toBe(0);
		expect(region.y).toBe(0);
	});
});

describe('verifyStitchCoverage', () => {
	it('reports complete coverage for a single full-frame tile', () => {
		const tiles = [{ x: 0, y: 0, w: 100, h: 100, halo: 0 }];
		const result = verifyStitchCoverage(tiles, 100, 100);
		expect(result.complete).toBe(true);
		expect(result.uncoveredPixels).toBe(0);
	});

	it('reports complete coverage for a 2×2 grid', () => {
		const tiles = [
			{ x: 0, y: 0, w: 50, h: 50, halo: 0 },
			{ x: 50, y: 0, w: 50, h: 50, halo: 0 },
			{ x: 0, y: 50, w: 50, h: 50, halo: 0 },
			{ x: 50, y: 50, w: 50, h: 50, halo: 0 }
		];
		const result = verifyStitchCoverage(tiles, 100, 100);
		expect(result.complete).toBe(true);
	});

	it('detects uncovered pixels when tiles have gaps', () => {
		const tiles = [
			{ x: 0, y: 0, w: 40, h: 100, halo: 0 },
			{ x: 60, y: 0, w: 40, h: 100, halo: 0 }
		];
		const result = verifyStitchCoverage(tiles, 100, 100);
		expect(result.complete).toBe(false);
		expect(result.uncoveredPixels).toBe(20 * 100); // 20px gap × 100 height
	});

	it('handles empty tile list', () => {
		const result = verifyStitchCoverage([], 100, 100);
		expect(result.complete).toBe(false);
		expect(result.uncoveredPixels).toBe(100 * 100);
	});
});
