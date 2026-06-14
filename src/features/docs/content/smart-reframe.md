# Smart Reframe

Smart Reframe automatically generates a crop path when you convert a clip
between aspect ratios — for example turning a 16:9 landscape clip into a 9:16
vertical one — keeping the main subject in frame as it (or the camera) moves.

Everything runs on your device. No frames, detections, or other data leave your
browser.

## What it produces

Smart Reframe never bakes in an opaque crop. It writes ordinary **transform
keyframes** (position and scale) onto the clip — the same keyframes you can
create by hand. After applying, you can select the clip and edit, delete, or
extend any of them in the Inspector. The whole reframe is a single undo step.

## Using it

1. Select a video clip on the timeline.
2. Open **Smart Reframe** from the toolbar.
3. Pick a **target aspect ratio** (9:16, 1:1, 4:5, 16:9, or 4:3).
4. Click **Analyse**. A dedicated worker scans the clip; a progress bar shows
   how far it has got, and you can cancel at any time.
5. When analysis finishes, the program monitor shows a **preview overlay** of
   the proposed crop and its action-safe zone at the playhead. Scrub to check
   the motion.
6. Choose **Apply** to write the keyframes, **Discard** to throw the result
   away, or **Adjust** to change the motion bounds and re-analyse.

If the clip already has position or scale keyframes, Smart Reframe asks for
confirmation before replacing them.

## How the subject is found

- **Visual saliency** (always available) estimates the most prominent region of
  each frame from skin tone, edges, and local contrast — no machine-learning
  model required. This build uses saliency for every clip.
- **Face detection** is a planned enhancement. When a face-detection model ships
  it will drive the subject locator and fall back to saliency for clips with no
  faces. Until then the Smart Reframe panel notes that saliency is in use.

A lightweight tracker follows one subject across the clip and smooths its path,
and **shot-boundary detection** resets the tracker at hard cuts so the crop does
not slide across an edit.

## Smooth, bounded motion

Generated motion is deliberately gentle. Pan **velocity** and **acceleration**
are capped so the crop never whips, even when the subject moves abruptly — the
subject may briefly drift from the centre, which is the intended trade-off for
watchable motion. Use **Adjust** to loosen or tighten those caps.

The panel reports **safe-zone compliance**: the share of frames where the
subject stays inside the 90% action-safe rectangle. If it is low, widen the
bounds or nudge the keyframes by hand after applying.

## Limitations

- **One subject per clip.** Smart Reframe follows a single primary subject; it
  does not compose several faces into one crop.
- **Faces and general saliency only.** It does not track specific objects such
  as cars, pets, or products.
- **No automatic cutting.** It only generates transform keyframes; it never adds
  or reorders clips.
- **Offline, not live.** Analysis scans an imported clip; there is no
  live-camera reframe.

See also [Timeline editing](/docs/timeline-editing) for working with keyframes
and [Exporting](/docs/exporting) for rendering the reframed result.
