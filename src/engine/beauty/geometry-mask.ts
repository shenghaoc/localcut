/** Phase 32b: Geometry-aware skin mask from landmarks.
 *
 *  Derives face oval inclusion, eye/lip exclusion zones, and feathered
 *  mask geometry from smoothed landmarks. Integrates with Phase 32a's
 *  chroma skin mask when landmarks are available; falls back to
 *  chroma-only when they are not (UI-only reduced-quality label).
 */

import { LANDMARK_COUNT } from './beauty-params';

// ─── Types ──────────────────────────────────────────────────────────────

export interface GeometryMaskRegion {
	/** Inclusion polygon: face oval landmark indices. */
	faceOvalIndices: readonly number[];
	/** Exclusion polygons: eye and lip landmark indices. */
	exclusions: readonly (readonly number[])[];
	/** Feather width in normalized coordinates. */
	featherWidth: number;
}

export interface GeometryMaskResult {
	/** Per-pixel mask weight [0, 1] for the frame. */
	weights: Float32Array;
	/** Frame width. */
	width: number;
	/** Frame height. */
	height: number;
}

// ─── Face Mesh topology constants ───────────────────────────────────────

/**
 * Face oval landmark indices for the v1 FaceMesh-class topology.
 * These define the outer boundary of the face for inclusion masking.
 */
export const FACE_OVAL_INDICES: readonly number[] = [
	10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
	176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

/** Left eye landmark indices (simplified contour). */
export const LEFT_EYE_INDICES: readonly number[] = [
	33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
];

/** Right eye landmark indices (simplified contour). */
export const RIGHT_EYE_INDICES: readonly number[] = [
	362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
];

/** Outer lip landmark indices. */
export const LIP_OUTER_INDICES: readonly number[] = [
	61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185
];

/** Default exclusion regions. */
export const DEFAULT_EXCLUSIONS: readonly (readonly number[])[] = [
	LEFT_EYE_INDICES,
	RIGHT_EYE_INDICES,
	LIP_OUTER_INDICES
];

/** Default feather width in normalized coordinates. */
export const DEFAULT_FEATHER_WIDTH = 0.02;

// ─── Default region ─────────────────────────────────────────────────────

export const DEFAULT_GEOMETRY_MASK_REGION: GeometryMaskRegion = {
	faceOvalIndices: FACE_OVAL_INDICES,
	exclusions: DEFAULT_EXCLUSIONS,
	featherWidth: DEFAULT_FEATHER_WIDTH
};

// ─── Point-in-polygon ──────────────────────────────────────────────────

/** Check if a point is inside a polygon using ray-casting (works for concave polygons). */
function pointInPolygon(
	px: number,
	py: number,
	polygon: readonly { x: number; y: number }[]
): boolean {
	let inside = false;
	const n = polygon.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = polygon[i]!.x;
		const yi = polygon[i]!.y;
		const xj = polygon[j]!.x;
		const yj = polygon[j]!.y;
		// Ray-casting: count edges crossing the horizontal ray from (px, py) to (+inf, py)
		const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/** Distance from point to nearest edge of a polygon (approximate). */
function distanceToPolygon(
	px: number,
	py: number,
	polygon: readonly { x: number; y: number }[]
): number {
	let minDist = Infinity;
	const n = polygon.length;
	for (let i = 0; i < n; i++) {
		const a = polygon[i]!;
		const b = polygon[(i + 1) % n]!;
		// Point-to-segment distance
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lenSq = dx * dx + dy * dy;
		let t = 0;
		if (lenSq > 0) {
			t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
		}
		const projX = a.x + t * dx;
		const projY = a.y + t * dy;
		const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
		minDist = Math.min(minDist, dist);
	}
	return minDist;
}

// ─── Mask generation ────────────────────────────────────────────────────

interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function computeBBox(polygon: readonly { x: number; y: number }[]): BBox {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of polygon) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Generate a geometry-aware mask from smoothed landmarks.
 *
 * Uses bounding-box pre-computation to skip pixels that are definitely
 * outside each polygon region, reducing the number of expensive
 * point-in-polygon tests.
 *
 * @param landmarks - Smoothed landmarks [478 × 3] in normalized clip-local coords.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @param region - Mask region definition (face oval, exclusions, feather).
 * @returns Per-pixel mask weights [width × height] in [0, 1].
 */
export function generateGeometryMask(
	landmarks: Float32Array,
	width: number,
	height: number,
	region: GeometryMaskRegion = DEFAULT_GEOMETRY_MASK_REGION
): GeometryMaskResult {
	const weights = new Float32Array(width * height);

	// Extract 2D points for face oval
	const faceOvalPoints = region.faceOvalIndices
		.filter((i) => i < LANDMARK_COUNT)
		.map((i) => ({
			x: landmarks[i * 3]!,
			y: landmarks[i * 3 + 1]!
		}));

	// Extract 2D points for exclusion regions
	const exclusionPolygons = region.exclusions.map((indices) =>
		indices
			.filter((i) => i < LANDMARK_COUNT)
			.map((i) => ({
				x: landmarks[i * 3]!,
				y: landmarks[i * 3 + 1]!
			}))
	);

	const feather = region.featherWidth;

	// Pre-compute bounding boxes for early-out rejection
	const ovalBBox = faceOvalPoints.length >= 3 ? computeBBox(faceOvalPoints) : null;
	const exclusionBBoxes = exclusionPolygons.map((p) => (p.length >= 3 ? computeBBox(p) : null));

	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			// Normalized coordinates
			const nx = px / width;
			const ny = py / height;

			// Check face oval inclusion with feather
			if (ovalBBox) {
				// Early-out: skip pixels definitely outside oval + feather
				if (
					nx < ovalBBox.minX - feather ||
					nx > ovalBBox.maxX + feather ||
					ny < ovalBBox.minY - feather ||
					ny > ovalBBox.maxY + feather
				) {
					weights[py * width + px] = 0;
					continue;
				}

				const insideOval = pointInPolygon(nx, ny, faceOvalPoints);
				const distToOval = distanceToPolygon(nx, ny, faceOvalPoints);

				if (!insideOval && distToOval > feather) {
					weights[py * width + px] = 0;
					continue;
				}

				let weight = insideOval ? 1.0 : Math.max(0, 1 - distToOval / feather);

				// Check exclusion zones (eyes, lips)
				for (let ei = 0; ei < exclusionPolygons.length; ei++) {
					const polygon = exclusionPolygons[ei]!;
					const bbox = exclusionBBoxes[ei];
					if (polygon.length < 3 || !bbox) continue;

					// Early-out: skip exclusion check if definitely outside bbox + feather
					if (
						nx < bbox.minX - feather ||
						nx > bbox.maxX + feather ||
						ny < bbox.minY - feather ||
						ny > bbox.maxY + feather
					) {
						continue;
					}

					const insideExclusion = pointInPolygon(nx, ny, polygon);
					const distToExclusion = distanceToPolygon(nx, ny, polygon);

					if (insideExclusion) {
						weight = 0;
					} else if (distToExclusion < feather) {
						const exclusionWeight = distToExclusion / feather;
						weight = Math.min(weight, exclusionWeight);
					}
				}

				weights[py * width + px] = weight;
			}
		}
	}

	return { weights, width, height };
}
