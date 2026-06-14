// Untyped boundary to `@mediapipe/tasks-vision`, mirroring the LiteRT loader
// boundary: the package is reached through a `.js` module so its type surface
// (and any global/DOM augmentation) never enters the TypeScript program, and
// the dynamic import keeps the ~300 KB JS (and the CDN-loaded WASM) out of the
// startup module graph — it loads only when face detection actually runs.
export function loadMediapipeVision() {
	return import('@mediapipe/tasks-vision');
}
