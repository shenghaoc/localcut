# Design: Phase 38 — Look Packs and Animated Overlays

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Phase 38 adds film-emulation look presets (38a) and animated/Lottie overlay
sources (38b) to LocalCut Studio. Both halves build on established
infrastructure — they extend rather than replace. 38a extends the P15/P21
effect chain with three new WGSL passes and a portable JSON preset format.
38b extends the P11/P12 media-import and compositor paths with animated image
decoding and Lottie rasterisation. Either half can ship before the other.

## Non-goals

- Asset marketplace, hosted look catalogue, or cloud LUT library.
- After Effects expression evaluation or audio-reactive effects.
- `.lottie` zip container import (v1 supports plain `.json` only; see the
  Lottie decision section below for the rationale).
- In-app preset library or preset management UI beyond apply/export.
- Subtitle/caption animated effects.
- Any server-side media processing, accounts, or telemetry.

---

## 38a: Looks

### Why three new passes, not a generic "film grain plugin"

The three passes (grain, halation, vignette) are the minimal set that produces
a convincing film emulation when composed with an existing LUT. They operate on
GPU-resident textures, skip at zero strength (exactly like the P4 brightness-
contrast pattern), and require no new GPU resource types. Adding them as first-
class effect IDs in `EFFECT_REGISTRY` means they are keyframeable, snapshotted,
and serialised for free by the existing machinery.

### Pipeline order rationale

```
decode → colour grade (B/C/Sat/Temp) → clip LUT → halation → grain → vignette
```

- **Halation before grain**: halation is a lens/optical effect that occurs during
  exposure; the bright halos are part of the image before grain is deposited.
  Applying halation first lets grain sit on top of the glow, which matches
  real film physics and looks correct.
- **Grain before vignette**: grain should fall off toward the edges along with
  the vignette, not be uniform under a darkened edge. Applying the radial
  falloff last achieves this naturally without extra blending work.
- **All three after the LUT**: the clip LUT maps the colour grade result into
  the desired colour space / look; grain and halation are then applied as
  physical artefacts on top of that graded image. Applying them before the LUT
  would bake them into the LUT's input and produce incorrect results if the
  user changes LUT strength.
- **Consequence**: this order is fixed and not user-configurable. A code comment
  on `encodeFilmLooks` (the new aggregator function in `effects.ts`) states it
  explicitly.

### Architecture: effect chain extension

No new GPU resource type is needed. The new passes join the ping-pong storage
(`StoragePingPong` in `src/engine/effects.ts`) already used by base correction
and the LUT. The call flow in `gpu.ts` extends the existing `encodeColourChain`
(or its split-stage successors) with a tail call to `encodeFilmLooks`:

```
GPU command encoder (one per frame, single queue.submit):
  encodeColourImport(encoder, frame, storage)         ← existing P4
  encodeBaseCorrection(encoder, src, storage, params) ← existing P4
  encodeLut(encoder, src, storage, lut, params)       ← existing P15
  encodeFilmLooks(encoder, src, storage, params)      ← NEW
    └─ encodeHalation  (skipped if radius = 0)
    └─ encodeGrain     (skipped if strength = 0)
    └─ encodeVignette  (skipped if amount = 0)
```

All passes share the same `wgX / wgY` workgroup dimensions. The `slot` parameter
is forwarded so multi-layer frames each use their own uniform buffers.

### Components: 38a

#### `src/engine/effects.ts` (extended)

Add to `ClipEffectParams`:
```typescript
// Film-look params (Phase 38a). All default to neutral (pass skipped at zero).
grainStrength: number;        // 0–1, default 0
grainSize: number;            // 0.5–4.0, default 1.0
halationThreshold: number;    // 0–1, default 0.75
halationRadius: number;       // 0–64 px integer, default 0
halationTintR: number;        // 0–1, default 1.0
halationTintG: number;        // 0–1, default 0.3
halationTintB: number;        // 0–1, default 0.1
vignetteAmount: number;       // 0–1, default 0
vignetteFeather: number;      // 0–1, default 0.5
vignetteRoundness: number;    // 0–2, default 1.0
```

Add to `DEFAULT_CLIP_EFFECTS`. Extend `normalizeClipEffects`, `clipEffectsEqual`.

New active-check helpers (same pattern as `isBrightnessContrastActive`):
```typescript
function isGrainActive(params: ClipEffectParams): boolean
function isHalationActive(params: ClipEffectParams): boolean
function isVignetteActive(params: ClipEffectParams): boolean
```

New aggregator (skips all three if all params are neutral):
```typescript
function encodeFilmLooks(
  encoder: GPUCommandEncoder,
  srcView: GPUTextureView,
  storage: StoragePingPong,
  width: number,
  height: number,
  params: ClipEffectParams,
  slot: number,
  frameTimeSeed: number
): GPUTextureView
```

Extend `EffectId` union: `'grain' | 'halation' | 'vignette'` added.
Add corresponding `EffectRegistryEntry` entries with new WGSL modules.
Extend `packEffectUniform` / `EFFECT_IDS` accordingly.

#### `src/engine/shaders/grain.wgsl` and `grain.f16.wgsl`

Hash-noise grain shader. Uniform layout (16-byte aligned):
- `offset 0`: `strength: f32`
- `offset 4`: `size: f32`  
- `offset 8`: `frameTimeSeed: f32`
- `offset 12`: `_pad: f32`

Noise function: a 2-component hash derived from `vec2f(floor(xy / size), seed)`,
e.g. `fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453)`. This generates
a deterministic but visually random pattern per pixel per frame seed without
any texture lookup. `grainStrength` linearly blends between the original colour
and the grained result (`mix(colour, grained, strength)`).

#### `src/engine/shaders/halation.wgsl` and `halation.f16.wgsl`

Bright-pass + separable blur + screen-blend pass. Uniform layout (32-byte aligned):
- `offset 0`: `threshold: f32`
- `offset 4`: `radius: i32`
- `offset 8`: `tintR: f32`
- `offset 12`: `tintG: f32`
- `offset 16`: `tintB: f32`
- `offset 20–28`: `_pad[3]: f32`

Two-pass separable Gaussian (horizontal then vertical) on the bright-pass mask,
using the existing ping-pong storage views. Screen-blend equation:
`result = 1 − (1 − base) × (1 − glow)`. The tint is applied to the glow
before blending.

#### `src/engine/shaders/vignette.wgsl` and `vignette.f16.wgsl`

Radial falloff shader. Uniform layout (16-byte aligned):
- `offset 0`: `amount: f32`
- `offset 4`: `feather: f32`
- `offset 8`: `roundness: f32`
- `offset 12`: `_pad: f32`

NDC coordinates centred at (0,0). Ellipse metric: `len = pow(|x|^roundness + |y|^roundness, 1/roundness)` normalised to the shorter half-dimension. `falloff = smoothstep(1.0 − feather, 1.0, len)`. Multiply RGB by `1 − amount × falloff`. Alpha unchanged.

#### `src/engine/keyframes.ts` (extended)

Add to `EFFECT_PARAM_KEYS`:
```
'grainStrength' | 'grainSize' | 'halationThreshold' | 'halationRadius' |
'halationTintR' | 'halationTintG' | 'halationTintB' |
'vignetteAmount' | 'vignetteFeather' | 'vignetteRoundness'
```

No other changes; `sampleClipParamsAt` already handles `ClipEffectParams`
keys generically.

#### `src/engine/look-preset.ts` (new)

```typescript
export interface LookParams {
  grainStrength: number;
  grainSize: number;
  halationThreshold: number;
  halationRadius: number;
  halationTintR: number;
  halationTintG: number;
  halationTintB: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteRoundness: number;
}

export interface LookPresetLutRef {
  fileName: string;
  fingerprint: string;  // SHA-256 hex, for user reference only — not re-validated on apply
}

export interface LookPreset {
  lookSchemaVersion: 1;
  name: string;
  params: LookParams;
  lut?: LookPresetLutRef;
}

export function parseLookPreset(json: unknown): LookPreset | null
export function serializeLookPreset(preset: LookPreset): string
export function applyLookPresetToClip(preset: LookPreset, clip: TimelineClip): TimelineClip
export function defaultLookParams(): LookParams
export function isLookParamsNeutral(params: LookParams): boolean
```

`parseLookPreset` uses the same hand-rolled validation helpers as `project.ts`
(`isRecord`, `requiredString`, `finiteNumber`). Out-of-range values are clamped
to their declared ranges after validation rather than rejected, because preset
files authored by external tools may use slightly different ranges. The
`fingerprint` in the LUT ref is informational; the actual LUT file must be
supplied separately.

#### `src/protocol.ts` (extended)

```typescript
// 38a look-preset commands
interface ImportLookPresetCommand {
  type: 'import-look-preset';
  trackId: string;
  clipId: string;
  presetFile: File;
  lutFile?: File;  // optional accompanying .cube, routed through existing import-lut path
}

interface ExportLookPresetCommand {
  type: 'export-look-preset';
  trackId: string;
  clipId: string;
}

// 38a look-preset worker state messages
type LookPresetExportedMessage = {
  type: 'look-preset-exported';
  clipId: string;
  json: string;
  lutFileName?: string;
};
type LookPresetErrorMessage = {
  type: 'look-preset-error';
  clipId: string;
  reason: string;
};
```

These follow the existing kebab-case `{domain}-{verb}` naming convention.

#### `src/ui/Inspector.tsx` (extended)

New **"Look"** section below the LUT section:
- Sliders for `grainStrength`, `grainSize`, `halationThreshold`,
  `halationRadius`, tint RGB (compact three-component row), `vignetteAmount`,
  `vignetteFeather`, `vignetteRoundness`.
- Section collapsed (hidden) when `isLookParamsNeutral(clip.effects)`.
- **"Apply Look Preset…"** button: triggers a file-picker (`.json`), reads
  the file, posts `import-look-preset` command. If the preset references a LUT,
  a second file-picker opens for the `.cube` file.
- **"Export Look Preset…"** button (shown when any look param is non-default):
  posts `export-look-preset`; on `look-preset-exported` saves the JSON via
  blob download.
- No media objects or GPU handles in `src/ui/`.

### Look preset persistence and bundle

Presets are user-managed files — they are never stored in `ProjectDoc` or IDB.
`ClipEffectParams` already rides in `ProjectDoc.timeline` and is therefore
serialised in the bundle's `project.json` automatically. The look params are
just more fields on the existing object. The LUT file is bundled under
`assets/luts/` via the existing `import-lut` code path when the user supplies
it at import time.

---

## 38b: Overlays

### `AnimatedImageFrameSource` — why `ImageDecoder`, not full file buffering

`ImageDecoder` streams individual frames on demand and provides per-frame
`duration` metadata. Decoding the entire animated GIF/WebP/AVIF into
`VideoFrame`s up front would buffer gigabytes for long animations. The LRU
cache of 8 frames keeps memory bounded while keeping seek fast for the common
case (sequential playback).

### Architecture: animated image import path

```
File (animated WebP/AVIF/GIF)
  ↓ mediabunny-adapter.ts: isImageFile() == true
  ↓ capability-probe: imageDecoder === 'supported'?
  ├─ YES → AnimatedImageFrameSource(file.stream())
  └─ NO  → StillFrameSource (first frame, "static (browser limitation)" badge)
```

`AnimatedImageFrameSource` is constructed with a `ReadableStream` of the file
bytes. `ImageDecoder` is constructed with `{ data: stream, type: mimeType }`.
Frame decoding is lazy: only frames required by `frameAt(time)` are decoded.

### Lottie decision: lottie-web with OffscreenCanvas, explicit fallback

Two candidate libraries exist:
1. **lottie-web** (Airbnb, actively maintained, MIT): has a canvas renderer that
   operates on a 2D `CanvasRenderingContext2D`. `OffscreenCanvas` supports 2D
   context in Chromium and Safari 26+, making it usable in the pipeline worker.
2. **@lottiefiles/lottie-player** (LottieFiles, active, MIT): primarily a
   web-component; its headless API is less documented.

**Decision: lottie-web.** Organisational backing (Airbnb), 29k GitHub stars,
active maintenance, and the canonical headless use case is documented in the
community. The canvas renderer does not require the DOM when given an
`OffscreenCanvas`.

**Primary path**: construct an `OffscreenCanvas` in the pipeline worker; pass it
to `lottie.loadAnimation({ renderer: 'canvas', rendererSettings: { context: offscreenCtx } })`.
Call `goToAndStop(frameIndex, true)` to seek to a frame; call
`createImageBitmap(offscreenCanvas)` to obtain the raster; wrap as `VideoFrame`.
This keeps all rasterisation in the worker (hard gate 1 satisfied).

**Fallback decision tree** (to be executed by the implementer at T4.2 if lottie-web
canvas renderer surfaces a DOM dependency in the worker): rasterise frames on
**main at import time** into a fixed-length frame strip stored as a
`GPUTexture` array (not a per-frame VideoFrame sequence). This is an **edit-time
cost** (import is slow for long animations), not a per-frame cost, so hard gate 1
still holds. The frame strip is bounded to `min(lottie.totalFrames, 300)` frames
at most (10 s at 30 fps); longer animations are clamped with a user warning. The
implementer documents which path was taken in a code comment in `lottie-source.ts`.

**`.lottie` zip non-goal**: the `.lottie` format is a zip of a JSON animation
plus assets. Supporting it would require a zip library (fflate or similar),
adding a dependency for an optional feature. Plain `.json` covers the common
Lottie export from After Effects, LottieFiles, and other tools. This is stated
explicitly in the adapter rejection message so users know the workaround.

### Architecture: Lottie import path

```
File (.json with {"v":…,"layers":…} sniff)
  ↓ mediabunny-adapter.ts: isLottieFile() == true
  ↓ LottieFrameSource constructed with ArrayBuffer of file content
  ↓ kind: 'image', mimeType: 'application/lottie+json' (internal tag)
  ↓ duration = lottie.totalFrames / lottie.frameRate
```

The `isLottieFile` function reads the first 512 bytes of the file as text and
checks for both `"v":` and `"layers"`. This is the same sniff used by the
lottie-web ecosystem to detect Lottie JSON.

### Architecture: alpha video compositing

The P12 compositor (`composite-over.wgsl`) already uses premultiplied-alpha
over-blend. When `importExternalTexture` is called with a `VideoFrame` that
carries alpha data, the texture's alpha is available in the shader. However, the
`VideoFrame` constructor option `alpha: 'keep'` must be set at decode time to
preserve the channel. The existing `WebCodecsVideoDecoder` in
`src/engine/webcodecs-decoder.ts` does not currently pass `alpha: 'keep'`; this
must be added.

Blend equation used by `composite-over.wgsl` (documented for reference):
```
result.rgb = over.rgb + under.rgb × (1 − over.a)
result.a   = over.a  + under.a   × (1 − over.a)
```
Both inputs are premultiplied. Overlay layers use this same equation because all
layers pass through the same compositor; no special handling is required.

### Components: 38b

#### `src/engine/animated-image-source.ts` (new)

```typescript
export class AnimatedImageFrameSource implements VideoFrameProvider {
  constructor(stream: ReadableStream<Uint8Array>, mimeType: string)
  frameAt(time: number): Promise<DecodedFrame | null>
  reset(): void
  dispose(): void
}
```

Internal state:
- `decoder: ImageDecoder` — constructed in the constructor; `data` is the stream.
- `frameDurations: number[]` — populated lazily from the first accessed frame
  batch; used for index computation.
- `lruCache: Map<number, VideoFrame>` — insertion-order LRU, max 8 entries; on
  eviction the `VideoFrame` is `.close()`d.
- `frameCount: number` and `repetitionCount: number` — read from
  `decoder.tracks[0]` after the first `decode()` resolves.

Frame index computation:
```typescript
function timeToFrameIndex(time: number, frameDurations: number[], repetitionCount: number): number {
  const totalDuration = frameDurations.reduce((a, b) => a + b, 0);
  const loopedTime = repetitionCount === 0
    ? time % totalDuration
    : Math.min(time, totalDuration * repetitionCount);
  // accumulate durations to find the index
}
```

#### `src/engine/lottie-source.ts` (new)

```typescript
export class LottieFrameSource implements VideoFrameProvider {
  constructor(data: ArrayBuffer, outputWidth: number, outputHeight: number)
  frameAt(time: number): Promise<DecodedFrame | null>
  reset(): void
  dispose(): void
}
```

Cache key type: `string` of the form `"${frameIndex}:${outputWidth}x${outputHeight}"`.
Content hash is the SHA-256 of `data`, computed once in the constructor via
`crypto.subtle.digest` and used only in diagnostics/logging — the cache lives
per-instance so hash-based deduplication across instances is not needed.

`frameAt(t)`:
```typescript
const frameIndex = Math.floor(t * this.animation.frameRate);
const clampedIndex = frameIndex % this.animation.totalFrames;
const cacheKey = `${clampedIndex}:${this.outputWidth}x${this.outputHeight}`;
// LRU lookup → miss → goToAndStop → createImageBitmap → VideoFrame
```

#### `src/engine/capability-probe-v2.ts` (extended)

Add to `CapabilityProbeResult`:
```typescript
imageDecoder: FeatureSupport;
```

Probe:
```typescript
function probeImageDecoder(): FeatureSupport {
  return typeof (globalThis as unknown as Record<string, unknown>)['ImageDecoder'] === 'function'
    ? 'supported'
    : 'unsupported';
}
```

Add the field to both `CapabilityProbeResult` in `src/protocol.ts` and the
return value of `probeCapabilities()` in `src/engine/capability-probe-v2.ts`.

#### `src/engine/media-adapters/mediabunny-adapter.ts` (extended)

```typescript
function isLottieFile(file: File, firstBytes: string): boolean {
  return (file.name.endsWith('.json') || file.type === 'application/json') &&
    firstBytes.includes('"v":') && firstBytes.includes('"layers"');
}
```

The `firstBytes` string is sliced from an `ArrayBuffer` read of the first 512
bytes. Only `.json` extension is accepted; `.lottie` extension triggers the
user-facing rejection (R4.7).

The adapter's `open()` method gains a branch:
1. If `isLottieFile` → construct `LottieFrameSource` and return a
   `MediaInputHandle` with `kind: 'image'`, duration from the animation, and
   a `mimeType` of `'application/lottie+json'` (internal tag only).
2. Else if `isImageFile` and `imageDecoderSupported` → construct
   `AnimatedImageFrameSource` from `file.stream()` and the MIME type.
3. Else → existing path (still or video).

#### `src/engine/webcodecs-decoder.ts` (extended)

`WebCodecsVideoDecoder.configure()` adds `alpha: 'keep'` to the
`VideoDecoderConfig` when the codec string contains `vp09` or `av01`. This is a
no-op for codecs that do not carry alpha and for browsers that ignore the field.

#### `src/ui/MediaBin.tsx` (extended)

- Animated images: when `asset.kind === 'image'` and `asset.mimeType` is one of
  `image/gif`, `image/webp`, `image/avif`, display frame count and effective fps
  in the details popover. If `imageDecoder` is `'unsupported'` (read from the
  capability snapshot) and the file is animated, show the badge
  `"static (browser limitation)"` next to the asset name.
- Lottie: when `asset.mimeType === 'application/lottie+json'`, show a **"Lottie"**
  badge in the kind column instead of "image".
- Alpha video: when `asset.kind === 'video'` and source-health warnings include
  `'alpha-not-decoded'`, show a warning icon in the details popover.

### Persistence: 38b

Both `AnimatedImageFrameSource` and `LottieFrameSource` attach to a
`MediaInputHandle` whose `frameSource` field satisfies `VideoFrameProvider`.
The pipeline worker already stores handles in a `Map<sourceId, MediaInputHandle>`
and calls `frameSource.frameAt(t)` via the existing `decodeSourceFrame` helper.
No worker plumbing changes are required beyond the adapter-level construction.

The `ProjectDoc` schema bump (R6.2) is needed because `ClipEffectParams` gains
new fields. The actual version number is written as "next unused after v11" in
the implementation task; the implementer reads `PROJECT_SCHEMA_VERSION` and
bumps it by one.

### Third-party additions

- **lottie-web** (runtime dependency): MIT-licensed, Airbnb-backed,
  `^5.x` (latest stable), actively maintained. Used only in the pipeline worker
  for Lottie rasterisation. Install as `npm install lottie-web`. The canvas
  renderer is the only mode used; the SVG and HTML renderers are not imported.
  The library is justified by the AGENTS.md bar: organisational backing (Airbnb),
  active development, industry-standard for web Lottie playback.

- No other new runtime dependencies. `ImageDecoder` is a native browser API.
  `OffscreenCanvas` and `createImageBitmap` are already used in the codebase.

### Validation

- **Unit (Vitest, Node environment, co-located):**
  - `look-preset.test.ts` — see R7.1.
  - `animated-image-source.test.ts` — mocked `ImageDecoder`, LRU close
    accounting, loop wrap, frame index computation — see R7.1.
  - `lottie-source.test.ts` — mocked lottie-web, mocked `OffscreenCanvas`,
    LRU close accounting, cache key, resize miss — see R7.1.
  - `effects.test.ts` additions — new defaults and equality — see R7.1.
  - `capability-probe-v2.test.ts` addition — `imageDecoder` probe — see R7.1.

- **Manual smoke:**
  - 38a: apply a `.json` look preset with LUT to a clip; confirm the look params
    populate in the Inspector; export the project bundle and re-import it;
    confirm look params survive round-trip. Export a preset from a graded clip.
  - 38b animated: import an animated GIF and an animated WebP; confirm playback
    steps through frames; verify no `VideoFrame` leak (check DevTools Memory).
    Test on Firefox to confirm "static (browser limitation)" badge appears.
  - 38b Lottie: import a Lottie JSON; confirm animation plays frame-accurately;
    verify duration is correct.
  - 38b alpha video: import a VP9-alpha `.webm`; place on upper track; confirm
    transparency composites over lower layer in both preview and export.
  - 38a + 38b together: stack a Lottie overlay over a graded clip with a vignette
    look; export to MP4; verify the output matches the preview.
