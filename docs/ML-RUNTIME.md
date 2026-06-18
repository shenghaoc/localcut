# ML Runtime Policy

This document is the current policy for on-device ML in LocalCut Studio. It
describes the implemented end state after the runtime consolidation: model
features run through ONNX Runtime Web (ORT), with the execution provider chosen
per model.

> Everything here runs in the user's browser. Models are fetched from a small
> allowlist of hosts through same-origin proxies, verified by size and SHA-256,
> and cached locally. No frames, tensors, audio, transcripts, or inference
> results leave the device. There is no server-side inference.

## Runtime Rules

- **ONNX is the repo-owned model format.** New model features use ONNX manifests
  and ORT sessions.
- **ORT-WebGPU is required for full-frame, frame-coupled models** such as
  portrait matte and frame interpolation.
- **ORT-WebNN is opt-in per model** and requires operator-support proof before a
  manifest may pin it.
- **ORT-WASM is allowed for small, non-frame-coupled models** such as Whisper ASR
  and DTLN audio cleanup.
- **Full-frame inference must not silently fall back to CPU tensors.** A
  frame-coupled manifest that lists `wasm` or `tensorLocation: "cpu"` is rejected.
- **Models are fetched on explicit user action only.** ORT itself is lazy-loaded
  through `src/engine/ml/ort/ort-loader.ts`; no model or runtime loads at app
  startup.

## Device Ownership

ORT does not adopt an externally created `GPUDevice`
([microsoft/onnxruntime#26107][ort-26107]). For WebGPU sessions, ORT creates the
device; the renderer then adopts `ort.env.webgpu.device` so the app's WGSL passes
and ORT tensor buffers live on the same device.

The rule is:

- **WebGPU:** ORT owns the device (`deviceOwner: "ort-webgpu"`), and the renderer
  rebuilds on that device before compositing ORT output.
- **WebNN:** a model may use a pre-created `MLContext` (`deviceOwner:
"webnn-context"`) only when that model has explicit WebNN support proof.
- **WASM:** CPU tensors are allowed only outside the frame-coupled preview/export
  hot path.

The browser proof lives in `src/engine/ml/ort/ort-device-ownership.browser.test.ts`.

[ort-26107]: https://github.com/microsoft/onnxruntime/issues/26107

## Execution Providers

`src/engine/ml/ort/ep-policy.ts` validates the EP list from each manifest and
hands it to ORT verbatim. The foundation never appends an implicit fallback.

| EP       | Use                           | Tensor location |
| -------- | ----------------------------- | --------------- |
| `webgpu` | Full-frame video models       | `gpu-buffer`    |
| `webnn`  | Explicitly proven model paths | `ml-tensor`     |
| `wasm`   | Small non-frame-coupled jobs  | `cpu`           |

Frame-coupled models must pin at least one GPU-class EP and must not include
`wasm`. This keeps the accelerated preview/export path free of hidden CPU
round-trips.

## Model Hosting And Integrity

Model bytes are sourced from their publisher and fetched through the app's
same-origin Worker proxies:

- `/_model/hf/` for Hugging Face model repos and their storage backends.
- `/_model/gh/` for GitHub-hosted releases or raw files.
- `/_model/gcs/` for vendor-published Google Cloud Storage assets.

Every manifest records:

- `license` and `source`
- exact `sizeBytes`
- `sha256-<64 hex>` checksum
- an explicit execution-provider list
- tensor IO shape, layout, and value-range fields when the engine needs them

`loadOrtModelAsset()` checks the trusted-host policy, verifies the byte count and
digest, and caches the verified asset in OPFS keyed by digest. The ORT runtime
WASM is served separately through the version-pinned `/_ort/` proxy and
runtime-cached by Workbox; it is not precached.

## Diagnostics

The diagnostics snapshot reports a single ML runtime family:

- `mlRuntime: "ort"`
- `ortEp: "webgpu" | "webnn" | "wasm"`
- `tensorLocation: "cpu" | "gpu-buffer" | "ml-tensor"`
- `deviceOwner: "ort-webgpu" | "webnn-context"`

These fields make the important runtime choice visible without exposing internal
worker state in the UI.

## Current Model Features

### Portrait Matte

`src/engine/matte/matte-onnx-engine.ts` runs the shipped MODNet ONNX portrait
matting graph from `public/models/matte-onnx/manifest.json` on ORT-WebGPU. The
input path is:

`VideoFrame` -> `importExternalTexture` -> `matte-onnx-preprocess.wgsl` ->
`ort.Tensor.fromGpuBuffer` -> ORT `session.run` -> `matte-resolve.wgsl`

The renderer adopts ORT's WebGPU device before matte output is composited, so the
alpha buffer stays on-device. GPL-family model weights are rejected by
`validateMatteOnnxManifest`.

### Auto Captions

`src/engine/asr/asr-worker.ts` loads one of the ONNX Whisper manifests under
`public/models/whisper-onnx/`. ASR is not frame-coupled, so the manifests pin the
WASM EP and CPU tensors. Base int8 is the default; tiny int8 is the smaller,
faster option.

### Audio Cleanup

`src/engine/audio-cleanup/cleanup-ort-worker.ts` loads the ONNX DTLN manifest
under `public/models/dtln-onnx/`. DTLN tensors are small, so cleanup also runs on
the WASM EP. The UI exposes one engine: ONNX Runtime DTLN.

### Frame Interpolation And Beauty

The interpolation and beauty manifests remain template-gated until a
license-verified model passes the ORT operator and performance gates. Template
manifests are rejected by their validators and keep the feature hidden instead of
loading placeholder bytes.

## Module Map

| Module                  | Responsibility                                               |
| ----------------------- | ------------------------------------------------------------ |
| `ort-types.ts`          | Shared runtime-free ORT vocabulary.                          |
| `ort-loader.ts`         | Lazy dynamic imports of WebGPU, WebNN, and WASM ORT builds.  |
| `ort-model-manifest.ts` | ONNX manifest validation and frame-coupled EP policy.        |
| `ort-asset-loader.ts`   | Trusted-host check plus verified OPFS asset loading.         |
| `ep-policy.ts`          | Execution-provider resolution and no-CPU frame-coupled gate. |
| `ort-session.ts`        | `InferenceSession.create` wrapper and device reporting.      |
| `webnn-context.ts`      | WebNN `MLContext` helper for models that opt into WebNN.     |
| `onnx-fixture.ts`       | Dev/test identity model used by browser-mode ORT proofs.     |
