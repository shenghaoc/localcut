import { describe, it, expect } from 'vite-plus/test';
import { createSaliencyEstimator } from './saliency-estimator';

/** Create a synthetic ImageData with a skin-coloured blob in a specific quadrant. */
function makeSkinBlobImageData(blobQuadrant: 'tl' | 'tr' | 'bl' | 'br', w = 64, h = 64): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	// Skin tone in RGB: approximately R=200, G=150, B=120
	const skinR = 200,
		skinG = 150,
		skinB = 120;
	const bgR = 50,
		bgG = 50,
		bgB = 50;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = (y * w + x) * 4;
			let isBlob = false;
			switch (blobQuadrant) {
				case 'tl':
					isBlob = x < w / 2 && y < h / 2;
					break;
				case 'tr':
					isBlob = x >= w / 2 && y < h / 2;
					break;
				case 'bl':
					isBlob = x < w / 2 && y >= h / 2;
					break;
				case 'br':
					isBlob = x >= w / 2 && y >= h / 2;
					break;
			}
			if (isBlob) {
				data[idx] = skinR;
				data[idx + 1] = skinG;
				data[idx + 2] = skinB;
			} else {
				data[idx] = bgR;
				data[idx + 1] = bgG;
				data[idx + 2] = bgB;
			}
			data[idx + 3] = 255;
		}
	}
	return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

/** Create a uniform ImageData. */
function makeUniformImageData(r: number, g: number, b: number, w = 64, h = 64): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = 255;
	}
	return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('SaliencyEstimator', () => {
	it('returns centroid in the correct quadrant for a skin blob', () => {
		const estimator = createSaliencyEstimator();

		const cases: Array<{
			quadrant: 'tl' | 'tr' | 'bl' | 'br';
			expectedX: '<' | '>';
			expectedY: '<' | '>';
		}> = [
			{ quadrant: 'tl', expectedX: '<', expectedY: '<' },
			{ quadrant: 'tr', expectedX: '>', expectedY: '<' },
			{ quadrant: 'bl', expectedX: '<', expectedY: '>' },
			{ quadrant: 'br', expectedX: '>', expectedY: '>' }
		];

		for (const { quadrant, expectedX, expectedY } of cases) {
			const img = makeSkinBlobImageData(quadrant);
			const result = estimator.estimate(img);
			if (expectedX === '<') {
				expect(result.centroidX).toBeLessThan(0.5);
			} else {
				expect(result.centroidX).toBeGreaterThan(0.5);
			}
			if (expectedY === '<') {
				expect(result.centroidY).toBeLessThan(0.5);
			} else {
				expect(result.centroidY).toBeGreaterThan(0.5);
			}
		}
	});

	it('returns low confidence for a uniform frame', () => {
		const estimator = createSaliencyEstimator();
		const img = makeUniformImageData(128, 128, 128);
		const result = estimator.estimate(img);
		expect(result.confidence).toBeLessThan(0.5);
	});

	it('returns valid normalised coordinates', () => {
		const estimator = createSaliencyEstimator();
		const img = makeSkinBlobImageData('br');
		const result = estimator.estimate(img);
		expect(result.centroidX).toBeGreaterThanOrEqual(0);
		expect(result.centroidX).toBeLessThanOrEqual(1);
		expect(result.centroidY).toBeGreaterThanOrEqual(0);
		expect(result.centroidY).toBeLessThanOrEqual(1);
	});

	it('never reports confidence above 1 (regression for the unclamped ratio)', () => {
		const estimator = createSaliencyEstimator();
		// A strong, isolated skin blob is exactly the case the old formula
		// over-counted past 1.0.
		for (const quadrant of ['tl', 'tr', 'bl', 'br'] as const) {
			const result = estimator.estimate(makeSkinBlobImageData(quadrant));
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		}
	});
});
