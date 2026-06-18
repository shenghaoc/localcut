# Portrait matte ONNX model

This directory holds the shipped portrait-matte manifest for the ORT-only matte
backend (`src/engine/matte/matte-onnx-engine.ts`). The retained runtime is
ONNX Runtime Web on the WebGPU execution provider; there is no alternate matte
runtime or CPU fallback.

## Shipped model

| Field        | Value                                                                               |
| ------------ | ----------------------------------------------------------------------------------- |
| Model        | [`onnx-community/modnet-webnn`](https://huggingface.co/onnx-community/modnet-webnn) |
| Source graph | `onnx/model.onnx`                                                                   |
| License      | Apache-2.0                                                                          |
| Size         | 25,888,640 bytes                                                                    |
| Digest       | `sha256-07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`           |
| Input        | `input`, FP32 NCHW `[1, 3, 256, 256]`, signed-unit normalization                    |
| Output       | `output`, single-channel alpha `[1, 1, 256, 256]`, unit range                       |

The Hugging Face model card identifies the repository as Apache-2.0 and describes
the graph as MODNet portrait matting. The manifest uses the fp32 ONNX file because
the matte path is frame-coupled and must keep tensor output on the ORT WebGPU
device (`gpu-buffer`).

## Fetch, verify, cache

The model is fetched only after the user enables Portrait Matte. The URL goes
through the same-origin `/_model/hf/` Worker proxy so the cross-origin-isolated
app never performs a direct browser fetch to Hugging Face. `loadOrtModelAsset`
checks the trusted-host policy, verifies `sizeBytes` and SHA-256, then stores the
bytes in the digest-keyed OPFS model cache for offline reuse.

The ORT runtime itself is not bundled here. It is loaded lazily through the
version-pinned `/_ort/` proxy and runtime-cached by the service worker.

## Runtime contract

The matte engine imports each `VideoFrame` as an external texture, resizes and
normalizes it with `matte-onnx-preprocess.wgsl`, wraps the resulting GPU buffer
with `ort.Tensor.fromGpuBuffer`, and asks ORT for `gpu-buffer` output. The
resolve pass reads the single-channel alpha buffer directly on the same
ORT-owned WebGPU device adopted by the renderer.

The manifest must keep:

- `executionProviders: ["webgpu"]`
- `tensorLocation: "gpu-buffer"`
- `frameCoupled: true`
- `io.outputChannels: 1`
- `io.outputRange: "unit"`

GPL-family portrait-matting weights remain rejected by
`validateMatteOnnxManifest`; the app is MIT-licensed and ships only
permissively licensed model weights.
