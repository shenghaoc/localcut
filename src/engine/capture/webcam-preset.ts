/**
 * Phase 42: Webcam PiP layout preset transform derivation.
 *
 * Pure function — fully unit-testable. Derives normalised (0–1) P12
 * ClipTransformSnapshot fields from a corner + size + margin selection.
 */

import type { TransformParamsSnapshot } from '../../protocol';
import { computeFitRect } from '../transform';

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
 * Derives a P12 TransformParamsSnapshot for the webcam PiP clip.
 *
 * The transform uses `fit: 'fit'` so the source is contained within the
 * output, then scales and positions it to the requested corner/size/margin.
 *
 * @param preset   Corner, size, and margin selection.
 * @param canvasW  Export canvas width in pixels.
 * @param canvasH  Export canvas height in pixels.
 * @param sourceW  Webcam source width in pixels (for aspect ratio).
 * @param sourceH  Webcam source height in pixels (for aspect ratio).
 * @returns A partial TransformParamsSnapshot (x, y, scale, fit).
 */
export function deriveWebcamTransform(
	preset: WebcamPipPreset,
	canvasW: number,
	canvasH: number,
	sourceW: number,
	sourceH: number
): Pick<TransformParamsSnapshot, 'x' | 'y' | 'scale' | 'fit'> {
	const clampedMargin = Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, preset.marginPx));

	// Normalized size of the source at scale=1 with 'fit' mode.
	const fitRect = computeFitRect(sourceW, sourceH, canvasW, canvasH, 'fit');
	const targetW = SIZE_PERCENT[preset.size];
	const scale = targetW / fitRect.width;

	// Actual normalized dimensions after scale.
	const halfW = (fitRect.width * scale) / 2;
	const halfH = (fitRect.height * scale) / 2;

	// Normalized margin.
	const marginX = clampedMargin / canvasW;
	const marginY = clampedMargin / canvasH;

	// Center position in [0,1] space.
	let cx: number;
	let cy: number;

	switch (preset.corner) {
		case 'bottom-right':
			cx = 1 - marginX - halfW;
			cy = 1 - marginY - halfH;
			break;
		case 'bottom-left':
			cx = marginX + halfW;
			cy = 1 - marginY - halfH;
			break;
		case 'top-right':
			cx = 1 - marginX - halfW;
			cy = marginY + halfH;
			break;
		case 'top-left':
			cx = marginX + halfW;
			cy = marginY + halfH;
			break;
	}

	// Convert from [0,1] center to TransformParamsSnapshot offset from 0.5.
	return {
		x: cx - 0.5,
		y: cy - 0.5,
		scale,
		fit: 'fit'
	};
}
