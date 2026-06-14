/**
 * Subject tracker: IoU-based association with One Euro smoothing.
 * Tracks a single primary subject across frames. Face detections are preferred
 * over saliency when both are available (R4.3).
 */

import { OneEuro2D, DEFAULT_ONE_EURO_CONFIG, type OneEuroFilterConfig } from './one-euro-filter';

export interface TrackedDetection {
	/** Normalised centre x in [0,1]. */
	cx: number;
	/** Normalised centre y in [0,1]. */
	cy: number;
	/** Normalised width. */
	width: number;
	/** Normalised height. */
	height: number;
	confidence: number;
	source: 'face' | 'saliency';
}

export interface TrajectoryPoint {
	time: number;
	cx: number;
	cy: number;
}

export interface SubjectTrackerConfig {
	/** IoU threshold for association (default 0.3). */
	iouThreshold: number;
	/** Coast window in seconds (default 1.0). */
	coastWindow: number;
	/** One Euro filter configuration. */
	filterConfig: OneEuroFilterConfig;
}

export const DEFAULT_TRACKER_CONFIG: SubjectTrackerConfig = {
	iouThreshold: 0.3,
	coastWindow: 1.0,
	filterConfig: DEFAULT_ONE_EURO_CONFIG
};

/**
 * Compute Intersection over Union between two axis-aligned boxes.
 * Boxes are defined by (cx, cy, width, height) in normalised coordinates.
 */
export function computeIoU(a: TrackedDetection, b: TrackedDetection): number {
	const aLeft = a.cx - a.width / 2;
	const aTop = a.cy - a.height / 2;
	const aRight = a.cx + a.width / 2;
	const aBottom = a.cy + a.height / 2;

	const bLeft = b.cx - b.width / 2;
	const bTop = b.cy - b.height / 2;
	const bRight = b.cx + b.width / 2;
	const bBottom = b.cy + b.height / 2;

	const interLeft = Math.max(aLeft, bLeft);
	const interTop = Math.max(aTop, bTop);
	const interRight = Math.min(aRight, bRight);
	const interBottom = Math.min(aBottom, bBottom);

	if (interLeft >= interRight || interTop >= interBottom) return 0;

	const interArea = (interRight - interLeft) * (interBottom - interTop);
	const aArea = a.width * a.height;
	const bArea = b.width * b.height;
	const unionArea = aArea + bArea - interArea;

	return unionArea > 0 ? interArea / unionArea : 0;
}

export interface SubjectTracker {
	/** Feed one frame's detection (or null) with source time. Returns the smoothed centroid. */
	update(frame: { detection: TrackedDetection | null; time: number }): { cx: number; cy: number };
	/** Reset state (e.g., at shot boundary). */
	reset(): void;
	/** Get the full trajectory after all frames have been fed. */
	trajectory(): TrajectoryPoint[];
}

export function createSubjectTracker(
	config: SubjectTrackerConfig = DEFAULT_TRACKER_CONFIG
): SubjectTracker {
	const filter = new OneEuro2D(config.filterConfig);
	const points: TrajectoryPoint[] = [];
	let currentTarget: TrackedDetection | null = null;
	let lastDetectionTime = -Infinity;

	function update(frame: { detection: TrackedDetection | null; time: number }): {
		cx: number;
		cy: number;
	} {
		const { detection, time } = frame;
		if (detection === null) {
			// No detection — coast if within window
			if (currentTarget && time - lastDetectionTime > config.coastWindow) {
				// Coast window expired — reset
				currentTarget = null;
			}
			// Continue filtering with the last known position
			const cx = currentTarget ? currentTarget.cx : 0;
			const cy = currentTarget ? currentTarget.cy : 0;
			const smoothed = filter.filter(cx, cy, time);
			points.push({ time, cx: smoothed.x, cy: smoothed.y });
			return { cx: smoothed.x, cy: smoothed.y };
		}

		if (currentTarget === null) {
			// No current target — accept this detection
			currentTarget = { ...detection };
			lastDetectionTime = time;
			const smoothed = filter.filter(detection.cx, detection.cy, time);
			points.push({ time, cx: smoothed.x, cy: smoothed.y });
			return { cx: smoothed.x, cy: smoothed.y };
		}

		// Check IoU with current target
		const iou = computeIoU(currentTarget, detection);

		// Prefer face over saliency
		if (detection.source === 'face' && currentTarget.source === 'saliency') {
			// Always accept face over saliency
			currentTarget = { ...detection };
			lastDetectionTime = time;
		} else if (iou >= config.iouThreshold) {
			// Same subject — update position
			currentTarget = { ...detection };
			lastDetectionTime = time;
		} else if (time - lastDetectionTime > config.coastWindow) {
			// Coast window expired — accept new subject
			currentTarget = { ...detection };
			lastDetectionTime = time;
		}
		// Otherwise — ignore this detection (different subject within coast window)

		const smoothed = filter.filter(currentTarget.cx, currentTarget.cy, time);
		points.push({ time, cx: smoothed.x, cy: smoothed.y });
		return { cx: smoothed.x, cy: smoothed.y };
	}

	function reset(): void {
		filter.reset();
		currentTarget = null;
		lastDetectionTime = -Infinity;
		points.length = 0;
	}

	function trajectory(): TrajectoryPoint[] {
		return [...points];
	}

	return { update, reset, trajectory };
}
