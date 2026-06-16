/** Phase 32b: Landmark track ring buffer tests. */

import { describe, expect, it } from 'vite-plus/test';
import {
	createLandmarkRing,
	pushSample,
	resetRing,
	getNewest,
	interpolateLandmarks,
	type LandmarkSample
} from './landmark-track';
import { LANDMARK_FLOATS, LANDMARK_RING_CAPACITY } from './beauty-params';

function makeSample(t: number, val: number, faceId = 'face-1'): LandmarkSample {
	const landmarks = new Float32Array(LANDMARK_FLOATS);
	landmarks.fill(val);
	return { t, faceId, confidence: 0.9, landmarks };
}

describe('createLandmarkRing', () => {
	it('creates empty ring', () => {
		const ring = createLandmarkRing();
		expect(ring.count).toBe(0);
		expect(ring.writePos).toBe(0);
		expect(ring.samples.length).toBe(LANDMARK_RING_CAPACITY);
	});
});

describe('pushSample', () => {
	it('adds samples up to capacity', () => {
		const ring = createLandmarkRing();
		for (let i = 0; i < LANDMARK_RING_CAPACITY; i++) {
			pushSample(ring, makeSample(i * 0.1, i));
		}
		expect(ring.count).toBe(LANDMARK_RING_CAPACITY);
	});

	it('overwrites oldest when full', () => {
		const ring = createLandmarkRing();
		for (let i = 0; i < LANDMARK_RING_CAPACITY + 2; i++) {
			pushSample(ring, makeSample(i * 0.1, i));
		}
		expect(ring.count).toBe(LANDMARK_RING_CAPACITY);
		// Newest should be the last pushed
		expect(getNewest(ring)?.t).toBeCloseTo((LANDMARK_RING_CAPACITY + 1) * 0.1);
	});

	it('copies sample landmarks into ring-owned storage', () => {
		const ring = createLandmarkRing();
		const sample = makeSample(0, 0.25);
		pushSample(ring, sample);
		sample.landmarks.fill(0.75);
		expect(getNewest(ring)?.landmarks[0]).toBeCloseTo(0.25);
	});
});

describe('resetRing', () => {
	it('clears all samples', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0, 0.5));
		pushSample(ring, makeSample(0.1, 0.6));
		resetRing(ring);
		expect(ring.count).toBe(0);
		expect(getNewest(ring)).toBeNull();
	});
});

describe('getNewest', () => {
	it('returns null for empty ring', () => {
		expect(getNewest(createLandmarkRing())).toBeNull();
	});

	it('returns the last pushed sample', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0.1, 0.5));
		pushSample(ring, makeSample(0.2, 0.6));
		const newest = getNewest(ring);
		expect(newest?.t).toBeCloseTo(0.2);
	});
});

describe('interpolateLandmarks', () => {
	it('returns null for empty ring', () => {
		const ring = createLandmarkRing();
		const out = new Float32Array(LANDMARK_FLOATS);
		expect(interpolateLandmarks(ring, 0, out)).toBeNull();
	});

	it('returns single sample directly', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0.1, 0.5));
		const out = new Float32Array(LANDMARK_FLOATS);
		const faceId = interpolateLandmarks(ring, 0.2, out);
		expect(faceId).toBe('face-1');
		expect(out[0]).toBeCloseTo(0.5);
	});

	it('interpolates between two samples', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0.0, 0.0));
		pushSample(ring, makeSample(1.0, 1.0));
		const out = new Float32Array(LANDMARK_FLOATS);
		const faceId = interpolateLandmarks(ring, 0.5, out);
		expect(faceId).toBe('face-1');
		expect(out[0]).toBeCloseTo(0.5);
	});

	it('clamps to newest when t > newest.t', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0.0, 0.0));
		pushSample(ring, makeSample(1.0, 1.0));
		const out = new Float32Array(LANDMARK_FLOATS);
		interpolateLandmarks(ring, 2.0, out);
		expect(out[0]).toBeCloseTo(1.0);
	});

	it('clamps to oldest when t is before the ring range', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0.0, 0.0));
		pushSample(ring, makeSample(1.0, 1.0));
		const out = new Float32Array(LANDMARK_FLOATS);
		interpolateLandmarks(ring, -1.0, out);
		expect(out[0]).toBeCloseTo(0.0);
	});

	it('searches older samples for the bracketing interval', () => {
		const ring = createLandmarkRing();
		pushSample(ring, makeSample(0, 0));
		pushSample(ring, makeSample(1, 1));
		pushSample(ring, makeSample(2, 2));
		pushSample(ring, makeSample(3, 3));
		const out = new Float32Array(LANDMARK_FLOATS);
		interpolateLandmarks(ring, 1.5, out);
		expect(out[0]).toBeCloseTo(1.5);
	});
});
