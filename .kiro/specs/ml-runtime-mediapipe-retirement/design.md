# Design — ML runtime: MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

> **Plan only — not yet implemented.** Implementation is for a later agent. This
> completes "one ML runtime, ORT": after `@litertjs/core` is gone (#123),
> `@mediapipe/tasks-vision` is the last non-ORT runtime, and the ORT replacement is
> already scaffolded — the work is to pin a model, prove parity, wire it, and delete
> MediaPipe.

## Key insight: the ORT path already exists, just disabled

Smart Reframe's face detection is behind one interface, `FaceDetector`
(`{ detect(image): FaceDetection[] }`), with two implementations:

- `createMediapipeFaceDetector` (`face-detector.ts`) — **deployed**:
  `@mediapipe/tasks-vision` `FaceDetector` over BlazeFace `.tflite`; MediaPipe owns
  decode + NMS. Loaded via the untyped `mediapipe-loader.js`; WASM fileset + model
  URLs in `face-models.ts`.
- `createOrtFaceDetector` (`face-detector-ort.ts`) — **built but disabled**: ORT
  session (non-frame-coupled, CPU tensor outputs), with TS decode + NMS in
  `face-detector-ort-decode.ts`, manifest validation in `face-detector-ort-manifest.ts`,
  and a **template** `public/models/reframe-face/manifest.json` (so it refuses to
  load and the analyzer falls back to MediaPipe or saliency).

So this retirement is: supply a model → wire the ORT detector as the click-to-load
path → delete the MediaPipe implementation + dependency.

## Why it's simpler than the LiteRT retirement

- **Not frame-coupled.** Face detection runs at the analysis fps (~2 fps) in the
  reframe worker, not the preview/export hot path. The ORT detector reads outputs
  back to CPU for TS decode — no `gpu-buffer` IO, no compositor device adoption
  (unlike matte/interpolation/beauty). The non-frame-coupled EP policy lets it
  declare `wasm` alongside `webgpu`/`webnn`, gated by input-tensor size.
- **No live device sharing.** Nothing here touches `PreviewRenderer` / #122.

## Sequencing & gates

1. **R2** Pick a permissively-licensed face-detection ONNX; pin it in
   `reframe-face/manifest.json` (real url/size/sha + `io`/`decode`); make
   `face-detector-ort-decode.ts` match its output convention; pass the
   op-support/size gate; **prove parity** vs MediaPipe BlazeFace on the reframe
   fixtures. **Gate: do not remove MediaPipe until parity holds.**
2. **R3** Switch the reframe analyzer/worker click-to-load to `createOrtFaceDetector`;
   keep saliency as the default and the unavailable→saliency degrade path.
3. **R4** Delete `createMediapipeFaceDetector` + tasks-vision typings,
   `mediapipe-loader.{js,d.ts}`, the fileset/`.tflite` config in `face-models.ts`,
   the `@mediapipe/tasks-vision` dependency, and MediaPipe-specific probe/UI copy.
4. **R5** ORT-only docs; `docs/ML-RUNTIME.md` declares ORT the sole ML runtime.

## What stays

- The `FaceDetector` interface + `createMockFaceDetector` (tests).
- Pure-DSP saliency fallback, IoU primary-subject tracking, One-Euro smoothing,
  histogram shot-boundary, and the whole reframe analysis/keyframe-output pipeline.
- The ORT foundation (`src/engine/ml/ort/`) and the ORT-WASM EP.

## Risks

- **Model supply / parity (highest).** A permissive face-detection ONNX (e.g. an
  anchor-based SSD/BlazeFace-class export) whose decode convention is documented and
  whose accuracy matches MediaPipe at 2 fps may need candidate evaluation. The
  template manifest's `license: TBD` is the blocker. Until R2.3, keep MediaPipe.
- **Decode/NMS fidelity.** MediaPipe hides anchor decode + NMS + score thresholds;
  `face-detector-ort-decode.ts` must reproduce them for the chosen graph. Mismatched
  anchors/score scaling silently degrade tracking.
- **Capability-probe coupling.** `capability-probe-v2.ts` references MediaPipe; the
  reframe availability signal must move cleanly to the ORT EP check without altering
  `CapabilityTierV2` derivation.

## Touch points

`src/engine/reframe/{face-detector.ts, mediapipe-loader.{js,d.ts}, face-models.ts,
face-detector-ort*.ts, reframe-analyzer.ts}`, `public/models/reframe-face/`,
`src/engine/capability-probe-v2.ts`, `src/ui/{SmartReframePanel.tsx,
reframe-controller.ts, reframe-bridge.ts}`, `package.json`, the Smart Reframe docs.
Done-signal: `grep -riE '@mediapipe|tasks-vision' src/ public/ package.json` returns
only historical spec text.
