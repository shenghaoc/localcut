/**
 * Face detection via MediaPipe Tasks Vision (`@mediapipe/tasks-vision`
 * `FaceDetector`, BlazeFace). MediaPipe owns the model decode + NMS, so this
 * module is a thin wrapper that maps its pixel-space detections to normalised
 * boxes. The package is reached through the untyped {@link loadMediapipeVision}
 * boundary; the WASM fileset and the `.tflite` model are loaded from remote on
 * the user's explicit "Load face model" action (see the controller/panel),
 * mirroring Phase 28/29.
 */

import { loadMediapipeVision } from './mediapipe-loader';

export interface FaceDetection {
	/** Normalised left edge in [0,1]. */
	x: number;
	/** Normalised top edge in [0,1]. */
	y: number;
	/** Normalised width. */
	width: number;
	/** Normalised height. */
	height: number;
	confidence: number;
}

export interface FaceDetector {
	detect(imageData: ImageData): Promise<FaceDetection[]>;
	dispose(): void;
}

export interface MediapipeFaceDetectorOptions {
	/** Directory the tasks-vision WASM fileset loads from. */
	wasmPath: string;
	/** URL of the BlazeFace `.tflite` model. */
	modelUrl: string;
	/** Minimum detection confidence (default 0.5). */
	minConfidence?: number;
}

// ── Minimal local typings for the @mediapipe/tasks-vision surface we use ──
interface MpBoundingBox {
	originX: number;
	originY: number;
	width: number;
	height: number;
}
interface MpDetection {
	boundingBox?: MpBoundingBox;
	categories?: Array<{ score: number }>;
}
interface MpFaceDetector {
	detect(image: ImageData): { detections: MpDetection[] };
	close(): void;
}
interface MpBaseOptions {
	modelAssetPath: string;
	delegate: 'GPU' | 'CPU';
}
interface MpVisionModule {
	FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
	FaceDetector: {
		createFromOptions(
			fileset: unknown,
			options: { baseOptions: MpBaseOptions; runningMode: 'IMAGE'; minDetectionConfidence: number }
		): Promise<MpFaceDetector>;
	};
}

/**
 * Load the MediaPipe runtime + BlazeFace model and return a {@link FaceDetector}.
 * Tries the GPU delegate first, falling back to CPU (more robust inside a Web
 * Worker). Heavy and network-bound — call only from the analysis worker on the
 * user's explicit load action.
 */
export async function createMediapipeFaceDetector(
	options: MediapipeFaceDetectorOptions
): Promise<FaceDetector> {
	const vision = (await loadMediapipeVision()) as MpVisionModule;
	const fileset = await vision.FilesetResolver.forVisionTasks(options.wasmPath);
	const minDetectionConfidence = options.minConfidence ?? 0.5;

	let detector: MpFaceDetector;
	try {
		detector = await vision.FaceDetector.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: options.modelUrl, delegate: 'GPU' },
			runningMode: 'IMAGE',
			minDetectionConfidence
		});
	} catch {
		detector = await vision.FaceDetector.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: options.modelUrl, delegate: 'CPU' },
			runningMode: 'IMAGE',
			minDetectionConfidence
		});
	}

	return {
		async detect(imageData: ImageData): Promise<FaceDetection[]> {
			const { width, height } = imageData;
			if (width === 0 || height === 0) return [];
			// detect() is synchronous in MediaPipe; running it in the worker keeps
			// the main thread free (R0.2).
			const result = detector.detect(imageData);
			const out: FaceDetection[] = [];
			for (const d of result.detections) {
				const bb = d.boundingBox;
				if (!bb || !(bb.width > 0) || !(bb.height > 0)) continue;
				out.push({
					x: bb.originX / width,
					y: bb.originY / height,
					width: bb.width / width,
					height: bb.height / height,
					confidence: d.categories?.[0]?.score ?? 0
				});
			}
			return out;
		},
		dispose() {
			detector.close();
		}
	};
}

/**
 * Create a face detector that returns canned detections keyed by frame index
 * (R11.2 injection seam) — no MediaPipe runtime, for unit tests.
 */
export function createMockFaceDetector(detections: Map<string, FaceDetection[]>): FaceDetector {
	let frameIndex = 0;
	return {
		async detect(): Promise<FaceDetection[]> {
			const key = `frame_${frameIndex++}`;
			return detections.get(key) ?? [];
		},
		dispose() {}
	};
}
