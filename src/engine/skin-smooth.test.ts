import { describe, it, expect } from 'vite-plus/test';
import {
	SKIN_SMOOTH_EPSILON,
	LUMA_BT709,
	DEFAULT_SKIN_MASK,
	normalizeSkinMask,
	radiusForHeight,
	skinMaskWeight,
	referenceGuidedFilterLuma,
	referenceSkinSmooth,
	packSkinBoxUniform,
	packSkinApplyUniform,
	isSkinSmoothActive
} from './skin-smooth';

describe('skinMaskWeight', () => {
	it('returns >= 0.9 for light skin', () => {
		const m = skinMaskWeight([0.96, 0.76, 0.65], DEFAULT_SKIN_MASK);
		expect(m).toBeGreaterThanOrEqual(0.9);
	});

	it('returns >= 0.9 for deep skin', () => {
		const m = skinMaskWeight([0.45, 0.27, 0.2], DEFAULT_SKIN_MASK);
		expect(m).toBeGreaterThanOrEqual(0.9);
	});

	it('returns 0 for white', () => {
		expect(skinMaskWeight([1, 1, 1], DEFAULT_SKIN_MASK)).toBe(0);
	});

	it('returns 0 for black', () => {
		expect(skinMaskWeight([0, 0, 0], DEFAULT_SKIN_MASK)).toBe(0);
	});

	it('returns 0 for mid grey', () => {
		expect(skinMaskWeight([0.5, 0.5, 0.5], DEFAULT_SKIN_MASK)).toBe(0);
	});

	it('returns 0 for foliage green', () => {
		expect(skinMaskWeight([0.13, 0.55, 0.13], DEFAULT_SKIN_MASK)).toBe(0);
	});

	it('returns 0 for fabric blue', () => {
		expect(skinMaskWeight([0.2, 0.3, 0.8], DEFAULT_SKIN_MASK)).toBe(0);
	});

	it('returns 0 for saturated red', () => {
		expect(skinMaskWeight([1, 0, 0], DEFAULT_SKIN_MASK)).toBe(0);
	});
});

describe('normalizeSkinMask', () => {
	it('returns defaults for undefined', () => {
		expect(normalizeSkinMask(undefined)).toEqual(DEFAULT_SKIN_MASK);
	});

	it('clamps out-of-range cb/cr bounds', () => {
		const result = normalizeSkinMask({ cbMin: -1, cbMax: 1, crMin: -1, crMax: 1, softness: 0.04 });
		expect(result.cbMin).toBe(-0.5);
		expect(result.cbMax).toBe(0.5);
		expect(result.crMin).toBe(-0.5);
		expect(result.crMax).toBe(0.5);
	});

	it('swaps min/max when inverted', () => {
		const result = normalizeSkinMask({
			cbMin: 0.1,
			cbMax: -0.1,
			crMin: 0.3,
			crMax: 0.1,
			softness: 0.04
		});
		expect(result.cbMin).toBeLessThanOrEqual(result.cbMax);
		expect(result.crMin).toBeLessThanOrEqual(result.crMax);
	});

	it('clamps softness to valid range', () => {
		expect(normalizeSkinMask({ softness: 0.001 }).softness).toBe(0.005);
		expect(normalizeSkinMask({ softness: 0.5 }).softness).toBe(0.15);
	});

	it('falls back non-finite values to default', () => {
		const result = normalizeSkinMask({
			cbMin: NaN,
			cbMax: Infinity,
			crMin: -Infinity,
			crMax: NaN,
			softness: NaN
		});
		expect(result.cbMin).toBe(DEFAULT_SKIN_MASK.cbMin);
		expect(result.cbMax).toBe(DEFAULT_SKIN_MASK.cbMax);
		expect(result.crMin).toBe(DEFAULT_SKIN_MASK.crMin);
		expect(result.crMax).toBe(DEFAULT_SKIN_MASK.crMax);
		expect(result.softness).toBe(DEFAULT_SKIN_MASK.softness);
	});
});

describe('radiusForHeight', () => {
	it('returns 4 at h=540', () => {
		expect(radiusForHeight(540)).toBe(4);
	});

	it('returns 8 at h=1080', () => {
		expect(radiusForHeight(1080)).toBe(8);
	});

	it('returns 16 at h=2160', () => {
		expect(radiusForHeight(2160)).toBe(16);
	});

	it('returns 2 at h=0 (lower clamp)', () => {
		expect(radiusForHeight(0)).toBe(2);
	});

	it('returns 24 at h=3600 (upper clamp)', () => {
		expect(radiusForHeight(3600)).toBe(24);
	});
});

describe('referenceGuidedFilterLuma', () => {
	it('constant image is unchanged (max error <= 1e-6)', () => {
		const w = 16,
			h = 16;
		const luma = new Float32Array(w * h).fill(0.5);
		const result = referenceGuidedFilterLuma(luma, w, h, 4, SKIN_SMOOTH_EPSILON);
		for (let i = 0; i < result.length; i++) {
			expect(Math.abs(result[i]! - 0.5)).toBeLessThanOrEqual(1e-6);
		}
	});

	it('noise reduction: output variance <= 0.35x input variance', () => {
		const w = 32,
			h = 32;
		const luma = new Float32Array(w * h);
		for (let i = 0; i < luma.length; i++) {
			luma[i] = 0.5 + (Math.random() - 0.5) * 0.1; // ±0.05
		}
		const inputVar = variance(luma);
		const result = referenceGuidedFilterLuma(luma, w, h, 4, SKIN_SMOOTH_EPSILON);
		const outputVar = variance(result);
		expect(outputVar).toBeLessThanOrEqual(inputVar * 0.35);
	});

	it('no overshoot: monotone ramp stays within input range', () => {
		const w = 16,
			h = 16;
		const luma = new Float32Array(w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				luma[y * w + x] = 0.1 + (x / (w - 1)) * 0.8;
			}
		}
		const result = referenceGuidedFilterLuma(luma, w, h, 4, SKIN_SMOOTH_EPSILON);
		const minIn = Math.min(...luma);
		const maxIn = Math.max(...luma);
		for (let i = 0; i < result.length; i++) {
			expect(result[i]!).toBeGreaterThanOrEqual(minIn - 1e-6);
			expect(result[i]!).toBeLessThanOrEqual(maxIn + 1e-6);
		}
	});
});

describe('referenceSkinSmooth', () => {
	it('strength 0 returns bit-identical copy', () => {
		const w = 8,
			h = 8;
		const rgba = new Float32Array(w * h * 4);
		for (let i = 0; i < rgba.length; i++) rgba[i] = Math.random();
		const result = referenceSkinSmooth(rgba, w, h, 0);
		expect(result).toEqual(rgba);
		expect(result).not.toBe(rgba); // different array
	});

	it('golden non-skin invariance: non-skin quadrants unchanged, skin quadrant smoothed', () => {
		const w = 64,
			h = 64;
		const rgba = new Float32Array(w * h * 4);

		// Helper to convert gamma-encoded to linear (inverse sRGB OETF)
		function srgbToLinear(g: number): number {
			return g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
		}

		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const idx = (y * w + x) * 4;
				const qx = x < 32 ? 0 : 1;
				const qy = y < 32 ? 0 : 1;
				const quadrant = qy * 2 + qx;

				let rG: number, gG: number, bG: number;
				if (quadrant === 0) {
					// Q0: noisy skin tone
					rG = 0.96 + (Math.random() - 0.5) * 0.06;
					gG = 0.76 + (Math.random() - 0.5) * 0.06;
					bG = 0.65 + (Math.random() - 0.5) * 0.06;
				} else if (quadrant === 1) {
					// Q1: black-on-white text
					rG = (x + y) % 2 === 0 ? 0 : 1;
					gG = rG;
					bG = rG;
				} else if (quadrant === 2) {
					// Q2: foliage green checker
					const green = (x + y) % 2 === 0;
					rG = green ? 0.13 : 0.2;
					gG = green ? 0.55 : 0.6;
					bG = green ? 0.13 : 0.2;
				} else {
					// Q3: fabric blue weave
					const blue = (x + y) % 2 === 0;
					rG = blue ? 0.2 : 0.15;
					gG = blue ? 0.3 : 0.25;
					bG = blue ? 0.8 : 0.75;
				}

				// Convert gamma to linear
				rgba[idx] = srgbToLinear(Math.max(0, Math.min(1, rG)));
				rgba[idx + 1] = srgbToLinear(Math.max(0, Math.min(1, gG)));
				rgba[idx + 2] = srgbToLinear(Math.max(0, Math.min(1, bG)));
				rgba[idx + 3] = 1;
			}
		}

		const result = referenceSkinSmooth(rgba, w, h, 0.5);

		// Q1, Q2, Q3: bit-identical (mask weight = 0)
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const qx = x < 32 ? 0 : 1;
				const qy = y < 32 ? 0 : 1;
				const quadrant = qy * 2 + qx;
				if (quadrant !== 0) {
					const idx = (y * w + x) * 4;
					for (let c = 0; c < 4; c++) {
						expect(result[idx + c]).toBe(rgba[idx + c]);
					}
				}
			}
		}

		// Q0: luma variance should drop >= 50%
		const q0InputLuma: number[] = [];
		const q0OutputLuma: number[] = [];
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				const idx = (y * w + x) * 4;
				q0InputLuma.push(
					rgba[idx]! * LUMA_BT709[0] +
						rgba[idx + 1]! * LUMA_BT709[1] +
						rgba[idx + 2]! * LUMA_BT709[2]
				);
				q0OutputLuma.push(
					result[idx]! * LUMA_BT709[0] +
						result[idx + 1]! * LUMA_BT709[1] +
						result[idx + 2]! * LUMA_BT709[2]
				);
			}
		}
		const inputVar = variance(new Float32Array(q0InputLuma));
		const outputVar = variance(new Float32Array(q0OutputLuma));
		expect(outputVar).toBeLessThanOrEqual(inputVar * 0.5);
	});
});

describe('isSkinSmoothActive', () => {
	it('returns false at strength 0', () => {
		expect(isSkinSmoothActive({ skinSmoothStrength: 0 })).toBe(false);
	});

	it('returns true at strength 0.5', () => {
		expect(isSkinSmoothActive({ skinSmoothStrength: 0.5 })).toBe(true);
	});
});

describe('packSkinBoxUniform', () => {
	it('packs horizontal correctly', () => {
		const result = packSkinBoxUniform(8, true);
		expect(Array.from(result)).toEqual([8, 1, 0, 0]);
	});

	it('packs vertical correctly', () => {
		const result = packSkinBoxUniform(4, false);
		expect(Array.from(result)).toEqual([4, 0, 1, 0]);
	});
});

describe('packSkinApplyUniform', () => {
	it('encodes all eight fields at correct offsets', () => {
		const result = packSkinApplyUniform(0.7, DEFAULT_SKIN_MASK);
		expect(result.length).toBe(8);
		const view = new DataView(result.buffer);
		expect(view.getFloat32(0, true)).toBeCloseTo(0.7, 5);
		expect(view.getFloat32(4, true)).toBeCloseTo(DEFAULT_SKIN_MASK.cbMin, 5);
		expect(view.getFloat32(8, true)).toBeCloseTo(DEFAULT_SKIN_MASK.cbMax, 5);
		expect(view.getFloat32(12, true)).toBeCloseTo(DEFAULT_SKIN_MASK.crMin, 5);
		expect(view.getFloat32(16, true)).toBeCloseTo(DEFAULT_SKIN_MASK.crMax, 5);
		expect(view.getFloat32(20, true)).toBeCloseTo(DEFAULT_SKIN_MASK.softness, 5);
		expect(view.getFloat32(24, true)).toBe(0);
		expect(view.getFloat32(28, true)).toBe(0);
	});
});

describe('WGSL/TS constant sync', () => {
	it('prepare shader contains LUMA_BT709 constants', async () => {
		const source = await import('./shaders/skin-smooth-prepare.wgsl?raw').then((m) => m.default);
		expect(source).toContain('0.2126');
		expect(source).toContain('0.7152');
		expect(source).toContain('0.0722');
	});

	it('coeffs shader contains epsilon constant', async () => {
		const source = await import('./shaders/skin-smooth-coeffs.wgsl?raw').then((m) => m.default);
		expect(source).toContain('0.01');
	});

	it('apply shader contains all constants', async () => {
		const source = await import('./shaders/skin-smooth-apply.wgsl?raw').then((m) => m.default);
		expect(source).toContain('0.2126');
		expect(source).toContain('0.7152');
		expect(source).toContain('0.0722');
		expect(source).toContain('0.299');
		expect(source).toContain('0.587');
		expect(source).toContain('0.114');
		expect(source).toContain('0.564');
		expect(source).toContain('0.713');
	});
});

// Helper: compute variance of a Float32Array
function variance(arr: Float32Array): number {
	let sum = 0;
	let sumSq = 0;
	for (let i = 0; i < arr.length; i++) {
		sum += arr[i]!;
		sumSq += arr[i]! * arr[i]!;
	}
	const mean = sum / arr.length;
	return sumSq / arr.length - mean * mean;
}
