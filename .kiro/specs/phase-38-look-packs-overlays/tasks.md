# Tasks: Phase 38 — Look Packs and Animated Overlays

Tasks are split into 38a (looks) and 38b (overlays). Each half can be
implemented and merged independently. All checkboxes are unchecked; implement
in the order listed within each group unless a dependency is noted.

---

## 38a: Looks

## T1 — Extend `ClipEffectParams` with look params (R1.6, R1.7)

- [ ] **T1.1** `src/engine/effects.ts`: Add ten new fields to `ClipEffectParams`:
  `grainStrength` (default `0`), `grainSize` (default `1.0`),
  `halationThreshold` (default `0.75`), `halationRadius` (default `0`),
  `halationTintR` (default `1.0`), `halationTintG` (default `0.3`),
  `halationTintB` (default `0.1`), `vignetteAmount` (default `0`),
  `vignetteFeather` (default `0.5`), `vignetteRoundness` (default `1.0`).
  Update `DEFAULT_CLIP_EFFECTS`, `normalizeClipEffects`, and `clipEffectsEqual`
  to include all new fields.

- [ ] **T1.2** `src/engine/effects.ts`: Add active-check helpers:
  `isGrainActive(params)` (returns `params.grainStrength > 0`),
  `isHalationActive(params)` (returns `params.halationRadius > 0`),
  `isVignetteActive(params)` (returns `params.vignetteAmount > 0`).
  Extend `EffectId` union with `'grain' | 'halation' | 'vignette'`.

- [ ] **T1.3** `src/engine/keyframes.ts`: Add the ten new param keys to
  `EFFECT_PARAM_KEYS` (`'grainStrength'`, `'grainSize'`, `'halationThreshold'`,
  `'halationRadius'`, `'halationTintR'`, `'halationTintG'`, `'halationTintB'`,
  `'vignetteAmount'`, `'vignetteFeather'`, `'vignetteRoundness'`). No other
  changes to the keyframe module.

- [ ] **T1.4** `src/engine/project.ts`: bump `PROJECT_SCHEMA_VERSION` to the
  next unused integer after v11 (the Phase 46 PR #63 claims v11; read the
  current value and add one). The new `ClipEffectParams` fields are backwards-
  compatible; `normalizeClipEffects` fills defaults for missing fields on load.

## T2 — Grain WGSL shader (R1.2)

- [ ] **T2.1** `src/engine/shaders/grain.wgsl`: hash-noise grain shader.
  Uniform struct (16 bytes): `strength: f32` at offset 0, `size: f32` at
  offset 4, `frameTimeSeed: f32` at offset 8, `_pad: f32` at offset 12.
  Bindings: `@group(0) @binding(0) var<uniform> u: GrainUniforms`,
  `@binding(1) var src: texture_storage_2d<rgba16float, read>`,
  `@binding(2) var dst: texture_storage_2d<rgba16float, write>`. Noise function:
  `fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453)` where
  `p = vec2f(floor(vec2f(gid.xy) / u.size) + u.frameTimeSeed)`. Blend:
  `mix(colour, colour + (noise - 0.5) * u.strength, u.strength)`.

- [ ] **T2.2** `src/engine/shaders/grain.f16.wgsl`: f16-arithmetic variant of
  `grain.wgsl`; storage textures use `rgba16float`; intermediate computations
  use `f16` where possible. Must produce visually equivalent results to the
  f32 variant.

- [ ] **T2.3** `src/engine/effects.ts`: Add grain to `EFFECT_REGISTRY` with
  `uniformByteLength: 16` and fields mapping `grainStrength` (offset 0),
  `grainSize` (offset 4). `frameTimeSeed` is passed separately via a new
  parameter on `encodeFilmLooks`; it is not a `ClipEffectParams` key.

## T3 — Halation WGSL shader (R1.3)

- [ ] **T3.1** `src/engine/shaders/halation.wgsl`: bright-pass + separable
  Gaussian blur + screen-blend. Uniform struct (32 bytes):
  `threshold: f32` offset 0, `radius: i32` offset 4, `tintR: f32` offset 8,
  `tintG: f32` offset 12, `tintB: f32` offset 16, three `f32` padding to
  reach 32 bytes. The pass dispatches twice internally (horizontal blur, then
  vertical blur) sharing the ping-pong storage views from the caller.
  Screen-blend: `result = 1 - (1 - base) * (1 - glow * tint)`.

- [ ] **T3.2** `src/engine/shaders/halation.f16.wgsl`: f16 variant, same
  equations, intermediate arithmetic in f16.

- [ ] **T3.3** `src/engine/effects.ts`: Add halation to `EFFECT_REGISTRY` with
  `uniformByteLength: 32` and fields mapping `halationThreshold` (offset 0),
  `halationRadius` (offset 4), `halationTintR` (offset 8), `halationTintG`
  (offset 12), `halationTintB` (offset 16).

## T4 — Vignette WGSL shader (R1.4)

- [ ] **T4.1** `src/engine/shaders/vignette.wgsl`: radial falloff shader.
  Uniform struct (16 bytes): `amount: f32` offset 0, `feather: f32` offset 4,
  `roundness: f32` offset 8, `_pad: f32` offset 12. NDC coordinates
  `uv = (gid.xy / vec2f(dims)) * 2.0 - 1.0`. Metric:
  `len = pow(pow(abs(uv.x), u.roundness) + pow(abs(uv.y), u.roundness), 1.0/max(u.roundness, 1e-5))`.
  (Clamp roundness to avoid division by zero when roundness is 0.)
  Falloff: `smoothstep(1.0 - u.feather, 1.0, len)`. Multiply RGB by
  `1.0 - u.amount * falloff`; alpha unchanged.

- [ ] **T4.2** `src/engine/shaders/vignette.f16.wgsl`: f16 variant.

- [ ] **T4.3** `src/engine/effects.ts`: Add vignette to `EFFECT_REGISTRY` with
  `uniformByteLength: 16` and fields mapping `vignetteAmount` (offset 0),
  `vignetteFeather` (offset 4), `vignetteRoundness` (offset 8).

## T5 — `encodeFilmLooks` aggregator and GPU integration (R1.5)

- [ ] **T5.1** `src/engine/effects.ts`: Implement `encodeFilmLooks(encoder,
  srcView, storage, width, height, params, slot, frameTimeSeed): GPUTextureView`.
  Call `encodeHalation` when `isHalationActive(params)`; call `encodeGrain`
  when `isGrainActive(params)`, passing `frameTimeSeed` as a uniform write;
  call `encodeVignette` when `isVignetteActive(params)`. Return `srcView`
  unchanged when all three are inactive. Document the pipeline order
  (`halation → grain → vignette`) and its rationale in a JSDoc comment on
  the function.

- [ ] **T5.2** `src/engine/gpu.ts`: Extend `encodeColourChain` (and/or
  `compositeLayers` — wherever the per-layer chain is assembled) to call
  `encodeFilmLooks` after `encodeLut`, passing the current wall-clock frame
  time as `frameTimeSeed`. The single `queue.submit` per frame is unchanged
  (verify with the existing submission-count test in `gpu.test.ts`).

- [ ] **T5.3** `src/engine/gpu.ts` + `src/engine/export.ts`: Confirm
  `frameTimeSeed` is derived from the timeline timestamp during both preview
  and export (not from runtime wall-clock state). For export, the seed is the timeline
  timestamp of the frame being rendered. Shared preview/export path ensures
  grain pattern is deterministic given the same timestamp.

## T6 — Look preset module (R2.1, R2.2, R2.5)

- [ ] **T6.1** `src/engine/look-preset.ts`: Implement `LookParams`,
  `LookPresetLutRef`, `LookPreset` interfaces. Implement `defaultLookParams()`
  returning defaults from `DEFAULT_CLIP_EFFECTS`. Implement
  `isLookParamsNeutral(params)` returning true when all look params equal their
  defaults.

- [ ] **T6.2** `src/engine/look-preset.ts`: Implement `parseLookPreset(json)`.
  Validate with `isRecord`, `requiredString`, `finiteNumber` helpers copied
  from `project.ts`. Check `lookSchemaVersion === 1`. Clamp all numeric params
  to their declared ranges after successful type validation. Return `null` on
  any validation failure; never throw.

- [ ] **T6.3** `src/engine/look-preset.ts`: Implement `serializeLookPreset(preset)`
  returning `JSON.stringify(preset, null, 2)`. Implement
  `applyLookPresetToClip(preset, clip)` returning a new `TimelineClip` with
  `effects` merged from `preset.params` without mutating `clip`.

## T7 — Look preset protocol and worker commands (R2.3, R2.4)

- [ ] **T7.1** `src/protocol.ts`: Add `ImportLookPresetCommand`
  (`type: 'import-look-preset'`; fields `trackId: string`, `clipId: string`,
  `presetFile: File`, `lutFile?: File`) to `WorkerCommand`. Add
  `ExportLookPresetCommand` (`type: 'export-look-preset'`; `trackId`, `clipId`)
  to `WorkerCommand`. Add `LookPresetExportedMessage` and
  `LookPresetErrorMessage` to `WorkerStateMessage`.

- [ ] **T7.2** `src/engine/worker.ts`: Handle `'import-look-preset'` command:
  read the preset file text, call `parseLookPreset`, and — if `lutFile` is
  provided — parse the `.cube` via `clipLutFromCubeFile` _before_ the
  mutation. Then commit a **single** `commitTimelineMutation` that calls
  `applyLookPresetToClip` and, when a parsed LUT is present, follows it with
  `setClipLut` so both changes land as one undo entry. On JSON validation
  failure post `look-preset-error`; on LUT parse failure post a project
  warning and proceed with the look params only.

- [ ] **T7.3** `src/engine/worker.ts`: Handle `'export-look-preset'` command:
  find the clip by `trackId`/`clipId`, build a `LookPreset` from its current
  params, call `serializeLookPreset`, post `look-preset-exported` with the
  JSON string and the clip's `lut?.fileName` if present.

## T8 — Inspector UI for looks (R1.8, R2.6)

- [ ] **T8.1** `src/ui/Inspector.tsx`: Add a **"Look"** section below the LUT
  section. Section is hidden when `isLookParamsNeutral` returns true for the
  selected clip's effect params. Sliders: `grainStrength` (0–1), `grainSize`
  (0.5–4.0), `halationThreshold` (0–1), `halationRadius` (0–64, integer steps),
  tint RGB as a compact three-slider row, `vignetteAmount` (0–1),
  `vignetteFeather` (0–1), `vignetteRoundness` (0–2). Each slider debounces at
  80 ms and posts `set-keyframe` (or a plain `set-clip-effects` command — use
  whichever is the existing pattern for non-keyframed effect sliders).

- [ ] **T8.2** `src/ui/Inspector.tsx`: **"Apply Look Preset…"** button opens a
  file picker (`accept=".json,.cube"`, `multiple`). If two files are selected,
  the `.json` is parsed as the preset and the `.cube` is routed through the
  existing LUT import path. Both the preset params and LUT import are committed
  atomically in a single timeline mutation (one undo entry). Display an inline
  error if the worker responds with `look-preset-error`.

- [ ] **T8.3** `src/ui/Inspector.tsx`: **"Export Look Preset…"** button (shown
  when look params are non-neutral) posts `export-look-preset`. On
  `look-preset-exported`, trigger a blob download of the JSON as
  `<preset-name>.json` using the existing blob-download helper. If `lutFileName`
  is present, append an explanatory toast: "Include [lutFileName] alongside the
  preset when sharing."

---

## 38b: Overlays

## T9 — `imageDecoder` capability probe (R3.4)

- [ ] **T9.1** `src/protocol.ts`: Add `imageDecoder: FeatureSupport` to
  `CapabilityProbeResult`.

- [ ] **T9.2** `src/engine/capability-probe-v2.ts`: Add `probeImageDecoder()`
  function that checks `typeof (globalThis as Record<string, unknown>)['ImageDecoder'] === 'function'`.
  Include the result in the return value of `probeCapabilities()`.

## T10 — `AnimatedImageFrameSource` (R3.1–R3.3, R3.7)

- [ ] **T10.1** `src/engine/animated-image-source.ts` (new file): Implement
  `AnimatedImageFrameSource implements VideoFrameProvider`. Constructor takes
  `(stream: ReadableStream<Uint8Array>, mimeType: string)`. Constructs an
  `ImageDecoder` with `{ data: stream, type: mimeType, preferAnimation: true }`.

- [ ] **T10.2** `src/engine/animated-image-source.ts`: Implement
  `frameAt(time: number): Promise<DecodedFrame | null>`. Lazily populates
  `frameDurations: number[]` from the first decode result's metadata on the
  first call. Computes `frameIndex` by accumulating durations. Loops according
  to `repetitionCount` (per MDN: `Infinity` = infinite loop via modulo;
  finite values clamp to `totalDuration * (repetitionCount + 1)`; `0` = play
  once, clamp to `totalDuration`). LRU cache lookup before decode; on miss
  call `this.decoder.decode({ frameIndex })`, obtain `ImageBitmap` from
  `result.image`, construct `new VideoFrame(bitmap, ...)`, close the
  `ImageBitmap`. Cache the `VideoFrame`; evict LRU entry at capacity 8 by
  closing the evicted frame.

- [ ] **T10.3** `src/engine/animated-image-source.ts`: Implement `reset()` —
  flush and close all cached frames, clear `frameDurations`. Implement
  `dispose()` — flush and close all cached frames, call `this.decoder.close()`.
  Close-exactly-once invariant: each `VideoFrame` is closed in exactly one of:
  LRU eviction, `reset()`, `dispose()`, or the cache never filling (frames
  served to callers are not in the cache after being returned — callers own them).

- [ ] **T10.4** `src/engine/animated-image-source.ts`: Compute effective frame
  rate from the first 10 frame durations (median of durations in microseconds,
  converted to fps). Fall back to 25 fps when `frameDurations` is empty or
  metadata is absent. Expose as `get effectiveFps(): number`.

## T11 — Integrate `AnimatedImageFrameSource` in the media adapter (R3.5, R3.6, R3.8)

- [ ] **T11.1** `src/engine/media-adapters/mediabunny-adapter.ts`: Import and
  use `AnimatedImageFrameSource`. Cache the `imageDecoder: FeatureSupport`
  result from the capability probe (passed into the adapter at worker init via
  the existing probe result).

- [ ] **T11.2** `src/engine/media-adapters/mediabunny-adapter.ts`: In the `open()`
  method, for image files with MIME type `image/gif`, `image/webp`, or
  `image/avif`: when `imageDecoder === 'supported'`, construct
  `AnimatedImageFrameSource(file.stream(), file.type)` and use it as
  `frameSource` in the returned `MediaInputHandle`; set `frameRate` from
  `animatedSource.effectiveFps`. When `imageDecoder !== 'supported'`, continue
  using the existing `StillFrameSource` path unchanged.

- [ ] **T11.3** `src/engine/media-adapters/mediabunny-adapter.ts`: Add the
  source-health warning `'alpha-not-decoded'` to `generateSourceHealthWarnings`
  when `conformance.kind === 'video'`, the codec string contains `vp09` or `av01`,
  and the relevant decode probe is not `'supported'`.

- [ ] **T11.4** `src/ui/MediaBin.tsx`: When `imageDecoder` probe (from the
  capability snapshot passed to the component) is `'unsupported'` and the
  source's MIME type is `image/gif`, `image/webp`, or `image/avif`, display a
  **"static (browser limitation)"** badge next to the source name in the media
  bin row. When `asset.kind === 'image'` and frame count is available from
  metadata, show frame count and effective fps in the details popover.

## T12 — Lottie recognition and sniff (R4.1, R4.5, R4.7)

- [ ] **T12.1** `src/engine/media-adapters/mediabunny-adapter.ts`: Add
  `isLottieFile(file: File, firstBytes: string): boolean` — returns true when
  the file name ends with `.json` (or MIME is `application/json`) and
  `firstBytes` contains both `'"v":'` and `'"layers"'`. Read `firstBytes` as
  the first 512 bytes decoded from a `TextDecoder`.

- [ ] **T12.2** `src/engine/media-adapters/mediabunny-adapter.ts`: Add a guard
  in `canInspect` / `open` for `.lottie` extension: post a user-facing
  source-health warning `'lottie-zip-unsupported'` with message "Lottie zip
  (.lottie) is not yet supported; export plain .json from your Lottie tool."
  Return early without attempting to open.

## T13 — `LottieFrameSource` (R4.2–R4.4)

- [ ] **T13.1** `src/engine/lottie-source.ts` (new file): Install `lottie-web`
  (`npm install lottie-web`). Import `lottie` from `'lottie-web'`.
  Implement `LottieFrameSource implements VideoFrameProvider`. Constructor takes
  `(data: ArrayBuffer, outputWidth: number, outputHeight: number)`. Create an
  `OffscreenCanvas(outputWidth, outputHeight)`, get its 2D context, load the
  animation via `lottie.loadAnimation({ renderer: 'canvas', autoplay: false, loop: true, rendererSettings: { context: ctx }, animationData: JSON.parse(new TextDecoder().decode(data)) })`.
  Store `this.animation`, `this.canvas`, `this.outputWidth`, `this.outputHeight`.

- [ ] **T13.2** `src/engine/lottie-source.ts`: Implement `frameAt(time)`:
  compute `totalFrames = this.animation.totalFrames`.
  Use positive modulo to guard against negative `t`:
  `frameIndex = ((Math.floor(t * this.animation.frameRate) % totalFrames) + totalFrames) % totalFrames`.
  Build `cacheKey = \`${frameIndex}:${this.outputWidth}x${this.outputHeight}\``.
  LRU lookup (max 16 entries); on miss call `this.animation.goToAndStop(frameIndex, true)`,
  then `const bitmap = await createImageBitmap(this.canvas)`, then
  `new VideoFrame(bitmap, { timestamp: Math.round(t * 1e6) })`, close the bitmap.
  Cache and return.

- [ ] **T13.3** `src/engine/lottie-source.ts`: Implement `reset()` — flush and
  close all cached frames. Implement `dispose()` — flush and close all cached
  frames, call `this.animation.destroy()`. Close-exactly-once invariant upheld
  across all paths.

- [ ] **T13.4** Add an implementation note (code comment in `lottie-source.ts`)
  documenting the fallback: if the lottie-web canvas renderer surfaces a DOM
  dependency in the worker during integration, rasterise frames at import time
  on main into a capped frame strip (`min(totalFrames, 300)` frames), cache as
  a `VideoFrame[]`, and serve from cache. This is the fallback plan; the primary
  plan is the worker `OffscreenCanvas` path.

## T14 — Integrate `LottieFrameSource` in the media adapter (R4.2–R4.6)

- [ ] **T14.1** `src/engine/media-adapters/mediabunny-adapter.ts`: In `open()`,
  after the Lottie sniff check, construct `LottieFrameSource` with the file's
  `ArrayBuffer` and the project's current output resolution (default
  `1920 × 1080` when not set). Set `frameRate = animation.frameRate`,
  `duration = animation.totalFrames / animation.frameRate`, `kind: 'image'`,
  `mimeType: 'application/lottie+json'` in the `MediaInputHandle`.

- [ ] **T14.2** `src/ui/MediaBin.tsx`: When `asset.mimeType === 'application/lottie+json'`,
  display a **"Lottie"** badge in the kind column. Show duration and frame rate
  in the details popover. No thumbnail generation attempt (Lottie thumbnails are
  a non-goal for this phase).

## T15 — Alpha video: preserve alpha at decode (R5.1–R5.4)

- [ ] **T15.1** `src/engine/webcodecs-decoder.ts`: In the `samples` generator
  method where `decoder.configure(decoderConfig)` is called, add `alpha: 'keep'`
  to the `VideoDecoderConfig` when the codec string contains `'vp09'` or `'av01'`.
  Add a code comment: "alpha channel preservation for VP9/AV1-alpha overlays
  (Phase 38b R5.2); this is a no-op for codecs without alpha support."

- [ ] **T15.2** `src/engine/media-adapters/mediabunny-adapter.ts`: In
  `generateSourceHealthWarnings`, add the `'alpha-not-decoded'` warning when
  `conformance.kind === 'video'` and the codec probe for the source's codec is
  not `'supported'` and the codec string contains `'vp09'` or `'av01'`. Only
  warn if the file actually has an alpha plane — use the codec string heuristic
  since `ImageDecoder` / Mediabunny track metadata may not expose this directly.

- [ ] **T15.3** `src/ui/MediaBin.tsx`: In the details popover, when source
  warnings include `'alpha-not-decoded'`, show an icon and the text
  "Alpha channel not decoded on this browser/platform."

## T16 — Unit tests (R7.1)

- [ ] **T16.1** `src/engine/look-preset.test.ts` (new file): Tests —
  `parseLookPreset` returns a valid `LookPreset` for a well-formed JSON object;
  returns `null` when `lookSchemaVersion` is missing; returns `null` when
  `params` is absent; returns `null` when any param is non-finite; clamps
  out-of-range values after a valid parse; `serializeLookPreset` produces JSON
  that `parseLookPreset` round-trips; `applyLookPresetToClip` merges params
  without mutating the input clip; `isLookParamsNeutral` returns true for
  defaults and false when any param is non-default.

- [ ] **T16.2** `src/engine/animated-image-source.test.ts` (new file): Mock
  `ImageDecoder` with a 3-frame sequence (durations 33 ms each). Tests —
  `frameAt(0)` returns frame 0; `frameAt(0.066)` returns frame 2; loop wraps
  at `time > totalDuration` with `repetitionCount = 0`; LRU evicts at 9th
  frame and closes the evicted `VideoFrame`; `reset()` closes all cached
  frames and clears durations; `dispose()` closes all frames and calls
  `decoder.close()`; close-exactly-once: no frame is closed twice on the
  normal `reset()` → `frameAt()` → `dispose()` path.

- [ ] **T16.3** `src/engine/lottie-source.test.ts` (new file): Mock lottie-web
  (`vi.mock('lottie-web', ...)` returning a fake animation object with
  `frameRate: 30`, `totalFrames: 90`). Mock `OffscreenCanvas` and
  `createImageBitmap` to return a fake `ImageBitmap`. Tests —
  `frameAt(0)` computes frame index 0 and calls `goToAndStop(0, true)`;
  `frameAt(1)` computes frame index 30; `frameAt(3)` wraps to index 0 (loop);
  LRU evicts at 17th unique frame and closes the evicted `VideoFrame`;
  cache key includes output size (changing dimensions causes a miss);
  `reset()` closes all cached frames; `dispose()` calls `animation.destroy()`.

- [ ] **T16.4** `src/engine/effects.test.ts` additions: `normalizeClipEffects({})` 
  returns all ten new look params at their defaults;
  `clipEffectsEqual(a, b)` returns false when `grainStrength` differs, and
  false when `vignetteAmount` differs.

- [ ] **T16.5** `src/engine/capability-probe-v2.test.ts` addition:
  `probeCapabilities()` returns `imageDecoder: 'supported'` when `globalThis.ImageDecoder`
  is a function, and `'unsupported'` when it is absent.

## T17 — Docs and quality gate (R7.2–R7.4)

- [ ] **T17.1** `docs/USER-GUIDE.md`: Add **"Look Packs"** section: what a look
  preset is; how to apply one (Inspector → Apply Look Preset… → pick `.json`);
  how to export one; note that the accompanying `.cube` LUT file must be
  bundled alongside the preset JSON when sharing.

- [ ] **T17.2** `docs/USER-GUIDE.md`: Add **"Animated Overlays"** section:
  supported formats (animated WebP, AVIF, GIF, Lottie JSON); the Firefox
  static-frame limitation and the "static (browser limitation)" badge; how to
  use alpha video overlays (VP9/AV1 files, place on an upper track, compositor
  blends automatically); the `.lottie` zip non-goal with the workaround
  (export plain `.json` from the Lottie tool).

- [ ] **T17.3** Verify `npm run build` exits 0 (strict TypeScript passes). Fix
  any type errors introduced by the new params and modules before merging.

- [ ] **T17.4** Verify `npm test` exits 0 and that the test count is greater
  than the pre-38 baseline. The five new test files (T16.1–T16.5) must all run
  and pass.
