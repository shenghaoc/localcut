# Requirements: ML runtime — MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

> **Plan only — not yet implemented.** The final step of the unify-on-ORT policy
> (`ml-runtime-ort-device-ownership`, #121). After `ml-runtime-litert-retirement`
> (#123) removes `@litertjs/core`, the **only** remaining non-ORT ML runtime is
> `@mediapipe/tasks-vision`, used for Smart Reframe's BlazeFace face detection
> (itself TFLite-backed, on MediaPipe's own WASM fileset). This spec migrates that
> detector to the **already-scaffolded ORT face-detector path** and removes
> `@mediapipe/tasks-vision`, leaving **one ML runtime: ORT.**

## Background

Smart Reframe (Phase 33) detects faces with `@mediapipe/tasks-vision`'s
`FaceDetector` (BlazeFace `.tflite`), loaded via `mediapipe-loader.js` /
`face-detector.ts`; MediaPipe owns model decode + NMS internally. An ORT
alternative is **already built but disabled**:

- `face-detector-ort.ts` — `createOrtFaceDetector` / `OrtFaceDetector`.
- `face-detector-ort-decode.ts` — TS decode + NMS (what MediaPipe does internally).
- `face-detector-ort-manifest.ts` — manifest validation.
- `public/models/reframe-face/manifest.json` — **template** (`license: TBD`), so the
  ORT path stays disabled and Smart Reframe uses MediaPipe or the saliency fallback.

Face detection runs in a one-shot analysis pass at the analysis fps (default 2 fps),
**not** in the preview/export hot path, so it is **not frame-coupled**: the ORT
detector may declare `wasm` alongside `webgpu`/`webnn` and reads outputs back to CPU
(`tensorLocation: 'cpu'`) for TS decode. No compositor device adoption is needed.

## R0 — Hard constraints (must not regress)

- **R0.1** No model bytes fetched/instantiated at startup; the face ONNX loads only
  on explicit user action (click-to-load), exactly as MediaPipe does today.
- **R0.2** **Saliency fallback stays the default.** Smart Reframe must work with no
  face model loaded (pure-DSP saliency), and degrade to it on any model
  unavailability/failure — never a dead feature.
- **R0.3** No inference/pixel loops on the main thread; reframe analysis stays in
  its lazy worker. No cloud inference; same-origin/allowlisted model hosting only.
- **R0.4** Reframe output quality (crop-path, primary-subject tracking, One-Euro
  smoothing, shot-boundary) is preserved.

## R1 — Dependencies & sequencing

- **R1.1** Builds on the merged ORT foundation (#121) and the existing reframe ORT
  scaffolding. Independent of `ml-runtime-litert-retirement` (#123) — different
  files/runtime — but **both must land** for the end state "one ML runtime, ORT".
- **R1.2** This is the step that lets the policy claim full single-runtime
  unification; until it lands, the repo ships two ML runtimes (ORT + MediaPipe
  Tasks-Vision).

## R2 — Face-detection ONNX + parity

- **R2.1** Pin a **license-verified permissive** face-detection ONNX in
  `public/models/reframe-face/manifest.json` (real `model.url` on an allowlisted
  host, `sizeBytes` + SHA-256, real `io` + `decode` contract matching the exported
  graph). Replace the `template` flag and `license: TBD`.
- **R2.2** The ORT detector's TS decode + NMS (`face-detector-ort-decode.ts`) must
  match the chosen model's output convention (boxes/scores/anchors), producing the
  same `FaceDetection` shape the reframe analyzer consumes.
- **R2.3** Prove detection parity vs MediaPipe BlazeFace on the Smart Reframe
  fixture set (primary-subject selection + crop-path stability at the analysis fps)
  before removing the MediaPipe path.

## R3 — Wire the ORT detector

- **R3.1** The reframe analyzer/worker click-to-load path creates the **ORT** face
  detector (`createOrtFaceDetector`) instead of the MediaPipe one; saliency remains
  the pre-load default.
- **R3.2** `OrtFaceDetectorUnavailableError` (template/op-gate/network) degrades to
  saliency, exactly as the MediaPipe-unavailable path does today.

## R4 — Remove `@mediapipe/tasks-vision`

- **R4.1** Delete the MediaPipe detector code (`createMediapipeFaceDetector` + the
  tasks-vision typings in `face-detector.ts`), `mediapipe-loader.{js,d.ts}`, and the
  tasks-vision WASM-fileset config + BlazeFace `.tflite` references in
  `face-models.ts`. Keep the shared `FaceDetector` interface + mock.
- **R4.2** Remove `@mediapipe/tasks-vision` from `package.json` + lockfile.
- **R4.3** Update the capability probe (`capability-probe-v2.ts`) and Smart Reframe
  UI (`SmartReframePanel`, controller/bridge) to drop MediaPipe-specific
  detection/copy; the only model path is ORT.

## R5 — Docs

- **R5.1** `docs/SMART-REFRAME.md` + `src/features/docs/content/smart-reframe.md`
  describe ORT face detection (no MediaPipe). `docs/ML-RUNTIME.md` states the end
  state: **ORT is the only ML runtime**; no LiteRT, no MediaPipe Tasks-Vision.

## R6 — Verification

- **R6.1** Full quality gate green; reframe tests updated (ORT detector + decode;
  remove MediaPipe-detector tests).
- **R6.2** Manual: Smart Reframe with the ORT face model loaded and with saliency
  only; both produce valid crop paths.
- **R6.3** Single-runtime done-signal: `grep -riE '@mediapipe|tasks-vision' src/
  public/ package.json` returns only historical spec text; a fresh `pnpm install`
  pulls no MediaPipe package; the app boots with ORT as the sole ML runtime.
