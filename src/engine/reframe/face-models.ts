/**
 * Face-detection model + runtime locations for Smart Reframe (Phase 33).
 *
 * Light module (no `@mediapipe/tasks-vision` / `onnxruntime-web` import) so both
 * the UI and the analysis worker can read these URLs without pulling either
 * runtime into their graphs.
 *
 * Two paths coexist:
 *
 * 1. **MediaPipe BlazeFace TFLite** (Phase 33 PR86). Per the hobby-scope
 *    decision the model is loaded **from remote on demand** — not vendored
 *    and not digest-pinned. The `latest` model URL is intentionally mutable;
 *    if Google relocates it, only these constants need updating.
 * 2. **ORT/ONNX face detector** (Phase 33 follow-up). A properly catalog-pinned
 *    alternative whose manifest lives at {@link REFRAME_FACE_ONNX_MANIFEST_URL}
 *    and whose bytes are SHA-256-verified + OPFS-cached on the Phase 105 ORT
 *    foundation. The manifest ships as a `template` until a real model is
 *    vendored, so the ORT path is disabled by default and Smart Reframe falls
 *    back to MediaPipe or saliency.
 */

/** tasks-vision WASM fileset, pinned to the installed package version. */
export const MEDIAPIPE_WASM_PATH =
	'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

/** BlazeFace short-range (128×128) — faster, for typical front-facing subjects. */
export const BLAZEFACE_SHORT_RANGE_URL =
	'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

/** BlazeFace sparse full-range — wider coverage / smaller faces. */
export const BLAZEFACE_FULL_RANGE_URL =
	'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite';

/**
 * Same-origin manifest URL for the optional ORT/ONNX face detector. The file
 * ships as a `template` so the path stays disabled (see
 * {@link file://../../../public/models/reframe-face/README.md}); the loader
 * resolves the manifest, then asks the manifest validator to reject the
 * template — diagnostics report "face detector unavailable; using saliency".
 */
export const REFRAME_FACE_ONNX_MANIFEST_URL = '/models/reframe-face/manifest.json';
