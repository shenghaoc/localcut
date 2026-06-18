/** Portrait-matte backend surface (Phase 31). ORT/ONNX is the retained runtime. */

/** Which matte runtime is active. */
export type MatteBackendKind = 'ort-onnx';

export const DEFAULT_MATTE_BACKEND: MatteBackendKind = 'ort-onnx';

export interface MatteFrameRequest {
	clipId: string;
	/** Clip's pinned model; mismatch against the deployed model warns. */
	modelKey: string;
	/** Engine-owned clone; the engine closes it exactly once. */
	frame: VideoFrame;
	sourceTimeS: number;
	/** Expected source frame step (1/fps) for the discontinuity policy. */
	frameStepS: number;
	quality: 'preview' | 'export';
}

/**
 * The subset of the matte engine the pipeline worker drives.
 */
export interface MatteBackendEngine {
	/**
	 * True when the engine's matte views are allocated on the renderer/compositor's
	 * adopted ORT `GPUDevice`, so the compositor can bind them directly.
	 */
	readonly compositesOnRendererDevice: boolean;
	/** Per-frame matte; the engine takes ownership of `request.frame`. */
	matteViewFor(request: MatteFrameRequest): Promise<GPUTextureView | null>;
	/** Drops a clip's temporal (EMA) history without releasing the session. */
	resetClip(clipId: string): void;
	/** Releases a clip's session, history texture, and cached alpha frames. */
	deleteClip(clipId: string): void;
	/** Tears down all GPU resources and any inference session. */
	dispose(): Promise<void>;
}

export function resolveMatteBackend(): MatteBackendKind {
	return DEFAULT_MATTE_BACKEND;
}
