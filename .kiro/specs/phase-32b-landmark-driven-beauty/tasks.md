# Tasks: Phase 32b - Landmark-Driven Beauty

## T1 - ORT runtime and ONNX model manifest (R1, R2)

- [ ] **T1.1** Reuse or create the shared ORT model platform in the pipeline
  worker. Runtime chunks must be lazy-loaded only after explicit user action
  and must stay out of startup bundles verified by no-startup-load tests.
- [ ] **T1.2** Create `src/engine/beauty/beauty-runtime.ts`: ORT session wrapper
  for detector + landmark ONNX models with EP selection `webgpu` -> optional
  `webnn` after per-model proof -> explicit reduced/export-only `wasm`.
  Include deterministic disposal and explicit compile/runtime errors.
- [ ] **T1.3** Extend the Phase 8/26 probe with Beauty availability: WebGPU,
  cross-origin isolation, ORT runtime chunks, model-cache support, selected EP,
  reduced/export-only status, and explicit unavailable reasons.
- [ ] **T1.4** Create `src/engine/beauty/model-manifest.ts`: validate manifest
  id, version, total size, landmark topology, and multiple ONNX assets
  (`detector`, `landmarks`, optional `blendshape`) with per-asset provenance,
  license, digest, and input/output contracts.
- [ ] **T1.5** Add `public/models/beauty/manifest.json` for the selected ONNX
  detector/landmark candidate. Record exact bytes, license strings, model-card
  URLs, provider/source URLs, tensor contracts, and real SHA-256 digests before
  landing. Do not depend on `.task` bundles or TFLite files.
- [ ] **T1.6** Enforce model URL policy: allow only `/_model/hf`, `/_model/gh`,
  `/_model/gcs`, or same-origin static asset paths; reject direct cross-origin
  URLs.
- [ ] **T1.7** Reuse/extend the digest-verified OPFS asset cache so model
  downloads stream into cache without buffering whole assets in memory;
  progress reports `bytesLoaded`/`bytesTotal` and cache-only reloads.
- [ ] **T1.8** Update Vite/PWA cache rules so Beauty manifests and ORT runtime
  chunks are digest/version pinned, while ONNX weights remain on-demand and
  OPFS-cached.
- [ ] **T1.9** Add tests for multi-asset ONNX manifest validation, proxy URL
  rejection, license/provenance presence, total-size accounting, digest
  mismatch, OPFS cache hit/miss, progress reporting, no-startup-load, and EP
  fallback/degradation.

## T2 - Model candidate evaluation and output decoders (R2)

- [ ] **T2.1** Evaluate ONNX FaceMesh/MediaPipe-derived detector/landmark
  candidates. Record provenance, license compatibility, tensor contracts,
  topology, download size, and ORT-WebGPU support in `design.md`.
- [ ] **T2.2** Prove ORT-WebNN separately per candidate before enabling it in
  capability tiers. If proof is missing, WebNN remains unavailable for Beauty
  even when the browser exposes `navigator.ml`.
- [ ] **T2.3** Implement detector output decoding with bounded tensors:
  boxes/scores/keypoints, confidence thresholds, non-finite handling, and
  no-face output.
- [ ] **T2.4** Implement landmark output decoding with topology checks:
  landmark count, coordinate normalization, confidence/presence outputs, and
  malformed tensor rejection.
- [ ] **T2.5** Unit-test detector and landmark output contracts with small
  mocked tensor fixtures. Do not download real models in CI.

## T3 - Frame preprocess, detection, and primary face selection (R2, R3, R5)

- [ ] **T3.1** Create `src/engine/beauty/preprocess.ts`: bounded ROI/tensor
  prep for detector and landmark input shapes, using GPU preprocess on the
  accelerated path and compact tensors only on reduced paths.
- [ ] **T3.2** Ensure every `VideoFrame` or clone used for detection/preprocess
  is closed exactly once across success, skip, cancellation, export abort, and
  worker teardown.
- [ ] **T3.3** Create `src/engine/beauty/primary-face.ts`: area/centrality/
  confidence/continuity scoring and handoff rules for one primary face.
- [ ] **T3.4** Add scene-cut, confidence-loss, and no-face handling that resets
  tracking state and ramps the effect to identity instead of reusing stale
  landmarks.
- [ ] **T3.5** Unit-test primary-face scoring, multi-face handoff, no-face
  identity ramp, and close-exactly-once frame lifetime with mocked frames.

## T4 - Cadence, interpolation, and smoothing (R3)

- [ ] **T4.1** Create `src/engine/beauty/cadence.ts`: derive solve interval from
  project fps, measured inference p95, and realtime budget; cap default 30 fps
  cadence at 10 Hz.
- [ ] **T4.2** Create `src/engine/beauty/landmark-track.ts`: timestamped sample
  ring buffer with capacity 4, VFR-safe interpolation, and reset on handoff or
  confidence loss.
- [ ] **T4.3** Create `src/engine/beauty/one-euro.ts`: one-euro filter per
  landmark coordinate with configurable `minCutoff`, `beta`, and `dCutoff`.
  Implement using contiguous `Float32Array` buffers updated in a single loop to
  avoid per-coordinate class instances and per-frame GC pressure.
- [ ] **T4.4** Add diagnostics counters for cadence Hz, solved/skipped frames,
  inference average/p95, primary-face handoffs, and smoothing resets.
- [ ] **T4.5** Unit-test cadence adaptation, timestamp interpolation across VFR
  gaps, filter jitter reduction, fast-motion lag bounds, and reset behavior.

## T5 - WGSL mesh-warp pass (R4, R5)

- [ ] **T5.1** Create `src/engine/beauty/beauty-params.ts`: defaults,
  `SUBTLE` preset, clamp ranges, effective-strength calculation, and uniform/
  storage packing.
- [ ] **T5.2** Add `src/engine/shaders/beauty-warp.wgsl` and f16 variant if
  needed: inverse warp for jaw, eyes, nose, and mouth with conservative falloff
  regions and clip-local normalized coordinates.
- [ ] **T5.3** Register the Beauty pass in the existing effect chain so it runs
  in the worker, before Phase 12 transform/composite, inside the same frame
  command encoder/submission.
- [ ] **T5.4** Implement the bit-exact identity path: when effective strength is
  zero, skip the pass and reuse the incoming texture without resampling.
- [ ] **T5.5** Add GPU-buffer lifetime handling for landmark/topology buffers
  and fixed-size histories; no unbounded per-frame allocations in playback.
- [ ] **T5.6** Unit-test parameter clamping, uniform packing, pass-skip identity,
  command-submission count, and topology buffer bounds with mocked WebGPU.

## T6 - ProjectDoc, keyframes, protocol, and bundles (R4)

- [ ] **T6.1** Extend clip effect types with `BeautyEffectParams`:
  `enabled`, `modelId`, `modelVersion`, `preset`, `masterStrength`,
  `jawSlim`, `eyeEnlarge`, `noseWidth`, and `mouth`.
- [ ] **T6.2** Wire Phase 15 keyframe sampling for `beauty.masterStrength`,
  `beauty.jawSlim`, `beauty.eyeEnlarge`, `beauty.noseWidth`, and
  `beauty.mouth`; preview and export must sample the same value at the same
  timestamp.
- [ ] **T6.3** Add structured-clone-safe protocol messages for model load
  status, runtime status, setting Beauty params, and keyframe edits. Do not
  send media objects, GPU handles, landmarks, or face imagery to the UI.
- [ ] **T6.4** Update ProjectDoc schema migration, autosave, undo/redo, and
  Phase 23 bundle import/export so Beauty params/keyframes/model id/version
  round-trip and model weights/raw landmarks/face images are never embedded.
- [ ] **T6.5** Unit-test ProjectDoc migration, undo/redo snapshots, bundle
  round-trip, model-weight exclusion, raw-landmark exclusion, and protocol type
  guards.

## T7 - Phase 32a geometry-aware skin mask (R6)

- [ ] **T7.1** Add `src/engine/beauty/geometry-mask.ts`: derive face oval,
  eye/lip exclusion regions, and feathered mask geometry from smoothed
  landmarks.
- [ ] **T7.2** Integrate geometry mask data with the Phase 32a chroma skin mask
  path when landmarks are available; preserve chroma-only behavior with a
  reduced-quality label in the UI/Inspector when they are not. Ensure this label
  is never burned into exported video.
- [ ] **T7.3** Ensure the mask uses the same interpolated landmarks and
  timestamp as the Beauty warp pass so preview/export agree.
- [ ] **T7.4** Unit-test mask-region construction, exclusion zones, feather
  bounds, chroma-only fallback, and timestamp parity with the warp path.

## T8 - Inspector UI, capability messaging, and docs (R7)

- [ ] **T8.1** Add an Inspector Beauty section with sliders/numeric inputs for
  master strength, jaw slim, eye enlarge, nose width, and mouth; include reset
  buttons and Phase 15 keyframe diamonds.
- [ ] **T8.2** Add explicit model UI states: unavailable, load required,
  downloading, verifying, compiling, ready, cached/offline, failed, and
  reduced/export-only. Show provider, license, exact download size, and
  local-only copy before fetch.
- [ ] **T8.3** Label primary-face v1 behavior when multiple faces are detected:
  largest/most central face only; no partial secondary-face deformation.
- [ ] **T8.4** Follow UI/accessibility steering: native controls, keyboard
  reachability, `aria-label`s for icon-only reset/keyframe controls,
  persistent visible status text, and no startup modal.
- [ ] **T8.5** Update `docs/USER-GUIDE.md` and in-app guide content with local
  ONNX model download/offline-cache behavior, capability requirements, subtle
  preset, primary-face limitation, and non-goals.

## T9 - Tests, Playwright coverage, and quality gate (R8)

- [ ] **T9.1** Add Vitest coverage for model manifest/cache, ORT runtime
  fallback, no-startup-load, preprocess bounds, frame lifetime, primary-face
  selection, cadence, interpolation, one-euro smoothing, identity ramp,
  parameter clamping, keyframe sampling, ProjectDoc/bundle round-trip, and
  protocol guards.
- [ ] **T9.2** Add mocked GPU tests for zero-strength identity, pass skip,
  command-submission count, fixed buffer sizes, and no `importExternalTexture`
  caching across frames.
- [ ] **T9.3** Add Playwright coverage only for UI-critical flows: capability
  gating, Load model progress/status, keyframe controls, reduced-tier message,
  and model-failure recovery. Do not use Playwright for shader math or model
  correctness.
- [ ] **T9.4** Keep normal CI free of large video/model fixtures and network
  downloads. Use synthetic landmarks, mocked OPFS streams/handles, and mocked
  ORT sessions.

## T10 - Manual validation (R3, R5, R8)

- [ ] **T10.1** Manual GPU smoke: load model from a clean profile, verify exact
  size/progress/digest status, apply `SUBTLE`, and confirm accelerated 1080p
  preview remains realtime at the chosen cadence.
- [ ] **T10.2** Manual offline smoke: reload after first download with network
  unavailable; model loads from OPFS and the Beauty controls remain usable.
- [ ] **T10.3** Manual fixture-footage check: smoothed landmark variance stays
  under the documented bound and no visible jitter appears in preview/export.
- [ ] **T10.4** Manual identity check: export with master strength `0` and
  compare against export without the effect; output must be bit-exact.
- [ ] **T10.5** Manual bundle check: Phase 23 export/import preserves Beauty
  params/keyframes/model id, and the bundle contains no model weight bytes,
  face images, or raw landmark arrays.
- [ ] **T10.6** Run `vp run check`; test count must grow for the non-trivial
  engine, protocol, persistence, and UI logic added by this phase.
