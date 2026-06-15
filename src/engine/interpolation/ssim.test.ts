import { describe, it, expect } from 'vite-plus/test';
import { computeSsim, computeSsimRgba } from './ssim';

describe('computeSsim', () => {
	it('returns 1.0 for identical images', () => {
		const pixels = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
		expect(computeSsim(pixels, pixels, 4, 2, 2)).toBeCloseTo(1.0, 4);
	});

	it('returns ~1.0 for nearly identical images', () => {
		const a = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
		const b = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.51, 0.51, 0.51, 0.51]);
		const ssim = computeSsim(a, b, 4, 2, 2);
		expect(ssim).toBeGreaterThan(0.95);
	});

	it('returns low value for very different images', () => {
		const a = new Float32Array(64).fill(0.0);
		const b = new Float32Array(64).fill(1.0);
		const ssim = computeSsim(a, b, 8, 8, 8);
		expect(ssim).toBeLessThan(0.1);
	});

	it('returns ~0 for uncorrelated random-like images', () => {
		// Checkerboard vs inverse checkerboard
		const size = 16;
		const a = new Float32Array(size * size);
		const b = new Float32Array(size * size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const idx = y * size + x;
				a[idx] = (x + y) % 2 === 0 ? 0.0 : 1.0;
				b[idx] = (x + y) % 2 === 0 ? 1.0 : 0.0;
			}
		}
		const ssim = computeSsim(a, b, size, size, 8);
		// Inverse checkerboard has negative SSIM (negative correlation)
		expect(ssim).toBeLessThan(0);
	});

	it('handles non-square images', () => {
		const a = new Float32Array(24).fill(0.3);
		const b = new Float32Array(24).fill(0.3);
		expect(computeSsim(a, b, 6, 4, 2)).toBeCloseTo(1.0, 4);
	});

	it('handles window size smaller than image', () => {
		const a = new Float32Array(16).fill(0.5);
		const b = new Float32Array(16).fill(0.5);
		expect(computeSsim(a, b, 4, 4, 2)).toBeCloseTo(1.0, 4);
	});

	it('throws on mismatched array lengths', () => {
		const a = new Float32Array(8);
		const b = new Float32Array(16);
		expect(() => computeSsim(a, b, 4, 2, 2)).toThrow(/array length/);
	});

	it('throws on window size < 2', () => {
		const a = new Float32Array(4);
		expect(() => computeSsim(a, a, 2, 2, 1)).toThrow(/window size/);
	});

	it('returns 1.0 when image is smaller than window', () => {
		const a = new Float32Array([0.5]);
		const b = new Float32Array([0.5]);
		// 1×1 image with window size 8 → 0 windows → returns 1.0
		expect(computeSsim(a, b, 1, 1, 8)).toBe(1.0);
	});

	it('is symmetric', () => {
		const a = new Float32Array([0.1, 0.3, 0.5, 0.7, 0.2, 0.4, 0.6, 0.8]);
		const b = new Float32Array([0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.5, 0.7]);
		expect(computeSsim(a, b, 4, 2, 2)).toBeCloseTo(computeSsim(b, a, 4, 2, 2), 6);
	});

	it('degrades with increasing noise', () => {
		const size = 16;
		const original = new Float32Array(size * size).fill(0.5);
		const ssimValues: number[] = [];

		for (const noiseLevel of [0.01, 0.05, 0.1, 0.2, 0.5]) {
			const noisy = new Float32Array(size * size);
			for (let i = 0; i < noisy.length; i++) {
				noisy[i] = Math.max(0, Math.min(1, original[i] + (Math.random() - 0.5) * noiseLevel));
			}
			ssimValues.push(computeSsim(original, noisy, size, size, 8));
		}

		// SSIM should generally decrease with more noise
		// (not strictly monotonic due to randomness, but the trend should hold)
		for (let i = 1; i < ssimValues.length; i++) {
			// Allow some tolerance for randomness
			expect(ssimValues[i]).toBeLessThan(ssimValues[i - 1] + 0.1);
		}
	});
});

describe('computeSsimRgba', () => {
	it('returns 1.0 for identical RGBA images', () => {
		const pixels = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
		expect(computeSsimRgba(pixels, pixels, 2, 1, 2)).toBeCloseTo(1.0, 4);
	});

	it('returns low value for black vs white', () => {
		const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
		const white = new Uint8ClampedArray([
			255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
		]);
		const ssim = computeSsimRgba(black, white, 2, 2, 2);
		expect(ssim).toBeLessThan(0.1);
	});

	it('throws on wrong array size', () => {
		const a = new Uint8ClampedArray(4); // 1 pixel
		const b = new Uint8ClampedArray(8); // 2 pixels
		expect(() => computeSsimRgba(a, b, 2, 1, 2)).toThrow(/4 bytes per pixel/);
	});
});
