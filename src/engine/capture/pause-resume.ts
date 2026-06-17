/**
 * Phase 42: Pause/resume gap-collapsing pure functions.
 *
 * All arithmetic is integer µs (no floating-point accumulation).
 * These functions are fully unit-testable with synthetic manifests.
 */

import type { CaptureManifestRecord } from './chunk-manifest';

export interface PauseResumePair {
	pauseAtUs: number;
	resumeAtUs: number;
}

/**
 * Pairs consecutive pause/resume records in manifest order.
 * A final unpaired pause (session stopped while paused) is excluded.
 */
export function extractPauseResumePairs(
	records: readonly CaptureManifestRecord[]
): PauseResumePair[] {
	const pairs: PauseResumePair[] = [];
	let pendingPause: number | null = null;

	for (const record of records) {
		if (record.kind === 'pause') {
			pendingPause = record.atUs;
		} else if (record.kind === 'resume' && pendingPause !== null) {
			pairs.push({ pauseAtUs: pendingPause, resumeAtUs: record.atUs });
			pendingPause = null;
		}
	}
	// Final unpaired pause is excluded — no gap to subtract.
	return pairs;
}

/**
 * Computes the gap-collapsed timestamp for a sample.
 *
 * Returns `rawTs − Σ(pair.resumeAtUs − pair.pauseAtUs)` for all pairs
 * where `pair.resumeAtUs ≤ rawTs`.
 *
 * Integer arithmetic only — no floating-point accumulation.
 */
export function computeGapCollapsedUs(rawTs: number, pairs: readonly PauseResumePair[]): number {
	let cumulativeGap = 0;
	for (const pair of pairs) {
		if (pair.resumeAtUs <= rawTs) {
			cumulativeGap += pair.resumeAtUs - pair.pauseAtUs;
		}
	}
	return rawTs - cumulativeGap;
}

/**
 * Returns adjusted seam marker positions for each pause/resume pair.
 * Each position is the gap-collapsed resume timestamp.
 */
export function seamMarkerPositionsUs(
	pairs: readonly PauseResumePair[]
): { positionUs: number; label: string }[] {
	return pairs.map((pair, index) => {
		// The marker position is the collapsed timestamp of the resume point.
		// The current gap and all prior gaps must be subtracted to place the marker at the seam.
		const positionUs = computeGapCollapsedUs(pair.resumeAtUs, pairs);
		return {
			positionUs,
			label: `Resume ${index + 1}`
		};
	});
}
