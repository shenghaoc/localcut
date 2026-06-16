/** Phase 43: Auto-zoom proposal generation via deterministic event clustering.
 *
 *  Pure-logic module — no DOM, no OPFS, no GPU dependencies. Fully unit-testable.
 *  Runs synchronously on the main thread at panel open / re-cluster.
 *
 *  Review-issue fix: stable IDs use sync SHA-256 from cache-key.ts instead of
 *  async crypto.subtle.digest.
 */

import type { DomEventLogEntry } from './dom-event-log';
import { stableProposalId } from './dom-event-log';

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

	// Sort by timestamp (O(n log n))
	const sorted = [...entries].sort((a, b) => a.t - b.t);

	// Linear sweep: build clusters
	const clusters: EventCluster[] = [];
	let current: RunningCluster | null = null;

	for (const entry of sorted) {
		const ex = entry.x;
		const ey = entry.y;

		if (current === null) {
			current = { startUs: entry.t, endUs: entry.t, sumX: ex, sumY: ey, count: 1 };
			continue;
		}

		const timeDelta = entry.t - current.startUs;
		const cx = current.sumX / current.count;
		const cy = current.sumY / current.count;
		const dist = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);

		if (timeDelta <= windowUs && dist <= distThreshold) {
			// Extend current cluster
			current.endUs = entry.t;
			current.sumX += ex;
			current.sumY += ey;
			current.count += 1;
		} else {
			// Close current, open new
			clusters.push(closeCluster(current));
			current = { startUs: entry.t, endUs: entry.t, sumX: ex, sumY: ey, count: 1 };
		}
	}
	if (current) clusters.push(closeCluster(current));

	// Generate proposals per cluster
	const proposals: ZoomProposal[] = clusters.map((cluster) => {
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
			scale: params.zoomScale,
			status: 'pending' as const
		};
	});

	// Merge overlapping proposals
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

function mergeProposals(proposals: ZoomProposal[], mergeThresholdUs: number): ZoomProposal[] {
	if (proposals.length <= 1) return proposals;

	// Sort by zoomInAtUs
	proposals.sort((a, b) => a.zoomInAtUs - b.zoomInAtUs);

	const merged: ZoomProposal[] = [proposals[0]!];
	for (let i = 1; i < proposals.length; i++) {
		const prev = merged[merged.length - 1]!;
		const curr = proposals[i]!;
		if (curr.zoomInAtUs - prev.zoomOutAtUs < mergeThresholdUs) {
			// Merge: move prev's zoomOut to curr's zoomIn
			prev.zoomOutAtUs = curr.zoomInAtUs;
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
	proposal: ZoomProposal
): Record<string, { t: number; value: number; easing: string }[]> {
	const { zoomInAtUs, zoomOutAtUs, centroidX, centroidY, scale } = proposal;
	const rampS = (proposal.cluster.endUs - proposal.cluster.startUs) / 1e6;

	// Convert µs to seconds relative to clip start
	const tIn = zoomInAtUs / 1e6;
	const tInEnd = tIn + rampS;
	const tOutStart = zoomOutAtUs / 1e6;
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
			{ t: tInEnd, value: centroidX * 2 - 1, easing: 'linear' },
			{ t: tOutStart, value: centroidX * 2 - 1, easing: 'ease' },
			{ t: tOut, value: 0, easing: 'linear' }
		],
		y: [
			{ t: tIn, value: 0, easing: 'ease' },
			{ t: tInEnd, value: centroidY * 2 - 1, easing: 'linear' },
			{ t: tOutStart, value: centroidY * 2 - 1, easing: 'ease' },
			{ t: tOut, value: 0, easing: 'linear' }
		]
	};
}
