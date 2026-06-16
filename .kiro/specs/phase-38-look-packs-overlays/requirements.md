# Requirements: Phase 38 — Look Packs and Animated Overlays

Phase 38 extends the colour-grade pipeline (P15/P21) and the compositor (P12)
with two independently shippable capabilities. **38a — Looks** adds three new
film-emulation effect passes (grain, halation, vignette) and a versioned JSON
look-preset format that bundles these with an optional LUT reference; presets
import and export as files. **38b — Overlays** adds animated image sources
(animated WebP/AVIF/GIF via `ImageDecoder`) and Lottie animation sources
(lottie-web on an `OffscreenCanvas` in the pipeline worker), and formally
documents alpha-channel video overlay compositing through the existing P12
layer stack. Each half has a clear acceptance boundary and may ship before the
other.

**Non-goals for the whole phase:** an asset marketplace or any hosted look
catalogue; After Effects expression evaluation; audio-reactive effects; `.lottie`
zip-container import (plain `.json` only in v1); subtitle or caption-track
animated effects; server-side processing of any kind.

---

## R1 — 38a: Film-emulation effect passes

- **R1.1** Three new WGSL compute passes are added to `src/engine/effects.ts`
  and registered in the `EFFECT_REGISTRY` so they follow the existing
  skip-at-zero pattern: **grain**, **halation**, and **vignette**. Each pass
  exists in an `f32` and an `f16` variant (`*.wgsl` and `*.f16.wgsl` in
  `src/engine/shaders/`). A pass encodes zero workgroups when all its params
  are at their neutral/zero values; the single `queue.submit` per frame (hard
  gate 4) is never violated.

- **R1.2** Grain parameters: `grainStrength` (default `0`, range `0–1`) and
  `grainSize` (default `1.0`, range `0.5–4.0`, dimensionless scale factor).
  The grain is **hash noise** generated entirely in the shader from a seed
  derived from `(x, y, frameTimeSeed)` — no texture lookup, no CPU upload
  per frame. `frameTimeSeed` is a `f32` uniform updated per-frame (seconds
  since timeline start, float-quantised to the current frame). Noise is sampled
  in output-pixel space and then scaled by `grainSize` so the spatial frequency
  is resolution-independent; a larger `grainSize` yields coarser grain.
  `grainStrength 0` bypasses the pass entirely (zero workgroups).

- **R1.3** Halation parameters: `halationThreshold` (default `0.75`, range
  `0–1`), `halationRadius` (default `0`, range `0–64` pixels, **integer**
  step of 1), `halationTint` (default `[1.0, 0.3, 0.1]` RGB, per-component
  range `0–1`). The pass is a bright-pass extraction (pixels above
  `halationThreshold` in luminance) followed by a separable Gaussian blur of
  radius `halationRadius` (two 1-D passes sharing ping-pong storage already
  in the chain), then screen-blended back. `halationRadius 0` bypasses the
  pass entirely.

- **R1.4** Vignette parameters: `vignetteAmount` (default `0`, range `0–1`),
  `vignetteFeather` (default `0.5`, range `0–1`), `vignetteRoundness` (default
  `1.0`, range `0–2`, where `1.0` is circular and `2.0` is fully rectangular).
  The pass computes a radial falloff from the image centre and multiplies RGB
  by `1 − vignetteAmount × falloff`. `vignetteAmount 0` bypasses the pass
  entirely.

- **R1.5** The fixed pipeline order for the three new passes, applied **after**
  the existing colour-grade chain and after the clip LUT, is:
  `decode → colour grade (brightness/contrast/saturation/temperature) → clip LUT → halation → grain → vignette`.
  Rationale (documented in design.md and in a code comment on the encoder
  function): halation is a lens/film response that occurs before grain is
  deposited; grain overlays the whole emulsion after chemical processes; vignette
  is a lens falloff applied last as a framing element. This order is fixed and
  not user-configurable.

- **R1.6** All six new params (`grainStrength`, `grainSize`, `halationThreshold`,
  `halationRadius`, `halationTint[3]`, `vignetteAmount`, `vignetteFeather`,
  `vignetteRoundness`) are added to `ClipEffectParams` in `src/engine/effects.ts`
  with the defaults listed above. `normalizeClipEffects` returns the defaults
  for missing fields. `clipEffectsEqual` is extended to cover all new fields.
  `sampleClipParamsAt` in `src/engine/keyframes.ts` already handles
  `ClipEffectParams` generically; no keyframe-layer changes needed.

- **R1.7** The new params are keyframeable via the existing `set-keyframe`
  command: the param keys (`grainStrength`, `grainSize`, `halationThreshold`,
  `halationRadius`, `halationTint` — broken into three individual component keys
  `halationTintR`, `halationTintG`, `halationTintB`, `vignetteAmount`,
  `vignetteFeather`, `vignetteRoundness`) are added to `EFFECT_PARAM_KEYS` in
  `src/engine/keyframes.ts`. All keys are of type `number`; tint components are
  individually keyframeable.

- **R1.8** The Inspector panel (`src/ui/Inspector.tsx`) gains a "Look" section
  below the LUT section showing sliders for each new param with the numeric
  ranges above; the section is hidden when all look params equal their defaults,
  matching the existing collapsed-by-default convention.

---

## R2 — 38a: Look preset format

- **R2.1** A look preset is a JSON file with the schema:
  ```json
  {
    "lookSchemaVersion": 1,
    "name": "<string>",
    "params": {
      "grainStrength": <number>,
      "grainSize": <number>,
      "halationThreshold": <number>,
      "halationRadius": <number>,
      "halationTintR": <number>,
      "halationTintG": <number>,
      "halationTintB": <number>,
      "vignetteAmount": <number>,
      "vignetteFeather": <number>,
      "vignetteRoundness": <number>
    },
    "lut": {
      "fileName": "<string>",
      "fingerprint": "<sha-256-hex>"
    }
  }
  ```
  The `lut` field is optional; `params` must be present. All numeric values are
  validated with `Number.isFinite`; out-of-range values are clamped on import.
  Validation is hand-rolled (`isRecord` / `requiredString` / `finiteNumber`
  helpers) following the existing pattern in `src/engine/project.ts` — no Zod.

- **R2.2** A new module `src/engine/look-preset.ts` exports:
  - `interface LookPreset { lookSchemaVersion: 1; name: string; params: LookParams; lut?: LookPresetLutRef }` where `LookParams` is `Pick<ClipEffectParams, grainStrength | grainSize | halationThreshold | halationRadius | halationTintR | halationTintG | halationTintB | vignetteAmount | vignetteFeather | vignetteRoundness>` and `LookPresetLutRef { fileName: string; fingerprint: string }`.
  - `parseLookPreset(json: unknown): LookPreset | null` — returns null on any validation failure; never throws.
  - `serializeLookPreset(preset: LookPreset): string` — returns pretty-printed JSON.
  - `applyLookPresetToClip(preset: LookPreset, clip: TimelineClip): TimelineClip` — merges `preset.params` into `clip.effects`, returning a new clip object; does not mutate.

- **R2.3** Import flow: a new `import-look-preset` worker command accepts a
  `File` object (the `.json` preset) and an optional separate `.cube` `File`.
  The worker reads the JSON, validates it via `parseLookPreset`, then:
  (a) applies `applyLookPresetToClip` to the target clip,
  (b) if `lut` is present and a `.cube` file is provided, routes it through the
      existing `import-lut` path so the LUT rides in the bundle under
      `assets/luts/` automatically, and
  (c) emits a `timeline-snapshot` state message. If validation fails the worker
      emits `look-preset-error { clipId; reason: string }`.

- **R2.4** Export flow: a new `export-look-preset` worker command produces the
  `.json` text for the current clip's look params. The LUT fingerprint is the
  existing `ClipLut.key` digest. The worker responds with
  `look-preset-exported { clipId; json: string; lutFileName?: string }` and the
  UI saves it via the existing blob-download helper. The `.cube` file is saved
  separately by the user (the UI instructs them to include it alongside the
  preset).

- **R2.5** Presets are **templates**: applying a preset materialises its params
  directly into the clip's `ClipEffectParams` and LUT reference. There is no
  live link between a clip and a preset; editing the clip later does not mutate
  the preset file.

- **R2.6** The Inspector shows an "Apply Look Preset…" button (file-picker,
  accepts `.json`) and an "Export Look Preset…" button when any look param is
  non-default. No in-app preset library is stored; presets live only as files.

---

## R3 — 38b: Animated image sources (`AnimatedImageFrameSource`)

- **R3.1** A new module `src/engine/animated-image-source.ts` exports
  `AnimatedImageFrameSource` implementing `VideoFrameProvider`. It wraps the
  browser `ImageDecoder` API to decode animated WebP, animated AVIF, and GIF
  sources frame-by-frame, without decoding the whole file up front.

- **R3.2** Frame seeking: `frameAt(time)` maps `time` to a frame index by
  accumulating frame durations from `ImageDecoder.tracks[0].frameCount` and
  each frame's `duration` metadata. Looping uses the file's `repetitionCount`
  metadata (per MDN: `Infinity` = infinite loop; finite values are honoured
  by clamping to `totalDuration * (repetitionCount + 1)`; `0` = play once).
  The frame at the computed index is decoded via `ImageDecoder.decode({ frameIndex })` and
  converted to a `VideoFrame` via `new VideoFrame(imageBitmap)`. The returned
  `DecodedFrame` wraps this `VideoFrame`; the caller (the pipeline worker) is
  responsible for calling `.close()` exactly once.

- **R3.3** LRU frame cache: `AnimatedImageFrameSource` maintains an internal LRU
  cache of at most **8** decoded `VideoFrame`s keyed by frame index. On cache
  eviction the evicted `VideoFrame` is closed immediately. On `reset()` the cache
  is flushed and all cached frames are closed. On `dispose()` all frames are
  closed and the `ImageDecoder` is closed. Close-exactly-once is upheld across
  all paths.

- **R3.4** Capability probe: `src/engine/capability-probe-v2.ts` gains a new
  field `imageDecoder: FeatureSupport` in `CapabilityProbeResult`. The probe
  checks `typeof ImageDecoder !== 'undefined'`. Chromium and Safari report
  `'supported'`; Firefox reports `'unsupported'`.

- **R3.5** Import path: `mediabunny-adapter.ts` currently imports animated
  WebP/AVIF/GIF as stills (first frame via `createImageBitmap`). When
  `imageDecoder === 'supported'`, the adapter creates an `AnimatedImageFrameSource`
  instead of `StillFrameSource`. The capability check is performed once per
  worker init and cached. The adapter detects animated content by attempting
  `ImageDecoder.isTypeSupported(mimeType)` for MIME types `image/webp`,
  `image/avif`, and `image/gif`.

- **R3.6** Firefox compatibility path: when `imageDecoder === 'unsupported'`,
  the existing `StillFrameSource` (first frame via `createImageBitmap`) is
  used unchanged. The media bin source row displays a badge: **"static (browser
  limitation)"** next to the duration/frame-count info. This badge appears only
  when the file is animated (detected by file extension `.gif` or the MIME type
  containing `webp`/`avif` when the browser cannot use `ImageDecoder`) and the
  source has been imported as a still. No crash or blank app.

- **R3.7** The animated source's effective frame rate (used for playback cadence
  and timeline display) is derived from the median frame duration of the first
  10 decoded frames, falling back to 25 fps when metadata is absent. This value
  is stored in `MediaInputHandle.frameRate` at import time.

- **R3.8** Bundle round-trip: animated image files are imported as `kind: 'media'`
  bundle assets (the same as static images today). No new bundle asset kind is
  required. The `SourceDescriptor` for an animated source records `kind: 'image'`
  (unchanged) and the existing `mimeType`. Re-linking from a bundle re-imports
  the file through the same adapter, which will again produce an
  `AnimatedImageFrameSource` when the capability is present.

---

## R4 — 38b: Lottie animation sources

- **R4.1** Lottie `.json` files (plain JSON, not `.lottie` zip) are recognised
  at import by the adapter sniffing the file content for both `"v":` and
  `"layers"` within the first 512 bytes. The MIME type or extension alone is
  not sufficient; the content sniff is required because `.json` extension is
  generic.

- **R4.2** A new module `src/engine/lottie-source.ts` exports
  `LottieFrameSource` implementing `VideoFrameProvider`. It renders frames to
  an `OffscreenCanvas` in the pipeline worker using `lottie-web` in canvas mode
  (see design.md for the primary/fallback decision). Frame-accuracy: `frameAt(t)`
  computes `frameIndex = Math.floor(t × compositionFps)` where `compositionFps`
  is read from `lottie.frameRate` on the parsed animation. Rendering calls
  `lottie.goToAndStop(frameIndex, true)` then reads the canvas via
  `createImageBitmap(canvas)` and wraps it as a `VideoFrame`. This is a
  per-frame raster in the worker (not on main), satisfying hard gate 1.

- **R4.3** `LottieFrameSource` uses an LRU cache of at most **16** rendered
  `VideoFrame`s keyed by `frameIndex` and output dimensions
  (`${frameIndex}:${outputWidth}x${outputHeight}`). The cache is per-instance;
  no cross-instance deduplication is needed. The content hash (SHA-256 of the
  source data) is computed once in the constructor for diagnostics/logging only.
  Eviction closes the evicted `VideoFrame`. `reset()` flushes and closes all
  cached frames. `dispose()` closes all frames, destroys the lottie instance,
  and releases the `OffscreenCanvas`.

- **R4.4** The `OffscreenCanvas` is sized to the project's output resolution
  (from the `ExportSettings` stored in the worker) at `LottieFrameSource`
  construction time. If output resolution is not yet set, it defaults to
  `1920 × 1080`. When output resolution changes the source is recreated.

- **R4.5** Lottie files are imported as `kind: 'media'` bundle assets. The
  content sniff and a file extension check (`.json`) guard against importing
  arbitrary JSON. The `SourceDescriptor` records `kind: 'image'` (Lottie clips
  behave as image/overlay clips with a finite duration equal to the animation
  loop duration). `duration` is `lottie.totalFrames / lottie.frameRate`.

- **R4.6** The media bin displays Lottie sources with the label **"Lottie"**
  in the kind badge (instead of "image") so users can distinguish them.

- **R4.7** `.lottie` zip container files are a **non-goal in v1**. If a user
  imports a file with `.lottie` extension the adapter rejects it with a
  user-facing warning: "Lottie zip (.lottie) is not yet supported; export plain
  .json from your Lottie tool." No partial parse attempt.

---

## R5 — 38b: Alpha-channel video overlays

- **R5.1** VP9 and AV1 video with alpha channels are supported as overlay
  sources when `vp9Decode === 'supported'` or `av1Decode === 'supported'` from
  the Phase 26 probe. No new codec probe is needed; the existing ones are
  sufficient.

- **R5.2** Alpha video clips are composited through the existing P12 layer stack
  unchanged. The `composite-over` pass in `src/engine/shaders/composite-over.wgsl`
  already uses premultiplied-alpha over-blend (`result = over + under × (1 − over.a)`);
  an alpha video layer that decodes to a `VideoFrame` with alpha will composite
  correctly once the `alphaMode` at frame import is set to `'premultiplied'`
  (see design.md).

- **R5.3** The media bin and Inspector surface no special UI for alpha video
  beyond the existing layer-order controls. The user places the alpha video on
  a higher track; the compositor blends it over lower tracks by default.

- **R5.4** When neither `vp9Decode` nor `av1Decode` is `'supported'` the user
  can still import the file as a video source; the video will be opaque
  (the alpha channel is discarded by the decoder). A source-health warning
  `'alpha-not-decoded'` is surfaced in the media bin details popover if the
  file's video codec contains an alpha channel and the platform cannot decode
  it with alpha. This check is heuristic: if the codec string contains `vp09`
  or `av01` and the probe is not `'supported'`, the warning is shown.

---

## R6 — Bundle, persistence, and schema

- **R6.1** No new `BundleAssetKind` is introduced. Lottie `.json` files, animated
  image files, and alpha-video files all use the existing `'media'` kind. LUT
  files referenced by look presets already use `'lut'`. The bundle round-trip
  for all new source types is exercised by the existing bundle import/export
  path.

- **R6.2** `ProjectDoc` schema is bumped: write "bump `PROJECT_SCHEMA_VERSION`
  to the next unused version after v11 (the Phase 46 PR #63 claims v11)" in the
  implementation task. The new fields added to `TimelineClip` (the six look
  params in `ClipEffectParams`) are backwards-compatible: missing fields are
  filled by `normalizeClipEffects` with defaults.

- **R6.3** No new IndexedDB stores are required. Look preset files are
  user-managed files on disk; they are never persisted in the app's IDB.

---

## R7 — Tests and documentation

- **R7.1** Unit tests (Vitest, Node environment, co-located with the modules
  they test):
  - `src/engine/look-preset.test.ts`: `parseLookPreset` — valid full preset,
    valid preset without LUT, missing `params` field (→ null), invalid numeric
    (non-finite → null), out-of-range clamping after a successful parse,
    `serializeLookPreset` round-trip, `applyLookPresetToClip` merges params
    and does not mutate the input clip.
  - `src/engine/animated-image-source.test.ts`: mocked `ImageDecoder` with
    3-frame sequences — `frameAt` maps time to frame index correctly; loop
    wraps at end; LRU evicts at 8 frames and closes the evicted frame;
    `reset()` closes all cached frames; `dispose()` closes all frames and
    the `ImageDecoder`; close-exactly-once across normal/error paths.
  - `src/engine/lottie-source.test.ts`: mocked lottie-web and mocked
    `OffscreenCanvas`/`createImageBitmap` — `frameAt` maps time to frame index
    at the animation's fps; LRU evicts at 16 frames; `reset()` closes all;
    cache key includes output size (resize misses cache); `dispose()` cleans up.
  - `src/engine/effects.test.ts` additions: `normalizeClipEffects` fills all
    new look params with defaults; `clipEffectsEqual` returns false when any
    new param differs.
  - `src/engine/capability-probe-v2.test.ts` addition: `imageDecoder` is
    `'supported'` when `ImageDecoder` is in globalThis, `'unsupported'` when
    absent.
  - No large media fixtures; all tests use mocked APIs or tiny synthetic data.

- **R7.2** `docs/USER-GUIDE.md` gains a **Look Packs** section covering: what a
  look preset is, how to apply one (Inspector → Apply Look Preset…), how to
  export one, and the note that `.cube` LUT files must be included alongside
  the preset JSON.

- **R7.3** `docs/USER-GUIDE.md` gains an **Animated Overlays** section covering:
  supported animated formats (animated WebP, AVIF, GIF, Lottie JSON), the
  Firefox static-frame limitation badge, how to use alpha video overlays (VP9/AV1
  on upper tracks), and the `.lottie` zip non-goal with the workaround.

- **R7.4** `npm run build` stays green (strict TypeScript); `npm test` stays
  green and the test count grows relative to the pre-38 baseline.
