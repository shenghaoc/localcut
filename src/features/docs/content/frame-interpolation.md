# Frame Interpolation

Frame Interpolation synthesises new, plausible in-between frames from your footage
using a machine-learning model running entirely on your device. It enables three uses:

1. **Smooth slow motion** — slow a clip without judder or ghosting by generating
   intermediate frames instead of duplicating or blending.
2. **Frame-rate upconversion** — export at a higher fps than your source (e.g. 24→60).
3. **Motion blur synthesis** — optionally generate directional blur from the estimated
   optical flow.

## How it works

The interpolation model is a RIFE-class learned interpolator (Google FILM,
Apache-2.0 licensed) that runs on your GPU via
[LiteRT.js](https://www.npmjs.com/package/@litertjs/core) with WebGPU acceleration.
It takes a pair of adjacent frames and synthesises the frames in between.

Everything runs locally on your device — no frames are uploaded, no cloud AI is used,
and no account or API key is required.

## Availability

Frame Interpolation requires WebGPU hardware acceleration:

| Browser tier                             | Interpolation capability               |
| ---------------------------------------- | -------------------------------------- |
| **Accelerated** (core-webgpu)            | Preview bounded segments + export      |
| **Compatibility** (compatibility-webgpu) | Export only (slow, with time estimate) |
| **Limited / Shell-only**                 | Feature hidden — requires WebGPU       |

## Model download

The first time you use interpolation, the model (~tens of MB) is downloaded and
verified against its SHA-256 digest. After the first download, it is cached locally
and works fully offline.

- The download size is shown **before** any fetch begins.
- The model is fetched from a trusted host through a same-origin proxy.
- The model's license (Apache-2.0) and provenance are shown in the panel.

## Using interpolation

### Slow motion (speed ramps)

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
- **"Model not loaded"** — click Load model to download the interpolation model.
- **"Factor exceeds 4× cap"** — reduce the slowdown factor or target fps ratio.
- **Shot boundary refusal** — the engine detected a scene change and held the frame
  instead of synthesising. This is expected behaviour.

## Licensing

- **Model:** Google FILM (Apache-2.0), fetched from Google AI Edge / Kaggle.
- **Runtime:** LiteRT.js (`@litertjs/core`), already a dependency for Auto Captions
  and Audio Cleanup.
