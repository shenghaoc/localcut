# Design: Phase 31 - Portrait Video Matting

Portrait Matte is a frame-coupled ORT-WebGPU feature. ORT owns the `GPUDevice`;
the renderer adopts that device before matte output is composited. This keeps the
accelerated preview/export path free of CPU pixel or tensor round-trips.

## Model

The shipped manifest is `public/models/matte-onnx/manifest.json`:

- source: `https://huggingface.co/onnx-community/modnet-webnn`
- license: Apache-2.0
- graph: `onnx/model.onnx`
- size: 25,888,640 bytes
- checksum:
  `sha256-07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`
- input: `input`, FP32 NCHW `[1, 3, 256, 256]`, signed-unit normalization
- output: `output`, single-channel alpha, unit range

The manifest validator rejects placeholder manifests, non-ONNX formats,
copyleft licenses, non-WebGPU execution providers, CPU tensor locations, and
multi-channel or non-unit alpha outputs.

## Pipeline

```
VideoFrame
  -> importExternalTexture
  -> matte-onnx-preprocess.wgsl
  -> GPUBuffer input tensor
  -> ort.Tensor.fromGpuBuffer
  -> ORT session.run
  -> GPUBuffer alpha tensor
  -> matte-resolve.wgsl
  -> rgba8unorm alpha texture
  -> compositor matte/blur passes
```

The preprocess pass handles source-frame resize and normalization on the GPU.
The resolve pass applies temporal EMA smoothing and writes an alpha texture that
the compositor can bind directly.

## Runtime Ownership

`createOrtSession()` creates the ORT-WebGPU session. ORT exposes the device it
created via `ort.env.webgpu.device`; the worker asks `PreviewRenderer` to rebuild
on that device before the model reports loaded. This is the only supported
WebGPU direction because ORT ignores an injected app-created `GPUDevice`.

## Failure Behaviour

Model failures are non-fatal. Preview/export continues with the original clip
until the model is loaded and a matte is available. Errors update the matte model
status and diagnostics, but they do not disable the editor or corrupt timeline
state.

## Boundaries

- No CPU full-frame fallback.
- No server inference.
- No model load at startup.
- Smart Reframe's MediaPipe Tasks Vision model path is separate from this
  feature.
