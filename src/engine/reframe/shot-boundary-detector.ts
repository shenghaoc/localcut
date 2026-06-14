/**
 * Shot boundary detection via chi-squared histogram distance.
 * Pure DSP — no ML model. Operates on downscaled analysis frames.
 */

/** Number of bins per channel for the RGB histogram. */
const BINS_PER_CHANNEL = 8;
/** Total number of bins (8^3 = 512). */
const TOTAL_BINS = BINS_PER_CHANNEL * BINS_PER_CHANNEL * BINS_PER_CHANNEL;
/** Bin width in 0–255 range. */
const BIN_WIDTH = 256 / BINS_PER_CHANNEL;
/** Default chi-squared distance threshold for a shot boundary. */
export const DEFAULT_SHOT_BOUNDARY_THRESHOLD = 0.5;

/**
 * Compute a normalised RGB histogram (8 bins per channel = 512 bins).
 * Returns a Float64Array of normalised bin counts (sum ≈ 1).
 */
export function computeHistogram(imageData: ImageData): Float64Array {
	const { data, width, height } = imageData;
	const hist = new Float64Array(TOTAL_BINS);
	const pixelCount = width * height;

	for (let i = 0; i < data.length; i += 4) {
		const r = Math.floor(data[i] / BIN_WIDTH);
		const g = Math.floor(data[i + 1] / BIN_WIDTH);
		const b = Math.floor(data[i + 2] / BIN_WIDTH);
		const idx = r * BINS_PER_CHANNEL * BINS_PER_CHANNEL + g * BINS_PER_CHANNEL + b;
		hist[idx] += 1;
	}

	// Normalise
	for (let i = 0; i < TOTAL_BINS; i++) {
		hist[i] /= pixelCount;
	}

	return hist;
}

/**
 * Compute chi-squared distance between two normalised histograms.
 * Returns a non-negative value; larger means more different.
 */
export function chiSquaredDistance(a: Float64Array, b: Float64Array): number {
	let sum = 0;
	for (let i = 0; i < TOTAL_BINS; i++) {
		const denominator = a[i] + b[i];
		if (denominator > 0) {
			const diff = a[i] - b[i];
			sum += (diff * diff) / denominator;
		}
	}
	return sum;
}

/**
 * Determine whether the current frame is a shot boundary based on the
 * chi-squared distance between its histogram and the previous frame's.
 */
export function isShotBoundary(
	prevHist: Float64Array,
	currHist: Float64Array,
	threshold: number = DEFAULT_SHOT_BOUNDARY_THRESHOLD
): boolean {
	return chiSquaredDistance(prevHist, currHist) > threshold;
}
