# Requirements: ML runtime — MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

> **Implementation spec.** PR124 completes the single-runtime ML policy after
> PR123: Smart Reframe no longer ships `@mediapipe/tasks-vision` or a TFLite
> fallback. Face-aware reframing uses the existing ORT face-detector path with a
> pinned ONNX model; saliency remains the default and failure fallback.

## Background

Before this change Smart Reframe had two face-model paths: a disabled ORT/ONNX
scaffold and an active MediaPipe Tasks Vision fallback. That left a second ML
runtime in the app after LiteRT/TFLite retirement. The implemented end state is:

- `face-detector-ort.ts` owns face-model loading and inference.
- `face-detector-ort-decode.ts` decodes UltraFace raw boxes and applies NMS.
- `face-detector-ort-manifest.ts` validates the ORT manifest and score-row
  contract.
- `public/models/reframe-face/manifest.json` pins a real model, not a template.
- `face-detector.ts` contains only the shared `FaceDetector` interface and test
  mock.

Face detection runs in the lazy Smart Reframe analysis worker at analysis fps,
not in the preview/export hot path. It is non-frame-coupled and uses CPU output
tensors for TypeScript decode. No compositor-device adoption is involved.

## R0 — Hard Constraints

- **R0.1** No model bytes or ORT runtime are fetched/instantiated at startup.
  The face model loads only on explicit **Load face model** action.
- **R0.2** Saliency remains the default and the fallback on any model
  unavailability/failure.
- **R0.3** No inference or pixel loops move to the main thread. Reframe analysis
  stays in its lazy worker.
- **R0.4** No cloud inference, telemetry, or frame upload is introduced.

## R1 — Model Pin

- **R1.1** The shipped face detector is UltraFace RFB-320
  (`version-RFB-320.onnx`) from
  `Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB`, commit
  `dffdddda9794a50607cba8f318507a28c1c27cab`.
- **R1.2** License is MIT and documented in `public/models/reframe-face/README.md`.
- **R1.3** Model bytes are fetched via `/_model/gh/`, size-checked at
  `1,270,727` bytes, SHA-256 checked as
  `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017`, and
  OPFS-cached by digest.
- **R1.4** Manifest declares `frameCoupled: false`, `executionProviders:
  ["wasm"]`, and `tensorLocation: "cpu"` to prioritize broad, deterministic
  worker availability for this low-rate model.

## R2 — Decode Contract

- **R2.1** Input is `input [1, 3, 240, 320]`, NCHW RGB float32, normalized as
  upstream `(channel - 127) / 128`.
- **R2.2** `boxes [1, 4420, 4]` are decoded as `xyxy-normalized`.
- **R2.3** `scores [1, 4420, 2]` are decoded with `scoreStride: 2` and
  `scoreIndex: 1` to read the face-class confidence.
- **R2.4** TypeScript thresholding + greedy NMS produce the same
  `FaceDetection` shape the tracker already consumes.

## R3 — ORT-Only Wiring

- **R3.1** The worker click-to-load command creates `createOrtFaceDetector` only.
- **R3.2** `OrtFaceDetectorUnavailableError` and all load/session/decode errors
  report "face detector unavailable; using saliency" and leave analysis usable.
- **R3.3** `reframe-analyzer.ts` contains no fallback loader chain after ORT
  fails.
- **R3.4** `reframe-bridge.ts` no longer needs a classic-worker comment or type
  for `importScripts`; it can spawn the reframe worker as a module worker.

## R4 — Remove MediaPipe Runtime

- **R4.1** Delete `createMediapipeFaceDetector`, local Tasks Vision typings,
  `mediapipe-loader.{js,d.ts}`, and remote WASM/TFLite constants. Clean up
  `reframe-analyzer.ts` to remove the multi-runtime fallback loading chain and
  simplify ORT-failure handling. Update JSDoc/comments in `face-detector.ts`
  and `face-models.ts` so they no longer describe the retired runtime.
- **R4.2** Remove `@mediapipe/tasks-vision` from `package.json` and lockfile.
- **R4.3** Remove MediaPipe-specific Workbox runtime caches and UI/probe copy.
  Update `reframe-bridge.ts` worker type/comments because the classic-worker
  `importScripts` constraint no longer applies.
- **R4.4** Preserve the shared `FaceDetector` interface and
  `createMockFaceDetector` test seam.

## R5 — Docs

- **R5.1** `docs/SMART-REFRAME.md`,
  `src/features/docs/content/smart-reframe.md`, `docs/USER-GUIDE.md`, and
  `public/models/reframe-face/README.md` describe ORT-only face detection.
- **R5.2** `docs/ML-RUNTIME.md` includes Smart Reframe in the ORT runtime map and
  states the single-runtime end state.

## R6 — Verification

- **R6.1** Reframe decode/manifest/ORT loader tests cover score-row selection,
  shipped manifest validation, tensor-size gating, and mock detector behavior.
- **R6.2** `grep -riE '@mediapipe|tasks-vision' src/ public/ package.json`
  returns no runtime references.
- **R6.3** `vp run check` is the merge gate.
