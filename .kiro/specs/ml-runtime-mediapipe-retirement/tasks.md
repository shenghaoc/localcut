# Tasks — ML runtime: MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

> **Plan only — not yet implemented.** All tasks unchecked; a later agent
> implements them. Maps to `requirements.md`. Do not start T3+ before the parity
> gate (T2) passes.

- [ ] **T1 — Choose a permissive face-detection ONNX (R2.1).** Identify a
      verified-permissive (Apache-2.0 / MIT / BSD) face-detection ONNX whose output
      convention is documented; confirm it passes the ORT op-support + WASM
      input-size gate. Record provenance in `public/models/reframe-face/README.md`.
- [ ] **T2 — Pin model + decode + parity proof (R2).** Fill
      `public/models/reframe-face/manifest.json` (drop `template`, real
      url/size/sha + `io`/`decode`); make `face-detector-ort-decode.ts` match the
      graph's anchors/boxes/scores/NMS; prove detection + crop-path parity vs
      MediaPipe BlazeFace on the Smart Reframe fixtures. **Gate: do not proceed
      until parity is accepted.**
- [ ] **T3 — Wire the ORT detector (R3).** Reframe analyzer/worker click-to-load
      creates `createOrtFaceDetector`; saliency stays the pre-load default;
      `OrtFaceDetectorUnavailableError` → saliency degrade preserved.
- [ ] **T4 — Delete the MediaPipe detector (R4.1).** Remove
      `createMediapipeFaceDetector` + tasks-vision typings from `face-detector.ts`,
      `mediapipe-loader.{js,d.ts}`, and the fileset/`.tflite` config in
      `face-models.ts`. Keep the `FaceDetector` interface + `createMockFaceDetector`.
- [ ] **T5 — Drop the dependency (R4.2).** Remove `@mediapipe/tasks-vision` from
      `package.json` + lockfile; confirm a fresh `pnpm install` pulls no MediaPipe.
- [ ] **T6 — Probe + UI cleanup (R4.3).** Update `capability-probe-v2.ts` and the
      Smart Reframe UI (`SmartReframePanel`, controller/bridge) to drop
      MediaPipe-specific detection/copy without altering `CapabilityTierV2`.
- [ ] **T7 — Docs (R5).** `docs/SMART-REFRAME.md` +
      `src/features/docs/content/smart-reframe.md` → ORT face detection;
      `docs/ML-RUNTIME.md` declares ORT the **sole** ML runtime (no LiteRT, no
      MediaPipe Tasks-Vision).
- [ ] **T8 — Tests (R6.1).** Update reframe tests (ORT detector + decode; remove
      MediaPipe-detector tests); keep the saliency-fallback and mock-detector tests.
- [ ] **T9 — Verify (R6).** Full quality gate green; manual Smart Reframe with ORT
      model and saliency-only; `grep -riE '@mediapipe|tasks-vision' src/ public/
      package.json` returns only historical spec text.

## Dependencies

- Builds on `ml-runtime-ort-device-ownership` (merged, #121) and the existing
  reframe ORT scaffolding.
- Independent of `ml-runtime-litert-retirement` (#123) — different runtime/files —
  but **both must land** for the end state "one ML runtime, ORT". This is the step
  that lets the policy claim full single-runtime unification.
