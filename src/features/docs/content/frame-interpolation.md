# Frame Interpolation

Frame Interpolation is planned to synthesise plausible in-between frames from your
footage using a machine-learning model running entirely on your device. It is
currently hidden until a license-verified ONNX model passes the WebGPU validation
gate and the preview/export bridge is wired. When enabled, it supports three uses:

1. **Smooth slow motion** — slow a clip without judder or ghosting by generating
   intermediate frames instead of duplicating or blending.
2. **Frame-rate upconversion** — export at a higher fps than your source (e.g. 24→60).
3. **Motion blur synthesis** — optionally generate directional blur from the estimated
   optical flow.

## How it works

The interpolation model must be a RIFE-class ONNX interpolator running through
ONNX Runtime Web on the WebGPU execution provider. The engine uses the same
renderer-owned `GPUDevice` as preview/export, wraps inputs with GPU-buffer tensors,
and keeps the output on-device. There is no full-frame WASM/CPU fallback.

The checked-in manifest is a non-loadable template, so the app reports
**"No compatible interpolation model configured"** and keeps the feature hidden.

Everything runs locally on your device — no frames are uploaded, no cloud AI is used,
and no account or API key is required.

## Availability

Frame Interpolation requires a compatible model and WebGPU hardware acceleration:

| Browser tier                             | Interpolation capability               |
| ---------------------------------------- | -------------------------------------- |
| **Accelerated** (core-webgpu)            | Hidden until model + bridge validation |
| **Compatibility** (compatibility-webgpu) | Hidden until model + export bridge     |
| **Limited / Shell-only**                 | Hidden — requires WebGPU               |

## Model download

After a real model is configured, the first use downloads the ONNX file and verifies
it against its SHA-256 digest. After the first download, it is cached locally and
works fully offline.

- The download size is shown **before** any fetch begins.
- The model is fetched from a trusted host through a same-origin proxy.
- The model's license and provenance are shown in the panel.

## Using interpolation

### Slow motion (speed ramps)

This section describes the intended workflow once the model and synthesis bridge
land.

1. Select a clip on the timeline.
2. In the Inspector, find the speed/rate controls.
3. Choose **Synthesize** as the frame-handling mode (instead of Duplicate or Blend).
4. If the model isn't loaded yet, click **Load model** (size shown).
5. A time estimate appears before synthesis begins.
6. On the accelerated tier, click **Preview interpolated segment** to see a bounded
   preview around the playhead.

### Frame-rate upconversion at export

1. Open the Export dialog.
2. Enable the **fps upconversion** option.
3. Set your target fps (e.g. 60).
4. A time estimate appears before the export begins.

### Motion blur

When the model supports it, an optional **motion blur** toggle generates directional
blur from the estimated optical flow. This is off by default.

## Limits

- **Maximum 4× density per source pair** — at most 3 synthesised frames inside any
  one source interval. This caps quality degradation and VRAM/time costs.
- **Export-only below the accelerated tier** — preview requires the high tier.
- **No interpolation across shot boundaries** — the engine detects scene changes and
  holds the frame instead of synthesising across unrelated shots.
- **No realtime interpolated playback** in v1 — only bounded-segment preview on the
  accelerated tier.

## Performance

- A time estimate is shown before every synthesis run.
- Synthesised frames are cached, so re-generating the same span is near-instant.
- For large frames (1080p+), the engine tiles the frame to stay within VRAM limits.
- The feature is the most compute-heavy in the app — expect exports to take
  significantly longer with interpolation enabled.

## Troubleshooting

- **"Frame interpolation requires WebGPU"** — your browser or GPU doesn't support
  WebGPU. Use a Chromium-based browser with hardware acceleration enabled.
- **"No compatible interpolation model configured"** — the shipped manifest is still
  a template; a real ONNX model has not passed validation yet.
- **"Model not loaded"** — after a real manifest lands, click Load model to download
  the interpolation model.
- **"Factor exceeds 4× cap"** — reduce the slowdown factor or target fps ratio.
- **Shot boundary refusal** — the engine detected a scene change and held the frame
  instead of synthesising. This is expected behaviour.

## Licensing

- **Model:** not yet selected. Candidates must have a permissive license, pinned
  size/SHA-256, a documented I/O contract, and full ORT-WebGPU operator coverage.
- **Runtime:** ONNX Runtime Web with the WebGPU execution provider.
