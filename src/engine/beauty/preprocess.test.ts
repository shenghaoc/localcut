import { describe, expect, it } from 'vite-plus/test';
import { cpuPreprocessROI } from './preprocess';

describe('cpuPreprocessROI', () => {
	it('clamps out-of-bounds ROI coordinates before sampling', () => {
		const frame = new Uint8ClampedArray([
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255
		]);

		const out = cpuPreprocessROI(frame, 2, 2, { x: -1, y: -1, w: 3, h: 3 }, 2);

		expect([...out].every(Number.isFinite)).toBe(true);
		expect(Array.from(out.slice(0, 3))).toEqual([1, 0, 0]);
		expect(Array.from(out.slice(9, 12))).toEqual([1, 1, 1]);
	});
});
