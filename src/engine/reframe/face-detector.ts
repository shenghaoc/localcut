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

/**
 * Create a face detector that returns canned detections keyed by frame index
 * (R11.2 injection seam), for unit tests.
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
