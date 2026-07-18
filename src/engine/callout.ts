/** Phase 43: Callout data types, normalisation, hashing, and Canvas2D rasterisation.
 *
 *  Arrow/box/step callouts rasterise through OffscreenCanvas 2D (P14 pattern).
 *  Spotlight/blur callouts are WGSL effect passes — see shaders/spotlight.wgsl
 *  and shaders/blur-region.wgsl.
 */

import { hashString } from './cache-key';
import type {
	CalloutArrowGeometry,
	CalloutBoxGeometry,
	CalloutGeometry,
	CalloutKind,
	CalloutPayload,
	CalloutRegionGeometry,
	CalloutStepGeometry,
	CalloutStyle
} from '../protocol';

export type {
	CalloutArrowGeometry,
	CalloutBoxGeometry,
	CalloutGeometry,
	CalloutKind,
	CalloutPayload,
	CalloutRegionGeometry,
	CalloutStepGeometry,
	CalloutStyle
};

/** Film-stock amber — same hex as UI `--amber`. Callouts share the single accent;
 *  a second gold would read as palette drift in the tool chrome and on-preview. */
export const DEFAULT_CALLOUT_COLOR = '#d4a853';

export const DEFAULT_CALLOUT_STYLE: CalloutStyle = {
	color: DEFAULT_CALLOUT_COLOR,
	strokeWidth: 3,
	fillOpacity: 0,
	fontSize: 28,
	arrowheadSize: 14,
	blurRadius: 12,
	darkenStrength: 0.7
};

function defaultGeometry(kind: CalloutKind): CalloutGeometry {
	switch (kind) {
		case 'arrow':
			return { kind: 'arrow', x1: 0.2, y1: 0.8, x2: 0.8, y2: 0.2 };
		case 'box':
			return { kind: 'box', x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
		case 'step':
			return { kind: 'step', cx: 0.5, cy: 0.5, r: 0.05, number: 1 };
		case 'spotlight':
			return { kind: 'spotlight' };
		case 'blur':
			return { kind: 'blur' };
	}
}

/** Fill defaults for any missing style or geometry fields. */
export function normalizeCalloutPayload(
	partial: Partial<CalloutPayload> & { calloutKind: CalloutKind }
): CalloutPayload {
	const style: CalloutStyle = { ...DEFAULT_CALLOUT_STYLE, ...partial.style };
	const geometry = partial.geometry ?? defaultGeometry(partial.calloutKind);
	return { calloutKind: partial.calloutKind, geometry, style };
}

/** Validate and parse a raw value into a CalloutPayload, or return null. */
export function parseCalloutPayload(value: unknown): CalloutPayload | null {
	if (typeof value !== 'object' || value === null) return null;
	const obj = value as Record<string, unknown>;
	const kind = obj.calloutKind;
	if (
		kind !== 'arrow' &&
		kind !== 'box' &&
		kind !== 'step' &&
		kind !== 'spotlight' &&
		kind !== 'blur'
	)
		return null;
	if (typeof obj.geometry !== 'object' || obj.geometry === null) return null;
	if (typeof obj.style !== 'object' || obj.style === null) return null;

	const geo = obj.geometry as Record<string, unknown>;
	const sty = obj.style as Record<string, unknown>;

	// Validate geometry fields per kind
	switch (kind) {
		case 'arrow':
			if (typeof geo.x1 !== 'number' || typeof geo.y1 !== 'number') return null;
			if (typeof geo.x2 !== 'number' || typeof geo.y2 !== 'number') return null;
			break;
		case 'box':
			if (typeof geo.x !== 'number' || typeof geo.y !== 'number') return null;
			if (typeof geo.w !== 'number' || typeof geo.h !== 'number') return null;
			break;
		case 'step':
			if (typeof geo.cx !== 'number' || typeof geo.cy !== 'number') return null;
			if (typeof geo.r !== 'number' || typeof geo.number !== 'number') return null;
			break;
		case 'spotlight':
		case 'blur':
			// Region geometry has no required numeric fields
			break;
	}

	const style: CalloutStyle = {
		color: typeof sty.color === 'string' ? sty.color : DEFAULT_CALLOUT_STYLE.color,
		strokeWidth:
			typeof sty.strokeWidth === 'number' ? sty.strokeWidth : DEFAULT_CALLOUT_STYLE.strokeWidth,
		fillOpacity:
			typeof sty.fillOpacity === 'number' ? sty.fillOpacity : DEFAULT_CALLOUT_STYLE.fillOpacity,
		fontSize: typeof sty.fontSize === 'number' ? sty.fontSize : DEFAULT_CALLOUT_STYLE.fontSize,
		arrowheadSize:
			typeof sty.arrowheadSize === 'number'
				? sty.arrowheadSize
				: DEFAULT_CALLOUT_STYLE.arrowheadSize,
		blurRadius:
			typeof sty.blurRadius === 'number' ? sty.blurRadius : DEFAULT_CALLOUT_STYLE.blurRadius,
		darkenStrength:
			typeof sty.darkenStrength === 'number'
				? sty.darkenStrength
				: DEFAULT_CALLOUT_STYLE.darkenStrength
	};

	return { calloutKind: kind, geometry: geo as unknown as CalloutGeometry, style };
}

/**
 * Stable hash of the callout's visual appearance for texture cache keying.
 * Uses the synchronous SHA-256 from cache-key.ts (not async WebCrypto).
 */
export function calloutContentHash(payload: CalloutPayload): string {
	const normalized = normalizeCalloutPayload(payload);
	return hashString(JSON.stringify(normalized)).slice(0, 32);
}

/**
 * Rasterise arrow/box/step callouts to an OffscreenCanvas using Canvas2D.
 * Called on the cold path (style/geometry change), never per-frame.
 * Returns without drawing for spotlight/blur (these are WGSL passes).
 */
export function rasterizeCallout(
	ctx: OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	payload: CalloutPayload
): void {
	const { calloutKind, geometry, style } = payload;

	if (calloutKind === 'spotlight' || calloutKind === 'blur') return;

	ctx.clearRect(0, 0, width, height);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	switch (calloutKind) {
		case 'arrow':
			rasterizeArrow(ctx, width, height, geometry as CalloutArrowGeometry, style);
			break;
		case 'box':
			rasterizeBox(ctx, width, height, geometry as CalloutBoxGeometry, style);
			break;
		case 'step':
			rasterizeStep(ctx, width, height, geometry as CalloutStepGeometry, style);
			break;
	}
}

function rasterizeArrow(
	ctx: OffscreenCanvasRenderingContext2D,
	w: number,
	h: number,
	geo: CalloutArrowGeometry,
	style: CalloutStyle
): void {
	const x1 = geo.x1 * w;
	const y1 = geo.y1 * h;
	const x2 = geo.x2 * w;
	const y2 = geo.y2 * h;

	// Shaft
	ctx.strokeStyle = style.color;
	ctx.lineWidth = style.strokeWidth;
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();

	// Arrowhead
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len < 1) return;
	const ux = dx / len;
	const uy = dy / len;
	const size = style.arrowheadSize;
	ctx.fillStyle = style.color;
	ctx.beginPath();
	ctx.moveTo(x2, y2);
	ctx.lineTo(x2 - size * ux + size * 0.5 * uy, y2 - size * uy - size * 0.5 * ux);
	ctx.lineTo(x2 - size * ux - size * 0.5 * uy, y2 - size * uy + size * 0.5 * ux);
	ctx.closePath();
	ctx.fill();
}

function rasterizeBox(
	ctx: OffscreenCanvasRenderingContext2D,
	w: number,
	h: number,
	geo: CalloutBoxGeometry,
	style: CalloutStyle
): void {
	const rx = geo.x * w;
	const ry = geo.y * h;
	const rw = geo.w * w;
	const rh = geo.h * h;
	const cornerRadius = 4;

	ctx.strokeStyle = style.color;
	ctx.lineWidth = style.strokeWidth;
	ctx.beginPath();
	ctx.roundRect(rx, ry, rw, rh, cornerRadius);
	ctx.stroke();

	if (style.fillOpacity > 0) {
		ctx.fillStyle = style.color;
		ctx.globalAlpha = style.fillOpacity;
		ctx.beginPath();
		ctx.roundRect(rx, ry, rw, rh, cornerRadius);
		ctx.fill();
		ctx.globalAlpha = 1;
	}
}

function rasterizeStep(
	ctx: OffscreenCanvasRenderingContext2D,
	w: number,
	h: number,
	geo: CalloutStepGeometry,
	style: CalloutStyle
): void {
	const cx = geo.cx * w;
	const cy = geo.cy * h;
	const r = geo.r * Math.min(w, h);

	// Circle fill
	ctx.fillStyle = style.color;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fill();

	// Number text
	const label = String(Math.max(1, Math.min(99, Math.round(geo.number))));
	ctx.fillStyle = '#FFFFFF';
	ctx.font = `bold ${style.fontSize}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(label, cx, cy);
}
