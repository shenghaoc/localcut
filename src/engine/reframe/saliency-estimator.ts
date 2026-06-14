/**
 * Pure-DSP saliency estimator. No ML model. Operates on downscaled ImageData.
 *
 * Combines three signals:
 * 1. Skin-tone mask in YCbCr space (weight 0.5)
 * 2. Sobel edge density on luminance (weight 0.3)
 * 3. Local contrast (stdev of luminance per grid cell) (weight 0.2)
 *
 * The highest-scoring grid cell's centre is the saliency centroid.
 */

/** Grid resolution for the saliency map. */
const GRID_CELLS = 16;
/** Skin-tone thresholds in YCbCr space. */
const SKIN_CB_MIN = 77,
	SKIN_CB_MAX = 127;
const SKIN_CR_MIN = 133,
	SKIN_CR_MAX = 173;
/** Weights for the three saliency components. */
const W_SKIN = 0.5,
	W_EDGE = 0.3,
	W_CONTRAST = 0.2;

export interface SaliencyResult {
	/** Normalised centre x in [0,1]. */
	centroidX: number;
	/** Normalised centre y in [0,1]. */
	centroidY: number;
	/** Confidence in [0,1], lower than face detections. */
	confidence: number;
}

export interface SaliencyEstimator {
	estimate(imageData: ImageData): SaliencyResult;
}

/**
 * Convert RGB to luminance (BT.601).
 */
function luminance(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Check if a pixel is skin-tone in YCbCr space.
 */
function isSkin(r: number, g: number, b: number): boolean {
	// RGB → YCbCr
	const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
	const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
	return cb >= SKIN_CB_MIN && cb <= SKIN_CB_MAX && cr >= SKIN_CR_MIN && cr <= SKIN_CR_MAX;
}

/**
 * Compute Sobel magnitude at a pixel position from a luminance buffer.
 */
function sobelMagnitude(lum: Float32Array, x: number, y: number, w: number, h: number): number {
	if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return 0;
	const tl = lum[(y - 1) * w + (x - 1)];
	const tc = lum[(y - 1) * w + x];
	const tr = lum[(y - 1) * w + (x + 1)];
	const ml = lum[y * w + (x - 1)];
	const mr = lum[y * w + (x + 1)];
	const bl = lum[(y + 1) * w + (x - 1)];
	const bc = lum[(y + 1) * w + x];
	const br = lum[(y + 1) * w + (x + 1)];
	const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
	const gy = -tl - 2 * tc + tr + bl + 2 * bc + br;
	return Math.sqrt(gx * gx + gy * gy);
}

export function createSaliencyEstimator(): SaliencyEstimator {
	return {
		estimate(imageData: ImageData): SaliencyResult {
			const { data, width, height } = imageData;
			const cellW = Math.floor(width / GRID_CELLS);
			const cellH = Math.floor(height / GRID_CELLS);
			if (cellW < 2 || cellH < 2) {
				return { centroidX: 0.5, centroidY: 0.5, confidence: 0 };
			}

			// Build luminance buffer
			const lum = new Float32Array(width * height);
			for (let i = 0; i < data.length; i += 4) {
				lum[i >> 2] = luminance(data[i], data[i + 1], data[i + 2]);
			}

			// Per-cell scores
			const skinScores = new Float64Array(GRID_CELLS * GRID_CELLS);
			const edgeScores = new Float64Array(GRID_CELLS * GRID_CELLS);
			const contrastScores = new Float64Array(GRID_CELLS * GRID_CELLS);

			for (let gy = 0; gy < GRID_CELLS; gy++) {
				for (let gx = 0; gx < GRID_CELLS; gx++) {
					const startX = gx * cellW;
					const startY = gy * cellH;
					const endX = Math.min(startX + cellW, width);
					const endY = Math.min(startY + cellH, height);
					const cellPixels = (endX - startX) * (endY - startY);
					if (cellPixels <= 0) continue;

					let skinCount = 0;
					let edgeSum = 0;
					let lumSum = 0;
					let lumSqSum = 0;

					for (let y = startY; y < endY; y++) {
						for (let x = startX; x < endX; x++) {
							const idx = (y * width + x) * 4;
							const r = data[idx];
							const g = data[idx + 1];
							const b = data[idx + 2];

							if (isSkin(r, g, b)) skinCount++;
							edgeSum += sobelMagnitude(lum, x, y, width, height);
							const l = lum[y * width + x];
							lumSum += l;
							lumSqSum += l * l;
						}
					}

					const cellIdx = gy * GRID_CELLS + gx;
					skinScores[cellIdx] = skinCount / cellPixels;
					edgeScores[cellIdx] = edgeSum / cellPixels;

					// Contrast = stdev of luminance
					const mean = lumSum / cellPixels;
					const variance = lumSqSum / cellPixels - mean * mean;
					contrastScores[cellIdx] = Math.sqrt(Math.max(0, variance));
				}
			}

			// Normalise each component to [0,1]
			const maxSkin = Math.max(...skinScores) || 1;
			const maxEdge = Math.max(...edgeScores) || 1;
			const maxContrast = Math.max(...contrastScores) || 1;

			let bestScore = -1;
			let bestIdx = 0;

			for (let i = 0; i < GRID_CELLS * GRID_CELLS; i++) {
				const score =
					W_SKIN * (skinScores[i] / maxSkin) +
					W_EDGE * (edgeScores[i] / maxEdge) +
					W_CONTRAST * (contrastScores[i] / maxContrast);
				if (score > bestScore) {
					bestScore = score;
					bestIdx = i;
				}
			}

			const bestGx = bestIdx % GRID_CELLS;
			const bestGy = Math.floor(bestIdx / GRID_CELLS);

			// Each component is normalised to [0,1] and the weights sum to 1.0
			// (W_SKIN + W_EDGE + W_CONTRAST = 1), so `bestScore` is already in
			// [0,1]: 0 for a flat/uniform frame, →1 for a strong, isolated subject.
			// Clamp defensively against floating-point overshoot.
			const confidence = Math.max(0, Math.min(1, bestScore));

			return {
				centroidX: (bestGx + 0.5) / GRID_CELLS,
				centroidY: (bestGy + 0.5) / GRID_CELLS,
				confidence
			};
		}
	};
}
