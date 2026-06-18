# Design: ML Runtime - LiteRT/TFLite Retirement

PR #123 implements the runtime consolidation rather than only planning it. The
design is deletion-heavy: once ORT backs the retained features, every fallback
branch that can still instantiate the retired runtime is removed so the app has
one model runtime surface to validate.

## End State

- Portrait Matte: `MatteOnnxEngine` on ORT-WebGPU, using the Apache-2.0
  `onnx-community/modnet-webnn` graph pinned in
  `public/models/matte-onnx/manifest.json`.
- Auto Captions: ORT Whisper only, using the existing ONNX manifests in
  `public/models/whisper-onnx/`.
- Audio Cleanup: ORT DTLN only, using `cleanup-ort-worker.ts` and
  `public/models/dtln-onnx/manifest.json`.
- Diagnostics: `MlRuntimeDiagnosticSummary.mlRuntime` is `'ort'`.
- Build: no runtime-asset copy plugin, no setup/postinstall hook, and no Workbox
  runtime caches for removed paths.

## Removed Footprint

- Matte: `src/engine/matte/matte-engine.ts`,
  `src/engine/matte/matte-engine.concurrency.test.ts`,
  `src/engine/matte/litert-loader.{js,d.ts}`,
  `src/engine/matte/model-manifest.ts`, retired model tests,
  `public/models/matte/`, and `src/engine/shaders/matte-preprocess.wgsl`.
- ASR: `src/engine/asr/litert-runtime.ts`, its tests,
  `src/engine/asr/litert-loader.{js,d.ts}`, old single-model manifest tests, and
  `public/models/whisper/`.
- Audio Cleanup: `src/engine/audio-cleanup/dtln-runtime.ts`, old model-manifest
  files/tests, `src/engine/audio-cleanup/cleanup-worker.ts`,
  `public/models/dtln/`, and `scripts/verify-dtln-onnx-parity.mjs`.
- Build/assets: `@litertjs/core`, `scripts/setup-litert-assets.mjs`,
  `setup:litert`, `postinstall`, `public/litert/`,
  `litertRuntimeAssetsPlugin()`, and service-worker runtime caches for removed
  runtime/model paths.

## Retained Boundaries

- ORT foundation modules under `src/engine/ml/ort/`.
- ORT-WASM as an execution provider for small non-frame-coupled work.
- Smart Reframe's `@mediapipe/tasks-vision` BlazeFace model path. It is a
  separate dependency and remains out of scope for this retirement.
- Historical specs that describe the implementation history of previous PRs.

## Data Flow

Portrait Matte now uses the same ORT-owned device adoption path as other
frame-coupled ORT features:

`VideoFrame` -> `importExternalTexture` -> `matte-onnx-preprocess.wgsl` ->
`ort.Tensor.fromGpuBuffer` -> ORT `session.run` -> `matte-resolve.wgsl` ->
Phase 12 compositor.

The renderer adopts ORT's `GPUDevice` before the model reports loaded, so the
matte output is a renderer-device view with no CPU readback.

ASR and DTLN run on ORT-WASM because they are not frame-coupled. Their UI and
protocol surfaces no longer expose runtime selection.

## Review-Comment Resolution Notes

- The matte loader path is the concrete
  `src/engine/matte/litert-loader.{js,d.ts}`.
- DTLN removal follows the dependency chain: ASR's shared loader goes away with
  the ASR branch, and the DTLN worker is collapsed to ORT at the same time.
- Cleanup backend plumbing includes `CleanupBackendKind`, `cleanup-bridge.ts`,
  controller load commands, and `App.tsx` manifest selection.
- Docs cover `docs/ML-RUNTIME.md`, `docs/USER-GUIDE.md`, bundled `/docs`
  markdown, model READMEs, and impacted Phase 28/29/31/40 specs.
