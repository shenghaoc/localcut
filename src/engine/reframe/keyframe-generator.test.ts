import { describe, it, expect } from 'vite-plus/test';
import {
	generateReframeKeyframes,
	computeReframeScale,
	DEFAULT_KEYFRAME_GEN_CONFIG,
	type TrajectoryPoint
} from './keyframe-generator';
import { packTransformUniform, DEFAULT_TRANSFORM } from '../transform';

describe('computeReframeScale', () => {
	it('returns correct scale for 16:9 → 9:16', () => {
		// Source is wider than target → scale = srcAspect / tgtAspect
		const scale = computeReframeScale(16 / 9, 9 / 16);
		expect(scale).toBeCloseTo(16 / 9 / (9 / 16), 3);
		expect(scale).toBeGreaterThan(1);
	});

	it('returns correct scale for 16:9 → 1:1', () => {
		const scale = computeReframeScale(16 / 9, 1);
		expect(scale).toBeCloseTo(16 / 9, 3);
	});

	it('returns correct scale for 16:9 → 4:5', () => {
		const scale = computeReframeScale(16 / 9, 4 / 5);
		expect(scale).toBeCloseTo(16 / 9 / (4 / 5), 3);
	});

	it('returns correct scale for 9:16 → 16:9', () => {
		const scale = computeReframeScale(9 / 16, 16 / 9);
		expect(scale).toBeCloseTo(16 / 9 / (9 / 16), 3);
	});

	it('returns 1.0 for same aspect ratio', () => {
		expect(computeReframeScale(16 / 9, 16 / 9)).toBeCloseTo(1.0, 5);
	});

	it('returns 1.0 for invalid inputs', () => {
		expect(computeReframeScale(0, 16 / 9)).toBe(1);
		expect(computeReframeScale(16 / 9, 0)).toBe(1);
		expect(computeReframeScale(-1, 16 / 9)).toBe(1);
	});
});

describe('generateReframeKeyframes', () => {
	const baseConfig = {
		targetAspect: 9 / 16,
		sourceAspect: 16 / 9,
		...DEFAULT_KEYFRAME_GEN_CONFIG
	};

	it('returns empty keyframes for empty trajectory', () => {
		const result = generateReframeKeyframes([], baseConfig);
		expect(result.keyframes).toEqual({});
		expect(result.safeZoneCompliance).toBe(1);
	});

	it('generates x, y, scale tracks', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0, cy: 0 },
			{ time: 2, cx: 0, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		expect(result.keyframes.x).toBeDefined();
		expect(result.keyframes.y).toBeDefined();
		expect(result.keyframes.scale).toBeDefined();
		expect(result.keyframes.x!.length).toBeGreaterThan(0);
	});

	it('centres the subject for a centred trajectory', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		// For a centred subject, x and y should be ~0
		for (const kf of result.keyframes.x!) {
			expect(kf.value).toBeCloseTo(0, 3);
		}
		for (const kf of result.keyframes.y!) {
			expect(kf.value).toBeCloseTo(0, 3);
		}
	});

	it('negates position to shift layer opposite subject offset', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0.3, cy: 0.2 },
			{ time: 1, cx: 0.3, cy: 0.2 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		// x = -cx * scale, y = -cy * scale (negated)
		for (const kf of result.keyframes.x!) {
			expect(kf.value).toBeLessThan(0); // -0.3 * scale
		}
		for (const kf of result.keyframes.y!) {
			expect(kf.value).toBeLessThan(0); // -0.2 * scale
		}
	});

	it('places the subject at the rendered output centre under fit:fill (16:9 → 9:16)', () => {
		// Cross-check the generated x/y against the actual compositor uniform: the
		// fit:'fill' rect-scale must be folded into x/y or the subject under-pans.
		const cx = 0.3;
		const cy = -0.1;
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx, cy },
			{ time: 1, cx, cy }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		const x = result.keyframes.x![0]!.value;
		const y = result.keyframes.y![0]!.value;
		const scale = result.keyframes.scale![0]!.value;
		// packTransformUniform returns the inverse affine output→layer the shader
		// uses; sample it at the output centre (0.5, 0.5).
		const u = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, x, y, scale, fit: 'fill' },
			1080,
			1920, // output 9:16
			1920,
			1080 // source 16:9
		);
		const [m00, m01, m10, m11, t0, t1] = u;
		const layerX = m00 * 0.5 + m01 * 0.5 + t0;
		const layerY = m10 * 0.5 + m11 * 0.5 + t1;
		// The output centre samples the subject's source-normalised position.
		expect(layerX).toBeCloseTo(0.5 + cx, 4);
		expect(layerY).toBeCloseTo(0.5 + cy, 4);
	});

	it('places the subject at the rendered output centre under fit:fill (9:16 → 16:9, Y cropped)', () => {
		// Portrait → landscape crops the vertical axis, so the fill factor must
		// land on y, not x.
		const cx = 0.2;
		const cy = 0.35;
		const result = generateReframeKeyframes(
			[
				{ time: 0, cx, cy },
				{ time: 1, cx, cy }
			],
			{ ...DEFAULT_KEYFRAME_GEN_CONFIG, sourceAspect: 9 / 16, targetAspect: 16 / 9 }
		);
		const x = result.keyframes.x![0]!.value;
		const y = result.keyframes.y![0]!.value;
		const scale = result.keyframes.scale![0]!.value;
		const u = packTransformUniform(
			{ ...DEFAULT_TRANSFORM, x, y, scale, fit: 'fill' },
			1920,
			1080, // output 16:9
			1080,
			1920 // source 9:16
		);
		const [m00, m01, m10, m11, t0, t1] = u;
		const layerX = m00 * 0.5 + m01 * 0.5 + t0;
		const layerY = m10 * 0.5 + m11 * 0.5 + t1;
		expect(layerX).toBeCloseTo(0.5 + cx, 4);
		expect(layerY).toBeCloseTo(0.5 + cy, 4);
	});

	it('produces scale >= 1.0 (baseline for fill crop)', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0.3, cy: 0.2 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		for (const kf of result.keyframes.scale!) {
			expect(kf.value).toBeGreaterThanOrEqual(1.0);
		}
	});

	it('respects velocity bounds on a sudden displacement', () => {
		// Subject jumps from 0 to 0.8 in 0.5s — velocity = 1.6/s, well above 0.3/s bound
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 0.5, cx: 0.8, cy: 0 },
			{ time: 1, cx: 0.8, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, {
			...baseConfig,
			velocityBound: 0.3
		});

		// Check velocity between consecutive keyframes
		const xTrack = result.keyframes.x!;
		for (let i = 1; i < xTrack.length; i++) {
			const dt = xTrack[i].t - xTrack[i - 1].t;
			if (dt > 0) {
				const v = Math.abs(xTrack[i].value - xTrack[i - 1].value) / dt;
				expect(v).toBeLessThanOrEqual(0.3 + 0.01); // Small tolerance for floating point
			}
		}
	});

	it('respects acceleration bounds on oscillating trajectory', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 0.5, cx: 0.5, cy: 0 },
			{ time: 1.0, cx: -0.5, cy: 0 },
			{ time: 1.5, cx: 0.5, cy: 0 },
			{ time: 2.0, cx: 0, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, {
			...baseConfig,
			accelerationBound: 0.5
		});

		// Check acceleration between consecutive triples
		const xTrack = result.keyframes.x!;
		for (let i = 2; i < xTrack.length; i++) {
			const dt1 = xTrack[i - 1].t - xTrack[i - 2].t;
			const dt2 = xTrack[i].t - xTrack[i - 1].t;
			if (dt1 > 0 && dt2 > 0) {
				const v1 = (xTrack[i - 1].value - xTrack[i - 2].value) / dt1;
				const v2 = (xTrack[i].value - xTrack[i - 1].value) / dt2;
				const a = Math.abs(v2 - v1) / dt2;
				expect(a).toBeLessThanOrEqual(0.5 + 0.01);
			}
		}
	});

	it('generates hold keyframes are linear by default', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		for (const kf of result.keyframes.x!) {
			expect(kf.easing).toBe('linear');
		}
	});

	it('returns compliance between 0 and 1', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0.1, cy: 0.1 },
			{ time: 2, cx: 0, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		expect(result.safeZoneCompliance).toBeGreaterThanOrEqual(0);
		expect(result.safeZoneCompliance).toBeLessThanOrEqual(1);
	});

	it('reports full compliance for a stationary off-centre subject (layer fully compensates)', () => {
		// No motion → no clamping → the layer position equals the ideal, so the
		// subject sits dead-centre every frame regardless of the fill-crop factor.
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0.1, cy: 0 },
			{ time: 1, cx: 0.1, cy: 0 },
			{ time: 2, cx: 0.1, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, baseConfig);
		expect(result.safeZoneCompliance).toBeCloseTo(1, 5);
	});

	it('reports reduced compliance when clamping pushes the subject off-centre', () => {
		// A large, sudden displacement the tight velocity bound cannot follow:
		// the subject drifts past the action-safe zone for some frames (R6.5/R6.7).
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 0.5, cx: 0.5, cy: 0 },
			{ time: 1, cx: 0.5, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, { ...baseConfig, velocityBound: 0.05 });
		expect(result.safeZoneCompliance).toBeLessThan(1);
	});
});

describe('generateReframeKeyframes — shot boundaries (R5.3)', () => {
	const baseConfig = {
		targetAspect: 9 / 16,
		sourceAspect: 16 / 9,
		...DEFAULT_KEYFRAME_GEN_CONFIG
	};

	it('inserts a hold keyframe just before a cut and a linear keyframe at the cut', () => {
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: -0.3, cy: 0 },
			{ time: 1, cx: -0.3, cy: 0 },
			// Cut at t=2: a different subject appears on the opposite side.
			{ time: 2, cx: 0.3, cy: 0 },
			{ time: 3, cx: 0.3, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, { ...baseConfig, shotBoundaries: [2] });
		const xs = result.keyframes.x!;
		// x = -cx · fillCrop on the cropped (X) axis for 16:9 → 9:16.
		const fillCrop = computeReframeScale(baseConfig.sourceAspect, baseConfig.targetAspect);

		const holds = xs.filter((k) => k.easing === 'hold');
		expect(holds.length).toBeGreaterThanOrEqual(1);
		const hold = holds[holds.length - 1]!;
		// Hold sits immediately before the cut and carries the pre-cut value.
		expect(hold.t).toBeGreaterThan(1.99);
		expect(hold.t).toBeLessThan(2);
		expect(hold.value).toBeCloseTo(0.3 * fillCrop, 5); // -cx · fillCrop, cx = -0.3

		// The keyframe at the cut is the post-cut position, linear easing.
		const atCut = xs.find((k) => Math.abs(k.t - 2) < 1e-6);
		expect(atCut).toBeDefined();
		expect(atCut!.easing).toBe('linear');
		expect(atCut!.value).toBeCloseTo(-0.3 * fillCrop, 5); // -cx · fillCrop, cx = 0.3
	});

	it('keeps scale at 1.0 across shot boundaries', () => {
		const result = generateReframeKeyframes(
			[
				{ time: 0, cx: 0, cy: 0 },
				{ time: 1, cx: 0.2, cy: 0 },
				{ time: 2, cx: -0.2, cy: 0 }
			],
			{ ...baseConfig, shotBoundaries: [1] }
		);
		for (const kf of result.keyframes.scale!) expect(kf.value).toBe(1.0);
	});

	it('clamps velocity independently within each shot', () => {
		// Without per-shot clamping the cross-cut jump would be smoothed away.
		const trajectory: TrajectoryPoint[] = [
			{ time: 0, cx: 0, cy: 0 },
			{ time: 1, cx: 0, cy: 0 },
			{ time: 2, cx: 0.4, cy: 0 },
			{ time: 3, cx: 0.4, cy: 0 }
		];
		const result = generateReframeKeyframes(trajectory, { ...baseConfig, shotBoundaries: [2] });
		const xs = result.keyframes.x!.filter((k) => k.easing !== 'hold');
		for (let i = 1; i < xs.length; i++) {
			const dt = xs[i].t - xs[i - 1].t;
			// Skip the instantaneous cut transition (dt at the hold→cut edge).
			if (dt <= 0) continue;
			const v = Math.abs(xs[i].value - xs[i - 1].value) / dt;
			// Allow the cut discontinuity (between the last pre-cut and first
			// post-cut sample, which the hold keyframe isolates).
			if (xs[i - 1].t < 2 && xs[i].t >= 2) continue;
			expect(v).toBeLessThanOrEqual(0.3 + 0.01);
		}
	});
});
