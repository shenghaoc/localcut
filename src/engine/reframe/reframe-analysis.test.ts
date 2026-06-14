import { describe, it, expect } from 'vite-plus/test';
import { deriveMode, pickPrimaryFace } from './reframe-analysis';
import type { FaceDetection } from './face-detector';

function face(confidence: number, width = 0.2, height = 0.2): FaceDetection {
	return { x: 0.4, y: 0.4, width, height, confidence };
}

describe('pickPrimaryFace', () => {
	it('returns null for an empty list (no reduce-without-seed throw)', () => {
		expect(pickPrimaryFace([])).toBeNull();
	});

	it('returns the only face', () => {
		const only = face(0.6);
		expect(pickPrimaryFace([only])).toBe(only);
	});

	it('prefers the highest-confidence face (R2.4)', () => {
		const strong = face(0.9);
		expect(pickPrimaryFace([face(0.3), strong, face(0.5)])).toBe(strong);
	});

	it('breaks confidence ties by largest area', () => {
		const big = face(0.7, 0.4, 0.4);
		expect(pickPrimaryFace([face(0.7, 0.1, 0.1), big])).toBe(big);
	});
});

describe('deriveMode', () => {
	it('is "mixed" when both face and saliency frames occur', () => {
		expect(deriveMode(3, 2)).toBe('mixed');
	});
	it('is "face" when only faces are detected', () => {
		expect(deriveMode(5, 0)).toBe('face');
	});
	it('is "saliency" when no faces are detected', () => {
		expect(deriveMode(0, 5)).toBe('saliency');
		expect(deriveMode(0, 0)).toBe('saliency');
	});
});
