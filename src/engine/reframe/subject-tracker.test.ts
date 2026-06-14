import { describe, it, expect } from 'vite-plus/test';
import { computeIoU, createSubjectTracker, type TrackedDetection } from './subject-tracker';

describe('computeIoU', () => {
	it('returns 1.0 for identical boxes', () => {
		const a: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.2,
			height: 0.2,
			confidence: 1,
			source: 'face'
		};
		expect(computeIoU(a, { ...a })).toBeCloseTo(1.0, 5);
	});

	it('returns 0 for non-overlapping boxes', () => {
		const a: TrackedDetection = {
			cx: 0.2,
			cy: 0.2,
			width: 0.1,
			height: 0.1,
			confidence: 1,
			source: 'face'
		};
		const b: TrackedDetection = {
			cx: 0.8,
			cy: 0.8,
			width: 0.1,
			height: 0.1,
			confidence: 1,
			source: 'face'
		};
		expect(computeIoU(a, b)).toBe(0);
	});

	it('returns a value between 0 and 1 for partially overlapping boxes', () => {
		const a: TrackedDetection = {
			cx: 0.4,
			cy: 0.5,
			width: 0.2,
			height: 0.2,
			confidence: 1,
			source: 'face'
		};
		const b: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.2,
			height: 0.2,
			confidence: 1,
			source: 'face'
		};
		const iou = computeIoU(a, b);
		expect(iou).toBeGreaterThan(0);
		expect(iou).toBeLessThan(1);
	});
});

describe('SubjectTracker', () => {
	it('accepts the first detection as the primary subject', () => {
		const tracker = createSubjectTracker();
		const det: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		const result = tracker.update({ detection: det, time: 0 });
		expect(result.cx).toBeCloseTo(0.5, 3);
		expect(result.cy).toBeCloseTo(0.5, 3);
	});

	it('produces a flat trajectory for a stationary subject', () => {
		const tracker = createSubjectTracker();
		const det: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		for (let t = 0; t < 5; t += 0.5) {
			tracker.update({ detection: det, time: t });
		}
		const traj = tracker.trajectory();
		for (const point of traj) {
			expect(point.cx).toBeCloseTo(0.5, 3);
			expect(point.cy).toBeCloseTo(0.5, 3);
		}
	});

	it('resets state on reset()', () => {
		const tracker = createSubjectTracker();
		const det: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		tracker.update({ detection: det, time: 0 });
		tracker.update({ detection: det, time: 0.5 });
		tracker.reset();
		expect(tracker.trajectory()).toHaveLength(0);

		// After reset, accepts new detection
		const det2: TrackedDetection = {
			cx: 0.8,
			cy: 0.2,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		const result = tracker.update({ detection: det2, time: 1 });
		expect(result.cx).toBeCloseTo(0.8, 3);
	});

	it('prefers face detection over saliency', () => {
		const tracker = createSubjectTracker();
		const sal: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.5,
			source: 'saliency'
		};
		const face: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};

		// First: accept saliency
		tracker.update({ detection: sal, time: 0 });

		// Second: face should override (same position, different source)
		const result = tracker.update({ detection: face, time: 0.5 });
		expect(result.cx).toBeCloseTo(0.5, 2);
		expect(result.cy).toBeCloseTo(0.5, 2);
	});

	it('coasts within the coast window', () => {
		const tracker = createSubjectTracker({
			iouThreshold: 0.3,
			coastWindow: 1.0,
			filterConfig: { minCutoff: 1, beta: 0.007, dcutoff: 1 }
		});
		const det: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		tracker.update({ detection: det, time: 0 });

		// No detection for 0.5s — should coast at roughly the same position
		const result = tracker.update({ detection: null, time: 0.5 });
		expect(result.cx).toBeGreaterThan(0.3);
		expect(result.cx).toBeLessThan(0.7);
	});

	it('trajectory length matches number of updates', () => {
		const tracker = createSubjectTracker();
		const det: TrackedDetection = {
			cx: 0.5,
			cy: 0.5,
			width: 0.1,
			height: 0.1,
			confidence: 0.9,
			source: 'face'
		};
		for (let t = 0; t < 3; t += 0.5) {
			tracker.update({ detection: det, time: t });
		}
		expect(tracker.trajectory()).toHaveLength(6); // 0, 0.5, 1, 1.5, 2, 2.5
	});
});
