import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import { loadMediapipeVision } from './mediapipe-loader';
import {
	createMediapipeFaceDetector,
	createMockFaceDetector,
	type FaceDetection
} from './face-detector';

vi.mock('./mediapipe-loader', () => ({
	loadMediapipeVision: vi.fn()
}));

type DetectImpl = () => { detections: Array<Record<string, unknown>> };

function fakeVision(detectImpl: DetectImpl, createImpl?: ReturnType<typeof vi.fn>) {
	const detector = { detect: vi.fn(detectImpl), close: vi.fn() };
	const createFromOptions = createImpl ?? vi.fn(async () => detector);
	const vision = {
		FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
		FaceDetector: { createFromOptions }
	};
	vi.mocked(loadMediapipeVision).mockResolvedValue(vision);
	return { detector, createFromOptions };
}

function img(width: number, height: number): ImageData {
	return { data: new Uint8ClampedArray(4), width, height, colorSpace: 'srgb' } as ImageData;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createMediapipeFaceDetector', () => {
	it('maps MediaPipe pixel boxes to normalised detections', async () => {
		const { detector } = fakeVision(() => ({
			detections: [
				{
					boundingBox: { originX: 128, originY: 72, width: 64, height: 36 },
					categories: [{ score: 0.95 }]
				}
			]
		}));
		const fd = await createMediapipeFaceDetector({
			wasmPath: '/wasm',
			modelUrl: 'https://storage.googleapis.com/m.tflite'
		});
		const out = await fd.detect(img(256, 144));
		expect(out).toHaveLength(1);
		expect(out[0]!.x).toBeCloseTo(0.5, 5); // 128/256
		expect(out[0]!.y).toBeCloseTo(0.5, 5); // 72/144
		expect(out[0]!.width).toBeCloseTo(0.25, 5); // 64/256
		expect(out[0]!.height).toBeCloseTo(0.25, 5); // 36/144
		expect(out[0]!.confidence).toBeCloseTo(0.95, 5);
		fd.dispose();
		expect(detector.close).toHaveBeenCalledTimes(1);
	});

	it('drops detections with no/degenerate bounding box', async () => {
		fakeVision(() => ({
			detections: [
				{ categories: [{ score: 0.9 }] }, // no boundingBox
				{
					boundingBox: { originX: 0, originY: 0, width: 0, height: 10 },
					categories: [{ score: 0.9 }]
				}
			]
		}));
		const fd = await createMediapipeFaceDetector({ wasmPath: '/wasm', modelUrl: 'x' });
		expect(await fd.detect(img(100, 100))).toHaveLength(0);
	});

	it('falls back to the CPU delegate when GPU creation fails', async () => {
		const detector = { detect: vi.fn(() => ({ detections: [] })), close: vi.fn() };
		const createFromOptions = vi
			.fn()
			.mockRejectedValueOnce(new Error('GPU unavailable'))
			.mockResolvedValueOnce(detector);
		fakeVision(() => ({ detections: [] }), createFromOptions);
		await createMediapipeFaceDetector({ wasmPath: '/wasm', modelUrl: 'x' });
		expect(createFromOptions).toHaveBeenCalledTimes(2);
		expect(createFromOptions.mock.calls[0]![1].baseOptions.delegate).toBe('GPU');
		expect(createFromOptions.mock.calls[1]![1].baseOptions.delegate).toBe('CPU');
	});
});

describe('createMockFaceDetector (R11.2 injection)', () => {
	it('returns canned detections keyed by frame index', async () => {
		const face: FaceDetection = { x: 0.4, y: 0.4, width: 0.2, height: 0.2, confidence: 0.9 };
		const detector = createMockFaceDetector(new Map([['frame_0', [face]]]));
		expect(await detector.detect(img(1, 1))).toEqual([face]);
		expect(await detector.detect(img(1, 1))).toEqual([]); // frame_1 absent
	});
});
