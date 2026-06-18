# Requirements: Phase 33 — Smart Reframe

Automatic crop-path generation when converting between aspect ratios (16:9 ↔
9:16, 1:1, 4:5). Face detection drives the primary-subject locator; generic
saliency provides a fallback for faceless footage. The output is **editable
Phase 15 transform keyframes** — never an opaque baked crop — presented
through a review/apply overlay. Integrates with Phase 39 aspect modes for
the target output frame.

## R0 — Hard Constraints

- **R0.1** Smart Reframe runs entirely client-side. No frame, detection
  result, or user data leaves the device. No server, API key, or account.
- **R0.2** Face detection and saliency inference must not run on the SolidJS
  main thread. A dedicated Smart Reframe worker owns the analysis pipeline
  and is distinct from the pipeline worker (`src/engine/worker.ts`).
- **R0.3** The Smart Reframe worker is lazy-loaded (dynamic `import`) only
  when the user triggers analysis. It must not appear in the app startup
  module graph or spawn eagerly.
- **R0.4** Analysis must not block, degrade, or interfere with normal
  import/play/edit/export. Starting Smart Reframe on one clip while
  editing another must not stall the playback clock or the pipeline worker.
- **R0.5** Generated keyframes are stored as standard Phase 15
  `ClipKeyframes` (`x`, `y`, `scale` tracks) on the target clip. They
  are indistinguishable from hand-authored keyframes and fully editable
  by the user after generation.
- **R0.6** No baked crop, hard-coded rectangle, or opaque transform is
  stored. The output is exclusively Phase 15 keyframe tracks with
  standard `KeyframeSnapshot` format (`{ t, value, easing }`).
- **R0.7** Face detection weights and the ORT runtime are loaded only after an
  explicit user "Load face model" action — the same click-to-load gesture as
  Audio Cleanup and Auto Captions. Model bytes load through a same-origin proxy,
  are size/SHA-256 verified, and are OPFS-cached by digest.

## R1 — Aspect Ratio Targets

- **R1.1** Smart Reframe accepts a target aspect ratio selected by the user
  from the supported set: **9:16** (vertical), **1:1** (square), **4:5**
  (social portrait), **16:9** (landscape), and **4:3** (classic TV). The
  set is extensible; adding a new ratio requires only a constant entry.
- **R1.2** The source aspect ratio is derived from the clip's media
  dimensions (width / height after applying source rotation metadata per
  Phase 18). No user input is required for the source ratio.
- **R1.3** When the target aspect ratio equals the source aspect ratio, the
  analysis still runs (to centre on the subject) but the scale component
  of the generated keyframes is 1.0 throughout and the UI notes that no
  crop change is needed.
- **R1.4** The target aspect ratio integrates with Phase 39 aspect mode
  settings: Smart Reframe's output keyframes are compatible with any
  Phase 39 fit mode applied at render time.

## R2 — Face Detection

- **R2.1** Face detection uses the ORT/ONNX UltraFace RFB-320 model running in
  the Smart Reframe worker. The detector returns normalized face boxes with
  confidence scores; TypeScript decode reads the face-class score column and
  applies greedy NMS.
- **R2.2** The face detection model is loaded on the user's explicit "Load
  face model" action (R0.7), then cached for the worker session. A load failure
  (offline, digest mismatch, ORT/session failure) falls through to saliency with
  a notice (R2.6 / R8.2).
- **R2.3** Detection runs on downscaled analysis frames (longest edge ≤
  512 px) to bound compute cost. Detection results are mapped back to
  source-resolution coordinates.
- **R2.4** The detector returns zero or more face bounding boxes per frame.
  The primary subject is the face with the highest confidence score; ties
  broken by largest area. When zero faces are detected, the frame falls
  through to saliency (R3).
- **R2.5** Detection operates at a configurable analysis frame rate
  (default: 2 fps of source time) to balance accuracy against compute
  cost. The analysis rate is not coupled to the project frame rate.
- **R2.6** The face detection probe (presence of runtime, model load
  success/failure) follows the Phase 26 `FeatureSupport` pattern
  (`supported` / `unsupported` / `unknown`). Absence of the runtime
  disables face detection and falls through to saliency with a visible
  explanation.

## R3 — Generic Saliency Fallback

- **R3.1** When face detection yields zero faces for a frame, a pure-DSP
  saliency estimator runs on the same downscaled analysis frame. No ML
  model is required for saliency.
- **R3.2** The saliency estimator combines skin-tone region detection
  (YCbCr range), edge-density mapping, and local-contrast scoring into a
  single heatmap. The highest-scoring region is the saliency centroid.
- **R3.3** Saliency results are lower-confidence than face detections. The
  tracker (R4) weights face detections higher than saliency centroids
  when both are available for a frame.
- **R3.4** When neither face detection nor saliency produces a usable
  subject centroid for a contiguous segment, the segment's keyframes
  default to centred (x=0, y=0) with scale 1.0 and the UI flags the
  segment as "no subject detected".

## R4 — Subject Tracker

- **R4.1** The tracker associates detections across frames using
  Intersection-over-Union (IoU) matching. A detection in frame *N+1* is
  linked to the same subject in frame *N* if their IoU exceeds a
  configurable threshold (default 0.3).
- **R4.2** When IoU matching fails (subject lost, occluded, or cut), the
  tracker enters a coasting state for up to 1 second of source time. If
  no matching detection appears within the coast window, the tracker
  resets to the next available detection.
- **R4.3** The tracked subject's centre trajectory is smoothed with a
  One Euro filter to eliminate jitter. The filter parameters (min
  cutoff, beta, dcutoff) are tuned so that:
  - Slow, deliberate camera moves are preserved faithfully.
  - Fast subject motion is followed without lag exceeding 2 frames at
    the analysis rate.
  - Stationary subjects produce a flat trajectory (no drift).
- **R4.4** A single primary subject is tracked per clip (v1). When
  multiple faces appear, the highest-confidence face is the primary;
  other faces are ignored for keyframe generation.
- **R4.5** The tracker state resets at shot boundaries (R5). After reset,
  the first detection in the new shot becomes the primary subject.

## R5 — Shot Boundary Detection

- **R5.1** Shot boundaries are detected by computing the chi-squared
  distance between normalised RGB histograms of consecutive analysis
  frames. A boundary is signalled when the distance exceeds a
  configurable threshold (tuned so that hard cuts trigger but gradual
  dissolves with low per-frame delta do not false-trigger).
- **R5.2** Shot boundary detection is pure DSP — no ML model. It operates
  on the same downscaled analysis frames used for detection.
- **R5.3** When a shot boundary is detected, the tracker resets (R4.5)
  and the keyframe generation inserts a hold keyframe at
  `T_cut - ε` (immediately before the cut) so the preceding interval
  does not interpolate across the discontinuity. The keyframe at `T_cut`
  itself uses `'linear'` easing to allow tracking in the new shot.
- **R5.4** The shot boundary threshold is validated on a fixture set of
  known cuts to ensure deterministic detection in test mode.

## R6 — Keyframe Generation

- **R6.1** The tracked subject trajectory is converted into Phase 15
  transform keyframe tracks for `x`, `y`, and `scale`. The `easing` of
  all generated keyframes is `'linear'` by default.
- **R6.2** The `x` and `y` keyframe values position the subject centre at
  the output frame centre by translating the layer in the opposite
  direction of the subject's offset. Because the Phase 12 transform model
  positions the layer centre as `centre = 0.5 + x/y`, a subject offset
  to the right requires a negative `x` to shift the layer left:
  `x = -subjectNormX * scale` and `y = -subjectNormY * scale`, where
  `subjectNormX/Y` are the subject's normalised coordinates in the source
  frame (0 = centre, ±0.5 = edge) and `scale` is the geometric scale
  factor (R6.3).
- **R6.2a** The default `fit: 'fill'` mode already covers the output
  aspect ratio by cropping the source. Smart Reframe's `scale` represents
  an additional user zoom level *above* the fill crop — it does not
  re-apply the aspect-ratio crop. The generated scale starts at 1.0
  (no extra zoom) and only increases when the subject needs tighter
  framing; it is never used to achieve the aspect-ratio change itself.
- **R6.3** The `scale` value defaults to 1.0 (no extra zoom beyond the
  fill crop). It may increase above 1.0 when tighter framing is needed
  to keep the subject prominent, but it never drops below 1.0. The
  aspect-ratio change is handled entirely by the existing `fit: 'fill'`
  mode, not by Smart Reframe's scale.
- **R6.4** Keyframe timestamps are sampled at a regular interval
  (default: every 0.5 s of source time, plus one at clip start and one
  at clip end). All generated `t` values are **clip-local** seconds (not
  source-time), matching the existing `KeyframeSnapshot.t` convention so
  keyframes survive save/load and playback correctly. Shot boundary
  points (R5.3) are also keyframed.
- **R6.5** Pan velocity (first derivative of x/y) is bounded to a
  configurable maximum (default: 0.3 normalised units per second). When
  the raw trajectory exceeds this limit, the keyframe values are clamped
  and the subject may temporarily leave the output centre — this is the
  intended trade-off for smooth motion.
- **R6.6** Pan acceleration (second derivative of x/y) is bounded to a
  configurable maximum (default: 0.5 normalised units per second²) to
  prevent whip-pan artefacts. The acceleration bound is applied after
  the velocity bound via a two-pass clamp.
- **R6.7** After velocity/acceleration clamping, the keyframes are
  validated against the safe zone: the subject centre must lie within
  the action-safe rectangle (90 % of output dimensions) for ≥ 95 % of
  frames. If validation fails, the system widens the scale (zooming out)
  incrementally until the threshold is met or the maximum scale
  reduction is reached. Scale is never reduced below 1.0 — if the
  subject cannot fit within the safe zone at scale 1.0, the UI notes
  the limitation rather than introducing black bars.
- **R6.8** Generated keyframes must not overwrite existing user-authored
  keyframes on the same clip without explicit user confirmation. If the
  clip already has `x`, `y`, or `scale` keyframes, the UI warns and
  requires the user to confirm replacement.

## R7 — Preview and Review Flow

- **R7.1** Before applying keyframes to the timeline, the user sees a
  preview overlay on the programme monitor showing the proposed crop
  rectangle for the current playhead position. The overlay updates as
  the playhead moves.
- **R7.2** The preview overlay shows the target aspect ratio frame as a
  semi-transparent rectangle on the source frame, with the action-safe
  zone indicated as a dashed inner rectangle.
- **R7.3** The review flow has three actions: **Apply** (write keyframes
  to the clip), **Discard** (throw away the analysis result), and
  **Adjust** (open parameters for manual tuning of velocity/acceleration
  bounds before re-running generation).
- **R7.4** The preview overlay renders on the main thread using CSS/SVG
  over the existing preview surface. It does not add GPU passes, CPU
  pixel readbacks, or extra compositing submissions to the pipeline
  worker's hot path.
- **R7.5** When the user applies the reframe, the keyframes are written
  via a bulk track-replacement protocol (new `replace-keyframe-tracks`
  command or extension of `set-keyframes` that can overwrite full tracks
  at multiple timestamps). The action is a single undo entry — one undo
  removes all generated keyframes.

## R8 — Capability Gating

- **R8.1** A Smart Reframe capability row reports: face detection runtime
  availability (`supported` / `unsupported` / `unknown`), saliency
  availability (always `supported` — pure DSP), and analysis worker
  spawnability. Follows the Phase 26 `FeatureSupport` pattern.
- **R8.2** When face detection is `unsupported`, Smart Reframe operates in
  saliency-only mode with a visible notice: "Face detection unavailable;
  using visual saliency estimation." The feature remains fully
  functional.
- **R8.3** When the Smart Reframe worker cannot be spawned (e.g., Worker
  constructor fails), the feature is disabled with a clear explanation;
  the rest of the app is unaffected.
- **R8.4** Smart Reframe does not affect `CapabilityTierV2` derivation. It
  is an optional editing tool, not a tier-defining capability.

## R9 — Project Persistence

- **R9.1** Smart Reframe settings (target aspect ratio, velocity bound,
  acceleration bound, analysis frame rate) are persisted per-clip in the
  `ProjectDoc` as part of clip metadata. They do not bump the schema
  version independently — they ride the existing metadata extension
  pattern.
- **R9.2** Generated keyframes are standard Phase 15 `ClipKeyframes` and
  survive project save/load, autosave, and Phase 23 bundle round-trips
  without any Smart Reframe–specific serialisation.
- **R9.3** The analysis result (detection positions, tracker state) is
  transient and not persisted. Only the final keyframe output is stored.
  Re-running analysis with the same settings may produce slightly
  different trajectories but the keyframe output is deterministic for a
  given input fixture in test mode.

## R10 — Diagnostics

- **R10.1** Diagnostics report: face detection runtime state, saliency
  mode used for the last analysis, number of frames analysed, number of
  shot boundaries detected, number of keyframes generated, and the
  percentage of frames within the safe zone.
- **R10.2** Analysis errors (model load failure, worker crash, invalid
  source) are recorded in the diagnostics ring with the existing
  recent-errors pattern.

## R11 — Tests and Acceptance

- **R11.1** Unit tests (Vitest, Node, co-located) cover: One Euro filter
  (smooth output for stationary/moving inputs, jitter suppression);
  IoU tracker (association, coasting, reset); shot boundary histogram
  detector (known cuts trigger, gradual dissolves do not);
  keyframe generation (velocity/acceleration bounds, safe zone
  validation, scale calculation for each supported aspect ratio);
  and saliency estimator (skin-tone centroid on a synthetic frame).
  No large media fixtures; synthetic/programmatic inputs only.
- **R11.2** Mocked face detection: the detector interface is injected so
  tests supply canned bounding-box arrays. Tests exercise the full
  pipeline from detections → tracker → keyframes without loading a real
  model.
- **R11.3** Deterministic fixture test: a checked-in short clip
  (≤ 2 s, ≤ 500 KB, generated via `ffmpeg` from a colour-bar source
  with a known subject position) converts from 16:9 to 9:16 with the
  subject inside the action-safe zone for ≥ 95 % of frames. The
  expected keyframe values are asserted as a snapshot.
- **R11.4** Motion-bound assertion test: a synthetic trajectory with a
  sudden large displacement produces keyframes whose velocity and
  acceleration never exceed the configured bounds.
- **R11.5** `pnpm run check` stays green (format:check + lint +
  typecheck + test + build); test count grows.
