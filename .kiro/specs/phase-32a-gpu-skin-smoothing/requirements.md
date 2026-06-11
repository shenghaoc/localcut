# Requirements: Phase 32a — GPU Skin Smoothing

LocalCut gains a beauty effect (磨皮): a pure-WGSL skin-smoothing node in the
existing per-clip accelerated effect chain. Smoothing is an edge-preserving
**self-guided guided filter** on luma, gated by a tunable chroma-based
skin-probability mask (BT.601 Cb/Cr range), driven by a single keyframable
strength parameter (Phase 15 keyframes). The node encodes into the same single
WebGPU command submission as the rest of the chain, runs at whatever
resolution the chain runs at (proxy/adaptive preview via Phase 19/Phase 2,
full resolution at export), and offers an A/B bypass toggle in the effect UI.
No ML, no face detection, no geometry warps — those are Phase 32b. Everything
runs client-side in the pipeline worker; reduced tiers that cannot run the
WebGPU chain render without smoothing and say so.

## R1 — Effect node and parameter model

- **R1.1** `ClipEffectParams` (`src/engine/effects.ts`) and
  `ClipEffectParamsSnapshot` (`src/protocol.ts`) gain one new numeric field:
  `skinSmoothStrength`, range **[0, 1]**, default **0**.
  `DEFAULT_CLIP_EFFECTS.skinSmoothStrength === 0` and
  `normalizeClipEffects` fills the default for absent values and clamps
  finite values into [0, 1]; non-finite values fall back to 0.
- **R1.2** Strength 0 is an exact bypass: `isSkinSmoothActive(params)`
  returns `false` when `skinSmoothStrength <= 0`, and the GPU encoder adds
  **zero** compute passes for that layer (no scratch-texture allocation, no
  uniform writes).
- **R1.3** `skinSmoothStrength` is keyframable through the Phase 15 system:
  it is added to `EFFECT_PARAM_KEYS` in `src/engine/keyframes.ts`, accepted by
  the existing `set-keyframe` / `set-keyframes` / `delete-keyframe` commands,
  and sampled by `sampleClipParamsAt` so preview (`src/engine/worker.ts`),
  export (`src/engine/export.ts`), and the compatibility export sample the
  identical value at any timeline time.
- **R1.4** The filter radius is **not** a user parameter. It derives from the
  processed frame height: `radiusForHeight(h) = clamp(round(8 * h / 1080),
  2, 24)` pixels (so 1080p → 8, 540p proxy preview → 4, 2160p export → 16).
  The guided-filter regularizer is the fixed constant `SKIN_SMOOTH_EPSILON =
  0.01` (normalized-luma² units). Both constants live in
  `src/engine/skin-smooth.ts` and are mirrored literally in the WGSL.
- **R1.5** Existing helpers stay coherent: `clipEffectsEqual` compares the new
  field; `packEffectUniform` is untouched (skin smoothing packs its own
  uniforms, R3.6); existing projects and clips behave identically because the
  default is 0 (R6.1).

## R2 — Chroma skin-probability mask

- **R2.1** The mask is a soft rectangle in full-range **BT.601 Cb/Cr** space
  computed per pixel from gamma-encoded (sRGB OETF) values of the
  working-linear pixel: `Y601 = dot(rgb, (0.299, 0.587, 0.114))`,
  `Cb = (b − Y601) * 0.564`, `Cr = (r − Y601) * 0.713`, with Cb/Cr in
  [−0.5, 0.5]. The OETF conversion is mask-only; smoothing itself operates in
  working linear (R3.3).
- **R2.2** Mask weight `m ∈ [0, 1]` is
  `m = band(Cb, cbMin, cbMax, softness) * band(Cr, crMin, crMax, softness)`
  where `band(v, lo, hi, s) = smoothstep(lo − s, lo, v) * (1 − smoothstep(hi,
  hi + s, v))` — full weight inside [lo, hi], smooth falloff of width `s`
  outside, exactly 0 beyond the falloff.
- **R2.3** Tunable per-clip mask parameters with defaults:
  `cbMin = −0.20`, `cbMax = 0.00`, `crMin = 0.05`, `crMax = 0.20`,
  `softness = 0.04`. Validation (`normalizeSkinMask`): cb/cr bounds clamp to
  [−0.5, 0.5], `softness` clamps to [0.005, 0.15], and when `min > max` after
  clamping the pair is swapped. Non-finite values fall back to the default
  for that field. The defaults keep `crMin − softness = 0.01 > 0`, so exactly
  neutral pixels (Cb = Cr = 0: white/grey/black text) always get `m = 0`.
- **R2.4** With default mask parameters, the classification function
  `skinMaskWeight(rgb, mask)` (TypeScript reference, R8.2) yields `m ≥ 0.9`
  for representative gamma-encoded skin tones — light `(0.96, 0.76, 0.65)`
  and deep `(0.45, 0.27, 0.20)` — and `m === 0` for: white `(1,1,1)`, black
  `(0,0,0)`, mid grey `(0.5,0.5,0.5)`, foliage green `(0.13, 0.55, 0.13)`,
  fabric blue `(0.2, 0.3, 0.8)`, and saturated red `(1, 0, 0)`.
- **R2.5** Mask parameters are per-clip, optional, and **not keyframable**.
  They are stored as an optional `skinMask` sidecar on the clip (like the
  Phase 15 `lut` sidecar), edited via a new `set-skin-mask` command (R7.4),
  and absent means "use defaults". A reset action restores defaults by
  clearing the sidecar.

## R3 — GPU algorithm and single-submission pass structure

- **R3.1** The algorithm is the **self-guided guided filter on BT.709 luma**
  (He et al.) with separable box filters — not frequency separation — per the
  justification in design.md. Exactly seven compute passes per smoothed
  layer, all encoded into the **same** `GPUCommandEncoder` the frame already
  uses; `queue.submit` count per frame stays exactly 1 (hard gate 4).
- **R3.2** Pass structure (all `@workgroup_size(8, 8, 1)`, dispatch
  `ceil(width/8) × ceil(height/8)`, same bounds-check pattern as
  `saturation.wgsl`): (1) prepare — write `(Y, Y²)`; (2) box-blur horizontal;
  (3) box-blur vertical → `(meanY, meanY²)`; (4) coefficients —
  `a = var / (var + ε)`, `b = (1 − a) * meanY` with
  `var = max(0, meanY² − meanY²̄)` clamped at 0; (5) box-blur horizontal;
  (6) box-blur vertical → `(meanA, meanB)`; (7) apply — compose with mask and
  strength into the chain's destination texture.
- **R3.3** Working data: `Y = dot(rgbLinear, (0.2126, 0.7152, 0.0722))` on
  the base-corrected working-linear image. Final compose:
  `outRgb = clamp(rgbLinear + strength * m * (Y' − Y), 0, 1)` with
  `Y' = meanA * Y + meanB` — luma-delta only, chroma untouched, so strength 0
  or mask 0 reproduces the input **bit-exactly**.
- **R3.4** Intermediate moments use two dedicated **`rg32float`** storage
  textures (ping/pong) sized to the composite resolution, lazily allocated on
  the first smoothed frame, reallocated on resize, destroyed with the
  renderer. f32 moments are mandatory: `meanY² − meanY·meanY` on low-contrast
  skin (~1e-4) is catastrophically cancelled in f16/8-bit. Skin smoothing
  ships **f32-only WGSL** on both the f16 and f32 chain variants (a stated,
  justified exception to the `*.f16.wgsl` pairing convention).
- **R3.5** The node slots into the per-layer pipeline between
  `base-correction` and `lut-apply`: `PIPELINE_ORDER` in
  `src/engine/colour.ts` gains a `'skin-smooth'` stage at that position, and
  `compositeLayers`/`processLayer` in `src/engine/gpu.ts` encodes it there.
  The pass-7 destination is selected from the `storage.a/b/c` ping-pong with
  the same non-aliasing rule the LUT stage uses, and no skin-smooth pass
  writes `storage.a` after a layer's transform pass (preserving the Phase 13
  transition `blendDst` invariant documented in `gpu.ts`).
- **R3.6** Uniforms: box passes share two frame-level 16-byte buffers
  (`{ radius: u32, dirX: u32, dirY: u32, pad: u32 }` for H and V — radius is
  identical for every layer in a frame, R1.4); the apply pass uses one
  32-byte buffer **per layer slot**
  (`{ strength, cbMin, cbMax, crMin, crMax, softness, pad0, pad1 }`, all
  f32), grown on demand like `EffectChain`'s per-slot buffers, because
  `queue.writeBuffer` is queue-ordered and a shared buffer would clobber
  earlier layers. Packing functions are pure TypeScript and unit-tested.
- **R3.7** Performance: with one smoothed 1080p layer the added GPU cost
  budget is ≤ 2.5 ms/frame on the accelerated-tier baseline, and 1080p30
  preview stays realtime (no sustained dropped-frame regression in the
  Phase 25 diagnostics frame stats). Verified manually with the existing
  `gpu.ts` timestamp queries (R8.7); the automated gate is the mock-device
  pass-count test (R8.5).

## R4 — Preview/export parity, proxy resolution, A/B bypass

- **R4.1** Preview and export share the identical pass structure and math:
  both run through `compositeLayers`, both sample strength via
  `sampleClipParamsAt`. There is no separate export implementation.
- **R4.2** The chain runs at the active composite resolution — proxy/adaptive
  preview resolution (Phase 19 proxies, Phase 2 adaptive ladder) during
  playback, full project resolution at export. Because the radius scales with
  processed height (R1.4), proxy preview and full-resolution export are
  visually consistent (verified manually, R8.7).
- **R4.3** A/B bypass: a per-clip, session-only toggle. When enabled the
  worker skips the seven passes for that clip (identical output to
  strength 0) while preserving the stored strength, keyframes, and mask. The
  flag is **never serialised** (not in `ProjectDoc`, autosaves, or bundles),
  is cleared on project load/restore, and **never affects export** — export
  always honours the stored strength.
- **R4.4** Bypass takes effect on the next rendered frame, including while
  paused (the worker re-renders the current frame on receipt, matching the
  behaviour of `set-effect-param` while paused).

## R5 — Capability tiers

- **R5.1** Skin smoothing requires the WebGPU effect chain. It uses only core
  WebGPU capabilities (`rg32float` writable storage textures, compute
  passes) — **no new capability probes and no new device features** — so it
  is available on both the Accelerated and Compatibility-GPU tiers wherever
  the chain itself runs, including Safari 26+ WebGPU when those tiers are
  active. Realtime 1080p30 is promised only on the Accelerated tier.
- **R5.2** On the Limited-WebCodecs / compatibility export path
  (`src/engine/compatibility/compat-export.ts`) the effect is **not**
  rendered (no CPU pixel-loop port). The Inspector control is disabled on
  non-WebGPU tiers with the label "Requires GPU effects (accelerated tier)" —
  honest tiering, never a crash, never a silent visual mismatch claim.

## R6 — Persistence, keyframes, bundles, interchange

- **R6.1** `PROJECT_SCHEMA_VERSION` in `src/engine/project.ts` bumps
  **10 → 11**. Parsing a v10 (or earlier-migrated) document yields
  `skinSmoothStrength = 0` and no `skinMask`; a saved v11 document
  round-trips `skinSmoothStrength`, its keyframe track, and the `skinMask`
  sidecar exactly. Invalid persisted mask values are normalized per R2.3, not
  rejected.
- **R6.2** `ClipSnapshot` (`src/protocol.ts`) gains optional
  `skinMask?: SkinMaskSnapshot` (`{ cbMin, cbMax, crMin, crMax, softness }`,
  all numbers). The timeline model (`src/engine/timeline.ts`) carries it
  through clone, split, copy/paste, and duplicate exactly like the `lut`
  sidecar; both halves of a split keep the mask.
- **R6.3** Phase 23 bundles round-trip the new fields via `project.json`
  with no manifest changes (the document is opaque to the bundle layer); a
  test proves bundle export → import preserves strength, keyframes, and mask.
  Phase 48 OTIO export carries them automatically inside the
  `metadata.localcut` clip-effects payload; no `.otio` schema work beyond the
  existing pass-through, and the cuts-only EDL is unaffected.
- **R6.4** Undo/redo: `set-effect-param` for `skinSmoothStrength`,
  `set-skin-mask`, and keyframe edits all go through the existing Phase 9
  snapshot history. The session-only bypass flag is **not** undoable state.

## R7 — UI: Inspector effect section

- **R7.1** `src/ui/Inspector.tsx` gains a "Skin Smoothing" group in the
  effects section for video clips: a strength slider (range 0–1, step 0.01,
  default 0) wired through the existing debounced `scheduleParam` machinery
  and `set-effect-param`, with the standard per-parameter keyframe diamond
  and previous/next navigation (identical affordances to the existing effect
  sliders).
- **R7.2** An **A/B** toggle button sits beside the slider: visible pressed
  state via `aria-pressed`, keyboard operable, label "Bypass skin smoothing
  (A/B)". It sends `set-skin-smooth-bypass` and is enabled only when
  `skinSmoothStrength > 0` or a strength keyframe track exists. A short
  inline note states bypass affects preview only, never export.
- **R7.3** A collapsed "Skin mask" disclosure exposes the five mask sliders
  (`cbMin`, `cbMax` in [−0.5, 0.5] step 0.01; `crMin`, `crMax` in [−0.5, 0.5]
  step 0.01; `softness` in [0.005, 0.15] step 0.005) plus a "Reset mask"
  button that clears the sidecar to defaults. Mask edits debounce like other
  Inspector edits and are undoable.
- **R7.4** Protocol (`src/protocol.ts`): new commands
  `set-skin-mask { trackId, clipId, mask: SkinMaskSnapshot }` and
  `set-skin-smooth-bypass { trackId, clipId, bypass: boolean }`, both
  structured-clone-safe, dispatched in `src/engine/worker.ts`; no media
  objects or GPU handles cross into `src/ui/` (hard boundary).
- **R7.5** Dark professional-tool styling per the UI-standards steering;
  contrast and focus order per the accessibility steering; on non-WebGPU
  tiers the group renders disabled with the R5.2 label.

## R8 — Tests and docs

- **R8.1** All automated tests are Vitest, Node environment, co-located —
  WebGPU is mocked at the boundary; **no test pretends to execute WGSL**.
  Real-GPU visual verification is the explicit manual checklist (R8.7).
- **R8.2** `src/engine/skin-smooth.ts` exports a pure TypeScript reference
  implementation of the identical math (`skinMaskWeight`,
  `referenceGuidedFilterLuma`, `referenceSkinSmooth` mirroring the seven
  passes on `Float32Array` RGBA data) used by golden tests against small
  synthetic fixtures generated in-test (≤ 64×64) — no binary fixtures, no
  image files in CI.
- **R8.3** `src/engine/skin-smooth.test.ts` (new) covers at minimum:
  (a) mask classification per R2.4 (every listed fixture colour);
  (b) `normalizeSkinMask` clamping, swapping, non-finite fallback;
  (c) `radiusForHeight` at 540/1080/2160 plus both clamps;
  (d) guided-filter reference: constant image unchanged (≤ 1e-6), uniform
  noise on a flat patch has output variance ≤ 0.35× input at radius 4, a
  monotone 1-D step stays monotone with no overshoot beyond the input range
  + 1e-6 (no halo / gradient reversal);
  (e) golden non-skin invariance: a 64×64 quadrant fixture (noisy skin tone /
  black-on-white text pattern / foliage green checker / fabric blue weave) at
  default mask and strength 0.5 leaves the three non-skin quadrants
  **bit-identical** while the skin quadrant's luma variance drops ≥ 50%;
  (f) strength 0 and bypass produce bit-identical output to input;
  (g) uniform packing per R3.6 (offsets, defaults, clamps);
  (h) WGSL/TS constant sync: import each `skin-smooth-*.wgsl` via `?raw` and
  assert the literal radius-base, epsilon, luma and Cb/Cr coefficients match
  the TypeScript constants.
- **R8.4** Extended suites: `effects.test.ts` (defaults, normalize, clamp,
  `isSkinSmoothActive`, `clipEffectsEqual`); `keyframes.test.ts`
  (`skinSmoothStrength` recognised by `isEffectKeyframeParam`, sampled by
  `sampleClipParamsAt`, preview/export sample equality); `timeline.test.ts`
  (split/copy/duplicate carry `skinMask`); `project.test.ts` (v10 → v11
  migration defaults, v11 round-trip, malformed mask normalization);
  `project-bundle/project-bundle.test.ts` (bundle round-trip per R6.3);
  protocol type-guard coverage for the two new commands.
- **R8.5** `gpu.test.ts` (mock device, existing pattern): with one
  strength-0.5 frame layer the renderer issues exactly **1** submission and
  exactly **7** additional compute passes; with strength 0 or bypass it adds
  **0**; two smoothed layers add 14 passes, still 1 submission; moment
  textures are created lazily once and destroyed on `destroy()`.
- **R8.6** Docs: `docs/USER-GUIDE.md` gains a "Skin smoothing (beauty)"
  section — what it does, the single strength control, keyframing, the A/B
  bypass (preview-only), mask tuning, the no-face-detection boundary
  (Phase 32b pointer), and the tier requirement. No new docs page.
- **R8.7** Manual checklist (recorded in tasks): 1080p30 realtime with one
  smoothed layer on the accelerated tier (timestamp-query reading ≤ 2.5 ms);
  A/B toggle flips within one frame while playing and while paused; proxy
  preview vs full-res export visual consistency on a face clip; non-skin
  regions (text overlay, foliage, fabric) visibly untouched at default
  strength; export parity vs preview; behaviour on a Compatibility-GPU tier
  and the disabled control on a Limited tier.
- **R8.8** Quality gate: `npm run build` green (strict TypeScript),
  `npm test` green, total test count strictly grows.
