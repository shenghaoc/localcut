/**
 * Phase 42: Webcam PiP layout preset transform derivation.
 *
 * Pure function — fully unit-testable. Derives normalised (0–1) P12
 * ClipTransformSnapshot fields from a corner + size + margin selection.
 */

export type WebcamPipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type WebcamPipSize = 'S' | 'M' | 'L';

export interface WebcamPipPreset {
	corner: WebcamPipCorner;
	size: WebcamPipSize;
	marginPx: number;
}

export const DEFAULT_WEBCAM_PRESET: WebcamPipPreset = {
	corner: 'bottom-right',
	size: 'M',
	marginPx: 16
};

const SIZE_PERCENT: Record<WebcamPipSize, number> = {
	S: 0.2,
	M: 0.3,
	L: 0.4
};

const MIN_MARGIN = 0;
const MAX_MARGIN = 64;

/**
 * Derives normalised (0–1) P12 clip transform for the webcam clip.
 *
 * @param preset   Corner, size, and margin selection.
 * @param canvasW  Export canvas width in pixels.
 * @param canvasH  Export canvas height in pixels.
 * @param sourceW  Webcam source width in pixels (for aspect ratio).
 * @param sourceH  Webcam source height in pixels (for aspect ratio).
 * @returns `{ x, y, width, height }` matching ClipTransformSnapshot layout fields.
 */
export function deriveWebcamTransform(
	preset: WebcamPipPreset,
	canvasW: number,
	canvasH: number,
	sourceW: number,
	sourceH: number
): { x: number; y: number; width: number; height: number } {
	const clampedMargin = Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, preset.marginPx));

	const webcamW = SIZE_PERCENT[preset.size];
	const webcamH = webcamW * (canvasW / canvasH) * (sourceH / sourceW);

	// Separate X/Y normalisation for non-square canvases.
	const marginX = clampedMargin / canvasW;
	const marginY = clampedMargin / canvasH;

	let x: number;
	let y: number;

	switch (preset.corner) {
		case 'bottom-right':
			x = 1 - marginX - webcamW;
			y = 1 - marginY - webcamH;
			break;
		case 'bottom-left':
			x = marginX;
			y = 1 - marginY - webcamH;
			break;
		case 'top-right':
			x = 1 - marginX - webcamW;
			y = marginY;
			break;
		case 'top-left':
			x = marginX;
			y = marginY;
			break;
	}

	return { x, y, width: webcamW, height: webcamH };
}
