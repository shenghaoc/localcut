# Requirements: Phase 31 - Portrait Video Matting

> Current runtime note: PR #123 moved Portrait Matte to ONNX Runtime Web. The
> deployed path is ORT-WebGPU with an Apache-2.0 MODNet ONNX model pinned in
> `public/models/matte-onnx/manifest.json`.

## R0 - Hard Constraints

- **R0.1** All inference is local. No frame, tensor, mask, or model input may be
  uploaded or sent to a cloud inference service.
- **R0.2** No model loads at startup. The model manifest and weights load only
  after the user enables Portrait Matte.
- **R0.3** The frame-coupled matte path must not fall back to CPU tensors or the
  ORT-WASM execution provider.
- **R0.4** Every `VideoFrame` entering the matte path is closed exactly once.
- **R0.5** Failure to fetch, verify, or compile the model degrades to the original
  unmatted clip with a visible model status; it may not break playback/export.

## R1 - Model And Manifest

- **R1.1** The shipped manifest points to `onnx-community/modnet-webnn` through the
  same-origin `/_model/hf/` proxy.
- **R1.2** The manifest records the Apache-2.0 license, source URL, exact byte
  size, SHA-256 checksum, execution provider list, tensor location, and IO
  contract.
- **R1.3** GPL-family model weights are rejected by `validateMatteOnnxManifest`.
- **R1.4** The model input is RGB FP32 with manifest-declared layout, dimensions,
  and normalization range. The model output is a single-channel unit alpha mask.

## R2 - Zero-Copy Runtime

- **R2.1** The worker imports each frame with `importExternalTexture`.
- **R2.2** `matte-onnx-preprocess.wgsl` resizes and normalizes into a GPU buffer in
  the declared model layout.
- **R2.3** `ort.Tensor.fromGpuBuffer` wraps the preprocessed buffer; ORT output is
  requested as `gpu-buffer`.
- **R2.4** `matte-resolve.wgsl` converts the alpha buffer to an `rgba8unorm`
  texture and applies EMA smoothing without CPU readback.
- **R2.5** The renderer adopts ORT's `GPUDevice` before a loaded matte model can
  composite output, per `ml-runtime-compositor-device-adoption`.

## R3 - Temporal Behaviour

- **R3.1** EMA smoothing is shared between preview and export.
- **R3.2** Seeking, clip changes, source discontinuities, and explicit disable
  actions reset the clip's matte history.
- **R3.3** Preview may reuse the last matte while inference is busy; export waits
  for deterministic matte output.

## R4 - UI And Project State

- **R4.1** Portrait Matte remains an Inspector feature on a selected video clip.
- **R4.2** Modes remain remove, replace, and blur background.
- **R4.3** Strength/blur controls serialize with the existing clip effect state.
- **R4.4** Model status is visible and honest: not loaded, loading, loaded, failed,
  or unavailable.

## R5 - Verification

- **R5.1** Unit tests cover manifest validation, backend selection, load lifecycle,
  concurrency, temporal reset, and no-startup-load behaviour.
- **R5.2** Browser validation should cover WebGPU availability, first-use model
  load, preview matte, export matte, seek reset, and failed model fetch.
