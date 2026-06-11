# Design: Phase 32a — GPU Skin Smoothing

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Add a pure-WGSL beauty effect node (磨皮, skin smoothing) to the per-clip
accelerated effect chain. A single keyframable strength parameter (Phase 15)
drives an edge-preserving guided filter on BT.709 luma, gated by a tunable
BT.601 chroma skin-probability mask. Seven compute passes are encoded into the
same single `GPUCommandEncoder` the frame already uses; `queue.submit` count
per frame stays exactly 1. Proxy/adaptive preview resolution (Phase 19/Phase 2)
runs the identical pass structure at reduced radius; export runs at full
resolution. An A/B bypass toggle in the Inspector lets operators compare before
and after without losing the stored parameters.

## Why guided filter over frequency separation

Frequency separation is the natural competitor: split a clip into low and high
frequencies, smooth the low band, reconstruct. It is straightforward in 2D
convolution terms and familiar from photo retouching. Three problems rule it
out for this phase:

1. **Edge haloes.** Gaussian low-pass filters blur across strong edges (hairline,
   jaw, eyelid), so the reconstructed luma overshoots near high-contrast
   boundaries. The artefact is visible at full resolution and is why
   professional skin-retouching tools moved away from plain frequency
   separation.

2. **f16 numeric catastrophic cancellation.** Low-frequency extraction requires
   subtracting large nearby values (`I_blur − I`). At skin-tone contrast levels
   (~1e-4 normalised luma² variance) the subtraction destroys several bits of
   precision in f16 storage. Guided-filter moments (`meanY²`, `meanY·meanY`)
   have the same subtraction, which is why R3.4 mandates f32 scratch textures —
   but at least the choice is localised to two dedicated textures rather than
   infecting the entire chain.

3. **No halo by construction.** The guided filter (He et al. 2013) guarantees
   `output ≤ max(I)` and `output ≥ min(I)` within each filter window because
   the smoothed output is a linear function `a·I + b` of the input. There is no
   overshoot beyond the input range, so the gradient-reversal ("halo") artefact
   of naive frequency separation is impossible.

The guided filter's separable box-filter formulation reduces the seven-pass
pipeline to O(1) per pixel regardless of radius, which keeps the GPU cost
within the ≤ 2.5 ms/frame budget at 1080p (R3.7). No third-party WGSL
library is involved; the math fits in ~200 lines of WGSL.

## Non-goals

- **Face detection, landmarks, or geometry warps** — Phase 32b.
- **Per-face masking** — Phase 32b.
- **Automatic strength selection** — user sets strength explicitly.
- **CPU pixel-loop port for the Limited-WebCodecs tier** — the effect is
  simply unavailable there (R5.2); no silent visual mismatch claim.
- **f16 WGSL variants for the skin-smooth passes** — f32-only is correct and
  justified (see R3.4 and above).
- **New capability probes** — skin smoothing uses only capabilities already
  required by the existing effect chain.
- **Per-face masking or multi-region masks** — single global chroma mask per
  clip.

## Architecture: data flow

All GPU work lives in the pipeline worker. Main thread contributes only UI
signals (Inspector slider, bypass toggle, mask sliders) forwarded as
structured-clone-safe protocol commands; no media objects or GPU handles ever
cross into `src/ui/`.

```
pipeline worker
┌────────────────────────────────────────────────────────────────────────┐
│  compositeLayers (gpu.ts)                                              │
│                                                                        │
│  for each FrameCompositeLayer:                                         │
│    encodeSourceNormalize    → storage.a (passthrough import)           │
│    encodeBaseCorrection     → storage.b/c (brightness/contrast/sat)   │
│    encodeLut (if active)    → ping-pong                                │
│    encodeSkinSmooth ◄────── NEW, between lut-apply and opacity         │
│    │  pass 1: prepare       (linYY)     → skinScratch0 (rg32float)    │
│    │  pass 2: box-H mean    (meanY+Y²H) → skinScratch1 (rg32float)    │
│    │  pass 3: box-V mean    (meanY,meanY²) → skinScratch0             │
│    │  pass 4: coefficients  (a,b)       → skinScratch1                │
│    │  pass 5: box-H coeff   (meanAH)    → skinScratch0                │
│    │  pass 6: box-V coeff   (meanA,meanB) → skinScratch1              │
│    │  pass 7: apply         (blend)     → next ping-pong slot         │
│    encodeOpacity            → opacity scratch                         │
│    encodeTransformDirect    → transformView                           │
│    composite-over           → accumulator                             │
│                                                                        │
│  ── all encoded into ONE GPUCommandEncoder ──                          │
│  queue.submit([encoder.finish()])   // count stays exactly 1           │
└────────────────────────────────────────────────────────────────────────┘

main thread
┌────────────────────────────────────────────────────────────────────────┐
│  Inspector.tsx                                                         │
│    strength slider  ─► set-effect-param {key:'skinSmoothStrength'}    │
│    A/B toggle       ─► set-skin-smooth-bypass {bypass: boolean}       │
│    mask sliders     ─► set-skin-mask {mask: SkinMaskSnapshot}         │
└────────────────────────────────────────────────────────────────────────┘
```

## Seven-pass structure

| Pass | Input bindings | Output | WGSL file | Uniform |
|------|---------------|--------|-----------|---------|
| 1 — prepare | `src` (rgba32float/16, corrected working-linear) | `skinScratch0` rg32float (`Y`, `Y²`) | `skin-smooth-prepare.wgsl` | none |
| 2 — box-H | `skinScratch0` | `skinScratch1` rg32float | `skin-smooth-box.wgsl` | `SkinBoxUniform` (`radius`, `dirX=1`, `dirY=0`) |
| 3 — box-V | `skinScratch1` | `skinScratch0` rg32float → (`meanY`, `meanY²`) | `skin-smooth-box.wgsl` | `SkinBoxUniform` (`radius`, `dirX=0`, `dirY=1`) |
| 4 — coefficients | `skinScratch0` + `src` | `skinScratch1` rg32float (`a`, `b`) | `skin-smooth-coeffs.wgsl` | none |
| 5 — box-H | `skinScratch1` | `skinScratch0` rg32float | `skin-smooth-box.wgsl` | `SkinBoxUniform` (`radius`, `dirX=1`, `dirY=0`) |
| 6 — box-V | `skinScratch0` | `skinScratch1` rg32float → (`meanA`, `meanB`) | `skin-smooth-box.wgsl` | `SkinBoxUniform` (`radius`, `dirX=0`, `dirY=1`) |
| 7 — apply | `skinScratch1` + `src` | next ping-pong storage slot (rgba32float/16) | `skin-smooth-apply.wgsl` | `SkinApplyUniform` (per layer) |

All passes use `@workgroup_size(8, 8, 1)`, dispatch `ceil(width/8) × ceil(height/8)`,
and bounds-check every texel access using the same pattern as `saturation.wgsl`.

### WGSL uniform structs

```wgsl
// skin-smooth-box.wgsl — shared by passes 2, 3, 5, 6
// Bound at group(0) binding(0); 16 bytes, std140 compatible.
struct SkinBoxUniform {
    radius : u32,
    dirX   : u32,   // 1 for horizontal, 0 for vertical
    dirY   : u32,   // 0 for horizontal, 1 for vertical
    pad    : u32,
};

// skin-smooth-apply.wgsl — bound at group(0) binding(0); 32 bytes.
struct SkinApplyUniform {
    strength : f32,
    cbMin    : f32,
    cbMax    : f32,
    crMin    : f32,
    crMax    : f32,
    softness : f32,
    pad0     : f32,
    pad1     : f32,
};
```

The box-uniform values are frame-global (radius depends only on frame height;
direction is fixed per pass). Two `SkinBoxUniform` GPU buffers are allocated
once (H-pass and V-pass), updated with `queue.writeBuffer` before the first
skin-smooth layer in a frame, and reused for every subsequent smoothed layer.

The `SkinApplyUniform` is written once **per layer slot** (like `EffectChain`'s
existing per-slot buffers) because `queue.writeBuffer` is queue-ordered: a
single shared apply buffer would clobber earlier layers' uniforms before they
are consumed by the GPU.

### Key WGSL constants (mirrored exactly in TypeScript)

```wgsl
// skin-smooth-prepare.wgsl and skin-smooth-apply.wgsl
const LUMA_BT709   = vec3f(0.2126, 0.7152, 0.0722);
const LUMA_BT601   = vec3f(0.299,  0.587,  0.114);
const CB_SCALE     : f32 = 0.564;
const CR_SCALE     : f32 = 0.713;
const SKIN_EPSILON : f32 = 0.01;
// radius comes from the SkinBoxUniform, not a constant.
```

## Components

### `src/engine/skin-smooth.ts` (new)

Single TypeScript module with two responsibilities:

1. **Reference implementation** — pure TypeScript mirrors of every piece of
   math in the WGSL, executed on `Float32Array` RGBA data. Used exclusively
   by `skin-smooth.test.ts`; never imported on a hot path.

   ```typescript
   export const SKIN_SMOOTH_EPSILON = 0.01;
   export const LUMA_BT709 = [0.2126, 0.7152, 0.0722] as const;
   export const LUMA_BT601 = [0.299, 0.587, 0.114] as const;
   export const CB_SCALE = 0.564;
   export const CR_SCALE = 0.713;

   export interface SkinMaskParams {
     cbMin: number; cbMax: number;
     crMin: number; crMax: number;
     softness: number;
   }

   export const DEFAULT_SKIN_MASK: SkinMaskParams = {
     cbMin: -0.20, cbMax: 0.00,
     crMin:  0.05, crMax: 0.20,
     softness: 0.04,
   };

   /** Clamp/swap/finite validation — source of truth for normalizeSkinMask. */
   export function normalizeSkinMask(
     partial: Partial<SkinMaskParams> | undefined
   ): SkinMaskParams;

   /** radius = clamp(round(8 * h / 1080), 2, 24) */
   export function radiusForHeight(h: number): number;

   /**
    * Returns mask weight m ∈ [0,1] for a gamma-encoded (sRGB OETF) RGB triple.
    * band(v, lo, hi, s) = smoothstep(lo-s, lo, v) * (1 - smoothstep(hi, hi+s, v))
    */
   export function skinMaskWeight(
     rgb: readonly [number, number, number],
     mask: SkinMaskParams
   ): number;

   /**
    * Reference guided filter on luma for a single-channel Float32Array
    * (stride = width, linear light values). Returns a new Float32Array of
    * the same size with smoothed luma values.
    * Used for the golden non-overshoot and variance-reduction tests.
    */
   export function referenceGuidedFilterLuma(
     luma: Float32Array,
     width: number,
     height: number,
     radius: number,
     epsilon: number
   ): Float32Array;

   /**
    * Full seven-pass reference: RGBA Float32Array in, RGBA Float32Array out.
    * strength ∈ [0,1]; mask defaults to DEFAULT_SKIN_MASK if omitted.
    * Mirrors the exact compose: outRgb = clamp(rgbLin + strength*m*(Y'−Y), 0,1)
    */
   export function referenceSkinSmooth(
     rgba: Float32Array,
     width: number,
     height: number,
     strength: number,
     mask?: SkinMaskParams
   ): Float32Array;
   ```

2. **GPU packing helpers** — pure TypeScript packing functions for the two
   uniform structs. These are the only functions imported by `gpu.ts` and the
   worker at runtime.

   ```typescript
   /** Returns a 4-element Uint32Array: [radius, dirX, dirY, 0] */
   export function packSkinBoxUniform(
     radius: number,
     horizontal: boolean
   ): Uint32Array;

   /**
    * Returns a 8-element Float32Array: [strength, cbMin, cbMax, crMin, crMax,
    * softness, 0, 0] after normalizing mask to valid ranges.
    */
   export function packSkinApplyUniform(
     strength: number,
     mask: SkinMaskParams | undefined
   ): Float32Array;

   /** Returns true when skinSmoothStrength > 0 (bypass is session-only state,
    *  not consulted here — gpu.ts consults bypass before calling encodeSkinSmooth). */
   export function isSkinSmoothActive(params: { skinSmoothStrength: number }): boolean;
   ```

### `src/engine/shaders/skin-smooth-prepare.wgsl` (new)

Pass 1. Bindings: `@group(0) @binding(0) var src: texture_storage_2d<rgba32float, read>`,
`@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>`.
Reads linear RGB from `src`, computes `Y = dot(rgb, LUMA_BT709)`, writes `(Y, Y*Y)` to
`dst`. No uniform needed. Bounds-checked with `all(id.xy < dims)`.

### `src/engine/shaders/skin-smooth-box.wgsl` (new)

Passes 2, 3, 5, 6. Shared separable box-blur. Bindings:
`@group(0) @binding(0) var<uniform> u: SkinBoxUniform`,
`@group(0) @binding(1) var src: texture_storage_2d<rg32float, read>`,
`@group(0) @binding(2) var dst: texture_storage_2d<rg32float, write>`.
Accumulates `sum / count` over the 1-D kernel `[-radius, +radius]` in the
specified direction, clamping sample coordinates to `[0, dims-1]` (border
clamp, not wrapping). Bounds-checked on the output coordinate.

### `src/engine/shaders/skin-smooth-coeffs.wgsl` (new)

Pass 4. Bindings:
`@group(0) @binding(0) var moments: texture_storage_2d<rg32float, read>` — holds `(meanY, meanY²)`,
`@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>`.
Computes `var = max(0.0, moments.g - moments.r * moments.r)`,
`a = var / (var + SKIN_EPSILON)`,
`b = (1.0 - a) * moments.r`. Writes `(a, b)` to `dst`. No `src` texture needed
(the guided-filter self-guide uses only the moments, not the original pixels).

### `src/engine/shaders/skin-smooth-apply.wgsl` (new)

Pass 7. Bindings:
`@group(0) @binding(0) var<uniform> u: SkinApplyUniform`,
`@group(0) @binding(1) var src: texture_storage_2d<rgba32float, read>` — working-linear pixels,
`@group(0) @binding(2) var meanCoeffs: texture_storage_2d<rg32float, read>` — `(meanA, meanB)`,
`@group(0) @binding(3) var dst: texture_storage_2d<rgba32float, write>` — next ping-pong slot.

Algorithm per pixel:

```wgsl
let rgb   = textureLoad(src, coord).rgb;
let Y     = dot(rgb, LUMA_BT709);
let ab    = textureLoad(meanCoeffs, coord);
let Yprime = ab.r * Y + ab.g;            // guided-filter output luma
// Chroma mask — gamma-encode first, then compute Cb/Cr
let rgbG  = linear_to_srgb(rgb);        // sRGB OETF, per-channel
let Y601  = dot(rgbG, LUMA_BT601);
let Cb    = (rgbG.b - Y601) * CB_SCALE;
let Cr    = (rgbG.r - Y601) * CR_SCALE;
let m     = band(Cb, u.cbMin, u.cbMax, u.softness)
          * band(Cr, u.crMin, u.crMax, u.softness);
let outRgb = clamp(rgb + u.strength * m * (Yprime - Y), vec3f(0.0), vec3f(1.0));
textureStore(dst, coord, vec4f(outRgb, alpha));
```

`band(v, lo, hi, s)` is inlined as
`smoothstep(lo-s, lo, v) * (1.0 - smoothstep(hi, hi+s, v))`.

The f16 chain variant reads `rgba16float` source; the write target format
follows the same ping-pong selection logic. Because the intermediate scratch
textures are always `rg32float`, no f16 WGSL variant of the skin-smooth passes
is required or produced (R3.4).

### `src/engine/effects.ts` (extended)

- Add `skinSmoothStrength: number` to `ClipEffectParams` interface and
  `DEFAULT_CLIP_EFFECTS` (value `0`).
- Extend `normalizeClipEffects` to fill/clamp the new field.
- Add `isSkinSmoothActive(params: ClipEffectParams): boolean`.
- Extend `clipEffectsEqual` to compare the new field.
- `packEffectUniform` is **not** extended — skin-smooth packs its own uniforms
  via `packSkinBoxUniform` / `packSkinApplyUniform` in `skin-smooth.ts`.

### `src/engine/keyframes.ts` (extended)

- Add `'skinSmoothStrength'` to `EFFECT_PARAM_KEYS`.
- No other change — `isEffectKeyframeParam`, `sampleClipParamsAt`,
  `set-keyframe`/`set-keyframes`/`delete-keyframe` all work without further
  modification.

### `src/engine/colour.ts` (extended)

- Add `'skin-smooth'` to `ColorPipelineStage` union.
- Insert `'skin-smooth'` into `PIPELINE_ORDER` between `'lut-apply'` and
  `'opacity'`. The array grows from 7 to 8 elements.
- Update the `colour.test.ts` stage-count assertion from 7 to 8.

### `src/engine/gpu.ts` (extended)

#### New fields on `PreviewRenderer`

```typescript
// Scratch textures for guided-filter intermediates.
// Allocated lazily on first smoothed frame; reallocated on resize; destroyed
// on destroy(). Both are rg32float regardless of the f16/f32 chain variant.
private skinScratch0: GPUTexture | null = null;
private skinScratch1: GPUTexture | null = null;
private skinScratch0View: GPUTextureView | null = null;
private skinScratch1View: GPUTextureView | null = null;

// Frame-level box-pass uniform buffers (H and V).
// Allocated once; updated every frame that has ≥1 smoothed layer.
private skinBoxUniformH: GPUBuffer | null = null;
private skinBoxUniformV: GPUBuffer | null = null;

// Per-layer-slot apply-pass uniform buffers (grown on demand, same pattern
// as EffectChain's per-slot buffers).
private skinApplyUniforms: GPUBuffer[] = [];

// Compiled pipelines for the 4 distinct skin-smooth shaders.
private skinPreparePipeline: GPUComputePipeline | null = null;
private skinBoxPipeline: GPUComputePipeline | null = null;
private skinCoeffsPipeline: GPUComputePipeline | null = null;
private skinApplyPipeline: GPUComputePipeline | null = null;
```

#### `encodeSkinSmooth` (new private method)

```typescript
private encodeSkinSmooth(
  encoder: GPUCommandEncoder,
  srcView: GPUTextureView,         // working-linear RGBA (corrected+lut output)
  dstView: GPUTextureView,         // next ping-pong storage slot (non-aliasing)
  strength: number,
  mask: SkinMaskSnapshot | undefined,
  slot: number,
  wgX: number,
  wgY: number
): void
```

Called from `processLayer` in `compositeLayers` when
`isSkinSmoothActive(layer.effects)` is true and the per-clip bypass flag is
not set. Encodes all seven passes into `encoder`. The scratch textures are
lazily created (or verified size-correct) inside this method.

#### Scratch-texture lifecycle

1. **First smoothed frame**: create `skinScratch0` and `skinScratch1` at
   `(this.width, this.height)` with `usage: STORAGE_BINDING | TEXTURE_BINDING`.
   Format: `rg32float` for both.
2. **Resize** (`setSize` call): destroy both textures (`.destroy()`) and set
   pointers to `null`. They are re-created lazily at the new size on the next
   smoothed frame.
3. **All frames with zero smoothed layers**: do not allocate or touch the
   scratch textures.
4. **`destroy()`**: destroy all four skin-related GPU resources
   (`skinScratch0`, `skinScratch1`, `skinBoxUniformH`, `skinBoxUniformV`,
   plus each buffer in `skinApplyUniforms`).

#### Placement in `processLayer`

```
encodeSourceNormalize   → storage.a
encodeBaseCorrection    → storage.b/c
encodeLut (if active)   → ping-pong
encodeSkinSmooth ◄──── NEW: reads lutView, writes next non-aliasing slot
encodeOpacity           → opacity scratch
encodeTransformDirect   → transformView
```

The destination for pass 7 (`dstView`) is chosen with the same non-aliasing
rule the LUT stage uses:

```typescript
const skinDst =
  lutView === storage.a ? storage.b :
  lutView === storage.b ? storage.c : storage.a;
```

After `encodeSkinSmooth`, `skinDst` is passed as `lutView` to `encodeOpacity`.
This preserves the `blendDst` aliasing invariant documented in `gpu.ts` §568:
no skin-smooth pass writes `storage.a` after the layer's transform pass in
the same frame.

### `src/protocol.ts` (extended)

#### New snapshot type

```typescript
export interface SkinMaskSnapshot {
  cbMin: number;
  cbMax: number;
  crMin: number;
  crMax: number;
  softness: number;
}
```

#### Extended `ClipEffectParamsSnapshot`

Add `skinSmoothStrength: number` (mirrors `ClipEffectParams`).

#### Extended `TimelineClipSnapshot`

Add `skinMask?: SkinMaskSnapshot` alongside `lut?: ClipLutSnapshot`.

#### New commands (added to `WorkerCommand` union)

```typescript
| { type: 'set-skin-mask'; trackId: string; clipId: string; mask: SkinMaskSnapshot }
| { type: 'set-skin-smooth-bypass'; trackId: string; clipId: string; bypass: boolean }
```

Both are structured-clone-safe (plain numbers, no handles).

### `src/engine/timeline.ts` (extended)

- `TimelineClip` internal model gains `skinMask?: SkinMaskParams` (same fields
  as `SkinMaskSnapshot`, stored normalized).
- `splitClip`: both halves carry `skinMask` (identical to the pre-split clip).
- `cloneClip` / copy-paste / duplicate: carry `skinMask`.
- Worker handler for `set-skin-mask`: normalize the incoming `SkinMaskSnapshot`
  with `normalizeSkinMask`, store, snapshot, push to undo history (Phase 9
  pattern).
- Worker handler for `set-skin-smooth-bypass`: store in a `Map<clipId, boolean>`
  session-only bypass store (not part of `TimelineClip`; not serialised);
  re-render the current paused frame if paused (same pattern as
  `set-effect-param` while paused).

### `src/engine/worker.ts` (extended)

- Dispatch `set-skin-mask` and `set-skin-smooth-bypass` commands.
- Pass `skinMask` and bypass flag into the layer struct fed to `compositeLayers`
  (the `FrameCompositeLayer` gains `skinMask?: SkinMaskSnapshot` and
  `skinSmoothBypass?: boolean`).

### `src/engine/project.ts` (extended)

- Bump `PROJECT_SCHEMA_VERSION` from 10 to the next unused version (v11 is
  claimed by the open Phase 46 PR #63; write "bump to the next unused version
  after 10 at implementation time" — do not hardcode 11 here).
- Migration: when reading a document at any prior version, set
  `skinSmoothStrength = 0` in all clips and leave `skinMask` absent.
- Round-trip: persist `skinSmoothStrength`, its keyframe track (via existing
  `cloneClipKeyframes`/`parseClipKeyframes`), and `skinMask` sidecar into
  `project.json`.
- Invalid persisted mask values are normalized via `normalizeSkinMask`, not
  rejected.

### `src/ui/Inspector.tsx` (extended)

Adds a "Skin Smoothing" group in the per-clip effects section for video
clips. Rendering is conditional on the selected clip being a video source
clip (not a title clip).

#### Strength row

- `<input type="range" min="0" max="1" step="0.01">` wired to the existing
  debounced `scheduleParam` machinery and `set-effect-param` (key
  `'skinSmoothStrength'`).
- Keyframe diamond button and previous/next navigation — identical affordance
  to the existing effect sliders (re-use existing pattern from brightness
  slider).
- Label: "Smoothing".

#### A/B bypass toggle

- `<button aria-pressed={bypass()} ...>` with visible pressed-state styling.
- Label: "A/B Bypass".
- `aria-label`: "Bypass skin smoothing (A/B)".
- Enabled only when `skinSmoothStrength() > 0` or a strength keyframe track
  exists for the selected clip.
- Sends `set-skin-smooth-bypass` on click.
- Short inline note below the button: "Bypass affects preview only — export
  always uses stored strength."
- Session-only: cleared on project load/restore (the worker drops it there;
  the UI reads it from the worker's timeline state mirror).

**Design choice — toggle not press-and-hold:** a press-and-hold bypass
(momentary) is common in hardware monitoring but uncommon in web UIs and
requires pointer-capture logic that complicates keyboard access. A stateful
toggle matches how every other Inspector control works, is keyboard operable
with a single Space/Enter keypress, and its state is visible in the `aria-pressed`
attribute and visual styling without any additional disclosure. Operators who
want a quick A/B comparison can toggle twice.

#### "Skin mask" disclosure

A `<details>` element (collapsed by default) labelled "Skin mask (advanced)".
Contains:

| Slider | Range | Step | Label |
|--------|-------|------|-------|
| `cbMin` | −0.5 → 0.5 | 0.01 | "Cb min" |
| `cbMax` | −0.5 → 0.5 | 0.01 | "Cb max" |
| `crMin` | −0.5 → 0.5 | 0.01 | "Cr min" |
| `crMax` | −0.5 → 0.5 | 0.01 | "Cr max" |
| `softness` | 0.005 → 0.15 | 0.005 | "Softness" |

Each slider sends `set-skin-mask` on change (debounced). A "Reset mask"
button sends `set-skin-mask` with `DEFAULT_SKIN_MASK` values, clearing the
sidecar.

All mask controls are within the same "Skin Smoothing" collapsible group in
the Inspector; they are visible (not hidden) but the `<details>` is closed by
default so they do not clutter the common-case one-slider workflow.

#### Non-WebGPU tier

On any tier where the effect chain is unavailable the entire "Skin Smoothing"
group renders with `aria-disabled="true"` and a descriptive note:
"Requires GPU effects (accelerated tier)." No controls are interactive.

## Persistence / schema

`skinSmoothStrength` and its keyframe track ride `project.json` inside the
clip's `effects` and `keyframes` fields, respectively — no new bundle asset
kind, no manifest change. `skinMask` is stored as an optional plain-object
field on the clip in `project.json`, parallel to `lut`. Bundle export →
import round-trips both fields via the opaque `project.json` payload (Phase 23
bundle layer is unaware of clip internals).

Phase 48 OTIO export carries `skinSmoothStrength` and `skinMask` inside the
`metadata.localcut` clip-effects payload automatically; no `.otio` schema
work is required beyond the existing pass-through.

Schema version bump: implementation must write "bump `PROJECT_SCHEMA_VERSION`
to the next unused version after 10" rather than hardcoding 11, because the
Phase 46 PR (#63) claims v11 and may or may not be merged first.

## Third-party additions

No new runtime dependencies. All math is hand-written WGSL and TypeScript.
The guided-filter algorithm is from the public literature (He, Sun, Tang 2013)
and requires no library.

## Validation

### Unit tests (Vitest, Node environment, co-located)

**`src/engine/skin-smooth.test.ts`** (new):

- *Mask classification (R2.4):* `skinMaskWeight` ≥ 0.9 for light skin
  `(0.96, 0.76, 0.65)` and deep skin `(0.45, 0.27, 0.20)`;
  exactly 0 for white `(1,1,1)`, black `(0,0,0)`, grey `(0.5,0.5,0.5)`,
  foliage green `(0.13, 0.55, 0.13)`, fabric blue `(0.2, 0.3, 0.8)`,
  saturated red `(1, 0, 0)`.
- *`normalizeSkinMask`:* cb/cr bounds clamped to [−0.5, 0.5]; `softness`
  clamped to [0.005, 0.15]; when min > max after clamping the pair is
  swapped; non-finite values fall back to the default for that field.
- *`radiusForHeight`:* returns 4 at h=540, 8 at h=1080, 16 at h=2160;
  returns 2 at h=0 (lower clamp), 24 at h=3600 (upper clamp).
- *Guided-filter reference — constant image:*
  a 16×16 patch of constant luma 0.5 passes through `referenceGuidedFilterLuma`
  unchanged (max absolute error ≤ 1e-6).
- *Guided-filter reference — noise reduction:*
  a 32×32 flat patch with ±0.05 uniform noise has output variance ≤ 0.35×
  input variance at radius 4 (smoothing removes most noise without flattening
  to zero).
- *Guided-filter reference — no overshoot (no halo):*
  a 1-D ramp from 0.1 to 0.9 embedded in a 16×16 image stays monotone; no
  output sample is below `min(input) − 1e-6` or above `max(input) + 1e-6`.
- *Golden non-skin invariance:*
  construct a 64×64 RGBA `Float32Array` with four 32×32 quadrants:
  Q0 = noisy skin-tone `(0.96, 0.76, 0.65) ± 0.03` (gamma-encoded, then
  linear for pipeline input), Q1 = black-on-white text pattern `(0,0,0)` and
  `(1,1,1)`, Q2 = foliage green checker `(0.13, 0.55, 0.13)` / `(0.2, 0.6, 0.2)`,
  Q3 = fabric blue weave `(0.2, 0.3, 0.8)` / `(0.15, 0.25, 0.75)`.
  Run `referenceSkinSmooth` at default mask, `strength = 0.5`.
  Assert: Q1, Q2, Q3 pixels are **bit-identical** to the input (mask weight
  must be 0.0 for all of them). Assert: Q0 luma variance drops ≥ 50%.
- *Strength 0 and bypass:* `referenceSkinSmooth` at `strength = 0` returns
  bit-identical RGBA to the input.
- *Uniform packing:*
  `packSkinBoxUniform(8, true)` returns `[8, 1, 0, 0]`;
  `packSkinApplyUniform(0.7, DEFAULT_SKIN_MASK)` encodes fields in the correct
  byte offsets as Float32 values.
- *WGSL/TS constant sync:* import each `skin-smooth-*.wgsl` via `?raw` and
  assert the literal numeric strings `0.2126`, `0.7152`, `0.0722` (LUMA_BT709),
  `0.299`, `0.587`, `0.114` (LUMA_BT601), `0.564`, `0.713`, `0.01` appear in
  the relevant shader source verbatim.

**`src/engine/effects.test.ts`** (extended):

- `DEFAULT_CLIP_EFFECTS.skinSmoothStrength === 0`.
- `normalizeClipEffects({})` fills `skinSmoothStrength: 0`.
- `normalizeClipEffects({ skinSmoothStrength: 1.5 })` clamps to 1.
- `normalizeClipEffects({ skinSmoothStrength: -0.1 })` clamps to 0.
- `normalizeClipEffects({ skinSmoothStrength: NaN })` falls back to 0.
- `isSkinSmoothActive({ ...DEFAULT_CLIP_EFFECTS })` returns `false`.
- `isSkinSmoothActive({ ...DEFAULT_CLIP_EFFECTS, skinSmoothStrength: 0.5 })` returns `true`.
- `clipEffectsEqual` distinguishes differing `skinSmoothStrength` values.

**`src/engine/keyframes.test.ts`** (extended):

- `'skinSmoothStrength'` is recognised by `isEffectKeyframeParam`.
- `sampleClipParamsAt` returns the interpolated `skinSmoothStrength` at a
  keyframed time.
- Preview and export receive the identical sampled value for the same clip at
  the same timeline time.

**`src/engine/timeline.test.ts`** (extended):

- `splitClip` carries `skinMask` on both halves.
- Copy/paste and duplicate carry `skinMask`.

**`src/engine/project.test.ts`** (extended):

- Parsing a v10 document sets `skinSmoothStrength = 0` on all clips and
  leaves `skinMask` absent.
- A v11 (or next-version) round-trip preserves `skinSmoothStrength`, its
  keyframe track, and `skinMask`.
- Malformed mask (out-of-range, non-finite) is normalised on load, not
  rejected.

**`src/engine/project-bundle/project-bundle.test.ts`** (extended):

- Bundle export then import round-trips `skinSmoothStrength`, its keyframe
  track, and `skinMask` exactly.

**`src/engine/gpu.test.ts`** (extended):

- With one `strength = 0.5` frame layer: renderer issues exactly **1**
  `queue.submit` and exactly **7** additional compute passes (passes above
  the non-skin baseline).
- With `strength = 0` or bypass: **0** additional compute passes, still 1
  submit.
- With two smoothed layers: **14** additional compute passes, still 1 submit.
- Scratch textures `skinScratch0` / `skinScratch1` are created lazily on the
  first smoothed frame; a second smoothed frame in the same session reuses
  them (no extra `createTexture` calls).
- Calling `destroy()` destroys the scratch textures and all skin-related
  GPU buffers.

**Protocol type guards** (inline in the relevant test files or in a dedicated
`protocol.test.ts`): `set-skin-mask` and `set-skin-smooth-bypass` commands
are structurally valid discriminated-union members.

### Manual smoke checklist (recorded in tasks)

1. **Realtime performance**: one smoothed 1080p layer on the accelerated tier
   shows ≤ 2.5 ms/frame added GPU time via the existing timestamp-query
   readout in diagnostics; no sustained dropped-frame regression.
2. **A/B toggle**: toggling bypass while playing causes a visible change within
   one frame; toggling while paused causes immediate re-render. Export ignores
   the bypass flag entirely.
3. **Proxy visual consistency**: preview at proxy resolution (540p) and export
   at 1080p look visually consistent in the degree of smoothing.
4. **Non-skin regions untouched**: at default mask and strength 0.5, white text
   overlay, foliage, and fabric are visually unchanged.
5. **Export parity**: exported frame at a fixed time matches the preview frame
   at the same time (no separate implementation).
6. **Compatibility-GPU tier**: effect renders (slower than Accelerated is
   acceptable); the Inspector control is enabled and functional.
7. **Limited tier (no WebGPU)**: the Inspector "Skin Smoothing" group renders
   disabled with the "Requires GPU effects (accelerated tier)" label; the app
   does not crash; export runs without skin smoothing applied.
