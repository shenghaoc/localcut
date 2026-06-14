/**
 * Keyframe generator: converts a smoothed subject trajectory into Phase 15
 * transform keyframe tracks (x, y, scale) with velocity/acceleration bounds
 * and safe zone validation.
 */

import { KEYFRAME_EPSILON } from '../../protocol';
import type { ClipKeyframesSnapshot, KeyframeSnapshot } from '../../protocol';

export interface KeyframeGenConfig {
	targetAspect: number;
	sourceAspect: number;
	/** Sample interval in seconds (default 0.5). */
	sampleInterval: number;
	/** Maximum velocity in normalised units/s (default 0.3). */
	velocityBound: number;
	/** Maximum acceleration in normalised units/s² (default 0.5). */
	accelerationBound: number;
	/** Clip-local times (seconds) of detected shot boundaries (R5.3). Motion is
	 *  clamped independently within each shot, and a `'hold'` keyframe is placed
	 *  just before each cut so the preceding interval does not interpolate across
	 *  the discontinuity. Defaults to none. */
	shotBoundaries?: number[];
}

export const DEFAULT_KEYFRAME_GEN_CONFIG: Omit<KeyframeGenConfig, 'targetAspect' | 'sourceAspect'> =
	{
		sampleInterval: 0.5,
		velocityBound: 0.3,
		accelerationBound: 0.5
	};

/**
 * A smoothed subject sample. `cx`/`cy` are the subject's offset **from the
 * source-frame centre** in normalised units (0 = centred, ±0.5 = frame edge),
 * matching the `x = -cx * scale` position formula below. The analyser converts
 * the tracker's `[0,1]` centroid into this centre-relative convention before
 * calling the generator.
 */
export interface TrajectoryPoint {
	time: number;
	cx: number;
	cy: number;
}

/** Gap inserted before a cut for the pre-cut `'hold'` keyframe (R5.3). Larger
 *  than `KEYFRAME_EPSILON` so the hold and the post-cut keyframe are distinct
 *  times, but small enough to be imperceptible. */
const HOLD_GAP_S = 1e-3;

/** Action-safe half-extent: the subject centre must stay within ±0.45 of the
 *  output centre (90 % action-safe rectangle, R6.7). */
const ACTION_SAFE_HALF = 0.45;

export interface KeyframeGenResult {
	keyframes: ClipKeyframesSnapshot;
	safeZoneCompliance: number;
}

/**
 * Compute the scale factor needed to crop from source aspect to target aspect.
 * Always >= 1.0 (never scale up to crop).
 */
export function computeReframeScale(sourceAspect: number, targetAspect: number): number {
	if (sourceAspect <= 0 || targetAspect <= 0) return 1;
	const scale =
		sourceAspect > targetAspect ? sourceAspect / targetAspect : targetAspect / sourceAspect;
	return Math.max(scale, 1.0);
}

/**
 * Interpolate a trajectory at a given time using linear interpolation.
 */
function interpolateTrajectory(
	trajectory: TrajectoryPoint[],
	time: number
): { cx: number; cy: number } {
	if (trajectory.length === 0) return { cx: 0, cy: 0 };
	if (trajectory.length === 1) return { cx: trajectory[0].cx, cy: trajectory[0].cy };

	// Find surrounding points
	let prev = trajectory[0];
	let next = trajectory[trajectory.length - 1];

	for (let i = 0; i < trajectory.length - 1; i++) {
		if (trajectory[i].time <= time && trajectory[i + 1].time >= time) {
			prev = trajectory[i];
			next = trajectory[i + 1];
			break;
		}
	}

	if (time <= trajectory[0].time) return { cx: trajectory[0].cx, cy: trajectory[0].cy };
	if (time >= trajectory[trajectory.length - 1].time) {
		return { cx: trajectory[trajectory.length - 1].cx, cy: trajectory[trajectory.length - 1].cy };
	}

	const dt = next.time - prev.time;
	if (dt <= 0) return { cx: prev.cx, cy: prev.cy };

	const t = (time - prev.time) / dt;
	return {
		cx: prev.cx + (next.cx - prev.cx) * t,
		cy: prev.cy + (next.cy - prev.cy) * t
	};
}

/**
 * Clamp velocity: for each consecutive keyframe pair, if |Δv/Δt| > bound,
 * scale Δv down. Iterates until convergence.
 */
function clampVelocity(
	values: number[],
	times: number[],
	bound: number,
	maxIterations: number = 10
): number[] {
	const result = [...values];
	for (let iter = 0; iter < maxIterations; iter++) {
		let changed = false;
		for (let i = 1; i < result.length; i++) {
			const dt = times[i] - times[i - 1];
			if (dt <= 0) continue;
			const dv = result[i] - result[i - 1];
			const v = Math.abs(dv / dt);
			if (v > bound) {
				const scale = bound / v;
				result[i] = result[i - 1] + dv * scale;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return result;
}

/**
 * Clamp acceleration: for each consecutive triple, if |Δv/Δt| > bound,
 * reduce Δv. Iterates until convergence.
 */
function clampAcceleration(
	values: number[],
	times: number[],
	bound: number,
	maxIterations: number = 10
): number[] {
	const result = [...values];
	for (let iter = 0; iter < maxIterations; iter++) {
		let changed = false;
		for (let i = 2; i < result.length; i++) {
			const dt1 = times[i - 1] - times[i - 2];
			const dt2 = times[i] - times[i - 1];
			if (dt1 <= 0 || dt2 <= 0) continue;

			const v1 = (result[i - 1] - result[i - 2]) / dt1;
			const v2 = (result[i] - result[i - 1]) / dt2;
			const a = Math.abs((v2 - v1) / dt2);
			if (a > bound) {
				const targetV2 = v1 + Math.sign(v2 - v1) * bound * dt2;
				result[i] = result[i - 1] + targetV2 * dt2;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return result;
}

/** Regular sample times across `[start, end]` inclusive, at `interval` spacing. */
function sampleTimesForSegment(start: number, end: number, interval: number): number[] {
	const times = [start];
	for (let t = start + interval; t < end - KEYFRAME_EPSILON; t += interval) times.push(t);
	if (end - start > KEYFRAME_EPSILON) times.push(end);
	return times;
}

/** Split a trajectory into per-shot segments at the given boundary times. A
 *  point whose time is at or after a boundary starts a new segment. */
function partitionTrajectory(
	trajectory: TrajectoryPoint[],
	boundaries: number[]
): TrajectoryPoint[][] {
	if (boundaries.length === 0) return [trajectory];
	const sorted = [...boundaries].sort((a, b) => a - b);
	const segments: TrajectoryPoint[][] = [];
	let current: TrajectoryPoint[] = [];
	let boundaryIdx = 0;
	for (const point of trajectory) {
		while (boundaryIdx < sorted.length && point.time >= sorted[boundaryIdx] - KEYFRAME_EPSILON) {
			if (current.length > 0) segments.push(current);
			current = [];
			boundaryIdx++;
		}
		current.push(point);
	}
	if (current.length > 0) segments.push(current);
	return segments;
}

interface SegmentSamples {
	times: number[];
	/** Ideal (pre-clamp) layer position: `-cx * scale`. */
	rawX: number[];
	rawY: number[];
	/** Motion-bounded layer position actually written to keyframes. */
	clampedX: number[];
	clampedY: number[];
}

/**
 * Layer translation per normalised unit of subject offset, per axis. The clip
 * renders with `fit: 'fill'` (R6.2a), which scales the cropped axis by the
 * fill-crop factor *before* the transform translation is added to the output
 * centre (`centre = 0.5 + x`; see `packTransformUniform`). Inverting that map,
 * centring a subject at layer position `0.5 + cx` requires `x = -cx · rectW`,
 * where `rectW`/`rectH` are the fill rect dimensions: the cropped axis carries
 * the fill-crop factor (≥ 1), the other stays 1. A `-cx` translation alone
 * (omitting `rectW`) under-pans by that factor and the subject never reaches
 * the output centre.
 */
function fillRect(sourceAspect: number, targetAspect: number): { rectW: number; rectH: number } {
	const fillCrop = computeReframeScale(sourceAspect, targetAspect); // ≥ 1
	return sourceAspect >= targetAspect
		? { rectW: fillCrop, rectH: 1 }
		: { rectW: 1, rectH: fillCrop };
}

/** Sample one shot segment and apply per-segment velocity + acceleration bounds.
 *  Scale stays at 1.0 (R6.3 — the aspect crop is the `fit: 'fill'` rect, not an
 *  extra zoom); the layer position negates the subject offset, scaled by the
 *  fill rect so the subject reaches the output centre (see {@link fillRect}). */
function sampleSegment(segment: TrajectoryPoint[], config: KeyframeGenConfig): SegmentSamples {
	const start = segment[0].time;
	const end = segment[segment.length - 1].time;
	const { rectW, rectH } = fillRect(config.sourceAspect, config.targetAspect);
	const times = sampleTimesForSegment(start, end, config.sampleInterval);
	const rawX = times.map((t) => -interpolateTrajectory(segment, t).cx * rectW);
	const rawY = times.map((t) => -interpolateTrajectory(segment, t).cy * rectH);
	let clampedX = clampVelocity(rawX, times, config.velocityBound);
	let clampedY = clampVelocity(rawY, times, config.velocityBound);
	clampedX = clampAcceleration(clampedX, times, config.accelerationBound);
	clampedY = clampAcceleration(clampedY, times, config.accelerationBound);
	return { times, rawX, rawY, clampedX, clampedY };
}

/**
 * Generate Phase 15 transform keyframe tracks from a smoothed subject
 * trajectory. The result is exclusively standard `x`/`y`/`scale` keyframe
 * tracks (R0.6): `x`/`y` translate the layer to keep the subject centred,
 * `scale` stays at 1.0 (R6.3 — the aspect crop is handled by `fit: 'fill'`).
 * Velocity (R6.5) and acceleration (R6.6) are bounded per shot, and a `'hold'`
 * keyframe is placed just before each cut so motion does not interpolate across
 * the discontinuity (R5.3).
 */
export function generateReframeKeyframes(
	trajectory: TrajectoryPoint[],
	config: KeyframeGenConfig
): KeyframeGenResult {
	if (trajectory.length === 0) {
		return { keyframes: {}, safeZoneCompliance: 1 };
	}

	const start = trajectory[0].time;
	const end = trajectory[trajectory.length - 1].time;
	// Only boundaries strictly inside the clip split shots; the rest are noise.
	const boundaries = (config.shotBoundaries ?? [])
		.filter((t) => t > start + KEYFRAME_EPSILON && t < end - KEYFRAME_EPSILON)
		.sort((a, b) => a - b);
	const segments = partitionTrajectory(trajectory, boundaries);

	const xTrack: KeyframeSnapshot[] = [];
	const yTrack: KeyframeSnapshot[] = [];
	const scaleTrack: KeyframeSnapshot[] = [];

	// Deviation of the subject from the output centre after clamping, used for
	// safe-zone compliance: when clamping prevents the layer from reaching its
	// ideal position the subject drifts off-centre by `clamped - raw` (R6.7).
	let inZone = 0;
	let sampleCount = 0;

	segments.forEach((segment, segIdx) => {
		const { times, rawX, rawY, clampedX, clampedY } = sampleSegment(segment, config);
		for (let i = 0; i < times.length; i++) {
			xTrack.push({ t: times[i], value: clampedX[i], easing: 'linear' });
			yTrack.push({ t: times[i], value: clampedY[i], easing: 'linear' });
			scaleTrack.push({ t: times[i], value: 1.0, easing: 'linear' });
			sampleCount++;
			if (
				Math.abs(clampedX[i] - rawX[i]) <= ACTION_SAFE_HALF &&
				Math.abs(clampedY[i] - rawY[i]) <= ACTION_SAFE_HALF
			) {
				inZone++;
			}
		}
		// At every cut except after the final shot, hold the pre-cut position
		// until the boundary so the interval does not slide across the cut. The
		// next segment's first keyframe (authored at the boundary time, linear
		// easing) is the post-cut position.
		if (segIdx < segments.length - 1) {
			const cutTime = segments[segIdx + 1][0].time;
			const holdTime = cutTime - HOLD_GAP_S;
			const last = times.length - 1;
			if (holdTime > times[last] + KEYFRAME_EPSILON) {
				xTrack.push({ t: holdTime, value: clampedX[last], easing: 'hold' });
				yTrack.push({ t: holdTime, value: clampedY[last], easing: 'hold' });
				scaleTrack.push({ t: holdTime, value: 1.0, easing: 'hold' });
			} else {
				// Segment too short to fit a separate hold sample: convert its last
				// keyframe to a hold so it still does not interpolate across the cut.
				xTrack[xTrack.length - 1].easing = 'hold';
				yTrack[yTrack.length - 1].easing = 'hold';
				scaleTrack[scaleTrack.length - 1].easing = 'hold';
			}
		}
	});

	return {
		keyframes: { x: xTrack, y: yTrack, scale: scaleTrack },
		safeZoneCompliance: sampleCount > 0 ? inZone / sampleCount : 1
	};
}
