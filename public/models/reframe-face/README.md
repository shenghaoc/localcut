# Smart Reframe Face-Detector Model

Smart Reframe uses visual saliency by default and can optionally load this
ORT/ONNX face detector after the user clicks **Load face model**. The model is
never fetched or instantiated at startup.

## Shipped Model

| Field   | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| Model   | UltraFace RFB-320 (`version-RFB-320.onnx`)                         |
| Source  | `Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB`               |
| Commit  | `dffdddda9794a50607cba8f318507a28c1c27cab`                         |
| License | MIT                                                                |
| Size    | `1,270,727` bytes                                                  |
| SHA-256 | `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017` |
| Runtime | ONNX Runtime Web, WASM EP, CPU tensors                             |

The model input is `input [1, 3, 240, 320]` in NCHW RGB float32 layout. The
preprocessor applies the upstream normalization `(channel - 127) / 128`.

The model outputs:

| Output   | Shape          | Decode                                                         |
| -------- | -------------- | -------------------------------------------------------------- |
| `boxes`  | `[1, 4420, 4]` | `xyxy-normalized`                                              |
| `scores` | `[1, 4420, 2]` | class row `[background, face]`; read index `1` with stride `2` |

The TypeScript decoder applies score thresholding and greedy NMS, then returns
normalized `FaceDetection` boxes to the existing Smart Reframe tracker.

## Delivery

- Fetched only on explicit user action through the same-origin Worker proxy:
  `/_model/gh/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/<commit>/...`.
- Verified by exact byte count and SHA-256 before session creation.
- Cached in OPFS by digest through `loadOrtModelAsset`.
- No frame, tensor, or detection result leaves the user's browser.

The model is non-frame-coupled: Smart Reframe samples at the analysis frame rate,
not on the preview/export hot path. The 320x240x3 float32 input tensor is below
the worker responsiveness gate for ORT-WASM.
