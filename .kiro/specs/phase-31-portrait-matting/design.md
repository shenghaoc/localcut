# Design: Phase 31 — Portrait Video Matting

> Status: **Corrected re-plan.** Person matting as a per-clip effect through the Phase 28
> on-device-ML runtime conventions. This document supersedes the earlier Phase 31 design,
> which mis-picked a GPL-licensed model and built an offline CPU pre-computation pipeline
> instead of the intended zero-copy realtime path. See [Implementation corrections](#implementation-corrections)
> for the disposition of already-merged foundations.

## Goal

Per-clip person matting — "green screen without a green screen" — with three user-facing
modes: **remove** (background → transparency), **replace** (any timeline source as the
background), and **blur** (mask-driven background blur). Inference runs on-device through
the Phase 28 runtime conventions (lazy load, manifest + SHA-256 same-origin weights,
probe that never gates the capability tier, no cloud fallback), producing an alpha
texture consumed directly by the Phase 12 compositor.

## Non-goals

- General object segmentation / rotoscoping (SAM-class) — future phase.
- Guaranteed hair-strand studio quality — best-effort edges; honest UI labeling.
- Chroma-key green screen is **not** this feature — but since no chroma-key effect
  exists in the codebase yet, this spec includes it as a separate, trivial WGSL effect
  (see [Chroma key (sibling effect)](#chroma-key-sibling-effect)). It shares nothing
  with the ML matting path.

## Model evaluation and verdict

Evaluated on temporal stability, edge quality, throughput, and **license**. The project
is MIT-licensed (`package.json`), so GPL-family model code/weights are disqualifying even
when fetched at runtime: recommending or defaulting to GPL weights pushes copyleft
obligations onto every deployer.

| Candidate | Temporal stability | Edge quality | Throughput (WebGPU-class) | License | Verdict |
|---|---|---|---|---|---|
| **RVM** (RobustVideoMatting, MobileNetV3) | Best — recurrent hidden state across frames | High (true matting) | Good (~512² recurrent pass) | **GPL-3.0** | **Rejected on license.** Technically the strongest candidate; unusable as a default in an MIT app. |
| **MODNet** | None built in — single-frame; needs an external temporal smoothing pass | High (true matting, trimap-free) | Good (~512² single pass) | **Apache-2.0** | **Primary.** Apache-licensed true matting; temporal stability restored by our EMA smoothing pass (below). |
| **MediaPipe Selfie Segmentation** (`@mediapipe/tasks-vision`) | Moderate (per-frame, but stable masks in practice) | Lower — segmentation mask, not matting; soft edges only via feathering | Excellent (built for realtime) | **Apache-2.0** | **Fallback** for reduced/WASM-only environments where MODNet inference can't hold realtime. |

**Recorded verdict: MODNet (Apache-2.0) primary, served as a `.tflite` model and run on
LiteRT.js (`@litertjs/core`, Apache-2.0) with the WebGPU accelerator; MediaPipe selfie
segmenter (Apache-2.0) as the labeled reduced-quality fallback; RVM rejected solely on
GPL-3.0 licensing.** If a permissively licensed RVM-class recurrent model appears later,
the recurrent-state policy below already covers it.

The runtime is **LiteRT.js**, the same on-device ML runtime Phase 28 (audio cleanup) and
Phase 29 (auto-captions) already use — so the matte inherits the project's established
LiteRT conventions (build-scoped `/litert/<sha>/` WASM, lazy load, `.tflite` models). It
**replaces an earlier onnxruntime-web attempt**: ORT 1.26 would not run on the
compositor's `GPUDevice` (it ignored an injected `env.webgpu.device` and ran the session
on a device of its own, making cross-device tensor IO impossible — the zero-copy contract
below was unachievable). LiteRT.js exposes `setWebGpuDevice(device)` plus GPU-buffer
tensor IO (`new Tensor(gpuBuffer, …)` / `tensor.toGpuBuffer()`), which is exactly the
shared-device path ORT lacked. The inherited "Phase 28 runtime" contract is the
*operational* pattern: lazily-loaded inference, manifest-validated checksummed same-origin
weights, a probe that informs but never gates `CapabilityTierV2`, explicit user opt-in,
zero cloud.

## Zero-copy pipeline

The matting path is realtime and GPU-resident end to end. **No CPU pixel round-trips**:
no `createImageBitmap`, no `OffscreenCanvas`/`getImageData`, no `ImageData` postMessage
hops.

```
VideoFrame (pipeline worker decode, per displayed frame)
  → importExternalTexture
  → preprocess WGSL pass (resize to model input, normalize, NHWC pack into GPU buffer)
  → LiteRT.js WebGPU model.run with GPU-buffer tensor IO
      (input: new Tensor(gpuBuffer, …); output: tensor.toGpuBuffer())
  → alpha tensor (GPU buffer) → alpha texture (r8unorm)
  → temporal-smooth WGSL pass (EMA over previous alpha; recurrent surrogate)
  → [export only] guided-upsample WGSL pass (joint bilateral, guided by full-res luma)
  → matte-apply pass in the Phase 12 compositor (remove / replace / blur variants)
```

Consequences:

- **The session lives in the pipeline worker, on the compositor's `GPUDevice`.**
  GPU buffers are not transferable across workers, so a separate inference worker would
  force a CPU readback. LiteRT runs in the pipeline worker (an ES-module worker, so it
  can dynamic-`import('@litertjs/core')` lazily) and `setWebGpuDevice(device)` shares the
  compositor's device, so the input buffer the preprocess pass fills and the alpha buffer
  the model returns all live on one device — no readback.
- **Inference is per-frame at playback/export time, not an offline batch job.** The
  alpha-texture LRU cache remains as a *reuse* cache (paused playhead, scrubbing
  back over recent frames), not as the source of truth. Export never has "missing matte"
  frames because export runs the same per-frame path.
- The single-`queue.submit` gate applies to the compositor's effect chain. LiteRT issues
  its own internal submissions for inference on the shared device; that is a separate
  subsystem and documented as such. Alpha delivery into the compositor adds **no** extra
  submission: the temporal-smooth/upsample/matte-apply passes ride the existing per-frame
  encoder. LiteRT's output buffer is freed only after `queue.onSubmittedWorkDone()` so the
  resolve pass never reads a released buffer.

## Recurrent state policy

MODNet is single-frame, so the shipped model carries no recurrent state; temporal
stability comes from the EMA smoothing pass (`alpha_t = mix(alpha_raw, alpha_{t-1}, k)`,
`k` fixed, reset on discontinuity). The policy below is normative anyway, so an
RVM-class permissive model can slot in later without re-design:

- Recurrent state (model hidden state *and* the EMA history texture) is owned by the
  **per-clip matte session** in the pipeline worker. One clip-session at a time per clip;
  sessions are keyed by `clipId`.
- **State resets on seeks** and on any source-time discontinuity (next frame's
  `sourceTime` differs from the previous by more than ~1.5 frame intervals), on clip
  boundary, on enable-toggle, and on model swap.
- State is never serialized, never persisted, never shared across clips.

## Resolution policy

- **Preview**: inference at model input resolution; the decode feed follows the Phase 19
  proxy/adaptive-resolution pipeline (the preprocess pass consumes whatever resolution
  P19 delivers — proxy frames are cheaper to import and sample). Alpha is applied at
  compositor resolution via bilinear sampling.
- **Export** (decided verdict): **model-resolution alpha refined by a guided-upsample
  WGSL pass** (joint bilateral upsample using full-resolution luma as guide), not
  full-resolution inference. One inference cost per frame regardless of output size,
  shared math between preview and export, and edge quality recovered where it matters
  (luma edges). Full-res inference is rejected: quadratic cost growth for marginal gain
  over guided upsampling.

## User-facing modes

`ClipMatte` (timeline model, serialized, undoable):

```typescript
interface ClipMatte {
  enabled: boolean;
  mode: 'remove' | 'replace' | 'blur';
  modelKey: string;        // model pin: id + version (manifest-checksummed)
  strength: number;        // 0..1 alpha blend toward the matte result
  blurRadius?: number;     // 'blur' mode only, px at compositor resolution
}
```

- **remove** — layer alpha multiplied by matte; background becomes transparency,
  compositing over whatever is below (Phase 12 semantics unchanged).
- **replace** — remove + an explicit background: the UI places/links a chosen timeline
  source as the layer directly beneath the matted clip. Replace is a *composition
  recipe* the UI manages, not a second texture input to the shader — keeps the
  compositor contract unchanged and any timeline source (video, still, title) usable
  as background by construction.
- **blur** — mask-driven blur: a separable blur pass on the layer weighted by inverse
  matte (background blurred, subject sharp). `blurRadius` user-controlled.

## Chroma key (sibling effect)

Does not exist in the codebase today, so it is spec'd here as a deliberately separate,
trivial effect — **no ML, no model, no session**: `chroma-key.wgsl` (+ `.f16`) computes
alpha from chroma distance to a user-picked key color (key color, tolerance, softness
uniforms) and slots into the same compositor stage as matte-apply. It shares the
`ClipMatte` UI section visually but nothing else. Implementation cost is one shader,
one uniform struct, three Inspector controls.

## Determinism (test mode)

A `matteTestMode` flag (worker init option) makes alpha output reproducible: fixed EMA
seed state, no adaptive resolution switching, `downsample`/threshold parameters pinned.
Repeated runs over the same fixture must produce byte-identical alpha hashes. This is
what the acceptance test asserts; without the flag, runtime behavior may adapt freely.

## Persistence and portability

- `ClipMatte` serializes with a `schemaVersion` bump; absent field = no matting
  (backward compatible).
- **Model pin survives the bundle round-trip** (P23): `modelKey` resolves through the
  model manifest (id, version, SHA-256). Re-opening a bundle on another machine with a
  different deployed model version keeps the clip's pin and surfaces a mismatch warning
  instead of silently switching models.
- No OPFS persistence of alpha frames (the previous design's PNG cache is dropped —
  alpha is recomputed, not stored).

## Capability gating

| Capability | Path | Behaviour |
|---|---|---|
| WebGPU + shared device | MODNet `.tflite` via LiteRT WebGPU | Full feature, realtime preview at proxy resolution |
| WebGPU unavailable / device sharing impossible | MediaPipe selfie segmenter (WASM) | Labeled reduced quality ("segmentation, not matting"); realtime maintained |
| Neither | Feature unavailable | Matte controls disabled with explanation |

Probe stays cheap (no model load), runs on first matte interaction, informs the
capability panel, and never affects `CapabilityTierV2`.

## Validation

- **Realtime**: accelerated-tier preview holds the project's preview-fps budget with
  matting enabled at proxy resolution (measured, not asserted by hope).
- **Temporal stability**: fixture-based test — mean per-pixel |Δalpha| between
  consecutive frames on a static-camera talking-head fixture stays under a fixed bound;
  catches flicker regressions.
- **Determinism**: same fixture, test mode, two runs → identical alpha hashes.
- **Round-trip**: matte settings + model pin survive project bundle export/import.
- **Lifetime**: every alpha `GPUTexture`/GPU buffer destroyed exactly once; sessions
  released on clip delete/disable/dispose.

## Implementation corrections

Disposition of the already-merged "Phase 31 foundations" (PR #80) measured against this
corrected design:

**Survives (aligned):**
- `ClipMatte` timeline model, snapshot/serialization, undoable mutations (extend with
  `mode`/`blurRadius`).
- `matte-apply.wgsl` + compositor insertion point, bilinear sampler, optional
  `matteView` on `FrameCompositeLayer` (becomes the `remove` variant).
- Model manifest + SHA-256 verification, same-origin weight loading, probe that does
  not gate the tier, Inspector/badge/capability-row UI shells.
- Alpha-texture LRU cache (repurposed as reuse cache, not source of truth).

**Must be removed or reworked:**
- **RVM as primary model and all RVM-specific defaults** — GPL-3.0; replace with MODNet.
  Recurrent plumbing survives only behind the model-capability abstraction.
- **CPU preprocessing path** (`createImageBitmap` → `OffscreenCanvas`/`getImageData` →
  `ImageData`/`Uint8Array` postMessage hops) — replaced by the GPU preprocess pass +
  LiteRT GPU-buffer tensor IO.
- **Offline whole-clip batch pre-computation** and its main-thread orchestration
  (`request-matte-frames` round-trips through the UI) — replaced by per-frame inference
  in the pipeline worker at playback/export time.
- **Separate matte inference worker** — inference moves into the pipeline worker on the
  shared `GPUDevice`; the dedicated worker remains only if it ends up hosting the
  MediaPipe fallback.
- **Export "missing matte" warning stopgap** — obsolete once export runs the per-frame
  path.
- The earlier design's **OPFS PNG matte persistence** — dropped.
