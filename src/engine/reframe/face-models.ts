/**
 * Face-detection model + runtime locations for Smart Reframe (Phase 33).
 *
 * Light module (no `@mediapipe/tasks-vision` import) so both the UI and the
 * analysis worker can read these URLs without pulling MediaPipe into their
 * graphs. Per the project's hobby-scope decision, the MediaPipe BlazeFace
 * model and the tasks-vision WASM are loaded **from remote on demand** (not
 * vendored or digest-pinned). The `latest` model URL is intentionally mutable;
 * if Google relocates it, only these constants need updating.
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
