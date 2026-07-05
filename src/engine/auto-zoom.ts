/** Phase 43: Auto-zoom proposal generation via deterministic event clustering.
 *
 *  Pure-logic module — no DOM, no OPFS, no GPU dependencies. Fully unit-testable.
 *  Runs synchronously on the main thread at panel open / re-cluster.
 *
 *  Stable IDs use a sync FNV-1a-derived hash so this module remains
 *  synchronous and within the 1-hour log performance budget.
 */

import type { DomEventLogEntry } from './dom-event-log';
import { stableProposalId } from './dom-event-log';
import type { ClipKeyframesSnapshot } from '../protocol';

export interface AutoZoomParams {
	clusterWindowS: number;
	clusterDistanceNorm: number;
	leadInMs: number;
	rampMs: number;
	holdMs: number;
	zoomScale: number;
	overlapMergeThresholdMs: number;
}

export const DEFAULT_AUTO_ZOOM_PARAMS: AutoZoomParams = {
	clusterWindowS: 2,
	clusterDistanceNorm: 0.15,
	leadInMs: 200,
	rampMs: 400,
	holdMs: 1500,
	zoomScale: 1.6,
	overlapMergeThresholdMs: 50
};

export interface EventCluster {
	startUs: number;
	endUs: number;
	centroidX: number;
	centroidY: number;
	eventCount: number;
}

export interface ZoomProposal {
	id: string;
	cluster: EventCluster;
	zoomInAtUs: number;
	zoomOutAtUs: number;
	centroidX: number;
	centroidY: number;
	scale: number;
	status: 'pending' | 'applied' | 'skipped';
}

interface RunningCluster {
	startUs: number;
	endUs: number;
	sumX: number;
	sumY: number;
	count: number;
}

/**
 * Cluster entries into zoom proposals. Pure function; deterministic given the
 * same input. Runs in O(n log n) time (sort by t, linear sweep).
 */
export function clusterEvents(
	entries: readonly DomEventLogEntry[],
	params: AutoZoomParams,
	clipStartUs: number
): ZoomProposal[] {
	if (entries.length === 0) return [];

	const windowUs = params.clusterWindowS * 1e6;
	const distThreshold = params.clusterDistanceNorm;
	const leadInUs = params.leadInMs * 1000;
	const holdUs = params.holdMs * 1000;
	const mergeThresholdUs = params.overlapMergeThresholdMs * 1000;

	// Linear sweep: build clusters
	const proposals: ZoomProposal[] = [];
	let current: RunningCluster | null = null;
	const distThresholdSq = distThreshold * distThreshold;
	let lastT = Number.NEGATIVE_INFINITY;

	for (const entry of entries) {
		if (entry.kind === 'key') continue;
		if (entry.t < lastT) {
			return clusterEvents(
				[...entries].sort((a, b) => a.t - b.t),
				params,
				clipStartUs
			);
		}
		lastT = entry.t;

		const ex = entry.x;
		const ey = entry.y;

		if (current === null) {
			current = { startUs: entry.t, endUs: entry.t, sumX: ex, sumY: ey, count: 1 };
			continue;
		}

		const timeDelta = entry.t - current.startUs;
		const cx = current.sumX / current.count;
		const cy = current.sumY / current.count;
		const dx = ex - cx;
		const dy = ey - cy;
		const distSq = dx * dx + dy * dy;

		if (timeDelta <= windowUs && distSq <= distThresholdSq) {
			// Extend current cluster
			current.endUs = entry.t;
			current.sumX += ex;
			current.sumY += ey;
			current.count += 1;
		} else {
			// Close current, open new
			proposals.push(
				createProposal(closeCluster(current), params.zoomScale, leadInUs, holdUs, clipStartUs)
			);
			current = { startUs: entry.t, endUs: entry.t, sumX: ex, sumY: ey, count: 1 };
		}
	}
	if (current) {
		proposals.push(
			createProposal(closeCluster(current), params.zoomScale, leadInUs, holdUs, clipStartUs)
		);
	}

	return mergeProposals(proposals, mergeThresholdUs);
}

function closeCluster(c: RunningCluster): EventCluster {
	return {
		startUs: c.startUs,
		endUs: c.endUs,
		centroidX: c.sumX / c.count,
		centroidY: c.sumY / c.count,
		eventCount: c.count
	};
}

function createProposal(
	cluster: EventCluster,
	scale: number,
	leadInUs: number,
	holdUs: number,
	clipStartUs: number
): ZoomProposal {
	const zoomInAtUs = cluster.startUs - leadInUs;
	const zoomOutAtUs = cluster.endUs + holdUs;
	const idInput = `${cluster.startUs}:${cluster.centroidX.toFixed(4)}:${cluster.centroidY.toFixed(4)}`;
	return {
		id: stableProposalId(idInput),
		cluster,
		zoomInAtUs: Math.max(clipStartUs, zoomInAtUs),
		zoomOutAtUs,
		centroidX: cluster.centroidX,
		centroidY: cluster.centroidY,
		scale,
		status: 'pending'
	};
}

function mergeClusters(base: ZoomProposal, next: ZoomProposal): ZoomProposal {
	const baseCount = base.cluster.eventCount;
	const nextCount = next.cluster.eventCount;
	const totalCount = baseCount + nextCount;
	const mergedCentroidX = (base.centroidX * baseCount + next.centroidX * nextCount) / totalCount;
	const mergedCentroidY = (base.centroidY * baseCount + next.centroidY * nextCount) / totalCount;
	const mergedCluster = {
		...base.cluster,
		endUs: Math.max(base.cluster.endUs, next.cluster.endUs),
		centroidX: mergedCentroidX,
		centroidY: mergedCentroidY,
		eventCount: totalCount
	};

	base.zoomOutAtUs = Math.max(base.zoomOutAtUs, next.zoomOutAtUs);
	base.cluster = mergedCluster;
	base.centroidX = mergedCentroidX;
	base.centroidY = mergedCentroidY;
	base.id = stableProposalId(
		`${mergedCluster.startUs}:${mergedCluster.centroidX.toFixed(4)}:${mergedCluster.centroidY.toFixed(4)}`
	);
	return base;
}

function mergeProposals(proposals: ZoomProposal[], mergeThresholdUs: number): ZoomProposal[] {
	if (proposals.length <= 1) return proposals;

	const merged: ZoomProposal[] = [{ ...proposals[0]! }];
	for (let i = 1; i < proposals.length; i++) {
		const prev = merged[merged.length - 1]!;
		const curr = proposals[i]!;
		if (curr.zoomInAtUs - prev.zoomOutAtUs < mergeThresholdUs) {
			// Merge: proposals overlap or gap is within threshold.
			// Recompute cluster centroid and events so zoom frame tracks both regions.
			mergeClusters(prev, curr);
		} else {
			merged.push(curr);
		}
	}
	return merged;
}

/**
 * Convert a ZoomProposal to the ClipKeyframesSnapshot structure expected by
 * the set-keyframes command.
 */
export function applyProposal(
	proposal: ZoomProposal,
	params: AutoZoomParams = DEFAULT_AUTO_ZOOM_PARAMS,
	clipStartUs = 0
): ClipKeyframesSnapshot {
	const { zoomInAtUs, zoomOutAtUs, centroidX, centroidY, scale } = proposal;
	const rampS = Math.max(0.001, params.rampMs / 1000);
	const toClipSeconds = (timeUs: number) => Math.max(0, (timeUs - clipStartUs) / 1e6);

	// Convert µs to seconds relative to clip start
	const tIn = toClipSeconds(zoomInAtUs);
	const tInEnd = tIn + rampS;
	const tOutStart = toClipSeconds(zoomOutAtUs);
	const tOut = tOutStart + rampS;

	return {
		scale: [
			{ t: tIn, value: 1, easing: 'ease' },
			{ t: tInEnd, value: scale, easing: 'linear' },
			{ t: tOutStart, value: scale, easing: 'ease' },
			{ t: tOut, value: 1, easing: 'linear' }
		],
		x: [
			{ t: tIn, value: 0, easing: 'ease' },
			{ t: tInEnd, value: centroidX - 0.5, easing: 'linear' },
			{ t: tOutStart, value: centroidX - 0.5, easing: 'ease' },
			{ t: tOut, value: 0, easing: 'linear' }
		],
		y: [
			{ t: tIn, value: 0, easing: 'ease' },
			{ t: tInEnd, value: centroidY - 0.5, easing: 'linear' },
			{ t: tOutStart, value: centroidY - 0.5, easing: 'ease' },
			{ t: tOut, value: 0, easing: 'linear' }
		]
	};
}
