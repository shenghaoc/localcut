/**
 * Pure helpers for the Smart Reframe analysis worker, factored out of
 * `reframe-analyzer.ts` so they are unit-testable without the worker's
 * Mediabunny/OffscreenCanvas/`self` dependencies.
 */
import type { ReframeAnalysisMode } from '../../protocol';
import type { FaceDetection } from './face-detector';

/**
 * Pick the primary subject from a frame's faces: highest confidence, ties
 * broken by largest area (R2.4). Returns `null` for an empty list so callers
 * never hit a `reduce`-without-seed throw.
 */
export function pickPrimaryFace(faces: readonly FaceDetection[]): FaceDetection | null {
	let best: FaceDetection | null = null;
	for (const face of faces) {
		if (!best) {
			best = face;
			continue;
		}
		if (face.confidence !== best.confidence) {
			if (face.confidence > best.confidence) best = face;
		} else if (face.width * face.height > best.width * best.height) {
			best = face;
		}
	}
	return best;
}

/** Derive the honest analysis mode from per-frame source counts (R10.1). */
export function deriveMode(facesDetected: number, saliencyFrames: number): ReframeAnalysisMode {
	if (facesDetected > 0 && saliencyFrames > 0) return 'mixed';
	if (facesDetected > 0) return 'face';
	return 'saliency';
}
