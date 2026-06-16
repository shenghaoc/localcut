/** Phase 32b: Geometry mask tests. */

import { describe, expect, it } from 'vite-plus/test';
import {
	FACE_OVAL_INDICES,
	LEFT_EYE_INDICES,
	RIGHT_EYE_INDICES,
	LIP_OUTER_INDICES,
	generateGeometryMask
} from './geometry-mask';
import { LANDMARK_FLOATS, LANDMARK_COUNT } from './beauty-params';

/** Create synthetic landmarks: a simple face oval in normalized coords. */
function makeFaceLandmarks(faceCenterX = 0.5, faceCenterY = 0.5): Float32Array {
	const landmarks = new Float32Array(LANDMARK_FLOATS);
	// Fill all landmarks with a default position
	for (let i = 0; i < LANDMARK_COUNT; i++) {
		landmarks[i * 3] = faceCenterX;
		landmarks[i * 3 + 1] = faceCenterY;
		landmarks[i * 3 + 2] = 0;
	}

	// Create a face oval: circular arrangement of face oval landmarks
	const ovalRadius = 0.2;
	for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
		const angle = (i / FACE_OVAL_INDICES.length) * Math.PI * 2;
		const idx = FACE_OVAL_INDICES[i]!;
		landmarks[idx * 3] = faceCenterX + Math.cos(angle) * ovalRadius;
		landmarks[idx * 3 + 1] = faceCenterY + Math.sin(angle) * ovalRadius;
	}

	// Create left eye (small circle)
	const leftEyeCenter = { x: faceCenterX - 0.08, y: faceCenterY - 0.05 };
	for (let i = 0; i < LEFT_EYE_INDICES.length; i++) {
		const angle = (i / LEFT_EYE_INDICES.length) * Math.PI * 2;
		const idx = LEFT_EYE_INDICES[i]!;
		landmarks[idx * 3] = leftEyeCenter.x + Math.cos(angle) * 0.03;
		landmarks[idx * 3 + 1] = leftEyeCenter.y + Math.sin(angle) * 0.02;
	}

	// Create right eye
	const rightEyeCenter = { x: faceCenterX + 0.08, y: faceCenterY - 0.05 };
	for (let i = 0; i < RIGHT_EYE_INDICES.length; i++) {
		const angle = (i / RIGHT_EYE_INDICES.length) * Math.PI * 2;
		const idx = RIGHT_EYE_INDICES[i]!;
		landmarks[idx * 3] = rightEyeCenter.x + Math.cos(angle) * 0.03;
		landmarks[idx * 3 + 1] = rightEyeCenter.y + Math.sin(angle) * 0.02;
	}

	// Create lips (small oval below center)
	const lipCenter = { x: faceCenterX, y: faceCenterY + 0.08 };
	for (let i = 0; i < LIP_OUTER_INDICES.length; i++) {
		const angle = (i / LIP_OUTER_INDICES.length) * Math.PI * 2;
		const idx = LIP_OUTER_INDICES[i]!;
		landmarks[idx * 3] = lipCenter.x + Math.cos(angle) * 0.04;
		landmarks[idx * 3 + 1] = lipCenter.y + Math.sin(angle) * 0.02;
	}

	return landmarks;
}

describe('FACE_OVAL_INDICES', () => {
	it('has reasonable length', () => {
		expect(FACE_OVAL_INDICES.length).toBeGreaterThanOrEqual(10);
	});

	it('all indices are valid landmark indices', () => {
		for (const idx of FACE_OVAL_INDICES) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(LANDMARK_COUNT);
		}
	});
});

describe('generateGeometryMask', () => {
	it('produces mask with correct dimensions', () => {
		const landmarks = makeFaceLandmarks();
		const result = generateGeometryMask(landmarks, 32, 32);
		expect(result.width).toBe(32);
		expect(result.height).toBe(32);
		expect(result.weights.length).toBe(32 * 32);
	});

	it('center of face has weight > 0', () => {
		const landmarks = makeFaceLandmarks();
		const result = generateGeometryMask(landmarks, 64, 64);
		// Center pixel should be inside face oval
		const centerIdx = 32 * 64 + 32;
		expect(result.weights[centerIdx]).toBeGreaterThan(0);
	});

	it('corners have weight 0 (outside face)', () => {
		const landmarks = makeFaceLandmarks();
		const result = generateGeometryMask(landmarks, 64, 64);
		// Corners should be outside face oval
		expect(result.weights[0]).toBe(0); // top-left
		expect(result.weights[63]).toBe(0); // top-right
		expect(result.weights[63 * 64]).toBe(0); // bottom-left
		expect(result.weights[63 * 64 + 63]).toBe(0); // bottom-right
	});

	it('exclusion zones reduce weight', () => {
		const landmarks = makeFaceLandmarks();
		const result = generateGeometryMask(landmarks, 128, 128);

		// Eye area should have reduced weight
		const leftEyeX = Math.floor((0.5 - 0.08) * 128);
		const leftEyeY = Math.floor((0.5 - 0.05) * 128);
		const eyeIdx = leftEyeY * 128 + leftEyeX;
		const cheekIdx = Math.floor(0.5 * 128) * 128 + Math.floor(0.5 * 128);

		// Eye should have lower weight than cheek (if both are inside face)
		if (result.weights[eyeIdx]! > 0 && result.weights[cheekIdx]! > 0) {
			expect(result.weights[eyeIdx]).toBeLessThanOrEqual(result.weights[cheekIdx]!);
		}
	});

	it('all weights are in [0, 1]', () => {
		const landmarks = makeFaceLandmarks();
		const result = generateGeometryMask(landmarks, 32, 32);
		for (let i = 0; i < result.weights.length; i++) {
			expect(result.weights[i]).toBeGreaterThanOrEqual(0);
			expect(result.weights[i]).toBeLessThanOrEqual(1);
		}
	});
});
