/**
 * Phase 35: Time Remapping — shared pure module for speed-curve LUT.
 *
 * Imported by the pipeline worker, export loop, and compatibility export path.
 * No browser globals; unit-testable in Node.
 */

/** Speed range constants. */
export const REMAP_SPEED_MIN = 0.25;
export const REMAP_SPEED_MAX = 4.0;
/** LUT sample step (seconds). */
export const REMAP_LUT_STEP_S = 1 / 120;

/** One keyframe in the speed curve (output time → speed at that point). */
export interface RemapKeyframe {
	readonly outTimeS: number;
	readonly speed: number;
	readonly easing: 'linear' | 'ease' | 'hold';
}

/** Pre-sampled monotone piecewise-linear LUT. */
export interface RemapLUT {
	/** Output times in seconds (monotone, length = N). */
	readonly outTimesS: Float64Array;
	/** Corresponding source times in seconds (monotone, length = N). */
	readonly srcTimesS: Float64Array;
	/** Computed output clip duration (seconds). */
	readonly outputDurationS: number;
	/** Source duration used to build this LUT. */
	readonly sourceDurationS: number;
}

/**
 * Hermite smoothstep easing — same formula as `easeAmount` in keyframes.ts.
 * `t` is expected to be in [0, 1].
 */
function easeHermite(t: number): number {
	return t * t * (3 - 2 * t);
}

/**
 * Evaluate the speed at a given output time between two keyframes.
 * Uses Hermite smoothstep for `'ease'`, constant for `'hold'`, linear otherwise.
 */
function evalSpeed(keyframes: readonly RemapKeyframe[], outTimeS: number): number {
	if (keyframes.length === 0) return 1;
	if (keyframes.length === 1) return keyframes[0]!.speed;

	// Clamp to first/last keyframe
	if (outTimeS <= keyframes[0]!.outTimeS) return keyframes[0]!.speed;
	if (outTimeS >= keyframes[keyframes.length - 1]!.outTimeS)
		return keyframes[keyframes.length - 1]!.speed;

	// Find enclosing segment
	for (let i = 0; i < keyframes.length - 1; i += 1) {
		const left = keyframes[i]!;
		const right = keyframes[i + 1]!;
		if (outTimeS < left.outTimeS || outTimeS > right.outTimeS) continue;

		const span = right.outTimeS - left.outTimeS;
		if (span < 1e-9) return left.speed;

		const t = (outTimeS - left.outTimeS) / span;

		if (left.easing === 'hold') return left.speed;
		if (left.easing === 'ease') {
			const amount = easeHermite(t);
			return left.speed + (right.speed - left.speed) * amount;
		}
		// 'linear'
		return left.speed + (right.speed - left.speed) * t;
	}

	return 1;
}

/**
 * Build the remap LUT from a speed-curve keyframe array.
 *
 * Integrates the speed curve using composite Simpson's rule across each LUT
 * step interval. For `hold` easing the speed is constant, so the integral
 * over `[t_a, t_b]` is `speed * (t_b - t_a)`.
 *
 * The LUT terminates when `srcTimeS` reaches `sourceDurationS`; the final
 * `outputDurationS` is interpolated linearly between the last two entries.
 *
 * @param keyframes Sorted by outTimeS, speed in [REMAP_SPEED_MIN, REMAP_SPEED_MAX], no duplicates.
 * @param sourceDurationS Available source duration (in-to-out), seconds.
 * @param stepS LUT sample step in seconds (default REMAP_LUT_STEP_S).
 */
export function buildRemapLUT(
	keyframes: readonly RemapKeyframe[],
	sourceDurationS: number,
	stepS: number = REMAP_LUT_STEP_S
): RemapLUT {
	if (sourceDurationS <= 0 || keyframes.length === 0) {
		// Identity: speed = 1 everywhere, output duration = source duration
		const outTimesS = new Float64Array([0, sourceDurationS]);
		const srcTimesS = new Float64Array([0, sourceDurationS]);
		return { outTimesS, srcTimesS, outputDurationS: sourceDurationS, sourceDurationS };
	}

	const outTimes: number[] = [0];
	const srcTimes: number[] = [0];
	let cumulativeSrc = 0;
	let outTime = 0;

	// Determine the maximum output time to integrate up to.
	// We integrate until cumulativeSrc reaches sourceDurationS.
	const maxOutTime = sourceDurationS / REMAP_SPEED_MIN + stepS;

	while (cumulativeSrc < sourceDurationS && outTime < maxOutTime) {
		const speedAtStart = evalSpeed(keyframes, outTime);
		const speedAtMid = evalSpeed(keyframes, outTime + stepS * 0.5);
		const speedAtEnd = evalSpeed(keyframes, outTime + stepS);

		// Simpson's rule: integral ≈ (h/6) * (f(a) + 4*f(mid) + f(b))
		const srcDelta = (stepS / 6) * (speedAtStart + 4 * speedAtMid + speedAtEnd);

		if (cumulativeSrc + srcDelta >= sourceDurationS) {
			// Interpolate the exact output time where srcTime reaches sourceDurationS
			const remainingSrc = sourceDurationS - cumulativeSrc;
			const avgSpeed = (speedAtStart + speedAtEnd) * 0.5;
			if (avgSpeed > 1e-9) {
				const exactStep = remainingSrc / avgSpeed;
				outTime += exactStep;
				cumulativeSrc = sourceDurationS;
			} else {
				outTime += stepS;
				cumulativeSrc += srcDelta;
			}
			outTimes.push(outTime);
			srcTimes.push(cumulativeSrc);
			break;
		}

		cumulativeSrc += srcDelta;
		outTime += stepS;
		outTimes.push(outTime);
		srcTimes.push(cumulativeSrc);
	}

	// Ensure the last entry exactly equals sourceDurationS
	if (srcTimes[srcTimes.length - 1] !== sourceDurationS) {
		outTimes.push(outTime);
		srcTimes.push(sourceDurationS);
	}

	const outTimesS = new Float64Array(outTimes);
	const srcTimesS = new Float64Array(srcTimes);
	const outputDurationS = outTimes[outTimes.length - 1]!;

	return { outTimesS, srcTimesS, outputDurationS, sourceDurationS };
}

/**
 * Map an output time to a source time using the pre-built LUT.
 * Binary search for the enclosing interval; linear interpolation.
 * Clamps result to [0, sourceDurationS] at boundaries.
 */
export function remapOutputToSource(lut: RemapLUT, outTimeS: number): number {
	const { outTimesS, srcTimesS, outputDurationS, sourceDurationS } = lut;
	const n = outTimesS.length;

	if (n === 0) return 0;
	if (outTimeS <= 0) return 0;
	if (outTimeS >= outputDurationS) return sourceDurationS;

	// Binary search for the enclosing interval
	let lo = 0;
	let hi = n - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >>> 1;
		if (outTimesS[mid]! <= outTimeS) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	// Linear interpolation within [lo, hi]
	const t0 = outTimesS[lo]!;
	const t1 = outTimesS[hi]!;
	const s0 = srcTimesS[lo]!;
	const s1 = srcTimesS[hi]!;
	const span = t1 - t0;

	if (span < 1e-12) return s0;

	const t = (outTimeS - t0) / span;
	return s0 + (s1 - s0) * t;
}

/**
 * Convenience: signal "no remap". Callers that receive `null` skip all remap
 * lookup and use the clip's direct source offset, paying zero overhead for
 * clips without a remap.
 */
export function identityRemap(): null {
	return null;
}
