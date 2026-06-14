# Tasks: Phase 33 — Smart Reframe

> Status: **Implemented (saliency-only v1)** — automatic crop-path generation
> producing editable Phase 15 transform keyframes, reviewed via a preview
> overlay and applied as a single undo step.

## Implementation status

**Done:** protocol types + capability probe (T1); One Euro filter (T2); shot
boundary detector (T3); saliency estimator (T4); subject tracker (T5); face
detector interface, LiteRT.js runtime wrapper, manifest validation, and output
decoder (T6.1/T6.2/T6.3/T6.4 — the model catalogue entry is deferred, below);
keyframe generator with per-shot velocity/acceleration bounds, hold keyframes at
cuts, and safe-zone compliance (T7); worker orchestration with in-point-aware
sampling, clip-local timestamps, and cancellation (T8); the Smart Reframe panel
and review/apply flow (T9); the crop-preview overlay (T10); apply via the new
`replace-keyframe-tracks` single-undo command and source-File resolution via
`get-source-file` (R7.5 / file plumbing); the capability/diagnostics row (T12.1);
unit tests including the new `face-detector.test.ts` and `replaceClipKeyframeTracks`
coverage (T13); and docs in both `docs/SMART-REFRAME.md` and the in-app guide
(T16.1/T16.1a).

**Deferred / not done:**

- **T15 (face-detection model bundling)** — face detection runs through the
  shared LiteRT.js runtime (already a project dependency; no ONNX), but no
  `.tflite` model catalogue entry is bundled, so the model never downloads. The
  runtime wrapper, digest-verified asset loading, and the decoder are
  unit-tested; the shipped build runs saliency-only (R2.6 / R8.2) and the
  capability probe reports face detection `unsupported`.
- **T14 (deterministic media fixture)** — the fixture-based end-to-end test and
  the keyframe snapshot are pending (no media fixture is checked in). The motion
  bounds, hold keyframes, and compliance metric are covered by synthetic
  trajectory tests instead (T7.5 / T13.6).
- **T16.2–T16.4 (manual browser smoke tests)** — require a browser and are not
  part of the automated quality gate.

## T1 — Protocol types and capability probe (R0, R1, R8)

- [ ] **T1.1** Extend `src/protocol.ts` with `ReframeCommand` union
  (`reframe-start` / `reframe-cancel` / `reframe-dispose`),
  `ReframeWorkerMessage` union (`reframe-progress` / `reframe-result` /
  `reframe-error` / `reframe-cancelled`), `ReframeStartCommand` fields,
  and `ReframeAnalysisStats`. All types structured-clone-safe.
- [ ] **T1.2** Extend `src/engine/capability-probe-v2.ts` and
  `CapabilityProbeResult` with `SmartReframeProbeResult`: `faceDetection`
  (LiteRT.js model availability), `saliency` (always `supported`),
  `analysisWorker` (Worker constructor). Follow the existing
  `FeatureSupport` pattern.
- [ ] **T1.3** Add a Smart Reframe row to the capability/diagnostics panel
  showing the probe results per R8.1. Face detection `unsupported` shows
  a "saliency-only mode" notice (R8.2). Worker spawn failure disables
  the feature with explanation (R8.3).

## T2 — One Euro filter (R4)

- [ ] **T2.1** `src/engine/reframe/one-euro-filter.ts`: implement the One
  Euro filter (Casiez et al., 2012) as a pure TypeScript class (~60
  lines). Two instances (x, y) or a 2D variant. Configurable `minCutoff`,
  `beta`, `dcutoff`. No external dependency.
- [ ] **T2.2** Unit tests: stationary input produces flat output; ramp
  input tracks within 2-frame lag at 2 fps; high-frequency jitter is
  suppressed; parameters affect responsiveness as documented.

## T3 — Shot boundary detector (R5)

- [ ] **T3.1** `src/engine/reframe/shot-boundary-detector.ts`:
  `computeHistogram(imageData)` returns a 512-bin normalised RGB
  histogram (8 bins/channel). `isShotBoundary(prev, curr)` computes
  chi-squared distance and compares against threshold (default 0.5).
- [ ] **T3.2** Unit tests with synthetic `ImageData` buffers: two identical
  histograms → distance 0; completely different histograms → distance
  above threshold; a known gradual dissolve (interpolated histograms)
  stays below threshold. Deterministic on fixtures.

## T4 — Saliency estimator (R3)

- [ ] **T4.1** `src/engine/reframe/saliency-estimator.ts`: implement
  `estimate(imageData) → SaliencyResult`. Skin-tone mask in YCbCr
  (Cb ∈ [77,127], Cr ∈ [133,173]), Sobel edge magnitude on luminance,
  local contrast (stdev per grid cell). Weighted combination (skin 0.5,
  edge 0.3, contrast 0.2). Returns the highest-scoring grid cell's
  centre as the centroid.
- [ ] **T4.2** Unit tests: a synthetic frame with a skin-coloured blob in
  one quadrant returns a centroid within that quadrant; a uniform frame
  returns a low-confidence result; edge-heavy frame biases the centroid
  toward the edge region.

## T5 — Subject tracker (R4)

- [ ] **T5.1** `src/engine/reframe/subject-tracker.ts`: implement
  `SubjectTracker` with IoU-based association (threshold 0.3), coast
  window (1 s), face-over-saliency preference, and One Euro smoothing
  of the tracked centroid. `update()` accepts a `TrackerFrame` with
  source time for coast tracking and trajectory timestamps.
- [ ] **T5.2** `reset()` clears tracker state (called at shot boundaries,
  R4.5). `trajectory()` returns the full smoothed path after all frames
  are fed.
- [ ] **T5.3** Unit tests: detections with IoU above threshold associate
  correctly; detections with IoU below threshold trigger coasting then
  reset; face detection preferred over saliency when both present;
  `reset()` clears state; stationary subject produces flat trajectory;
  trajectory length matches input frame count.

## T6 — Face detector (R2)

- [ ] **T6.1** `src/engine/reframe/face-detector.ts`: define
  `FaceDetector` interface (with `async detect()`) and
  `FaceDetectorFactory` for test injection. `FaceDetection` type with
  normalised coordinates and confidence.
- [ ] **T6.2** LiteRT.js implementation (`createLiteRtFaceDetector`):
  load the model bytes via the shared digest-verified asset cache
  (`../asr/asset-cache`), compile the `.tflite` with `@litertjs/core`
  through the `../asr/litert-loader` boundary (WebNN → WebGPU → WASM
  fallback), run inference on the downscaled `ImageData`, and decode the
  output to normalised source coordinates.
- [ ] **T6.3** Model manifest: `src/engine/reframe/model-manifest.ts`
  with `ReframeModelManifest` interface (TFLite model asset + `sha256-`
  digest) and `validateManifest()` pure function. Ship a manifest JSON for
  the BlazeFace TFLite model as a static asset under `public/models/`.
- [ ] **T6.4** Unit tests: `validateManifest()` accepts a valid manifest,
  rejects missing fields and a bad checksum/format; the LiteRT detector's
  compile/fallback is tested via a mocked `loadLiteRtModule`, and the
  output decoder via synthetic tensors (no real model in CI).

## T7 — Keyframe generator (R6)

- [ ] **T7.1** `src/engine/reframe/keyframe-generator.ts`:
  `generateReframeKeyframes(trajectory, config)` computes scale
  (R6.3: default 1.0, may increase for tighter framing, never below
  1.0), x/y position (R6.2: `-subjectC * scale`), samples at regular
  intervals (default 0.5 s, R6.4 — clip-local timestamps), and inserts
  hold keyframes at `T_cut - ε` before shot boundary times (R5.3).
- [ ] **T7.2** Implement velocity bound pass (R6.5): clamp `|Δx/Δt|` and
  `|Δy/Δt|` to `velocityBound` (default 0.3 norm/s).
- [ ] **T7.3** Implement acceleration bound pass (R6.6): clamp `|Δv/Δt|`
  to `accelerationBound` (default 0.5 norm/s²). Two-pass iterative
  convergence (typically 2–3 iterations).
- [ ] **T7.4** Safe zone validation (R6.7): check subject centre is
  within action-safe rectangle (±0.45 of output) for ≥ 95 % of frames.
  If below threshold, reduce scale by 1 % and recompute, up to 20 %
  max reduction. Scale never drops below 1.0 — if the subject cannot
  fit at scale 1.0, flag the limitation instead of introducing bars.
- [ ] **T7.5** Unit tests: scale calculation for each supported aspect
  ratio pair (16:9→9:16, 16:9→1:1, 16:9→4:5, 9:16→16:9); x/y position
  for centred and off-centre subjects; velocity clamping on a sudden
  displacement trajectory; acceleration clamping on an oscillating
  trajectory; safe zone validation triggers scale widening; hold
  keyframes at boundary times produce `easing: 'hold'` entries.

## T8 — Smart Reframe worker orchestration (R0, R4)

- [ ] **T8.1** `src/engine/reframe-analyzer.ts`: worker entry point.
  Receives `ReframeStartCommand`, opens the source file via the
  transferable handle/path, creates a Mediabunny demux + VideoDecoder
  instance, and runs the analysis loop at the configured `analysisFps`.
- [ ] **T8.2** Analysis loop: for each decoded frame, apply source
  rotation metadata to orient the analysis buffer correctly (Phase 18
  rotation), then run shot boundary detection → face detection →
  (fallback) saliency → tracker update. Post `reframe-progress`
  messages at a throttled rate (≤ 10 Hz).
- [ ] **T8.3** After all frames: run `generateReframeKeyframes()` on the
  accumulated trajectory. Post `reframe-result` with the keyframes and
  stats. Close all `VideoFrame`s exactly once.
- [ ] **T8.4** Cancellation: `reframe-cancel` aborts the decode loop,
  closes in-flight frames, posts `reframe-cancelled`. `reframe-dispose`
  terminates the worker.
- [ ] **T8.5** Error handling: checksum/size mismatch → hard
  user-visible error (R2.2 — never silent fallback); model load failure
  (runtime unavailable) → saliency-only mode with notice (R2.6); decode
  error → `reframe-error` with reason; worker crash → surfaced to UI
  via `reframe-error`. Never crash the shell.
- [ ] **T8.6** Lazy worker spawn: the Smart Reframe worker is loaded via
  `new Worker(new URL('./reframe-analyzer.ts', import.meta.url),
  { type: 'module' })` only when the user triggers analysis (R0.3).
  The UI module does not statically import the worker code.

## T9 — UI: Smart Reframe panel (R7, R8)

- [ ] **T9.1** `src/ui/SmartReframePanel.tsx`: target aspect ratio
  dropdown (9:16, 1:1, 4:5, 16:9, 4:3 per R1.1). Disabled when no
  clip is selected on the timeline.
- [ ] **T9.2** "Analyse" button. Disabled with reason when: no clip
  selected, worker unavailable (R8.3), or analysis already in progress.
  Starts analysis by posting `reframe-start` to the worker.
- [ ] **T9.3** Progress bar during analysis (fraction from
  `reframe-progress`). Cancel button posts `reframe-cancel`.
- [ ] **T9.4** Result display: safe zone compliance %, mode indicator
  (face / saliency / mixed), shot boundaries detected, keyframes
  generated. Shows saliency-only notice when face detection unavailable
  (R8.2).
- [ ] **T9.5** Review actions: **Apply** (sends `set-keyframes` to
  pipeline worker via existing Phase 15 protocol, single undo entry),
  **Discard** (clears result), **Adjust** (expands velocity/acceleration
  sliders + re-analyse button).
- [ ] **T9.6** Existing-keyframe warning (R6.8): when the target clip
  already has `x`, `y`, or `scale` keyframes, show a confirmation
  dialog before applying.
- [ ] **T9.7** UI-standards + accessibility pass: keyboard reachable,
  ARIA labels on all controls, dark professional aesthetic per steering,
  `onCleanup` for worker message subscription and overlay.

## T10 — UI: Reframe overlay (R7)

- [ ] **T10.1** `src/ui/ReframeOverlay.tsx`: CSS/SVG overlay on the
  programme monitor. Shows a semi-transparent rectangle for the target
  aspect ratio crop at the current playhead position, using the
  generated keyframes sampled via `sampleKeyframes()` from
  `src/ui/keyframes.ts`.
- [ ] **T10.2** Dashed inner rectangle for the action-safe zone (90 %
  of output). Overlay is visible only when a reframe result is in
  review (between analysis and apply/discard).
- [ ] **T10.3** Overlay updates reactively as the playhead moves (bound
  to the SAB clock read). No GPU passes, no Canvas2D readback — pure
  CSS positioning (R7.4).
- [ ] **T10.4** Overlay removed on apply/discard; `onCleanup` for the
  playhead subscription.

## T11 — Project persistence (R9)

- [ ] **T11.1** Extend clip metadata in the project schema to carry
  optional Smart Reframe settings (`targetAspect`, `velocityBound`,
  `accelerationBound`). These are informational — the keyframes
  themselves are the authoritative output.
- [ ] **T11.2** Generated keyframes persist as standard Phase 15
  `ClipKeyframes` in the project document. No Smart Reframe–specific
  serialisation code — they flow through the existing keyframe
  save/load path.
- [ ] **T11.3** Test: save a project with reframed keyframes, reload,
  assert keyframes are identical. Phase 23 bundle round-trip also
  preserves keyframes.

## T12 — Diagnostics (R10)

- [ ] **T12.1** Smart Reframe findings in the Phase 25/26 diagnostics
  snapshot: face detection runtime state, saliency mode used, frames
  analysed, shot boundaries, keyframes generated, safe zone compliance.
  Follow the existing `finding()` pattern.
- [ ] **T12.2** Analysis errors recorded in the diagnostics ring
  (recent-errors store, redaction rules applied).

## T13 — Unit tests (R11)

- [ ] **T13.1** `one-euro-filter.test.ts`: stationary, ramp, jitter, and
  parameter-sensitivity cases (T2.2).
- [ ] **T13.2** `shot-boundary-detector.test.ts`: identical histograms,
  different histograms, gradual dissolve (T3.2).
- [ ] **T13.3** `saliency-estimator.test.ts`: skin blob centroid, uniform
  frame, edge-heavy frame (T4.2).
- [ ] **T13.4** `subject-tracker.test.ts`: IoU association, coasting,
  face-over-saliency, reset, stationary trajectory (T5.3).
- [ ] **T13.5** `face-detector.test.ts`: manifest validation, injected
  factory with canned detections (T6.4).
- [ ] **T13.6** `keyframe-generator.test.ts`: scale/position for each
  aspect ratio, velocity clamping, acceleration clamping, safe zone
  widening, hold keyframes (T7.5).
- [ ] **T13.7** All tests Node-environment, co-located, no large media
  fixtures. Synthetic `ImageData` buffers and programmatic trajectories
  only. Test count grows.

## T14 — Deterministic fixture test (R11)

- [ ] **T14.1** Generate a short test fixture (≤ 2 s, ≤ 500 KB) via
  `ffmpeg`: colour-bar source with a known skin-coloured rectangle at a
  fixed position. Checked into `src/engine/reframe/__fixtures__/`.
- [ ] **T14.2** Fixture test: run the full pipeline (decode → detect →
  track → generate) on the fixture with 16:9 → 9:16 target. Assert
  the subject is inside the action-safe zone for ≥ 95 % of frames
  (R11.3). Assert keyframe snapshot values match expected output within
  tolerance.
- [ ] **T14.3** Motion-bound assertion: a synthetic trajectory with a
  sudden 0.8-unit displacement at T=1s produces keyframes whose
  velocity and acceleration never exceed the configured bounds (R11.4).

## T15 — Face-model integration

- [x] **T15.1** Reuse LiteRT.js (`@litertjs/core`) — already a project
  dependency since the Phase 28/29 migrations off ONNX. No new runtime
  dependency is added; the face detector loads via `../asr/litert-loader`
  and the WASM served from `public/litert/`.
- [ ] **T15.2** Add the BlazeFace `.tflite` model as a catalogue/manifest
  entry under `public/models/reframe/` (digest-pinned, `sha256-`),
  downloaded on demand from a trusted host and OPFS-cached — never
  precached. Model must be ≤ 300 KB quantised. The output must conform to
  the documented `decodeFaceDetections` contract (`[N, ≥5]`:
  `[score, cx, cy, w, h, …]`).
- [ ] **T15.3** PWA service worker must not precache model weights at
  install; may cache after first successful load (same pattern as Phase
  28 RNNoise weights).

## T16 — Docs + verification (R11)

- [ ] **T16.1** `docs/SMART-REFRAME.md`: feature overview, supported
  aspect ratios, how face detection and saliency work, the review/apply
  flow, velocity/acceleration bounds, known limitations (single subject,
  no live reframe). Link from `docs/USER-GUIDE.md`.
- [ ] **T16.1a** Update the bundled in-app User Guide content under
  `src/features/docs/content/` with Smart Reframe guidance so `/docs`
  in the app covers the feature.
- [ ] **T16.2** Manual smoke: import a 16:9 talking-head clip, reframe
  to 9:16, verify the face stays centred in the preview overlay, apply,
  play back, edit a keyframe by hand, export, verify the reframed
  output plays correctly.
- [ ] **T16.3** Manual smoke: import a 16:9 B-roll clip with no faces,
  verify saliency mode activates with the notice, verify a reasonable
  crop path is generated.
- [ ] **T16.4** Manual smoke: verify undo removes all generated keyframes
  in one step; verify project save/load preserves reframed keyframes.
- [ ] **T16.5** `pnpm run check` green (format:check + lint + typecheck
  + test + build); test count grows.
