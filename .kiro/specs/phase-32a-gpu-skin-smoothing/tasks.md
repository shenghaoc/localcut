# Tasks: Phase 32a — GPU Skin Smoothing

## T1 — TypeScript reference module and constants (R1, R2, R3, R8)

- [ ] **T1.1** Create `src/engine/skin-smooth.ts`. Export constants: `SKIN_SMOOTH_EPSILON = 0.01`,
  `LUMA_BT709 = [0.2126, 0.7152, 0.0722] as const`, `LUMA_BT601 = [0.299, 0.587, 0.114] as const`,
  `CB_SCALE = 0.564`, `CR_SCALE = 0.713`, `DEFAULT_SKIN_MASK` (cbMin −0.20, cbMax 0.00,
  crMin 0.05, crMax 0.20, softness 0.04), and `SkinMaskParams` interface (cbMin, cbMax,
  crMin, crMax, softness, all `number`).
- [ ] **T1.2** Export `normalizeSkinMask(partial: Partial<SkinMaskParams> | undefined): SkinMaskParams`
  in `src/engine/skin-smooth.ts`: cb/cr bounds clamped to [−0.5, 0.5], softness clamped to
  [0.005, 0.15], min/max pairs swapped when min > max after clamping, non-finite values fall
  back to the corresponding `DEFAULT_SKIN_MASK` field.
- [ ] **T1.3** Export `radiusForHeight(h: number): number` in `src/engine/skin-smooth.ts`:
  `clamp(Math.round(8 * h / 1080), 2, 24)`.
- [ ] **T1.4** Export `skinMaskWeight(rgb: readonly [number, number, number], mask: SkinMaskParams): number`
  in `src/engine/skin-smooth.ts`. Gamma-encode each channel with the sRGB OETF, compute
  Y601, Cb, Cr; return `band(Cb, cbMin, cbMax, softness) * band(Cr, crMin, crMax, softness)`
  where `band(v, lo, hi, s) = smoothstep(lo−s, lo, v) * (1 − smoothstep(hi, hi+s, v))`.
- [ ] **T1.5** Export `referenceGuidedFilterLuma(luma: Float32Array, width: number, height: number, radius: number, epsilon: number): Float32Array`
  in `src/engine/skin-smooth.ts`. Pure-TS seven-step self-guided guided filter on a
  single-channel (stride = width) input: (1) compute `meanY`, `meanY²` with separable box
  blur of `[Y, Y²]`; (2) compute `a = var/(var+ε)`, `b = (1−a)*meanY` with
  `var = max(0, meanY² − meanY·meanY)`; (3) box-blur `[a, b]` → `[meanA, meanB]`;
  (4) return `meanA*Y + meanB` per pixel.
- [ ] **T1.6** Export `referenceSkinSmooth(rgba: Float32Array, width: number, height: number, strength: number, mask?: SkinMaskParams): Float32Array`
  in `src/engine/skin-smooth.ts`. Accepts working-linear RGBA Float32Array, applies
  `referenceGuidedFilterLuma` to the BT.709 luma channel, then blends with the chroma
  mask: `outRgb = clamp(rgbLin + strength * m * (Yprime − Y), 0, 1)`.
  Returns a new `Float32Array`; input is not mutated. At strength 0, returns bit-identical
  copy of the input.
- [ ] **T1.7** Export `packSkinBoxUniform(radius: number, horizontal: boolean): Uint32Array`
  in `src/engine/skin-smooth.ts`: 4-element `[radius, dirX, dirY, 0]`
  (`dirX=1, dirY=0` when horizontal; `dirX=0, dirY=1` when vertical).
- [ ] **T1.8** Export `packSkinApplyUniform(strength: number, mask: SkinMaskParams | undefined): Float32Array`
  in `src/engine/skin-smooth.ts`: 8-element float32 `[strength, cbMin, cbMax, crMin, crMax, softness, 0, 0]`
  using `normalizeSkinMask(mask)` for the mask fields.
- [ ] **T1.9** Export `isSkinSmoothActive(params: { skinSmoothStrength: number }): boolean`
  in `src/engine/skin-smooth.ts`: returns `params.skinSmoothStrength > 0`.

## T2 — Effect params and keyframe registration (R1)

- [ ] **T2.1** Extend `ClipEffectParams` interface in `src/engine/effects.ts` with
  `skinSmoothStrength: number`. Add `skinSmoothStrength: 0` to `DEFAULT_CLIP_EFFECTS`.
  Extend `normalizeClipEffects` to fill the default for absent values and clamp finite
  values to [0, 1]; non-finite values fall back to 0.
- [ ] **T2.2** Add `isSkinSmoothActive` re-export (or inline equivalent) to
  `src/engine/effects.ts`, and extend `clipEffectsEqual` to compare `skinSmoothStrength`.
  `packEffectUniform` is unchanged — skin smoothing packs its own uniforms separately.
- [ ] **T2.3** Add `'skinSmoothStrength'` to `EFFECT_PARAM_KEYS` (the `Set<ClipKeyframeParam>`)
  in `src/engine/keyframes.ts`. No other change required — the existing
  `isEffectKeyframeParam`, `sampleClipParamsAt`, and command handlers all work without
  further modification.

## T3 — Protocol types (R2, R6, R7)

- [ ] **T3.1** Add `SkinMaskSnapshot` interface to `src/protocol.ts`:
  `{ cbMin: number; cbMax: number; crMin: number; crMax: number; softness: number }`.
- [ ] **T3.2** Add `skinSmoothStrength: number` to `ClipEffectParamsSnapshot` in
  `src/protocol.ts` (mirrors the `ClipEffectParams` extension).
- [ ] **T3.3** Add `skinMask?: SkinMaskSnapshot` to `TimelineClipSnapshot` in
  `src/protocol.ts`, parallel to `lut?: ClipLutSnapshot`.
- [ ] **T3.4** Add two new commands to the `WorkerCommand` discriminated union in
  `src/protocol.ts`:
  `| { type: 'set-skin-mask'; trackId: string; clipId: string; mask: SkinMaskSnapshot }`
  `| { type: 'set-skin-smooth-bypass'; trackId: string; clipId: string; bypass: boolean }`.
  Both must be structured-clone-safe (plain numbers and booleans, no handles).

## T4 — Pipeline stage order (R3)

- [ ] **T4.1** Add `'skin-smooth'` to the `ColorPipelineStage` union type in
  `src/engine/colour.ts`. Insert `'skin-smooth'` into the `PIPELINE_ORDER` array
  between `'lut-apply'` and `'opacity'`; the array grows from 7 to 8 elements.
  Update the comment block documenting the stage order to include the new stage.
- [ ] **T4.2** Update the `colour.test.ts` stage-count assertion from 7 to 8 to
  reflect the new stage.

## T5 — WGSL shaders (R3)

- [ ] **T5.1** Create `src/engine/shaders/skin-smooth-prepare.wgsl`: pass 1.
  Bindings: `@group(0) @binding(0) var src: texture_storage_2d<rgba32float, read>`,
  `@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>`.
  Workgroup size `(8, 8, 1)`. Bounds-check with `all(id.xy < textureDimensions(dst))`.
  Reads linear RGB from `src`, computes `Y = dot(rgb, LUMA_BT709)`, writes `(Y, Y*Y)`.
  Embed the literal constants `0.2126`, `0.7152`, `0.0722` (must match `skin-smooth.ts`).
  No f16 variant.
- [ ] **T5.2** Create `src/engine/shaders/skin-smooth-box.wgsl`: passes 2, 3, 5, 6.
  Bindings: `@group(0) @binding(0) var<uniform> u: SkinBoxUniform` (16 bytes),
  `@group(0) @binding(1) var src: texture_storage_2d<rg32float, read>`,
  `@group(0) @binding(2) var dst: texture_storage_2d<rg32float, write>`.
  Separable 1-D box blur of radius `u.radius` in direction `(u.dirX, u.dirY)`.
  Clamp sample coordinates to `[0, dims-1]` (border-clamp, not wrap). Bounds-check output.
  No f16 variant.
- [ ] **T5.3** Create `src/engine/shaders/skin-smooth-coeffs.wgsl`: pass 4.
  Bindings: `@group(0) @binding(0) var moments: texture_storage_2d<rg32float, read>`
  (holds meanY in `.r`, meanY² in `.g`),
  `@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>`.
  Per pixel: load texel `let m = textureLoad(moments, coord);`, compute
  `variance = max(0.0, m.g - m.r * m.r)`,
  `a = variance / (variance + SKIN_EPSILON)`, `b = (1.0 - a) * m.r`. Writes `(a, b)`.
  Embed literal `0.01` for epsilon. No f16 variant.
- [ ] **T5.4** Create `src/engine/shaders/skin-smooth-apply.wgsl`: pass 7.
  Bindings: `@group(0) @binding(0) var<uniform> u: SkinApplyUniform` (32 bytes),
  `@group(0) @binding(1) var src: texture_storage_2d<rgba32float, read>`,
  `@group(0) @binding(2) var meanCoeffs: texture_storage_2d<rg32float, read>`,
  `@group(0) @binding(3) var dst: texture_storage_2d<rgba32float, write>`.
  Per pixel: compute `Y = dot(rgb, LUMA_BT709)`, `Yprime = meanCoeffs.r*Y + meanCoeffs.g`,
  gamma-encode `rgb` with sRGB OETF to get `rgbG`, compute `Y601 = dot(rgbG, LUMA_BT601)`,
  `Cb = (rgbG.b − Y601) * CB_SCALE`, `Cr = (rgbG.r − Y601) * CR_SCALE`, `m = band(...)*band(...)`,
  `outRgb = clamp(rgb + vec3f(u.strength * m * (Yprime − Y)), vec3f(0.0), vec3f(1.0))`.
  Preserve alpha by loading the full RGBA texel first: `let rgba = textureLoad(src, coord)`.
  Embed literals for all constants. No f16 variant.

## T6 — GPU renderer integration (R3)

- [ ] **T6.1** Add four skin-smooth pipeline fields to `PreviewRenderer` in `src/engine/gpu.ts`:
  `skinPreparePipeline`, `skinBoxPipeline`, `skinCoeffsPipeline`, `skinApplyPipeline`
  (all `GPUComputePipeline | null`). Import the four shaders via `?raw`. Compile pipelines
  during renderer initialization (same startup path as existing effect pipelines).
- [ ] **T6.2** Add scratch texture fields to `PreviewRenderer`:
  `skinScratch0: GPUTexture | null`, `skinScratch1: GPUTexture | null`,
  `skinScratch0View: GPUTextureView | null`, `skinScratch1View: GPUTextureView | null`.
  Add frame-global box uniform buffer fields `skinBoxUniformH: GPUBuffer | null`,
  `skinBoxUniformV: GPUBuffer | null`. Add per-slot apply uniform array
  `skinApplyUniforms: GPUBuffer[]`. All initialised to `null` / `[]`.
- [ ] **T6.3** Implement lazy scratch-texture allocation in `PreviewRenderer`:
  on the first call to `encodeSkinSmooth` when `skinScratch0 === null`, create both
  scratch textures at `(this.width, this.height)` with format `rg32float` and usage
  `STORAGE_BINDING | TEXTURE_BINDING`. On `setSize` (resize): destroy existing scratch
  textures if non-null, set to `null`. On `destroy()`: destroy scratch textures,
  box uniform buffers, and all entries in `skinApplyUniforms`.
- [ ] **T6.4** Implement `encodeSkinSmooth(encoder, srcView, dstView, strength, mask, slot, wgX, wgY): void`
  as a private method of `PreviewRenderer` in `src/engine/gpu.ts`. Encodes exactly seven
  compute passes into `encoder` using the pipelines from T6.1, the scratch textures from
  T6.3, and uniforms from `src/engine/skin-smooth.ts` (`packSkinBoxUniform`,
  `packSkinApplyUniform`). Grows `skinApplyUniforms` on demand for the given slot index.
  Uses `this.device.queue.writeBuffer` for all uniform updates.
- [ ] **T6.5** Extend `FrameCompositeLayer` in `src/engine/gpu.ts` with
  `skinMask?: SkinMaskSnapshot` and `skinSmoothBypass?: boolean`. In `processLayer`
  inside `compositeLayers`: after the LUT stage, if `isSkinSmoothActive(layer.effects)`
  and `layer.skinSmoothBypass !== true`, call `encodeSkinSmooth` with the non-aliasing
  destination slot (same selection logic as the LUT ping-pong), then use the skin output
  as input to `encodeOpacity`. When inactive or bypassed, skip directly to `encodeOpacity`
  with the existing `lutView`.
- [ ] **T6.6** Write the box uniform buffers (`skinBoxUniformH`, `skinBoxUniformV`) once per
  frame, before encoding the first smoothed layer, using `radiusForHeight(this.height)` from
  `src/engine/skin-smooth.ts`. If no layers are smoothed in a frame, skip the write entirely.

## T7 — Timeline model and worker dispatch (R2, R4, R6)

- [ ] **T7.1** Add `skinMask?: SkinMaskParams` to the internal `TimelineClip` type in
  `src/engine/timeline.ts`. Carry `skinMask` through `splitClip` (both halves get a
  copy), `cloneClip`, copy/paste, and duplicate, mirroring the `lut` sidecar handling.
- [ ] **T7.2** Add a session-only bypass store in `src/engine/worker.ts`:
  `const skinSmoothBypassMap = new Map<string, boolean>()` (keyed by clipId).
  The map is not included in undo snapshots and is cleared on project load/restore.
- [ ] **T7.3** Handle `set-skin-mask` in `src/engine/worker.ts`: normalize the incoming
  `SkinMaskSnapshot` via `normalizeSkinMask`, store on the timeline clip, take a snapshot,
  push to undo history (Phase 9 pattern). Mirror the updated `TimelineClipSnapshot`
  (including `skinMask`) to the UI via the existing timeline-state message.
- [ ] **T7.4** Handle `set-skin-smooth-bypass` in `src/engine/worker.ts`: update
  `skinSmoothBypassMap` for the given clipId. If the playback clock is currently paused,
  re-render the current frame immediately (same behaviour as `set-effect-param` while
  paused). The bypass flag does **not** affect export — `exportTimeline` always consults
  only stored strength.
- [ ] **T7.5** When assembling `CompositeLayer` objects in the worker for preview and export,
  populate `skinMask` from the clip's `skinMask` field and `skinSmoothBypass` from
  `skinSmoothBypassMap.get(clipId) ?? false`. Export always passes `skinSmoothBypass: false`.

## T8 — Persistence and schema migration (R6)

- [ ] **T8.1** Bump `PROJECT_SCHEMA_VERSION` in `src/engine/project.ts` to the next unused
  version after 10 (check whether the Phase 46 PR #63 has been merged and taken v11;
  use whichever number follows the current merged version).
- [ ] **T8.2** Add migration logic in `src/engine/project.ts`: when reading a document at
  any prior schema version, set `skinSmoothStrength = 0` on all clips and omit `skinMask`.
- [ ] **T8.3** Persist `skinSmoothStrength`, its keyframe track (via existing
  `cloneClipKeyframes`/`parseClipKeyframes`), and `skinMask` in `src/engine/project.ts`:
  read and write `skinMask` from/to the clip JSON object alongside `lut`, applying
  `normalizeSkinMask` on load (invalid values normalized, not rejected).

## T9 — Inspector UI (R7)

- [ ] **T9.1** Add a "Skin Smoothing" collapsible group in `src/ui/Inspector.tsx` for
  video clips. The group is absent for title clips. When the active capability tier is
  below WebGPU, render the group with `aria-disabled="true"` and the note
  "Requires GPU effects (accelerated tier)."
- [ ] **T9.2** Implement the strength slider row in `src/ui/Inspector.tsx`:
  `<input type="range" min="0" max="1" step="0.01">`, wired to the existing debounced
  `scheduleParam` machinery and `set-effect-param` with key `'skinSmoothStrength'`.
  Include the standard keyframe diamond and previous/next navigation buttons, using the
  identical affordance pattern as the existing brightness/contrast sliders.
- [ ] **T9.3** Implement the A/B bypass toggle button in `src/ui/Inspector.tsx`:
  `<button aria-pressed={bypass()} aria-label="Bypass skin smoothing (A/B)">A/B Bypass</button>`.
  Sends `set-skin-smooth-bypass` on click. Enabled only when `skinSmoothStrength() > 0`
  or a strength keyframe track exists for the selected clip. Add a short note below:
  "Bypass affects preview only — export always uses stored strength."
- [ ] **T9.4** Implement the "Skin mask (advanced)" `<details>` element in
  `src/ui/Inspector.tsx` (collapsed by default): five sliders (cbMin, cbMax in [−0.5, 0.5]
  step 0.01; crMin, crMax in [−0.5, 0.5] step 0.01; softness in [0.005, 0.15] step 0.005),
  each debounced and sending `set-skin-mask` on change. A "Reset mask" button sends
  `set-skin-mask` with `DEFAULT_SKIN_MASK` values. All controls are `onCleanup`-safe.
- [ ] **T9.5** Apply dark professional-tool styling to the new Inspector group per the
  UI-standards steering (`src/ui/Inspector.tsx` and/or relevant CSS). Ensure contrast
  meets WCAG AA, focus order is logical, and the bypass button has a visible pressed state
  (CSS `:is([aria-pressed="true"])` or equivalent SolidJS signal-driven class).

## T10 — Unit tests (R8)

- [ ] **T10.1** Create `src/engine/skin-smooth.test.ts`. Test `skinMaskWeight` for all
  R2.4 fixtures: ≥ 0.9 for light skin `(0.96, 0.76, 0.65)` and deep skin `(0.45, 0.27, 0.20)`;
  exactly 0 for white `(1,1,1)`, black `(0,0,0)`, grey `(0.5,0.5,0.5)`, foliage green
  `(0.13, 0.55, 0.13)`, fabric blue `(0.2, 0.3, 0.8)`, saturated red `(1, 0, 0)`.
- [ ] **T10.2** In `src/engine/skin-smooth.test.ts`: test `normalizeSkinMask` — clamping
  out-of-range values, swapping min/max when inverted, non-finite → default for that field,
  undefined → full defaults.
- [ ] **T10.3** In `src/engine/skin-smooth.test.ts`: test `radiusForHeight` — returns 4 at
  h=540, 8 at h=1080, 16 at h=2160, 2 at h=0 (lower clamp), 24 at h=3600 (upper clamp).
- [ ] **T10.4** In `src/engine/skin-smooth.test.ts`: test `referenceGuidedFilterLuma` —
  (a) constant 16×16 patch of luma 0.5 is unchanged (max absolute error ≤ 1e-6);
  (b) 32×32 flat patch with ±0.05 uniform noise has output variance ≤ 0.35× input variance
  at radius 4; (c) a 1-D ramp 0.1→0.9 embedded in a 16×16 image stays monotone (no output
  value below `min(input)−1e-6` or above `max(input)+1e-6`).
- [ ] **T10.5** In `src/engine/skin-smooth.test.ts`: golden non-skin invariance test.
  Construct a 64×64 RGBA `Float32Array` with four 32×32 quadrants: Q0 = noisy skin tone
  `(0.96, 0.76, 0.65) ± 0.03` (gamma-encoded, converted to linear for input), Q1 =
  black-on-white text pattern, Q2 = foliage green checker, Q3 = fabric blue weave.
  Run `referenceSkinSmooth` at default mask and `strength = 0.5`. Assert Q1, Q2, Q3 pixels
  are bit-identical to the input; assert Q0 luma variance drops ≥ 50%.
- [ ] **T10.6** In `src/engine/skin-smooth.test.ts`: test strength 0 returns a bit-identical
  copy of the input (all RGBA values equal, no mutation). Test `isSkinSmoothActive` returns
  false at strength 0, true at strength 0.5.
- [ ] **T10.7** In `src/engine/skin-smooth.test.ts`: test `packSkinBoxUniform(8, true)` returns
  `Uint32Array [8, 1, 0, 0]`; `packSkinBoxUniform(4, false)` returns `[4, 0, 1, 0]`.
  Test `packSkinApplyUniform(0.7, DEFAULT_SKIN_MASK)` encodes all eight fields at correct
  Float32 byte offsets (verify via `DataView.getFloat32`).
- [ ] **T10.8** In `src/engine/skin-smooth.test.ts`: WGSL/TS constant sync test. Import
  `skin-smooth-prepare.wgsl`, `skin-smooth-coeffs.wgsl`, and `skin-smooth-apply.wgsl` via
  `?raw`. Assert each shader source string contains the literal substrings `'0.2126'`,
  `'0.7152'`, `'0.0722'`, `'0.299'`, `'0.587'`, `'0.114'`, `'0.564'`, `'0.713'`, `'0.01'`.
- [ ] **T10.9** Extend `src/engine/effects.test.ts`: `DEFAULT_CLIP_EFFECTS.skinSmoothStrength === 0`;
  `normalizeClipEffects({})` fills `skinSmoothStrength: 0`; `normalizeClipEffects({skinSmoothStrength: 1.5})`
  clamps to 1; `normalizeClipEffects({skinSmoothStrength: -0.1})` clamps to 0;
  `normalizeClipEffects({skinSmoothStrength: NaN})` falls back to 0;
  `isSkinSmoothActive(DEFAULT_CLIP_EFFECTS)` is false;
  `isSkinSmoothActive({...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5})` is true;
  `clipEffectsEqual` distinguishes differing `skinSmoothStrength`.
- [ ] **T10.10** Extend `src/engine/keyframes.test.ts`: `'skinSmoothStrength'` is recognised by
  `isEffectKeyframeParam`; `sampleClipParamsAt` interpolates `skinSmoothStrength` correctly
  at a keyframed time; preview and export receive the identical sampled value at the same time.
- [ ] **T10.11** Extend `src/engine/timeline.test.ts`: `splitClip` carries `skinMask` on both
  halves (identical to the pre-split value); copy/paste and duplicate carry `skinMask`.
- [ ] **T10.12** Extend `src/engine/project.test.ts`: parsing a v(N−1) document sets
  `skinSmoothStrength = 0` on all clips and omits `skinMask`; a round-trip at the new version
  preserves `skinSmoothStrength`, its keyframe track, and `skinMask`; malformed mask fields
  (out-of-range, non-finite) are normalised on load, not rejected.
- [ ] **T10.13** Extend `src/engine/project-bundle/project-bundle.test.ts`: bundle export then
  import round-trips `skinSmoothStrength`, its keyframe track, and `skinMask` exactly.
- [ ] **T10.14** Add protocol type-guard tests (inline or in a dedicated protocol test file):
  `{ type: 'set-skin-mask', trackId: 't1', clipId: 'c1', mask: DEFAULT_SKIN_MASK }` is a valid
  `WorkerCommand`; `{ type: 'set-skin-smooth-bypass', trackId: 't1', clipId: 'c1', bypass: true }`
  is a valid `WorkerCommand`.

## T11 — GPU mock-device pass-count test (R8)

- [ ] **T11.1** Extend `src/engine/gpu.test.ts` using the existing `fakeDevice()` / `layer()`
  pattern. Add a test case: one frame layer with `skinSmoothStrength = 0.5` and
  `skinSmoothBypass = false` — renderer issues exactly **1** `queue.submit` call and
  the `pass.dispatchWorkgroups` mock is called exactly 7 times more than the non-smooth
  baseline for the same frame.
- [ ] **T11.2** Add test case: one frame layer with `skinSmoothStrength = 0` — **0** extra
  dispatch calls beyond the non-smooth baseline; still exactly 1 `queue.submit`.
- [ ] **T11.3** Add test case: one frame layer with `skinSmoothStrength = 0.5` and
  `skinSmoothBypass = true` — **0** extra dispatch calls; still exactly 1 `queue.submit`.
- [ ] **T11.4** Add test case: two frame layers both with `skinSmoothStrength = 0.5` —
  exactly **14** extra dispatch calls (7 per layer); still exactly 1 `queue.submit`.
- [ ] **T11.5** Add test case: scratch textures are created exactly once (one
  `device.createTexture` call with format `rg32float`) on the first smoothed frame, and
  not created again for a subsequent smoothed frame without a resize in between. After
  calling `renderer.destroy()`, the mock texture `.destroy()` method has been called.

## T12 — Docs and quality gate (R8)

- [ ] **T12.1** Add a "Skin smoothing (beauty)" section to `docs/USER-GUIDE.md` covering:
  what the effect does (edge-preserving luma smoothing, chroma-masked); the single
  strength slider (range 0–1, default 0); keyframing strength via the standard diamond
  affordance; the A/B bypass toggle (preview only, never affects export); the "Skin mask
  (advanced)" disclosure and when to adjust it; the Phase 32b pointer (face detection,
  landmarks, and per-face masking are not part of this phase); and the accelerated-tier
  requirement (disabled on non-WebGPU tiers with an explanation in the Inspector).
- [ ] **T12.2** Manual smoke checklist — record results in the PR description:
  (a) 1080p30 preview with one smoothed layer on the accelerated tier shows ≤ 2.5 ms/frame
  additional GPU time via the diagnostics timestamp readout; (b) A/B toggle flips visibly
  within one frame while playing and re-renders immediately while paused; (c) proxy
  preview (540p) and full-resolution export look visually consistent in smoothing degree;
  (d) white text overlay, foliage background, and fabric texture are visibly unchanged at
  default mask and strength 0.5; (e) export frame at a fixed time matches the preview frame
  at the same time; (f) the effect renders on a Compatibility-GPU tier (slower is
  acceptable); (g) on a Limited tier (no WebGPU) the Inspector "Skin Smoothing" group
  renders disabled with the explanatory label and the app does not crash.
- [ ] **T12.3** `npm run build` succeeds with strict TypeScript (no new `any`, no type
  suppressions).
- [ ] **T12.4** `npm test` succeeds; total Vitest test count is strictly greater than before
  this phase.
