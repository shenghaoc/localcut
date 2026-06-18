/**
 * Pure decode helpers for the ORT face detector.
 *
 * Different face-detection ONNX models emit boxes in different ways:
 * - **Raw bbox** (YuNet, SCRFD-class): per-candidate boxes already in
 *   normalised image coordinates (xyxy or xywh).
 * - **Anchor-offset** (BlazeFace, MTCNN-class): per-candidate offsets relative
 *   to fixed anchor priors; the decoder reconstructs the box from anchor +
 *   offset.
 *
 * This module is intentionally pure (no ONNX Runtime import, no DOM/Worker
 * APIs) so the decode contract — score thresholding, optional sigmoid,
 * normalisation, anchor reconstruction, greedy NMS — can be exercised by unit
 * tests on synthetic tensors without spinning up an ORT session.
 *
 * The output is always a list of normalised {@link FaceDetection} boxes the
 * Smart Reframe tracker can consume directly.
 */
import type { FaceDetection } from './face-detector';

/** A single anchor prior (centre + size) in normalised image coordinates. */
export interface AnchorPrior {
	cx: number;
	cy: number;
	width: number;
	height: number;
}

/** Common decode tuning shared by every decoder. */
export interface BaseDecodeConfig {
	/** Minimum confidence (post-sigmoid, post-thresholding). */
	scoreThreshold: number;
	/** IoU threshold for greedy NMS (descending score). */
	iouThreshold: number;
	/** Maximum boxes to return after NMS. */
	maxDetections: number;
	/** Apply a sigmoid to raw scores before thresholding (logit-output models). */
	applySigmoid?: boolean;
	/** Number of scalar score entries per candidate (default 1). */
	scoreStride?: number;
	/** Index inside each score row to read, e.g. 1 for `[background, face]`. */
	scoreIndex?: number;
}

/** Decode parameters for direct-bbox models (YuNet / SCRFD class). */
export interface RawBboxDecodeConfig extends BaseDecodeConfig {
	type: 'raw-bbox';
	/** How `boxes` are laid out per candidate. */
	boxFormat: 'xyxy-normalized' | 'xywh-normalized' | 'xywh-pixel';
}

/** Decode parameters for anchor-offset models (BlazeFace class). */
export interface AnchorOffsetDecodeConfig extends BaseDecodeConfig {
	type: 'anchor-offset';
	/** Anchor priors — one per candidate, in normalised coordinates. */
	anchors: readonly AnchorPrior[];
	/**
	 * Variance scaling applied to the offsets. Many MTCNN/BlazeFace exports
	 * use unit variance (the model emits centre+log-size offsets that the
	 * decoder maps directly), so the default is `[1, 1, 1, 1]`. SSD-style
	 * graphs typically pin `[0.1, 0.1, 0.2, 0.2]`.
	 */
	variance?: readonly [number, number, number, number];
}

export type DecodeConfig = RawBboxDecodeConfig | AnchorOffsetDecodeConfig;

/** A candidate prior to NMS — already in normalised image coordinates. */
export interface DecodedCandidate {
	x: number;
	y: number;
	width: number;
	height: number;
	confidence: number;
}

const ZERO_BOX: DecodedCandidate = { x: 0, y: 0, width: 0, height: 0, confidence: 0 };

/** Standard logistic. Pure, no NaN propagation (clamped at the math limits). */
export function sigmoid(x: number): number {
	if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
	if (x >= 0) {
		const z = Math.exp(-x);
		return 1 / (1 + z);
	}
	const z = Math.exp(x);
	return z / (1 + z);
}

/** Clamp a value to `[lo, hi]`; defaults to `[0, 1]`. NaN → `lo`. */
export function clamp01(value: number, lo: number = 0, hi: number = 1): number {
	if (!Number.isFinite(value)) return lo;
	if (value < lo) return lo;
	if (value > hi) return hi;
	return value;
}

/**
 * Intersection-over-union for two boxes in `xywh` (corner origin).
 *
 * The denominator is the *union* area, not the bigger box, so two identical
 * boxes give exactly 1 and disjoint boxes give exactly 0. Returns 0 when either
 * box is degenerate (zero width/height) so degenerate predictions never sneak
 * through NMS.
 */
export function iou(a: DecodedCandidate, b: DecodedCandidate): number {
	if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0;
	const ax2 = a.x + a.width;
	const ay2 = a.y + a.height;
	const bx2 = b.x + b.width;
	const by2 = b.y + b.height;
	const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
	const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
	const inter = ix * iy;
	if (inter <= 0) return 0;
	const union = a.width * a.height + b.width * b.height - inter;
	return union > 0 ? inter / union : 0;
}

/**
 * Greedy non-maximum suppression. Candidates are sorted by confidence
 * (descending) — the highest-scoring one is kept, and any candidate whose IoU
 * with it exceeds {@link DecodeConfig.iouThreshold} is discarded. The process
 * repeats on what's left until at most `maxDetections` survive.
 *
 * Pure and total — never throws. An empty input returns an empty array.
 */
export function nonMaxSuppression(
	candidates: readonly DecodedCandidate[],
	iouThreshold: number,
	maxDetections: number
): DecodedCandidate[] {
	if (candidates.length === 0 || maxDetections <= 0) return [];
	const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
	const kept: DecodedCandidate[] = [];
	for (const candidate of sorted) {
		if (kept.length >= maxDetections) break;
		let suppressed = false;
		for (const winner of kept) {
			if (iou(candidate, winner) >= iouThreshold) {
				suppressed = true;
				break;
			}
		}
		if (!suppressed) kept.push(candidate);
	}
	return kept;
}

function activatedScore(raw: number, applySigmoid: boolean): number {
	if (!Number.isFinite(raw)) return 0;
	const activated = applySigmoid ? sigmoid(raw) : raw;
	if (activated <= 0) return 0;
	if (activated >= 1) return 1;
	return activated;
}

function scoreCandidateCount(scores: ArrayLike<number>, config: BaseDecodeConfig): number {
	const stride = config.scoreStride ?? 1;
	const index = config.scoreIndex ?? 0;
	if (stride <= 0 || index < 0 || index >= stride || index >= scores.length) return 0;
	return Math.floor((scores.length - 1 - index) / stride) + 1;
}

function scoreAt(scores: ArrayLike<number>, index: number, config: BaseDecodeConfig): number {
	const stride = config.scoreStride ?? 1;
	const scoreIndex = config.scoreIndex ?? 0;
	return scores[index * stride + scoreIndex] as number;
}

/**
 * Decode a flat boxes/scores pair from a raw-bbox model. `boxes` is laid out
 * `[N * 4]` — one box per candidate in the order matching the configured score
 * row (`scores[i * scoreStride + scoreIndex]`). Boxes in `xywh-pixel` are
 * normalised by the source's pixel dimensions.
 *
 * Returns the candidates surviving {@link BaseDecodeConfig.scoreThreshold}
 * (degenerate boxes always dropped). NMS is applied separately by
 * {@link decodeRawBboxOutput}.
 */
export function decodeRawBboxCandidates(
	boxes: ArrayLike<number>,
	scores: ArrayLike<number>,
	config: RawBboxDecodeConfig,
	sourceWidth: number = 1,
	sourceHeight: number = 1
): DecodedCandidate[] {
	const n = Math.min(scoreCandidateCount(scores, config), Math.floor(boxes.length / 4));
	const out: DecodedCandidate[] = [];
	for (let i = 0; i < n; i++) {
		const confidence = activatedScore(scoreAt(scores, i, config), config.applySigmoid === true);
		if (confidence < config.scoreThreshold) continue;
		const offset = i * 4;
		const candidate = readBox(
			boxes,
			offset,
			config.boxFormat,
			sourceWidth,
			sourceHeight,
			confidence
		);
		if (candidate.width <= 0 || candidate.height <= 0) continue;
		out.push(candidate);
	}
	return out;
}

function readBox(
	boxes: ArrayLike<number>,
	offset: number,
	format: RawBboxDecodeConfig['boxFormat'],
	srcW: number,
	srcH: number,
	confidence: number
): DecodedCandidate {
	const a = boxes[offset] as number;
	const b = boxes[offset + 1] as number;
	const c = boxes[offset + 2] as number;
	const d = boxes[offset + 3] as number;
	if (![a, b, c, d].every(Number.isFinite)) return { ...ZERO_BOX, confidence };
	switch (format) {
		case 'xyxy-normalized': {
			const x = clamp01(Math.min(a, c));
			const y = clamp01(Math.min(b, d));
			const x2 = clamp01(Math.max(a, c));
			const y2 = clamp01(Math.max(b, d));
			return { x, y, width: x2 - x, height: y2 - y, confidence };
		}
		case 'xywh-normalized': {
			const x = clamp01(a);
			const y = clamp01(b);
			const x2 = clamp01(a + c);
			const y2 = clamp01(b + d);
			return { x, y, width: x2 - x, height: y2 - y, confidence };
		}
		case 'xywh-pixel': {
			const x = clamp01(a / srcW);
			const y = clamp01(b / srcH);
			const x2 = clamp01((a + c) / srcW);
			const y2 = clamp01((b + d) / srcH);
			return { x, y, width: x2 - x, height: y2 - y, confidence };
		}
	}
}

/**
 * Decode a raw-bbox face-detector output to normalised {@link FaceDetection}
 * boxes, applying the score threshold + greedy NMS + max-detections cap from
 * the config. Pure.
 */
export function decodeRawBboxOutput(
	boxes: ArrayLike<number>,
	scores: ArrayLike<number>,
	config: RawBboxDecodeConfig,
	sourceWidth: number = 1,
	sourceHeight: number = 1
): FaceDetection[] {
	const candidates = decodeRawBboxCandidates(boxes, scores, config, sourceWidth, sourceHeight);
	const kept = nonMaxSuppression(candidates, config.iouThreshold, config.maxDetections);
	return kept.map(toFaceDetection);
}

/**
 * Decode BlazeFace-style anchor-offset outputs to normalised candidates,
 * applying the score threshold (degenerate boxes always dropped). NMS is
 * applied separately by {@link decodeAnchorOffsetOutput}.
 *
 * Convention used by anchor-offset face detector exports:
 * - `offsets[i*4 + 0,1]` — centre offset `(dx, dy)` from the anchor's centre,
 *   in anchor-relative units (variance-scaled when configured).
 * - `offsets[i*4 + 2,3]` — `(dw, dh)` size offset; multiplied by the anchor
 *   size to give the box size. Pre-existing softplus / log-space is the
 *   model's responsibility; this decoder treats them as already-decoded sizes.
 *
 * Mismatched array lengths are tolerated by truncating to the shortest of
 * `scores`, `offsets / 4`, and `anchors`.
 */
export function decodeAnchorOffsetCandidates(
	offsets: ArrayLike<number>,
	scores: ArrayLike<number>,
	config: AnchorOffsetDecodeConfig
): DecodedCandidate[] {
	const variance = config.variance ?? [1, 1, 1, 1];
	const n = Math.min(
		scoreCandidateCount(scores, config),
		Math.floor(offsets.length / 4),
		config.anchors.length
	);
	const out: DecodedCandidate[] = [];
	for (let i = 0; i < n; i++) {
		const confidence = activatedScore(scoreAt(scores, i, config), config.applySigmoid === true);
		if (confidence < config.scoreThreshold) continue;
		const anchor = config.anchors[i]!;
		const dxRaw = offsets[i * 4] as number;
		const dyRaw = offsets[i * 4 + 1] as number;
		const dwRaw = offsets[i * 4 + 2] as number;
		const dhRaw = offsets[i * 4 + 3] as number;
		if (![dxRaw, dyRaw, dwRaw, dhRaw].every(Number.isFinite)) continue;
		const cx = anchor.cx + dxRaw * variance[0] * anchor.width;
		const cy = anchor.cy + dyRaw * variance[1] * anchor.height;
		const width = anchor.width * dwRaw * variance[2];
		const height = anchor.height * dhRaw * variance[3];
		if (!(width > 0) || !(height > 0)) continue;
		const x0 = clamp01(cx - width / 2);
		const y0 = clamp01(cy - height / 2);
		const x1 = clamp01(cx + width / 2);
		const y1 = clamp01(cy + height / 2);
		const w = x1 - x0;
		const h = y1 - y0;
		if (w <= 0 || h <= 0) continue;
		out.push({ x: x0, y: y0, width: w, height: h, confidence });
	}
	return out;
}

/**
 * Decode an anchor-offset face-detector output to normalised
 * {@link FaceDetection} boxes, applying the score threshold + greedy NMS +
 * max-detections cap from the config. Pure.
 */
export function decodeAnchorOffsetOutput(
	offsets: ArrayLike<number>,
	scores: ArrayLike<number>,
	config: AnchorOffsetDecodeConfig
): FaceDetection[] {
	const candidates = decodeAnchorOffsetCandidates(offsets, scores, config);
	const kept = nonMaxSuppression(candidates, config.iouThreshold, config.maxDetections);
	return kept.map(toFaceDetection);
}

/** Strip the internal candidate type to the public {@link FaceDetection} shape. */
function toFaceDetection(candidate: DecodedCandidate): FaceDetection {
	return {
		x: candidate.x,
		y: candidate.y,
		width: candidate.width,
		height: candidate.height,
		confidence: candidate.confidence
	};
}
