# Requirements: Phase 32b - Landmark-Driven Beauty

LocalCut adds an opt-in beauty effect driven by face detection and dense
landmark inference. The feature runs fully locally through the shared ORT model
platform, drives a worker-owned WGSL mesh-warp pass, and preserves the
accelerated preview/export invariants: no main-thread media loops, no
full-frame CPU readback on the accelerated path, bounded queues, and explicit
capability-tier degradation.

## R1 - ORT runtime, ONNX model assets, and capability gating

- **R1.1** Face detection and dense landmark inference run in the pipeline
  worker through the shared ORT runtime. The primary execution provider is
  ORT-WebGPU when the Phase 8/26 probe confirms support. ORT-WebNN is optional
  for detector/landmark models only after per-model support proof.
- **R1.2** ORT-WASM is allowed only as an explicit reduced/export-only path when
  inference tensors are small, bounded, and produced without full-frame CPU
  readback. It must never run as a hidden realtime preview fallback.
- **R1.3** The feature is gated by the Phase 8/26 capability probe. Accelerated
  preview requires WebGPU, cross-origin isolation, ORT runtime availability,
  digest-verified ONNX assets, and a successfully loaded landmark manifest.
  Missing requirements hide or disable the beauty controls with a reduced-tier
  explanation; the UI never leaves a spinner hanging on an unsupported device.
- **R1.4** The model manifest declares model id, version, total download size,
  topology version, landmark count, and multiple ONNX assets: face detector,
  face landmark model, and an optional blendshape model omitted in v1.
- **R1.5** Each ONNX asset declares `url`, `sizeBytes`, `checksum`, `license`,
  `source`, `provider`, `modelCard`, and input/output contracts with tensor
  names, shapes, data types, and semantic labels. The UI shows exact total
  download size and progress before the first fetch.
- **R1.6** Model URLs must use `/_model/hf`, `/_model/gh`, `/_model/gcs`, or
  same-origin static asset paths. Direct cross-origin model fetches are
  rejected by manifest validation.
- **R1.7** Model assets are fetched only after explicit user action, streamed
  through digest verification, and cached in OPFS by version and digest. The
  app must run the feature offline after the first verified download; corrupted
  cached assets are rejected and re-fetched only after user confirmation.
- **R1.8** No server infrastructure, accounts, telemetry, remote inference, or
  remote image/video processing is introduced. Network traffic is limited to
  explicit model downloads through the shared model proxy/cache rules, and all
  user media stays in the browser sandbox.

## R2 - Model candidates and output contracts

- **R2.1** The implementation evaluates ONNX FaceMesh/MediaPipe-derived
  artifacts, including FaceMesh ONNX detector/landmark candidates, but does not
  depend on a MediaPipe `.task` bundle at runtime.
- **R2.2** The browser must not parse `.task` files. Any conversion from
  upstream formats to ONNX is an offline/dev-time process whose output is the
  digest-pinned ONNX artifact declared in the manifest.
- **R2.3** Detector output decoder tests cover boxes, scores, thresholding,
  non-finite values, and empty/no-face output using mocked tensors.
- **R2.4** Landmark output decoder tests cover landmark count, coordinate
  normalization, confidence/presence outputs, topology version mismatch, and
  malformed tensor shapes using mocked tensors.
- **R2.5** Candidate selection records license compatibility and AGENTS.md
  library criteria in `design.md` before landing a model choice.

## R3 - Primary-face detection, landmarks, and temporal stability

- **R3.1** Detection targets one face in v1: the primary face is the candidate
  with the highest weighted score from face area, centrality, detection
  confidence, and temporal continuity with the previous primary face.
- **R3.2** Multi-face support is deliberately deferred. When multiple faces are
  visible, the UI states that the largest/most central face is edited; no
  secondary face receives partial or unstable deformation.
- **R3.3** Inference runs at a reduced cadence derived from project frame rate
  and device throughput, defaulting to no more than 10 landmark solves per
  second for 30 fps footage. Cadence can drop under load but must be reported
  in diagnostics.
- **R3.4** Frames between inference results use timestamp-based landmark
  interpolation, then a one-euro filter per landmark coordinate to suppress
  jitter without adding visible lag during head movement.
- **R3.5** Landmark confidence loss, scene cuts, or face handoff reset the
  filter and ramp the warp to identity over a short bounded window; the effect
  never snaps the face shape to stale landmarks.
- **R3.6** Acceptance: on the checked fixture footage, smoothed landmark
  variance for stable anchor points remains below the documented bound while
  preserving deliberate head motion; no visible landmark jitter is present in
  accelerated preview or export.

## R4 - Beauty parameters and keyframes

- **R4.1** The effect exposes four user parameters: `jawSlim`, `eyeEnlarge`,
  `noseWidth`, and `mouth`. Adding the effect chooses the `SUBTLE` preset for
  each parameter; no beauty change is applied unless the user explicitly adds
  or enables the effect.
- **R4.2** Each parameter is clamped to a conservative range that prevents
  identity alteration: jaw and eye deformation are symmetric and local, nose
  width changes stay within the nose-region control cage, and the mouth
  parameter only adjusts lip-contour proportion/spacing. Presets are named
  honestly and never imply automatic attractiveness scoring.
- **R4.3** All four parameters and the effect master strength are keyframable
  through the Phase 15 keyframe system. Preview and export sample the same
  keyframe values at the same timeline timestamp before uniform packing.
- **R4.4** Strength `0` is a bit-exact identity: the compositor either skips the
  mesh-warp pass or follows a shader path that returns the original sample
  without resampling, color modification, or metadata mutation.
- **R4.5** Settings round-trip through `ProjectDoc`, autosave, undo/redo, and
  Phase 23 project bundles. Bundle export/import preserves the effect params,
  keyframes, selected ONNX model id/version, and disabled/unloaded states, but
  never embeds model weights, face images, or raw landmarks.

## R5 - WGSL mesh-warp pass and accelerated pipeline integration

- **R5.1** Landmark geometry drives a WGSL mesh-warp pass in the worker-owned
  accelerated effect chain. The pass operates in clip-local coordinates before
  Phase 12 transform/composite, reuses the frame's current GPU resources, and
  keeps preview/export on the shared processed texture path.
- **R5.2** The accelerated path has no full-resolution CPU pixel round-trip.
  `VideoFrame` inputs flow through `importExternalTexture`, GPU ROI/preprocess,
  ORT detector/landmark inference where the chosen EP supports it, and output
  landmark/warp buffers consumed by WGSL.
- **R5.3** The pass remains inside the single WebGPU command submission per
  frame. It does not cache `importExternalTexture` across frames and does not
  duplicate the effect chain for preview vs export.
- **R5.4** Memory is bounded: the worker keeps only the current frame's compact
  inference tensors, a small landmark history ring, and fixed-size GPU buffers.
  It never buffers an entire media file, decoded clip, or unbounded landmark
  series when streaming frame access exists.
- **R5.5** Every `VideoFrame` or clone created for detection/preprocess is
  closed exactly once on success, skip, cancellation, export abort, and worker
  teardown paths.
- **R5.6** Acceptance: on the accelerated tier, 1080p preview remains realtime
  at the chosen detection cadence. Diagnostics record inference cadence,
  average/p95 inference time, average/p95 warp time, dropped inference frames,
  and active ORT EP.

## R6 - Geometry-aware skin mask integration

- **R6.1** Phase 32b upgrades the Phase 32a chroma skin mask, when present, with
  landmark-derived geometry: face oval inclusion, eye/lip exclusion zones, and
  a soft feathered boundary aligned to the tracked primary face.
- **R6.2** The geometry-aware mask remains optional and composable. If landmark
  inference is unavailable, Phase 32a falls back to its chroma-only mask with a
  visible reduced-quality label in the UI/Inspector preview rather than silently
  changing output. This label is strictly a UI indicator and must never be
  burned into the exported video track during final render/export.
- **R6.3** Mask generation shares the same smoothed/interpolated landmarks as
  the warp pass, so skin grading, beauty deformation, preview, and export agree
  frame-for-frame.

## R7 - UI, accessibility, and user-facing honesty

- **R7.1** The Inspector gains a Beauty section only when the active clip can
  support it. Controls use sliders/numeric inputs with reset buttons, keyframe
  diamonds matching Phase 15, and clear status text for model unloaded,
  downloading, accelerated, reduced/export-only, or unavailable states.
- **R7.2** Model download UI states the model provider, license, exact download
  size, offline-cache behavior, and that all processing is local. No copy
  implies cloud enhancement, identity scoring, or automatic beautification.
- **R7.3** Keyboard and screen-reader behavior follows the accessibility
  steering: native controls, visible focus, useful `aria-label`s for icon-only
  keyframe/reset buttons, and no modal prompt on startup.
- **R7.4** Diagnostics expose runtime status and performance without file names,
  media contents, face images, or raw landmark coordinates.

## R8 - Tests, fixtures, and validation

- **R8.1** Unit tests use mocked streams, handles, `VideoFrame`s, GPU buffers,
  ORT sessions, and small tensor fixtures. They must not require large video
  fixtures or network model downloads in normal CI.
- **R8.2** Unit tests cover multi-asset ONNX manifest validation, OPFS cache
  behavior, model download progress accounting, detector/landmark output
  contracts, primary-face selection, cadence scheduling, timestamp
  interpolation, one-euro filtering, confidence-loss identity ramp, parameter
  clamping, keyframe sampling, ProjectDoc/bundle round-trip, and protocol type
  guards.
- **R8.3** A no-startup-load test proves ORT runtime chunks and model assets are
  loaded only after explicit user action.
- **R8.4** Identity tests verify strength `0` is bit-exact by comparing the pass
  input/output in a mocked GPU path and by asserting the compositor skips
  resampling when all effective strengths are zero.
- **R8.5** Playwright is limited to UI-critical flows: load/unload model status,
  capability-gated controls, keyframe control wiring, and explicit reduced-tier
  messaging. Shader math and model runtime behavior stay in Vitest/manual GPU
  validation.
- **R8.6** Manual validation includes the fixture-footage jitter check, 1080p
  realtime accelerated preview check, export parity check, identity export at
  zero strength, and offline-after-cache check.
