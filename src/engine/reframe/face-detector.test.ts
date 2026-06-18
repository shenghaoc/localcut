import { describe, it, expect } from 'vite-plus/test';
import { createMockFaceDetector, type FaceDetection } from './face-detector';

function img(width: number, height: number): ImageData {
	return { data: new Uint8ClampedArray(4), width, height, colorSpace: 'srgb' } as ImageData;
}

describe('createMockFaceDetector (R11.2 injection)', () => {
	it('returns canned detections keyed by frame index', async () => {
		const face: FaceDetection = { x: 0.4, y: 0.4, width: 0.2, height: 0.2, confidence: 0.9 };
		const detector = createMockFaceDetector(new Map([['frame_0', [face]]]));
		expect(await detector.detect(img(1, 1))).toEqual([face]);
		expect(await detector.detect(img(1, 1))).toEqual([]); // frame_1 absent
	});
});
