# Requirements: Phase 31 — Portrait Video Matting

> Supersedes the earlier Phase 31 requirements. Normative model (as deployed):
> **MediaPipe Selfie Segmentation (Apache-2.0)** — the best hosted, reliable `.tflite`;
> MODNet (Apache-2.0) is the aspirational true-matting upgrade but has no hostable
> `.tflite` weights; RVM rejected (GPL-3.0). The model is permissive and pluggable.

## R1 — Clip Matte Model

- **R1.1** Any video clip may carry an optional `matte` field with `enabled`,
  `mode` (`'remove' | 'replace' | 'blur'`), `modelKey` (model pin: id + version),
  `strength` (0–1, default 1.0), and `blurRadius` (blur mode only); absent means no
  matting (backward compatible).
- **R1.2** The `matte` field serializes into the project document with a
  `schemaVersion` bump. The **model pin survives the bundle round-trip** (P23): opening
  a bundle where the deployed model differs from the pin surfaces a mismatch warning and
  does not silently switch models. Model weights are never part of the bundle.
- **R1.3** Toggling `enabled`, changing `mode`, `strength`, or `blurRadius` are
  undoable timeline mutations via `commitTimelineMutation`.

## R2 — Licensing

- **R2.1** Every model candidate's license is recorded in design.md with an explicit
  verdict. GPL-family models (including RVM) must not be shipped, defaulted to, or
  recommended in UI/docs, including as runtime-downloaded weights.
- **R2.2** Shipped/recommended models and runtimes are permissively licensed
  (Apache-2.0/MIT/BSD): MODNet (`.tflite`), MediaPipe selfie segmenter, LiteRT.js.

## R3 — Zero-copy realtime inference

- **R3.1** The inference pipeline is GPU-resident end to end:
  `VideoFrame → importExternalTexture → preprocess WGSL → LiteRT WebGPU model with GPU-buffer tensor IO
  binding → alpha GPU buffer → alpha texture → compositor`. No `getImageData`,
  `createImageBitmap`-based preprocessing, CPU tensor staging, or pixel `postMessage`
  hops anywhere in the accelerated path.
- **R3.2** The matte session runs in the **pipeline worker on the compositor's
  `GPUDevice`** via `setWebGpuDevice`. If device sharing is impossible on the shipped runtime, the
  WebGPU matte path is disabled (fallback per R7) — a CPU readback bridge is not an
  acceptable substitute.
- **R3.3** Inference is per-frame at playback/export time. The alpha LRU cache
  (byte-budgeted, `.destroy()` on eviction) is a reuse cache only; correctness never
  depends on a frame being cached.
- **R3.4** Matte-related passes (preprocess excepted where LiteRT requires its own
  submission) ride the existing single per-frame compositor submission; the matting
  feature adds no extra `queue.submit` to the effect chain.

## R4 — Recurrent state policy

- **R4.1** All temporal state (model hidden state if the active model has it; the EMA
  smoothing history texture otherwise) is owned by the per-clip matte session in the
  pipeline worker.
- **R4.2** State resets on: seek or source-time discontinuity (> ~1.5 frame intervals),
  clip boundary, enable toggle, and model swap. State is never serialized or shared
  across clips.
- **R4.3** Temporal stability: on a static-camera fixture, mean per-pixel |Δalpha|
  between consecutive frames stays under a fixed bound (no flicker). Enforced by an
  automated fixture test.

## R5 — Resolution policy

- **R5.1** Preview inference consumes the Phase 19 proxy/adaptive-resolution decode
  feed; alpha is applied at compositor resolution via bilinear sampling.
- **R5.2** Export uses model-resolution alpha refined by a **guided-upsample WGSL pass**
  (joint bilateral, full-resolution luma guide). Full-resolution inference is out of
  scope.

## R6 — Modes

- **R6.1** **remove**: layer alpha multiplied by matte × strength; background becomes
  transparency through normal Phase 12 compositing.
- **R6.2** **replace**: remove + the UI places/links any chosen timeline source (video,
  still, title) as the layer directly beneath the matted clip; the compositor contract
  is unchanged.
- **R6.3** **blur**: mask-driven separable blur weighted by inverse matte; subject stays
  sharp; `blurRadius` user-controlled.

## R7 — Probe + capability

- **R7.1** A cheap probe (no model load) determines: WebGPU EP + shared device →
  full path; otherwise MediaPipe WASM fallback → labeled reduced quality
  ("segmentation, not matting"); neither → controls disabled with explanation.
- **R7.2** Probe results inform the capability panel and never affect
  `CapabilityTierV2`.
- **R7.3** Weights load lazily on explicit user action, same-origin, manifest-validated,
  SHA-256-verified (Phase 28 conventions). No cloud fallback of any kind.

## R8 — Determinism

- **R8.1** In test mode (`matteTestMode`), repeated runs over the same fixture produce
  byte-identical alpha output (fixed EMA seed, pinned parameters, no adaptive
  switching). Enforced by an automated hash-comparison test.

## R9 — Chroma key (sibling effect)

- **R9.1** A separate `chroma-key.wgsl` (+ `.f16`) effect computes alpha from chroma
  distance to a user-picked key color (key color, tolerance, softness). No ML, no model,
  no session; same compositor stage as matte-apply; spec'd here only because no
  chroma-key effect exists yet.

## R10 — UI

- **R10.1** Inspector "Portrait Matte" section on video clips: enable toggle, mode
  selector (remove/replace/blur), strength slider, blur radius (blur mode), background
  picker (replace mode), status indicator.
- **R10.2** Matted clips show a timeline badge; the capability panel shows a matte row
  with backend and model state.
- **R10.3** Honest labeling: fallback path is visibly marked reduced quality;
  unavailable states explain why.

## R11 — Acceptance

- **R11.1** Realtime preview at proxy resolution on the accelerated tier with matting
  enabled (measured against the preview-fps budget).
- **R11.2** Temporal stability fixture test green (R4.3).
- **R11.3** Determinism test green (R8.1).
- **R11.4** Matte settings + model pin survive bundle round-trip (R1.2).
- **R11.5** Every alpha texture/buffer destroyed exactly once; sessions released on
  clip delete, disable, and dispose.
