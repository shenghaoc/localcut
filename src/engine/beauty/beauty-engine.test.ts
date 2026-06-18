/** Phase 32b: BeautyEngine decode helpers + per-frame solve orchestration. */

import { describe, expect, it } from 'vite-plus/test';
import {
	BeautyEngine,
	decodeCandidates,
	expandBox,
	mapRoiToFull,
	type BeautyInferenceFn,
	type BeautyRawSolve
} from './beauty-engine';
import { LANDMARK_FLOATS } from './beauty-params';
import { DEFAULT_BEAUTY_EFFECT } from '../../protocol';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Counts close() calls so we can assert close-exactly-once per frame. */
function makeFrame(): { frame: VideoFrame; closes: () => number } {
	let count = 0;
	const frame = { close: () => (count += 1) } as unknown as VideoFrame;
	return { frame, closes: () => count };
}

function filledLandmarks(value: number): Float32Array {
	return new Float32Array(LANDMARK_FLOATS).fill(value);
}

describe('decodeCandidates', () => {
	it('returns no candidates when tensors are missing', () => {
		expect(decodeCandidates(undefined, undefined, 0)).toEqual([]);
	});

	it('keeps boxes above the score threshold and parses [x,y,w,h]', () => {
		const boxes = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.2, 0.2]);
		const scores = new Float32Array([0.9, 0.1]); // second below 0.5 threshold
		const out = decodeCandidates(boxes, scores, 1.5);
		expect(out).toHaveLength(1);
		expect(out[0]!.box[0]).toBeCloseTo(0.1);
		expect(out[0]!.box[1]).toBeCloseTo(0.2);
		expect(out[0]!.box[2]).toBeCloseTo(0.3);
		expect(out[0]!.box[3]).toBeCloseTo(0.4);
		expect(out[0]!.confidence).toBeCloseTo(0.9);
		expect(out[0]!.t).toBe(1.5);
	});

	it('treats out-of-range scores as logits via sigmoid', () => {
		const boxes = new Float32Array([0.1, 0.1, 0.2, 0.2]);
		const scores = new Float32Array([4]); // logit → sigmoid(4) ≈ 0.982
		const out = decodeCandidates(boxes, scores, 0);
		expect(out).toHaveLength(1);
		expect(out[0]!.confidence).toBeCloseTo(0.982, 2);
	});

	it('skips non-finite boxes', () => {
		const boxes = new Float32Array([Number.NaN, 0.1, 0.2, 0.2]);
		const scores = new Float32Array([0.9]);
		expect(decodeCandidates(boxes, scores, 0)).toEqual([]);
	});
});

describe('expandBox', () => {
	it('expands by the margin and clamps to the unit square', () => {
		const [x0, y0, x1, y1] = expandBox([0.4, 0.4, 0.2, 0.2], 0.25);
		expect(x0).toBeCloseTo(0.35);
		expect(y0).toBeCloseTo(0.35);
		expect(x1).toBeCloseTo(0.65);
		expect(y1).toBeCloseTo(0.65);
		// near an edge, the expansion clamps to [0,1]
		const edge = expandBox([0, 0, 0.2, 0.2], 0.5);
		expect(edge[0]).toBe(0);
		expect(edge[1]).toBe(0);
		expect(edge[2]).toBeCloseTo(0.3);
		expect(edge[3]).toBeCloseTo(0.3);
	});
});

describe('mapRoiToFull', () => {
	it('maps ROI-local normalized coords into full-frame coords', () => {
		const roiLandmarks = new Float32Array(LANDMARK_FLOATS);
		roiLandmarks[0] = 0.5; // x of landmark 0
		roiLandmarks[1] = 0.5; // y
		roiLandmarks[2] = 0.1; // z passthrough
		const out = new Float32Array(LANDMARK_FLOATS);
		mapRoiToFull(roiLandmarks, [0.2, 0.4, 0.6, 0.8], out);
		expect(out[0]).toBeCloseTo(0.2 + 0.5 * 0.4); // 0.4
		expect(out[1]).toBeCloseTo(0.4 + 0.5 * 0.4); // 0.6
		expect(out[2]).toBeCloseTo(0.1);
	});
});

describe('BeautyEngine.solveFrame', () => {
	it('returns null and closes the frame when no model is loaded', async () => {
		const engine = new BeautyEngine({});
		const { frame, closes } = makeFrame();
		const result = await engine.solveFrame({
			clipId: 'c',
			frame,
			timeS: 0,
			beauty: DEFAULT_BEAUTY_EFFECT,
			quality: 'preview'
		});
		expect(result).toBeNull();
		expect(closes()).toBe(1);
	});

	it('warms up over the first solve, then delivers interpolated landmarks', async () => {
		const inference: BeautyInferenceFn = () =>
			Promise.resolve<BeautyRawSolve>({
				landmarks: filledLandmarks(0.5),
				confidence: 0.9,
				faceId: 'face-0',
				reset: false
			});
		// projectFps == maxHz → solve interval 1 (every frame).
		const engine = new BeautyEngine({ projectFps: 10, inference });

		const f0 = makeFrame();
		const r0 = await engine.solveFrame({
			clipId: 'c',
			frame: f0.frame,
			timeS: 0,
			beauty: DEFAULT_BEAUTY_EFFECT,
			quality: 'preview'
		});
		expect(r0).toBeNull(); // ring empty at solve-kick time
		expect(f0.closes()).toBe(1);
		await flush(); // let the kicked single-flight solve push into the ring

		const f1 = makeFrame();
		const r1 = await engine.solveFrame({
			clipId: 'c',
			frame: f1.frame,
			timeS: 0.1,
			beauty: DEFAULT_BEAUTY_EFFECT,
			quality: 'preview'
		});
		expect(r1).not.toBeNull();
		expect(r1![0]).toBeCloseTo(0.5);
		expect(f1.closes()).toBe(1);
	});

	it('drops per-clip state on deleteClip (re-warms afterwards)', async () => {
		const inference: BeautyInferenceFn = () =>
			Promise.resolve<BeautyRawSolve>({
				landmarks: filledLandmarks(0.25),
				confidence: 0.9,
				faceId: 'face-0',
				reset: false
			});
		const engine = new BeautyEngine({ projectFps: 10, inference });
		await engine.solveFrame({
			clipId: 'c',
			frame: makeFrame().frame,
			timeS: 0,
			beauty: DEFAULT_BEAUTY_EFFECT,
			quality: 'preview'
		});
		await flush();
		engine.deleteClip('c');
		// Fresh state → first frame after delete is a warmup miss again.
		const after = await engine.solveFrame({
			clipId: 'c',
			frame: makeFrame().frame,
			timeS: 0.2,
			beauty: DEFAULT_BEAUTY_EFFECT,
			quality: 'preview'
		});
		expect(after).toBeNull();
	});
});
