/**
 * SSIM (Structural Similarity Index) metric for frame interpolation quality
 * validation (Phase 37, R14.9). Pure, GPU-free implementation.
 *
 * SSIM compares two images based on luminance, contrast, and structure:
 *   SSIM(x,y) = (2*μx*μy + C1)(2*σxy + C2) / ((μx² + μy² + C1)(σx² + σy² + C2))
 *
 * This is the mean SSIM over non-overlapping windows of the image.
 * Operates on single-channel (grayscale) Float32Arrays with values in [0, 1].
 *
 * Reference: Wang et al., "Image Quality Assessment: From Error Visibility to
 * Structural Similarity", IEEE TIP 2004.
 */

/** Standard SSIM stability constants for 8-bit images (L=1, K1=0.01, K2=0.03). */
const K1 = 0.01;
const K2 = 0.03;
const L = 1.0; // dynamic range for normalized [0,1] data
const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;

/** Default window size for local SSIM computation. */
const DEFAULT_WINDOW_SIZE = 8;

/**
 * Compute SSIM between two single-channel image patches.
 *
 * @param a - First image (grayscale, Float32Array, values in [0,1]).
 * @param b - Second image (same dimensions).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param windowSize - Local window size (default 8).
 * @returns Mean SSIM value in [-1, 1], where 1 means identical.
 */
export function computeSsim(
	a: Float32Array,
	b: Float32Array,
	width: number,
	height: number,
	windowSize: number = DEFAULT_WINDOW_SIZE
): number {
	if (a.length !== b.length || a.length !== width * height) {
		throw new Error(`SSIM: array length ${a.length} does not match dimensions ${width}×${height}`);
	}
	if (windowSize < 2) {
		throw new Error('SSIM: window size must be at least 2');
	}

	let ssimSum = 0;
	let windowCount = 0;

	// Slide non-overlapping windows across the image
	for (let wy = 0; wy + windowSize <= height; wy += windowSize) {
		for (let wx = 0; wx + windowSize <= width; wx += windowSize) {
			const stats = computeWindowStats(a, b, width, wx, wy, windowSize);
			const ssim = computeSsimFromStats(stats);
			ssimSum += ssim;
			windowCount++;
		}
	}

	return windowCount > 0 ? ssimSum / windowCount : 1;
}

/** Statistics for a single window. */
interface WindowStats {
	meanA: number;
	meanB: number;
	varA: number;
	varB: number;
	covAB: number;
}

function computeWindowStats(
	a: Float32Array,
	b: Float32Array,
	stride: number,
	ox: number,
	oy: number,
	size: number
): WindowStats {
	let sumA = 0;
	let sumB = 0;
	let sumA2 = 0;
	let sumB2 = 0;
	let sumAB = 0;
	const n = size * size;

	for (let dy = 0; dy < size; dy++) {
		const rowOffset = (oy + dy) * stride + ox;
		for (let dx = 0; dx < size; dx++) {
			const idx = rowOffset + dx;
			const va = a[idx];
			const vb = b[idx];
			sumA += va;
			sumB += vb;
			sumA2 += va * va;
			sumB2 += vb * vb;
			sumAB += va * vb;
		}
	}

	const meanA = sumA / n;
	const meanB = sumB / n;
	// Clamp variance to >= 0 to avoid negative values from floating-point imprecision
	const varA = Math.max(0, sumA2 / n - meanA * meanA);
	const varB = Math.max(0, sumB2 / n - meanB * meanB);
	const covAB = sumAB / n - meanA * meanB;

	return { meanA, meanB, varA, varB, covAB };
}

function computeSsimFromStats(s: WindowStats): number {
	const numerator = (2 * s.meanA * s.meanB + C1) * (2 * s.covAB + C2);
	const denominator = (s.meanA ** 2 + s.meanB ** 2 + C1) * (s.varA + s.varB + C2);
	return numerator / denominator;
}

/**
 * Compute SSIM between two RGBA image buffers (converts to grayscale first).
 *
 * @param a - First RGBA image (Uint8ClampedArray or Uint8Array, 4 bytes/pixel).
 * @param b - Second RGBA image (same dimensions).
 * @param width - Image width.
 * @param height - Image height.
 * @param windowSize - Local window size.
 * @returns Mean SSIM value.
 */
export function computeSsimRgba(
	a: Uint8ClampedArray | Uint8Array,
	b: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	windowSize: number = DEFAULT_WINDOW_SIZE
): number {
	const pixelCount = width * height;
	if (a.length !== pixelCount * 4 || b.length !== pixelCount * 4) {
		throw new Error('SSIM: RGBA arrays must be 4 bytes per pixel');
	}

	// Convert to grayscale using luminance weights (BT.709)
	const grayA = new Float32Array(pixelCount);
	const grayB = new Float32Array(pixelCount);
	for (let i = 0; i < pixelCount; i++) {
		const offset = i * 4;
		// BT.709 luminance: 0.2126 R + 0.7152 G + 0.0722 B
		grayA[i] = (0.2126 * a[offset] + 0.7152 * a[offset + 1] + 0.0722 * a[offset + 2]) / 255;
		grayB[i] = (0.2126 * b[offset] + 0.7152 * b[offset + 1] + 0.0722 * b[offset + 2]) / 255;
	}

	return computeSsim(grayA, grayB, width, height, windowSize);
}
