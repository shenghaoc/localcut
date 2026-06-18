/**
 * Face-detection model location for Smart Reframe (Phase 33).
 *
 * Light module (no `onnxruntime-web` import) so the UI can pass the manifest URL
 * to the lazy analysis worker without pulling the ORT runtime into startup.
 */

/**
 * Same-origin manifest URL for the optional ORT/ONNX face detector. Model bytes
 * are SHA-256 verified and OPFS cached by the shared ORT asset loader.
 */
export const REFRAME_FACE_ONNX_MANIFEST_URL = '/models/reframe-face/manifest.json';
