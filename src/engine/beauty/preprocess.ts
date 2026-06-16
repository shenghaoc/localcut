/** Phase 32b: Frame preprocess for detector and landmark input tensors.
 *
 *  Prepares bounded ROI tensors for the v1 face detector (192×192) and
 *  landmark model (256×256) ONNX contracts from the current VideoFrame. On the
 *  accelerated path, GPU preprocess produces compact tensors without
 *  full-frame CPU readback.
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Detector input dimensions for the v1 ONNX contract. */
export const DETECTOR_SIZE = 192;
export const DETECTOR_CHANNELS = 3;
export const DETECTOR_FLOATS = DETECTOR_SIZE * DETECTOR_SIZE * DETECTOR_CHANNELS;

/** Landmark input dimensions for the v1 ONNX contract. */
export const LANDMARK_INPUT_SIZE = 256;
export const LANDMARK_INPUT_CHANNELS = 3;
export const LANDMARK_INPUT_FLOATS =
	LANDMARK_INPUT_SIZE * LANDMARK_INPUT_SIZE * LANDMARK_INPUT_CHANNELS;

// ─── Types ──────────────────────────────────────────────────────────────

export interface PreprocessResult {
	/** Detector input tensor [1, 192, 192, 3] normalized to [0, 1]. */
	detectorInput: Float32Array;
	/** Landmark input tensor [1, 256, 256, 3] normalized to [0, 1]. */
	landmarkInput: Float32Array;
}

export interface PreprocessRegion {
	/** Region of interest in clip-local normalized coords [x, y, w, h]. */
	x: number;
	y: number;
	w: number;
	h: number;
}

// ─── Frame close tracking ───────────────────────────────────────────────

/**
 * Ensure a VideoFrame is closed exactly once. Returns a wrapper that
 * tracks close state and prevents double-close.
 */
export function trackFrameClose(frame: VideoFrame): {
	frame: VideoFrame;
	close: () => void;
	isClosed: boolean;
} {
	let closed = false;
	return {
		frame,
		close: () => {
			if (!closed) {
				closed = true;
				frame.close();
			}
		},
		get isClosed() {
			return closed;
		}
	};
}

// ─── CPU preprocess (reduced tier) ──────────────────────────────────────

/**
 * Extract a region of interest from frame data and resize to target size.
 * This is the CPU fallback for reduced tiers without GPU preprocess.
 *
 * @param frameData - RGBA pixel data from VideoFrame.
 * @param frameWidth - Source frame width.
 * @param frameHeight - Source frame height.
 * @param roi - Region of interest in normalized coords.
 * @param targetSize - Target square size (192 or 256).
 * @returns Normalized Float32Array [targetSize × targetSize × 3].
 */
export function cpuPreprocessROI(
	frameData: Uint8ClampedArray,
	frameWidth: number,
	frameHeight: number,
	roi: PreprocessRegion,
	targetSize: number
): Float32Array {
	const out = new Float32Array(targetSize * targetSize * 3);

	const rawX0 = roi.x * frameWidth;
	const rawY0 = roi.y * frameHeight;
	const rawX1 = (roi.x + roi.w) * frameWidth;
	const rawY1 = (roi.y + roi.h) * frameHeight;
	const x0 = Math.min(rawX0, rawX1);
	const y0 = Math.min(rawY0, rawY1);
	const x1 = Math.max(rawX0, rawX1);
	const y1 = Math.max(rawY0, rawY1);
	const srcX0 = Math.min(Math.max(x0, 0), Math.max(0, frameWidth - 1));
	const srcY0 = Math.min(Math.max(y0, 0), Math.max(0, frameHeight - 1));
	const srcX1 = Math.min(Math.max(x1, srcX0 + 1), frameWidth);
	const srcY1 = Math.min(Math.max(y1, srcY0 + 1), frameHeight);
	const srcW = Math.max(1, srcX1 - srcX0);
	const srcH = Math.max(1, srcY1 - srcY0);
	const denom = Math.max(1, targetSize - 1);

	for (let dy = 0; dy < targetSize; dy++) {
		for (let dx = 0; dx < targetSize; dx++) {
			// Bilinear sample from source ROI
			const sx = Math.min(srcX0 + (dx / denom) * srcW, frameWidth - 1);
			const sy = Math.min(srcY0 + (dy / denom) * srcH, frameHeight - 1);

			const x0 = Math.floor(sx);
			const y0 = Math.floor(sy);
			const x1 = Math.min(x0 + 1, frameWidth - 1);
			const y1 = Math.min(y0 + 1, frameHeight - 1);

			const fx = sx - x0;
			const fy = sy - y0;

			const idx00 = (y0 * frameWidth + x0) * 4;
			const idx10 = (y0 * frameWidth + x1) * 4;
			const idx01 = (y1 * frameWidth + x0) * 4;
			const idx11 = (y1 * frameWidth + x1) * 4;

			const outIdx = (dy * targetSize + dx) * 3;
			for (let c = 0; c < 3; c++) {
				const v00 = frameData[idx00 + c]!;
				const v10 = frameData[idx10 + c]!;
				const v01 = frameData[idx01 + c]!;
				const v11 = frameData[idx11 + c]!;

				const v0 = v00 + (v10 - v00) * fx;
				const v1 = v01 + (v11 - v01) * fx;
				out[outIdx + c] = (v0 + (v1 - v0) * fy) / 255;
			}
		}
	}

	return out;
}
