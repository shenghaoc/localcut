/**
 * Portrait-matte backend selection (Phase 31).
 *
 * The matte feature has two interchangeable runtimes behind one interface:
 *
 * - **LiteRT** (`matte-engine.ts`) — the **deployed default**: MediaPipe Selfie
 *   Segmentation (`.tflite`) on `@litertjs/core`, verified working end to end.
 * - **ORT/ONNX** (`matte-onnx-engine.ts`) — an **experimental spike**: an ONNX
 *   matting/segmentation model on ONNX Runtime Web (WebGPU EP), enabling a
 *   MODNet-class true-matting upgrade. Off by default; selected only via the
 *   `__MATTE_ONNX_SPIKE__` build flag, and even then it stays dark until a real
 *   ONNX model is pinned (the shipped manifest is a `template`).
 *
 * This module owns the swappable surface ({@link MatteBackendEngine}) and the pure
 * selector ({@link resolveMatteBackend}). Keeping the decision in one tested place
 * guarantees the deployed default does not change unless the flag is explicitly on.
 */
import type { MatteFrameRequest } from './matte-engine';

export type { MatteFrameRequest };

/** Which matte runtime is active. */
export type MatteBackendKind = 'litert' | 'ort-onnx';

/**
 * The deployed default. **Never** change this to `ort-onnx` without proven ORT
 * model quality/performance parity — doing so would regress the working LiteRT
 * MediaPipe path (Phase 31 acceptance).
 */
export const DEFAULT_MATTE_BACKEND: MatteBackendKind = 'litert';

/**
 * The subset of the matte engine the pipeline worker drives. Both
 * {@link file://./matte-engine.ts} `MatteEngine` and
 * {@link file://./matte-onnx-engine.ts} `MatteOnnxEngine` satisfy it, so the
 * worker holds one of either behind this type.
 */
export interface MatteBackendEngine {
	/** Per-frame matte; the engine takes ownership of `request.frame`. */
	matteViewFor(request: MatteFrameRequest): Promise<GPUTextureView | null>;
	/** Drops a clip's temporal (EMA) history without releasing the session. */
	resetClip(clipId: string): void;
	/** Releases a clip's session, history texture, and cached alpha frames. */
	deleteClip(clipId: string): void;
	/** Tears down all GPU resources and any inference session. */
	dispose(): Promise<void>;
}

/**
 * Resolves the active matte backend. Returns `ort-onnx` **only** when the
 * experimental spike flag is explicitly enabled; every other case is the deployed
 * LiteRT default. Pure and synchronous so the decision is unit-testable without a
 * build define.
 */
export function resolveMatteBackend(spikeEnabled: boolean): MatteBackendKind {
	return spikeEnabled ? 'ort-onnx' : DEFAULT_MATTE_BACKEND;
}
