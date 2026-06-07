/** Per-clip transform model + fit-mode math + uniform packing — Phase 12. */

/**
 * How a layer whose source aspect differs from the output is sized before the
 * user transform is applied:
 *  - `fill`      — cover the output, cropping overflow (no bars).
 *  - `fit`       — contain within the output, surrounding area left transparent
 *                  so lower layers show through (picture-in-picture default).
 *  - `letterbox` — contain within the output, surrounding area filled opaque
 *                  black (bars) so the layer occludes lower layers.
 */
export type FitMode = 'fill' | 'fit' | 'letterbox';

export const FIT_MODES: readonly FitMode[] = ['fill', 'fit', 'letterbox'];

/**
 * Per-clip transform. Position is a fraction of the output dimensions (0 keeps
 * the layer centered); rotation is clockwise degrees; opacity is 0..1; the
 * anchor is the rotation/scale pivot in layer-local [0,1] space. The identity
 * transform (all defaults) is a no-op pass-through.
 */
export interface TransformParams {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  fit: FitMode;
}

export const DEFAULT_TRANSFORM: TransformParams = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  fit: 'fill',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeFit(value: unknown): FitMode {
  return value === 'fit' || value === 'letterbox' || value === 'fill' ? value : DEFAULT_TRANSFORM.fit;
}

export function normalizeTransform(partial: Partial<TransformParams> | undefined): TransformParams {
  return {
    x: finiteOr(partial?.x, DEFAULT_TRANSFORM.x),
    y: finiteOr(partial?.y, DEFAULT_TRANSFORM.y),
    // A zero or negative scale would collapse the layer; floor it just above 0.
    scale: Math.max(1e-3, finiteOr(partial?.scale, DEFAULT_TRANSFORM.scale)),
    rotation: finiteOr(partial?.rotation, DEFAULT_TRANSFORM.rotation),
    opacity: clamp(finiteOr(partial?.opacity, DEFAULT_TRANSFORM.opacity), 0, 1),
    anchorX: clamp(finiteOr(partial?.anchorX, DEFAULT_TRANSFORM.anchorX), 0, 1),
    anchorY: clamp(finiteOr(partial?.anchorY, DEFAULT_TRANSFORM.anchorY), 0, 1),
    fit: normalizeFit(partial?.fit),
  };
}

export function transformsEqual(a: TransformParams, b: TransformParams): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.opacity === b.opacity &&
    a.anchorX === b.anchorX &&
    a.anchorY === b.anchorY &&
    a.fit === b.fit
  );
}

/** True when the transform leaves the layer untouched (identity, fully opaque, fill). */
export function isIdentityTransform(t: TransformParams): boolean {
  return transformsEqual(normalizeTransform(t), DEFAULT_TRANSFORM);
}

export interface FitRect {
  /** Normalized layer width/height within the output (before the user scale). */
  width: number;
  height: number;
}

/**
 * Normalized size of the source rectangle within the output for a fit mode,
 * preserving the source aspect ratio. `fill` covers (≥1 on the limiting axis),
 * `fit`/`letterbox` contain (≤1 on the limiting axis).
 */
export function computeFitRect(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  mode: FitMode,
): FitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || outputWidth <= 0 || outputHeight <= 0) {
    return { width: 1, height: 1 };
  }
  // ratio > 1 ⇒ the source is "wider" than the output relative to their aspects.
  const ratio = (sourceWidth / sourceHeight) / (outputWidth / outputHeight);
  if (mode === 'fill') {
    return ratio >= 1 ? { width: ratio, height: 1 } : { width: 1, height: 1 / ratio };
  }
  // contain (fit / letterbox)
  return ratio >= 1 ? { width: 1, height: 1 / ratio } : { width: ratio, height: 1 };
}

/** Floats per transform uniform: mat2 columns + translation + opacity + fit flag,
 *  then the layer "card" extents (fit rect + anchor) used to bound letterbox bars. */
export const TRANSFORM_UNIFORM_FLOATS = 12;
export const TRANSFORM_UNIFORM_BYTES = TRANSFORM_UNIFORM_FLOATS * 4;

/**
 * Packs the inverse affine used by `transform.wgsl` to map an output texel to a
 * layer-local sample coordinate, so the shader stays a single matrix-multiply.
 *
 * Forward map (layer-local `l` ∈ [0,1]² → output-normalized `o`):
 *   v = R(θ) · ((l − anchor) · rectSize · scale);  o = center + v
 * with `center = (0.5 + x, 0.5 + y)` and `rectSize` from {@link computeFitRect}.
 * Inverting gives `l = M·o + t`, where
 *   M = diag(1/sx, 1/sy) · R(−θ)  and  t = anchor − M·center.
 *
 * Layout: [m00, m01, m10, m11, t0, t1, opacity, fitFlag, rectW, rectH, anchorX, anchorY].
 * `fitFlag` is 1 for `letterbox` (out-of-source texels become opaque black) and
 * 0 otherwise (out-of-source texels become transparent). The trailing `rect`/
 * `anchor` let the shader recover the layer "card" coordinate
 * `k = 0.5 + (l − anchor)·rect` and so paint letterbox bars only *inside* the
 * transformed layer (`k ∈ [0,1]²`), leaving everything beyond it transparent.
 */
export function packTransformUniform(
  t: TransformParams,
  outputWidth: number,
  outputHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): Float32Array {
  // For 90°/270° rotations (the values that real-world rotation metadata produces)
  // the layer's bounding box is the source rectangle transposed. Computing the fit
  // rect on the un-swapped dimensions makes a portrait source displayed as landscape
  // (e.g. a 2160×3840 phone frame in a 3840×2160 output) scale up massively before
  // rotation and then get cropped. Swap the source dims when the rotation is an
  // odd quarter-turn so the fit rect matches the rotated layer's aspect.
  const quarterTurns = t.rotation / 90;
  const nearestQuarter = Math.round(quarterTurns);
  const isQuarterTurn = Math.abs(quarterTurns - nearestQuarter) < 1e-3;
  const swap = isQuarterTurn && ((nearestQuarter % 2) + 2) % 2 === 1;
  const fitSourceWidth = swap ? sourceHeight : sourceWidth;
  const fitSourceHeight = swap ? sourceWidth : sourceHeight;
  const rect = computeFitRect(fitSourceWidth, fitSourceHeight, outputWidth, outputHeight, t.fit);
  const sx = Math.max(1e-6, rect.width * t.scale);
  const sy = Math.max(1e-6, rect.height * t.scale);
  const theta = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // M = diag(1/sx, 1/sy) · R(−θ), with R(−θ) = [[cos, sin], [−sin, cos]].
  const m00 = cos / sx;
  const m01 = sin / sx;
  const m10 = -sin / sy;
  const m11 = cos / sy;

  const cx = 0.5 + t.x;
  const cy = 0.5 + t.y;
  // t = anchor − M·center.
  const t0 = t.anchorX - (m00 * cx + m01 * cy);
  const t1 = t.anchorY - (m10 * cx + m11 * cy);

  const fitFlag = t.fit === 'letterbox' ? 1 : 0;

  return new Float32Array([
    m00, m01, m10, m11,
    t0, t1, clamp(t.opacity, 0, 1), fitFlag,
    rect.width, rect.height, t.anchorX, t.anchorY,
  ]);
}
