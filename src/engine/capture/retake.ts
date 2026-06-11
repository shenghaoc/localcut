/**
 * Phase 42: Retake landing logic — pure function, no I/O.
 *
 * Produces the updated TimelineClipSnapshot that replaces the original clip
 * after a retake. Preserves id, transform, keyframes; updates sourceId,
 * duration, inPoint, outPoint.
 */

import type { TimelineClipSnapshot } from '../../protocol';

/**
 * Apply a retake to an existing clip snapshot.
 *
 * @param original     The original clip that is being replaced.
 * @param newSourceId  The sourceId of the new recording.
 * @param newDurationS The duration of the new recording in seconds.
 * @returns A new TimelineClipSnapshot with updated fields.
 */
export function applyRetakeToClip(
	original: TimelineClipSnapshot,
	newSourceId: string,
	newDurationS: number,
): TimelineClipSnapshot {
	return {
		...original,
		sourceId: newSourceId,
		duration: newDurationS,
		inPoint: 0,
		// transform, keyframes, id, kind, effects, lut, etc. are preserved via spread
	};
}
