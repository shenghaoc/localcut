# Smart Reframe

Smart Reframe (Phase 33) generates an automatic crop path when you convert a
clip between aspect ratios — for example turning a 16:9 landscape clip into a
9:16 vertical one — keeping the primary subject in frame as it or the camera
moves. The full specification lives in
[`.kiro/specs/phase-33-smart-reframe/`](../.kiro/specs/phase-33-smart-reframe/design.md).

> Runs entirely on this device. No frames, detection results, or other data
> leave your browser. No server, API key, or account.

## What it produces

Smart Reframe never bakes in an opaque crop or a hard-coded rectangle. It
writes standard **transform keyframes** — `x`, `y`, and `scale` tracks — onto
the target clip, identical in every way to keyframes you author by hand. After
applying you can select the clip and edit, delete, or extend them in the
Inspector. Applying is a single undo step, and the keyframes survive project
save/load and bundle round-trips with no Smart Reframe–specific serialisation.

The aspect-ratio change itself is handled by the existing `fit: 'fill'` crop, so
the generated `scale` stays at `1.0` (extra zoom is reserved for future tighter
framing); `x`/`y` translate the layer to keep the subject centred.

## Supported aspect ratios

9:16 (vertical), 1:1 (square), 4:5 (social portrait), 16:9 (landscape), and 4:3
(classic). The source aspect ratio is derived from the clip's media dimensions
after applying rotation metadata. When the target equals the source the analysis
still runs to centre the subject, but no crop change is needed.

## The review / apply flow

1. Select a video clip and open **Smart Reframe** from the toolbar.
2. Pick a target aspect ratio.
3. **Analyse** — a dedicated, lazily-spawned worker scans the clip's used range
   at a low analysis frame rate (default 2 fps). A progress bar reports frames
   processed; **Cancel** aborts cleanly.
4. On completion, the program monitor shows a **preview overlay**: the proposed
   crop rectangle plus a dashed action-safe inner rectangle at the playhead,
   updating as you scrub. The panel reports the detection mode, frames analysed,
   shot boundaries, keyframes generated, and safe-zone compliance.
5. **Apply** writes the keyframes, **Discard** drops the result, or **Adjust**
   exposes the velocity/acceleration/analysis-rate controls for a re-analysis.

If the clip already has `x`/`y`/`scale` keyframes, Smart Reframe asks you to
confirm replacement first.

## Subject detection

- **Visual saliency** (always available, pure DSP) scores each downscaled
  analysis frame from a skin-tone mask (YCbCr), Sobel edge density, and local
  contrast, and takes the highest-scoring region as the subject centroid. This
  build uses saliency for every clip.
- **Face detection** (BlazeFace-class, via LiteRT.js) is the designed primary
  locator and falls back to saliency for faceless footage. It reuses the same
  on-device runtime and model pipeline as Auto Captions and Audio Cleanup: the
  LiteRT.js runtime wrapper, the digest-verified model loader, and the output
  decoder are implemented and unit-tested, but no face-detection model
  catalogue entry is bundled yet — wiring the `.tflite` model is a separate
  integration step (spec task T15). The model would download on demand from a
  trusted host, digest-verified and OPFS-cached (no precache bloat), exactly
  like the Whisper and DTLN models. Until then the panel and the **Smart
  Reframe** capability row note that saliency is in use. A model-integrity
  failure (checksum/size mismatch) is always a hard, user-visible error — never
  a silent fallback.

A lightweight tracker (IoU association with one-euro smoothing) follows a single
primary subject, and shot-boundary detection (chi-squared RGB histogram
difference — pure DSP, no ML) resets tracking at hard cuts.

## Bounded motion

Pan **velocity** and **acceleration** are clamped per shot so generated motion
never whips, even on abrupt subject movement — the subject may briefly drift
from centre, the intended trade-off for watchable motion. At each cut a `hold`
keyframe is placed immediately before the boundary so the crop does not
interpolate across the edit. **Safe-zone compliance** reports the share of
frames where the subject stays inside the 90% action-safe rectangle; when it is
low, widen the bounds in **Adjust** or edit the keyframes by hand.

## Non-goals / limitations

- **One subject per clip** — no multi-subject composite framing.
- **Faces and general saliency only** — no car/pet/product object tracking.
- **No automatic cutting or reordering** — transform keyframes only.
- **Offline** — analysis scans an imported clip; there is no live-camera reframe.
