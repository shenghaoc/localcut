# Design — ML runtime: MediaPipe Tasks-Vision retirement (Smart Reframe → ORT)

PR124 finishes the runtime-consolidation chain: Smart Reframe face detection now
uses ONNX Runtime Web only. The old MediaPipe Tasks Vision path is deleted, and
saliency remains the default/fallback when the optional face model is not loaded
or fails.

## Runtime Shape

```
SmartReframePanel
  -> ReframeController.loadFaceModel(manifestUrl)
  -> reframe-load-face-model
  -> reframe-analyzer.ts
  -> createOrtFaceDetector()
  -> UltraFace RFB-320 ONNX on ORT-WASM
  -> TS decode/NMS
  -> FaceDetection[]
  -> tracker/keyframe generator
```

No path imports a second ML runtime. `face-detector.ts` is now a pure shared
interface/test-mock module; ORT lives behind the lazy worker import.
`reframe-analyzer.ts` no longer has a multi-runtime fallback loader: a detector
load failure reports saliency-only status directly.

## Model

The pinned model is UltraFace RFB-320:

- Repo: `Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB`
- Commit: `dffdddda9794a50607cba8f318507a28c1c27cab`
- License: MIT
- File: `models/onnx/version-RFB-320.onnx`
- Size: `1,270,727` bytes
- SHA-256:
  `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017`

The model is fetched through `/_model/gh/`, verified by the shared ORT asset
loader, and OPFS-cached by digest. It is not bundled and never loads at startup.

## Decode

The model graph signature is:

- Input `input [1, 3, 240, 320]`, NCHW RGB float32.
- Output `boxes [1, 4420, 4]`, `xyxy-normalized`.
- Output `scores [1, 4420, 2]`, `[background, face]`.

`face-detector-ort-manifest.ts` adds `scoreStride` + `scoreIndex` to the decode
schema so the manifest can say "read class index 1 out of each two-score row".
`face-detector-ort-decode.ts` uses those fields before thresholding and greedy
NMS. This keeps the decoder generic for future raw-bbox or anchor-offset models.

## Worker And UI

`reframe-bridge.ts` now creates a module worker; the previous classic-worker
constraint only existed for a runtime that loaded WASM through `importScripts`.
Its comments now describe lazy ESM ORT chunks instead of the retired
`importScripts` requirement. The controller and protocol send only
`ortManifestUrl`. The panel copy names one optional ONNX face detector and
reports the loaded engine as `ort-onnx`.

When ORT loading, asset verification, session creation, or decode fails, the
worker posts a failed face-model status and Smart Reframe remains saliency-only.
The analysis flow, tracker, shot-boundary detection, and keyframe generator are
unchanged.

## Removed Surface

- `@mediapipe/tasks-vision` dependency and lockfile entries.
- `src/engine/reframe/mediapipe-loader.{js,d.ts}`.
- `createMediapipeFaceDetector` and local Tasks Vision typings.
- the fallback loading chain in `reframe-analyzer.ts`.
- WASM/TFLite URL constants in `face-models.ts`.
- MediaPipe-specific Workbox runtime caches.
- UI/probe/docs copy that described a fallback engine.

## Verification

Automated coverage focuses on the new risk points:

- shipped manifest validates and pins the expected UltraFace size/checksum;
- score row selection decodes `[background, face]` outputs correctly;
- WASM tensor-size gate remains enforced;
- mock detector seam still supports saliency/tracker tests;
- the runtime grep for `@mediapipe|tasks-vision` under `src/`, `public/`, and
  `package.json` is empty.
