# Smart Reframe face-detector model (Phase 33 follow-up)

Phase 33 ships Smart Reframe with two subject-detection paths: a pure-DSP
**saliency** estimator (always available) and a click-to-load **MediaPipe
BlazeFace** detector loaded from Google's remote model store. The latter is
runtime-fetched (not vendored, not digest-pinned) under the project's
hobby-scope decision.

This directory adds an **optional ORT/ONNX face detector** as a properly
catalog-pinned alternative — built on the Phase 105 ORT foundation
(`src/engine/ml/ort/`), loaded through the same SHA-256-verified, OPFS-cached,
same-origin-proxy path the other ORT and LiteRT model assets use.

## Status: not yet configured (path disabled)

`manifest.json` here is a **`template`** — `validateReframeFaceDetectorManifest`
rejects any manifest with `"template": true`, so:

- The ORT face-detector path never loads bytes, never creates a session, and
  never appears in the Smart Reframe panel as available.
- Smart Reframe continues to work as today: saliency by default, with the
  existing MediaPipe BlazeFace path available on click-to-load.
- Diagnostics report **"face detector unavailable; using saliency"** when the
  ORT manifest is rejected and the MediaPipe path was not loaded.

There is no silent fallback to a different ONNX model and no startup download.

## How model bytes are delivered (local-first, no cloud inference)

- Fetched **on explicit user action** through the same-origin Worker proxy
  (`/_model/{hf,gh,gcs}/…`, `src/worker/index.ts`) or a Cloudflare **R2** bucket
  — never a direct cross-origin browser fetch (COEP `require-corp`). The host
  allowlist is `assertTrustedOrtModelUrl` (`src/engine/ml/ort/ort-asset-loader.ts`).
- **SHA-256 + size verified** before the session is created, and **OPFS-cached
  by digest** (`loadVerifiedAsset` / `createOpfsAssetStore`) — offline after
  the first download.
- Bytes are **never** embedded in the app bundle. The ORT WASM/JSEP runtime
  (~26 MB) is served same-origin via the Worker reverse-proxy at `/_ort/`.
- **No image uploads, no cloud inference, no telemetry.** Every detection runs
  in the Smart Reframe analysis worker on the user's device.

## Execution providers

The reframe face detector is **not** frame-coupled (it runs at the analysis fps,
typically 2 fps, in a one-shot worker pass — not on the preview/export hot
path). It may declare `webgpu`, `webnn`, **and** `wasm` execution providers.

The runtime then picks them in manifest order subject to one extra rule:

- **WASM is allowed only when the input tensor is small.** The face detector
  loader rejects the WASM EP for any input whose total tensor size (W × H × C ×
  bytesPerElement) exceeds `WASM_DETECTOR_INPUT_TENSOR_LIMIT_BYTES`
  (2 MiB at the time of writing). This keeps the worker responsive and
  preserves cancellation — a BlazeFace-class 128×128 detector is fine, a
  640×640 SCRFD is not.

The analysis worker is single-threaded per analysis and respects
`reframe-cancel` between frames, so cancellation works on any EP.

## Manifest schema

`manifest.json` is a base ORT manifest (provenance + integrity + EP policy,
validated by `validateOrtManifest`) plus a face-detector `io` block and a
`decode` block.

### `io`

| Field             | Type                                            | Description                                           |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `layout`          | `'nchw'` \| `'nhwc'`                            | Image tensor layout.                                  |
| `inputWidth`      | positive integer                                | Model input width in pixels.                          |
| `inputHeight`     | positive integer                                | Model input height in pixels.                         |
| `inputChannels`   | positive integer                                | Typically 3 (RGB).                                    |
| `bytesPerElement` | positive integer                                | 4 for float32, 2 for float16, 1 for int8/uint8.       |
| `inputName`       | non-empty string                                | The ONNX graph's image input name.                    |
| `inputRange`      | `'unit'` \| `'signed-unit'` \| `'mean-std'`     | `[0,1]`, `[-1,1]`, or per-channel `(x − mean) / std`. |
| `mean`            | `[r, g, b]` (only when `inputRange='mean-std'`) | Per-channel mean used during preprocessing.           |
| `std`             | `[r, g, b]` (only when `inputRange='mean-std'`) | Per-channel std-dev used during preprocessing.        |

### `decode`

| Field               | Type                                                         | Description                                                                                                 |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `type`              | `'raw-bbox'` \| `'anchor-offset'`                            | How to interpret the boxes output.                                                                          |
| `boxesOutputName`   | non-empty string                                             | Output name for box predictions.                                                                            |
| `scoresOutputName`  | non-empty string                                             | Output name for per-prediction scores.                                                                      |
| `boxFormat`         | `'xyxy-normalized'` \| `'xywh-normalized'` \| `'xywh-pixel'` | Box encoding (required for `raw-bbox`; for `anchor-offset` defaults to xywh offsets in the anchor's space). |
| `anchorsOutputName` | string                                                       | (Optional, `anchor-offset`) ONNX output that ships the prior anchors when they live in the graph.           |
| `scoreThreshold`    | float ∈ (0, 1)                                               | Minimum confidence to keep a candidate.                                                                     |
| `iouThreshold`      | float ∈ (0, 1)                                               | NMS IoU threshold (greedy NMS, descending score).                                                           |
| `maxDetections`     | positive integer                                             | Cap on outputs after NMS.                                                                                   |
| `applySigmoid`      | `boolean` (default `false`)                                  | Set true when the scores output is unactivated logits rather than probabilities.                            |

## To enable

1. Pick a face-detector ONNX whose **licence is verified permissive**
   (commercial-OK).
2. Export/obtain the ONNX graph; host it on an allowlisted host
   (HF / GitHub / GCS / R2).
3. Replace `manifest.json`: remove `"template"`, set the real `model.url` (proxy/R2 path),
   `model.sizeBytes` + `model.checksum` (sha256), and the `io`/`decode` contract
   matching the exported graph's signature.
4. Add the model's licence + provenance under the app's third-party attributions.
