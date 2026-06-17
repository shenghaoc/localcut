import { describe, expect, it } from 'vite-plus/test';
import { deriveWebcamTransform, type WebcamPipCorner, type WebcamPipSize } from './webcam-preset';
import { computeFitRect } from '../transform';

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
					CANVAS_W,
					CANVAS_H,
					SOURCE_W,
					SOURCE_H
				);
				const fitRect = computeFitRect(SOURCE_W, SOURCE_H, CANVAS_W, CANVAS_H, 'fit');
				const halfW = (fitRect.width * t.scale) / 2;
				const halfH = (fitRect.height * t.scale) / 2;
				const cx = 0.5 + t.x;
				const cy = 0.5 + t.y;
				expect(cx - halfW, `${corner}/${size} left`).toBeGreaterThanOrEqual(0);
				expect(cy - halfH, `${corner}/${size} top`).toBeGreaterThanOrEqual(0);
				expect(cx + halfW, `${corner}/${size} right`).toBeLessThanOrEqual(1);
				expect(cy + halfH, `${corner}/${size} bottom`).toBeLessThanOrEqual(1);
			}
		}
	});

	it('size percentages: S=0.20, M=0.30, L=0.40 of canvas width', () => {
		const sizeMap: [WebcamPipSize, number][] = [
			['S', 0.2],
			['M', 0.3],
			['L', 0.4]
		];
		for (const [size, expectedWidth] of sizeMap) {
			const t = deriveWebcamTransform(
				{ corner: 'top-left', size, marginPx: 0 },
				CANVAS_W,
				CANVAS_H,
				SOURCE_W,
				SOURCE_H
			);
			const fitRect = computeFitRect(SOURCE_W, SOURCE_H, CANVAS_W, CANVAS_H, 'fit');
			const actualWidth = fitRect.width * t.scale;
			expect(actualWidth, `size ${size}`).toBeCloseTo(expectedWidth, 3);
		}
	});

	it('aspect ratio preserved: pixel height/width ≈ sourceH/sourceW', () => {
		const t = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 0 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		const fitRect = computeFitRect(SOURCE_W, SOURCE_H, CANVAS_W, CANVAS_H, 'fit');
		const pixelW = fitRect.width * t.scale * CANVAS_W;
		const pixelH = fitRect.height * t.scale * CANVAS_H;
		const expectedRatio = SOURCE_H / SOURCE_W; // 720/1280 = 0.5625
		expect(pixelH / pixelW).toBeCloseTo(expectedRatio, 3);
	});

	it('fit mode is always "fit"', () => {
		const t = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 0 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		expect(t.fit).toBe('fit');
	});

	it('margin clamping: -4 clamps to 0', () => {
		const clamped = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: -4 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		const zero = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 0 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		expect(clamped.x).toBe(zero.x);
		expect(clamped.y).toBe(zero.y);
	});

	it('margin clamping: 100 clamps to 64', () => {
		const clamped = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 100 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		const max = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 64 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		expect(clamped.x).toBe(max.x);
		expect(clamped.y).toBe(max.y);
	});

	it('non-square canvas margin uniformity — 16px on all sides', () => {
		// Portrait canvas: 1080 × 1920
		const t = deriveWebcamTransform(
			{ corner: 'top-left', size: 'M', marginPx: 16 },
			1080,
			1920,
			SOURCE_W,
			SOURCE_H
		);
		const fitRect = computeFitRect(SOURCE_W, SOURCE_H, 1080, 1920, 'fit');
		const halfW = (fitRect.width * t.scale) / 2;
		const halfH = (fitRect.height * t.scale) / 2;
		const cx = 0.5 + t.x;
		const cy = 0.5 + t.y;
		// left edge should be at marginX = 16/1080
		expect(cx - halfW).toBeCloseTo(16 / 1080, 4);
		// top edge should be at marginY = 16/1920
		expect(cy - halfH).toBeCloseTo(16 / 1920, 4);
	});

	it('bottom-right places clip at bottom-right corner', () => {
		const t = deriveWebcamTransform(
			{ corner: 'bottom-right', size: 'M', marginPx: 0 },
			CANVAS_W,
			CANVAS_H,
			SOURCE_W,
			SOURCE_H
		);
		const fitRect = computeFitRect(SOURCE_W, SOURCE_H, CANVAS_W, CANVAS_H, 'fit');
		const halfW = (fitRect.width * t.scale) / 2;
		const halfH = (fitRect.height * t.scale) / 2;
		const cx = 0.5 + t.x;
		const cy = 0.5 + t.y;
		// right edge should be at 1.0
		expect(cx + halfW).toBeCloseTo(1, 5);
		// bottom edge should be at 1.0
		expect(cy + halfH).toBeCloseTo(1, 5);
	});
});
