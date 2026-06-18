# Tasks — ML runtime: MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

> **Implementation complete in PR124.** This spec is no longer plan-only. It
> implements Smart Reframe's ORT-only face detector and removes the final
> non-ORT ML runtime.

- [x] **T1 — Choose a permissive face-detection ONNX (R1).** Selected UltraFace
      RFB-320 from `Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB`, verified
      MIT license, pinned commit `dffdddda9794a50607cba8f318507a28c1c27cab`, and
      recorded provenance in `public/models/reframe-face/README.md`.
- [x] **T2 — Pin model + decode contract (R1, R2).** Filled
      `public/models/reframe-face/manifest.json` with real URL/size/SHA,
      `input [1,3,240,320]`, `boxes`, `scores`, and `scoreStride: 2` /
      `scoreIndex: 1` for the face-class score column.
- [x] **T3 — Extend decoder and tests (R2, R6).** Updated
      `face-detector-ort-manifest.ts` and `face-detector-ort-decode.ts` for
      score-row selection; added tests for the decode contract and shipped
      manifest.
- [x] **T4 — Wire the ORT detector (R3).** `reframe-analyzer.ts` now creates
      `createOrtFaceDetector` only; saliency remains the pre-load/default path
      and the failure fallback.
- [x] **T5 — Delete the MediaPipe detector (R4.1).** Removed
      `createMediapipeFaceDetector`, Tasks Vision typings, `mediapipe-loader`
      files, and remote WASM/TFLite constants from `face-models.ts`. Kept the
      `FaceDetector` interface and `createMockFaceDetector`.
- [x] **T6 — Drop the dependency (R4.2).** Removed `@mediapipe/tasks-vision` from
      `package.json`; lockfile regenerated without the package.
- [x] **T7 — Probe + UI + bridge cleanup (R3, R4.3).** Updated
      `capability-probe-v2.ts`, `SmartReframePanel`, `reframe-controller.ts`,
      `reframe-bridge.ts`, and protocol types so the only model path is ORT.
      `reframe-bridge.ts` now uses a module worker; the classic-worker
      `importScripts` constraint is gone.
- [x] **T8 — Analyzer fallback cleanup (R3).** Removed the fallback loading chain
      in `reframe-analyzer.ts`; ORT load failures report saliency-only status
      directly with simpler error handling.
- [x] **T9 — Docs (R5).** Updated `docs/SMART-REFRAME.md`,
      `src/features/docs/content/smart-reframe.md`, `docs/USER-GUIDE.md`,
      `docs/ML-RUNTIME.md`, `public/models/reframe-face/README.md`, and AGENTS
      routing copy.
- [x] **T10 — Verify (R6).** Required gates: focused reframe tests, typecheck,
      full `vp run check`, and
      `grep -riE '@mediapipe|tasks-vision' src/ public/ package.json`.

## Dependencies

- Builds on merged `ml-runtime-ort-device-ownership` (#121).
- Builds on merged `ml-runtime-litert-retirement` (#123). With this PR, ORT is
  the only ML runtime shipped by app code.
