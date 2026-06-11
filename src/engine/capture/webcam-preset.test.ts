import { describe, expect, it } from 'vitest';
import {
	deriveWebcamTransform,
	type WebcamPipCorner,
	type WebcamPipSize
} from './webcam-preset';

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SOURCE_W = 1280;
const SOURCE_H = 720;

describe('deriveWebcamTransform', () => {
	it('all 12 corner × size combinations fit within canvas bounds', () => {
		const corners: WebcamPipCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
		const sizes: WebcamPipSize[] = ['S', 'M', 'L'];

		for (const corner of corners) {
			for (const size of sizes) {
				const t = deriveWebcamTransform(
					{ corner, size, marginPx: 16 },
					CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
				);
				expect(t.x, `${corner}/${size} x`).toBeGreaterThanOrEqual(0);
				expect(t.y, `${corner}/${size} y`).toBeGreaterThanOrEqual(0);
				expect(t.x + t.width, `${corner}/${size} right edge`).toBeLessThanOrEqual(1);
				expect(t.y + t.height, `${corner}/${size} bottom edge`).toBeLessThanOrEqual(1);
			}
		}
	});

	it('size percentages: S=0.20, M=0.30, L=0.40 of canvas width', () => {
		const sizeMap: [WebcamPipSize, number][] = [['S', 0.2], ['M', 0.3], ['L', 0.4]];
		for (const [size, expectedWidth] of sizeMap) {
			const t = deriveWebcamTransform(
				{ corner: 'top-left', size, marginPx: 0 },
				CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
			);
			expect(t.width, `size ${size}`).toBeCloseTo(expectedWidth, 3);
		}
	});

	it('aspect ratio preserved: height/width ≈ sourceH/sourceW', () => {
		const t = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 0 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		const expectedRatio = SOURCE_H / SOURCE_W; // 720/1280 = 0.5625
		expect(t.height / t.width).toBeCloseTo(expectedRatio, 3);
	});

	it('margin clamping: -4 clamps to 0', () => {
		const clamped = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: -4 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		const zero = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 0 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		expect(clamped.x).toBe(zero.x);
		expect(clamped.y).toBe(zero.y);
	});

	it('margin clamping: 100 clamps to 64', () => {
		const clamped = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 100 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		const max = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 64 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		expect(clamped.x).toBe(max.x);
		expect(clamped.y).toBe(max.y);
	});

	it('non-square canvas margin uniformity — 16px on all sides', () => {
		// Portrait canvas: 1080 × 1920
		const t = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 16 },
			1080, 1920, SOURCE_W, SOURCE_H
		);
		// x should be marginX = 16/1080 ≈ 0.01481
		expect(t.x).toBeCloseTo(16 / 1080, 5);
		// y should be marginY = 16/1920 ≈ 0.00833
		expect(t.y).toBeCloseTo(16 / 1920, 5);
	});

	it('bottom-right places clip at bottom-right corner', () => {
		const t = deriveWebcamTransform(
			{ corner: 'bottom-right', size: 'M', marginPx: 0 },
			CANVAS_W, CANVAS_H, SOURCE_W, SOURCE_H
		);
		// With 0 margin, bottom-right = (1 - width, 1 - height)
		expect(t.x).toBeCloseTo(1 - 0.3, 5);
		expect(t.y).toBeCloseTo(1 - 0.3 * (SOURCE_H / SOURCE_W), 5);
	});
});
