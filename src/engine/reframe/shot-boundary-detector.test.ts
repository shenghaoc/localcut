import { describe, it, expect } from 'vite-plus/test';
import {
	computeHistogram,
	chiSquaredDistance,
	isShotBoundary,
	DEFAULT_SHOT_BOUNDARY_THRESHOLD
} from './shot-boundary-detector';

/** Create a synthetic ImageData with uniform colour. */
function makeUniformImageData(r: number, g: number, b: number, w = 16, h = 16): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = 255;
	}
	return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('computeHistogram', () => {
	it('returns a normalised histogram summing to ~1', () => {
		const img = makeUniformImageData(128, 128, 128);
		const hist = computeHistogram(img);
		expect(hist.length).toBe(512);
		const sum = hist.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 5);
	});

	it('concentrates in one bin for a uniform image', () => {
		const img = makeUniformImageData(10, 10, 10);
		const hist = computeHistogram(img);
		// (10/32=0, 10/32=0, 10/32=0) → bin 0
		expect(hist[0]).toBeCloseTo(1.0, 5);
	});
});

describe('chiSquaredDistance', () => {
	it('returns 0 for identical histograms', () => {
		const img = makeUniformImageData(100, 100, 100);
		const hist = computeHistogram(img);
		expect(chiSquaredDistance(hist, hist)).toBeCloseTo(0, 10);
	});

	it('returns a large value for completely different histograms', () => {
		const img1 = makeUniformImageData(0, 0, 0);
		const img2 = makeUniformImageData(255, 255, 255);
		const hist1 = computeHistogram(img1);
		const hist2 = computeHistogram(img2);
		const dist = chiSquaredDistance(hist1, hist2);
		expect(dist).toBeGreaterThan(1.0);
	});
});

describe('isShotBoundary', () => {
	it('returns false for identical frames', () => {
		const img = makeUniformImageData(100, 100, 100);
		const hist = computeHistogram(img);
		expect(isShotBoundary(hist, hist)).toBe(false);
	});

	it('returns true for completely different frames', () => {
		const img1 = makeUniformImageData(0, 0, 0);
		const img2 = makeUniformImageData(255, 255, 255);
		const hist1 = computeHistogram(img1);
		const hist2 = computeHistogram(img2);
		expect(isShotBoundary(hist1, hist2)).toBe(true);
	});

	it('returns false for a gradual dissolve (interpolated histograms)', () => {
		const img1 = makeUniformImageData(0, 0, 0);
		const img2 = makeUniformImageData(10, 10, 10); // Very similar
		const hist1 = computeHistogram(img1);
		const hist2 = computeHistogram(img2);
		// Small difference should not trigger
		expect(isShotBoundary(hist1, hist2, DEFAULT_SHOT_BOUNDARY_THRESHOLD)).toBe(false);
	});
});
