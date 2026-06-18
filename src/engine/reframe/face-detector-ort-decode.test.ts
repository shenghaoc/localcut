import { describe, it, expect } from 'vite-plus/test';
import {
	clamp01,
	decodeAnchorOffsetCandidates,
	decodeAnchorOffsetOutput,
	decodeRawBboxCandidates,
	decodeRawBboxOutput,
	iou,
	nonMaxSuppression,
	sigmoid,
	type AnchorOffsetDecodeConfig,
	type DecodedCandidate,
	type RawBboxDecodeConfig
} from './face-detector-ort-decode';

const RAW_BASE: RawBboxDecodeConfig = {
	type: 'raw-bbox',
	boxFormat: 'xyxy-normalized',
	scoreThreshold: 0.5,
	iouThreshold: 0.3,
	maxDetections: 16
};

function box(
	x: number,
	y: number,
	width: number,
	height: number,
	confidence = 0.9
): DecodedCandidate {
	return { x, y, width, height, confidence };
}

describe('sigmoid', () => {
	it('maps 0 to 0.5', () => {
		expect(sigmoid(0)).toBeCloseTo(0.5, 12);
	});
	it('is monotonically increasing across a wide range', () => {
		expect(sigmoid(-5)).toBeLessThan(sigmoid(-1));
		expect(sigmoid(-1)).toBeLessThan(sigmoid(0));
		expect(sigmoid(0)).toBeLessThan(sigmoid(1));
		expect(sigmoid(1)).toBeLessThan(sigmoid(5));
	});
	it('saturates without overflow on extreme inputs', () => {
		expect(sigmoid(1000)).toBe(1);
		expect(sigmoid(-1000)).toBe(0);
		// Past finite range: ±Infinity collapse to the asymptote.
		expect(sigmoid(Number.POSITIVE_INFINITY)).toBe(1);
		expect(sigmoid(Number.NEGATIVE_INFINITY)).toBe(0);
	});
});

describe('clamp01', () => {
	it('clamps below the floor to the floor', () => {
		expect(clamp01(-0.5)).toBe(0);
	});
	it('clamps above the ceiling to the ceiling', () => {
		expect(clamp01(1.5)).toBe(1);
	});
	it('passes through values in range', () => {
		expect(clamp01(0.5)).toBe(0.5);
	});
	it('treats NaN as the floor', () => {
		expect(clamp01(Number.NaN)).toBe(0);
	});
	it('honours an explicit range', () => {
		expect(clamp01(5, -2, 2)).toBe(2);
		expect(clamp01(-5, -2, 2)).toBe(-2);
	});
});

describe('iou', () => {
	it('returns 1 for identical boxes', () => {
		const b = box(0.1, 0.2, 0.3, 0.4);
		expect(iou(b, b)).toBeCloseTo(1, 12);
	});
	it('returns 0 for disjoint boxes', () => {
		expect(iou(box(0, 0, 0.1, 0.1), box(0.5, 0.5, 0.1, 0.1))).toBe(0);
	});
	it('matches the canonical half-overlap calculation', () => {
		// Two unit boxes offset by 0.5 each → intersection 0.5×0.5 = 0.25,
		// union 2 − 0.25 = 1.75, IoU 0.25/1.75 ≈ 0.142857.
		const a = box(0, 0, 1, 1);
		const b = box(0.5, 0.5, 1, 1);
		expect(iou(a, b)).toBeCloseTo(0.25 / 1.75, 12);
	});
	it('is 0 when either box is degenerate', () => {
		expect(iou(box(0, 0, 0, 0.5), box(0, 0, 1, 1))).toBe(0);
		expect(iou(box(0, 0, 1, 1), box(0, 0, 0.5, 0))).toBe(0);
	});
});

describe('nonMaxSuppression', () => {
	it('keeps the highest-scoring box and suppresses overlapping lower ones', () => {
		const high = box(0, 0, 0.5, 0.5, 0.95);
		const overlap = box(0.05, 0.05, 0.5, 0.5, 0.9);
		const distant = box(0.6, 0.6, 0.3, 0.3, 0.8);
		const kept = nonMaxSuppression([overlap, high, distant], 0.3, 16);
		// `high` overlaps `overlap` (IoU well over 0.3) and survives, `overlap` is dropped.
		expect(kept).toContainEqual(high);
		expect(kept).toContainEqual(distant);
		expect(kept).not.toContainEqual(overlap);
	});
	it('respects maxDetections', () => {
		const candidates = Array.from({ length: 8 }, (_, i) =>
			box(i * 0.1, 0, 0.05, 0.05, 0.9 - i * 0.01)
		);
		expect(nonMaxSuppression(candidates, 0.3, 3)).toHaveLength(3);
	});
	it('returns an empty array for an empty input', () => {
		expect(nonMaxSuppression([], 0.3, 5)).toEqual([]);
	});
	it('returns an empty array when maxDetections is 0', () => {
		expect(nonMaxSuppression([box(0, 0, 1, 1, 0.9)], 0.3, 0)).toEqual([]);
	});
});

describe('decodeRawBboxCandidates', () => {
	it('drops candidates below the score threshold', () => {
		const boxes = new Float32Array([0, 0, 0.2, 0.2, 0.5, 0.5, 0.6, 0.6]);
		const scores = new Float32Array([0.9, 0.3]);
		const out = decodeRawBboxCandidates(boxes, scores, RAW_BASE);
		expect(out).toHaveLength(1);
		expect(out[0]!.x).toBeCloseTo(0, 6);
		expect(out[0]!.width).toBeCloseTo(0.2, 6);
		expect(out[0]!.confidence).toBeCloseTo(0.9, 6);
	});
	it('reads the configured face-class score from a multi-class score row', () => {
		const boxes = new Float32Array([0, 0, 0.2, 0.2, 0.5, 0.5, 0.8, 0.8]);
		// UltraFace-style scores: [background, face] for each candidate.
		const scores = new Float32Array([0.99, 0.2, 0.1, 0.92]);
		const out = decodeRawBboxCandidates(boxes, scores, {
			...RAW_BASE,
			scoreStride: 2,
			scoreIndex: 1
		});
		expect(out).toHaveLength(1);
		expect(out[0]!.x).toBeCloseTo(0.5, 6);
		expect(out[0]!.confidence).toBeCloseTo(0.92, 6);
	});
	it('decodes xyxy-normalized boxes', () => {
		const boxes = new Float32Array([0.1, 0.2, 0.4, 0.6]);
		const scores = new Float32Array([0.9]);
		const out = decodeRawBboxCandidates(boxes, scores, RAW_BASE);
		expect(out[0]!.x).toBeCloseTo(0.1, 6);
		expect(out[0]!.y).toBeCloseTo(0.2, 6);
		expect(out[0]!.width).toBeCloseTo(0.3, 6);
		expect(out[0]!.height).toBeCloseTo(0.4, 6);
		expect(out[0]!.confidence).toBeCloseTo(0.9, 6);
	});
	it('decodes xywh-normalized boxes', () => {
		const boxes = new Float32Array([0.1, 0.2, 0.3, 0.4]);
		const scores = new Float32Array([0.9]);
		const out = decodeRawBboxCandidates(boxes, scores, {
			...RAW_BASE,
			boxFormat: 'xywh-normalized'
		});
		expect(out[0]!.x).toBeCloseTo(0.1, 6);
		expect(out[0]!.y).toBeCloseTo(0.2, 6);
		expect(out[0]!.width).toBeCloseTo(0.3, 6);
		expect(out[0]!.height).toBeCloseTo(0.4, 6);
		expect(out[0]!.confidence).toBeCloseTo(0.9, 6);
	});
	it('normalises xywh-pixel boxes by source dimensions', () => {
		const boxes = new Float32Array([100, 50, 200, 100]);
		const scores = new Float32Array([0.9]);
		const out = decodeRawBboxCandidates(
			boxes,
			scores,
			{ ...RAW_BASE, boxFormat: 'xywh-pixel' },
			400,
			200
		);
		expect(out[0]!.x).toBeCloseTo(0.25, 6);
		expect(out[0]!.y).toBeCloseTo(0.25, 6);
		expect(out[0]!.width).toBeCloseTo(0.5, 6);
		expect(out[0]!.height).toBeCloseTo(0.5, 6);
	});
	it('applies sigmoid when configured', () => {
		const boxes = new Float32Array([0, 0, 0.5, 0.5]);
		// Raw logit 4 → sigmoid ≈ 0.982 (above 0.5 threshold).
		const scores = new Float32Array([4]);
		const out = decodeRawBboxCandidates(boxes, scores, { ...RAW_BASE, applySigmoid: true });
		expect(out[0]!.confidence).toBeCloseTo(sigmoid(4), 6);
	});
	it('drops degenerate (zero-area) boxes even when the score passes', () => {
		const boxes = new Float32Array([0.1, 0.1, 0.1, 0.5]);
		const scores = new Float32Array([0.9]);
		const out = decodeRawBboxCandidates(boxes, scores, RAW_BASE);
		expect(out).toHaveLength(0);
	});
	it('drops non-finite predictions silently', () => {
		const boxes = new Float32Array([Number.NaN, 0.1, 0.4, 0.4]);
		const scores = new Float32Array([0.9]);
		const out = decodeRawBboxCandidates(boxes, scores, RAW_BASE);
		expect(out).toHaveLength(0);
	});
});

describe('decodeRawBboxOutput end-to-end', () => {
	it('returns NMS-deduped face detections', () => {
		// Two near-duplicate detections + one separate face.
		const boxes = new Float32Array([
			0.1, 0.1, 0.3, 0.3, 0.11, 0.11, 0.31, 0.31, 0.6, 0.6, 0.8, 0.8
		]);
		const scores = new Float32Array([0.95, 0.9, 0.85]);
		const out = decodeRawBboxOutput(boxes, scores, RAW_BASE);
		expect(out).toHaveLength(2);
		expect(out[0]!.confidence).toBeGreaterThanOrEqual(out[1]!.confidence);
	});
	it('caps at maxDetections', () => {
		const N = 5;
		const boxes = new Float32Array(N * 4);
		const scores = new Float32Array(N);
		for (let i = 0; i < N; i++) {
			boxes[i * 4] = i * 0.15;
			boxes[i * 4 + 1] = 0;
			boxes[i * 4 + 2] = i * 0.15 + 0.1;
			boxes[i * 4 + 3] = 0.1;
			scores[i] = 0.9 - i * 0.01;
		}
		const out = decodeRawBboxOutput(boxes, scores, { ...RAW_BASE, maxDetections: 2 });
		expect(out).toHaveLength(2);
	});
});

describe('decodeAnchorOffsetCandidates', () => {
	const ANCHOR_CONFIG: AnchorOffsetDecodeConfig = {
		type: 'anchor-offset',
		anchors: [
			{ cx: 0.5, cy: 0.5, width: 0.2, height: 0.2 },
			{ cx: 0.3, cy: 0.7, width: 0.1, height: 0.1 }
		],
		scoreThreshold: 0.5,
		iouThreshold: 0.3,
		maxDetections: 16
	};

	it('reconstructs boxes from anchor centre + size offsets', () => {
		// Anchor 0 at (0.5, 0.5) size 0.2 × 0.2; zero centre offset, dw=dh=1
		// → box centred at (0.5, 0.5) with size (0.2, 0.2)
		// → xywh = (0.4, 0.4, 0.2, 0.2).
		const offsets = new Float32Array([0, 0, 1, 1]);
		const scores = new Float32Array([0.9]);
		const out = decodeAnchorOffsetCandidates(offsets, scores, ANCHOR_CONFIG);
		expect(out).toHaveLength(1);
		expect(out[0]!.x).toBeCloseTo(0.4, 6);
		expect(out[0]!.y).toBeCloseTo(0.4, 6);
		expect(out[0]!.width).toBeCloseTo(0.2, 6);
		expect(out[0]!.height).toBeCloseTo(0.2, 6);
	});
	it('applies non-zero centre offsets in anchor-size units', () => {
		// dx=0.5 → centre shifts right by 0.5 × anchor.width = 0.1
		// New centre: (0.6, 0.5); xy → (0.5, 0.4).
		const offsets = new Float32Array([0.5, 0, 1, 1]);
		const scores = new Float32Array([0.9]);
		const out = decodeAnchorOffsetCandidates(offsets, scores, ANCHOR_CONFIG);
		expect(out[0]!.x).toBeCloseTo(0.5, 6);
		expect(out[0]!.y).toBeCloseTo(0.4, 6);
	});
	it('scales offsets by variance when configured', () => {
		// SSD-style variance scales every axis. With dx=1, dw=1, variance=[0.1,0.1,0.2,0.2]:
		//   cx_box = anchor.cx + dx * variance[0] * anchor.width = 0.5 + 0.02 = 0.52
		//   width  = anchor.width * dw * variance[2]            = 0.2 * 0.2     = 0.04
		//   x      = cx_box - width/2                            = 0.52 - 0.02   = 0.50
		const offsets = new Float32Array([1, 0, 1, 1]);
		const scores = new Float32Array([0.9]);
		const out = decodeAnchorOffsetCandidates(offsets, scores, {
			...ANCHOR_CONFIG,
			variance: [0.1, 0.1, 0.2, 0.2]
		});
		expect(out[0]!.x).toBeCloseTo(0.5, 6);
		expect(out[0]!.width).toBeCloseTo(0.04, 6);
	});
	it('drops below-threshold candidates and degenerate sizes', () => {
		const offsets = new Float32Array([0, 0, 1, 1, 0, 0, -1, 1]);
		const scores = new Float32Array([0.9, 0.9]);
		const out = decodeAnchorOffsetCandidates(offsets, scores, ANCHOR_CONFIG);
		// First candidate is fine, second has dw=-1 (negative size) and is dropped.
		expect(out).toHaveLength(1);
	});
	it('truncates to the shorter of (scores, offsets/4, anchors)', () => {
		const offsets = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
		const scores = new Float32Array([0.9, 0.9]); // shorter than anchors and boxes
		const out = decodeAnchorOffsetCandidates(offsets, scores, ANCHOR_CONFIG);
		expect(out).toHaveLength(2);
	});
});

describe('decodeAnchorOffsetOutput end-to-end', () => {
	it('applies the same NMS as the raw-bbox decoder', () => {
		const config: AnchorOffsetDecodeConfig = {
			type: 'anchor-offset',
			anchors: [
				{ cx: 0.5, cy: 0.5, width: 0.2, height: 0.2 },
				{ cx: 0.52, cy: 0.5, width: 0.2, height: 0.2 }, // near-duplicate anchor
				{ cx: 0.2, cy: 0.2, width: 0.1, height: 0.1 }
			],
			scoreThreshold: 0.5,
			iouThreshold: 0.3,
			maxDetections: 16
		};
		const offsets = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
		const scores = new Float32Array([0.95, 0.9, 0.8]);
		const out = decodeAnchorOffsetOutput(offsets, scores, config);
		// Two near-identical boxes merge; the distant third survives.
		expect(out).toHaveLength(2);
	});
});
