/** Phase 32b: Landmark sample ring buffer with timestamp-based interpolation.
 *
 *  Stores a bounded ring of timestamped landmark samples. Rendered frames
 *  between two inference results interpolate landmarks by timestamp (not
 *  frame index), so VFR sources and dropped inference frames do not drift.
 */

import { LANDMARK_FLOATS, LANDMARK_RING_CAPACITY } from './beauty-params';

// ─── Types ──────────────────────────────────────────────────────────────

export interface LandmarkSample {
	/** Timeline timestamp in seconds. */
	t: number;
	/** Primary face identifier for continuity tracking. */
	faceId: string;
	/** Detection confidence [0, 1]. */
	confidence: number;
	/** 478 × 3 normalized clip-local coordinates. */
	landmarks: Float32Array;
}

export interface LandmarkRing {
	/** Circular buffer of samples (newest at writePos). */
	samples: (LandmarkSample | null)[];
	/** Write position (next slot to fill). */
	writePos: number;
	/** Number of valid samples (≤ capacity). */
	count: number;
}

// ─── Ring operations ────────────────────────────────────────────────────

/** Create an empty landmark ring buffer. */
export function createLandmarkRing(): LandmarkRing {
	return {
		samples: Array.from({ length: LANDMARK_RING_CAPACITY }, () => null),
		writePos: 0,
		count: 0
	};
}

/** Push a sample into the ring (overwrites oldest when full). */
export function pushSample(ring: LandmarkRing, sample: LandmarkSample): void {
	const landmarks = new Float32Array(LANDMARK_FLOATS);
	landmarks.set(sample.landmarks.subarray(0, LANDMARK_FLOATS));
	ring.samples[ring.writePos] = {
		t: sample.t,
		faceId: sample.faceId,
		confidence: sample.confidence,
		landmarks
	};
	ring.writePos = (ring.writePos + 1) % LANDMARK_RING_CAPACITY;
	if (ring.count < LANDMARK_RING_CAPACITY) {
		ring.count++;
	}
}

/** Reset the ring (on scene cut, confidence loss, or face handoff). */
export function resetRing(ring: LandmarkRing): void {
	ring.samples.fill(null);
	ring.writePos = 0;
	ring.count = 0;
}

/** Get the newest sample. */
export function getNewest(ring: LandmarkRing): LandmarkSample | null {
	if (ring.count === 0) return null;
	const idx = (ring.writePos - 1 + LANDMARK_RING_CAPACITY) % LANDMARK_RING_CAPACITY;
	return ring.samples[idx];
}

function orderedSamples(ring: LandmarkRing): LandmarkSample[] {
	const samples: LandmarkSample[] = [];
	for (let i = 0; i < ring.count; i++) {
		const idx = (ring.writePos - ring.count + i + LANDMARK_RING_CAPACITY) % LANDMARK_RING_CAPACITY;
		const sample = ring.samples[idx];
		if (sample) samples.push(sample);
	}
	return samples;
}

// ─── Interpolation ──────────────────────────────────────────────────────

/**
 * Interpolate landmarks at the given timestamp using the two bracketing samples.
 * Returns null if no samples exist or timestamp is outside the sample range.
 *
 * @param ring - The landmark ring buffer.
 * @param t - Timeline timestamp in seconds.
 * @param out - Output buffer [LANDMARK_FLOATS].
 * @returns The interpolated faceId, or null if interpolation failed.
 */
export function interpolateLandmarks(
	ring: LandmarkRing,
	t: number,
	out: Float32Array
): string | null {
	if (ring.count === 0) return null;

	const samples = orderedSamples(ring);
	const oldest = samples[0]!;
	const newest = samples[samples.length - 1]!;

	// If only one sample or t is at/beyond newest, extrapolate from newest
	if (ring.count === 1 || t >= newest.t) {
		out.set(newest.landmarks.subarray(0, LANDMARK_FLOATS));
		return newest.faceId;
	}

	if (t <= oldest.t) {
		out.set(oldest.landmarks.subarray(0, LANDMARK_FLOATS));
		return oldest.faceId;
	}

	let left = oldest;
	let right = newest;
	for (let i = 0; i < samples.length - 1; i++) {
		const a = samples[i]!;
		const b = samples[i + 1]!;
		if (t >= a.t && t <= b.t) {
			left = a;
			right = b;
			break;
		}
	}

	// Linear interpolation between the bracketing samples.
	const dt = right.t - left.t;
	if (dt <= 0) {
		out.set(right.landmarks.subarray(0, LANDMARK_FLOATS));
		return right.faceId;
	}

	const alpha = (t - left.t) / dt;
	const clampedAlpha = Math.min(Math.max(alpha, 0), 1);

	for (let i = 0; i < LANDMARK_FLOATS; i++) {
		out[i] = left.landmarks[i]! + clampedAlpha * (right.landmarks[i]! - left.landmarks[i]!);
	}

	return right.faceId;
}
