# Requirements: Phase 30 — Animated Caption Styles

Phase 30 extends the Phase 22 caption tracks with a visual styling engine:
rich fill/stroke/shadow/glow presets, per-line background pills, and enter/exit
animations (pop, bounce, slide, typewriter). An optional per-word timing array
on `CaptionSegment` activates karaoke-style word highlight when present; manual
captions without word timings render the full styled line unchanged. All
rendering goes through the Phase 14 GPU-cached title raster path and the Phase
15 keyframe interpolation utilities — no new raster machinery, no per-frame
Canvas2D work. Ten or more built-in presets ship as code constants; users can
import and export custom presets as `.json` files for local sharing. Styled
captions survive Phase 23 bundle round-trips and burn-in export matches preview
exactly. Sidecar SRT/VTT export remains plain text — styling is project-level
metadata, not carried in sidecar formats.

## R1 — Animated caption style model

- **R1.0** The existing Phase 22 `CaptionStyle.presetId` type union is extended
  to accept the Phase 30 built-in IDs (R1.3) AND arbitrary string IDs (custom
  preset UUIDs). Unknown / unresolvable IDs fall back to the `"subtitle"`
  layout defaults at the rendering layer (no schema migration required for
  existing v10 documents whose tracks reference `"subtitle"` | `"lower-third"`
  | `"note"`).
- **R1.1** `CaptionAnimStylePreset` is a new versioned type exported from
  `src/engine/captions/anim-style.ts` with the discriminant field
  `captionStyleSchemaVersion: 1`. It carries: `id: string`, `label: string`,
  `builtIn: boolean`, `anchor: CaptionAnchor`, `maxWidthPercent: number`,
  `lineWrap: CaptionLineWrap`, `insetPx?: { x: number; y: number }`,
  `titleStyle: Partial<TitleStyle>`, `glow?: { color: string; blurPx: number }`,
  `pill?: { paddingXPx: number; paddingYPx: number; radiusPx: number; color: string; opacity: number }`,
  `animation?: { enter: CaptionAnimKind; exit: CaptionAnimKind; durationS: number }`,
  `highlightColor?: string`. All optional groups default to disabled when absent.
- **R1.2** `CaptionAnimKind` is the string union
  `'none' | 'pop' | 'bounce' | 'slide-up' | 'slide-down' | 'typewriter'`,
  exported from `src/engine/captions/anim-style.ts`. `animation.durationS`
  must be in `[0.05, 1.0]` s; the default is `0.25` s.
- **R1.3** Ten built-in presets ship as `ANIM_CAPTION_PRESETS: readonly CaptionAnimStylePreset[]`
  in `src/engine/captions/anim-style.ts`, frozen at module load. Required
  preset IDs: `"subtitle"`, `"lower-third"`, `"note"`, `"bold-outline"`,
  `"neon-glow"`, `"karaoke"`, `"cinematic"`, `"pop-card"`, `"bounce-card"`,
  `"slide-news"`. Each has a stable `id`, a human-readable `label`, and
  `builtIn: true`. Additional presets beyond ten are allowed.
- **R1.4** `CaptionSegment` (in `src/engine/captions/types.ts`) gains an
  optional field `words?: ReadonlyArray<{ text: string; startS: number; endS: number }>`.
  Words must be time-ordered and non-overlapping; each word's range must lie
  within `[segment.start, segment.start + segment.duration]`. The validator
  treats the field as optional (existing segments without it load unchanged).
  This schema aligns with Phase 29 word-level ASR timestamps (loose dependency;
  P29 populates the same field).
- **R1.5** `ANIM_CAPTION_PRESET_DEFAULTS` (exported const in
  `src/engine/captions/anim-style.ts`) specifies the resolved value for every
  optional field. All code that resolves a preset calls
  `resolveAnimPreset(partial): CaptionAnimStylePreset` rather than
  duplicating fallback logic inline.
- **R1.6** Custom presets not in `ANIM_CAPTION_PRESETS` are stored in a new
  array field `customAnimCaptionPresets: CaptionAnimStylePreset[]` on
  `ProjectDoc`. Phase 23 bundles carry them automatically because the field
  lives in `project.json`. A preset referenced by a track or segment that is
  not found in either the built-in list or `customAnimCaptionPresets` falls
  back silently to the `"subtitle"` preset; the project still opens with no
  data loss.

## R2 — Rasterization: glow and pills in Canvas2D

- **R2.1** Glow is rendered by extending `rasterizeTitleToCanvas()` in
  `src/engine/title.ts` with two additional Canvas2D shadow passes: first pass
  sets `ctx.shadowColor = glow.color`, `ctx.shadowBlur = glow.blurPx`,
  `ctx.shadowOffsetX = ctx.shadowOffsetY = 0` and draws an invisible fill to
  produce the halo; second pass draws the text body with `ctx.shadowBlur = 0`.
  No WebGPU shader changes are required.
- **R2.2** Per-line background pills are drawn in `rasterizeTitleToCanvas()`
  as rounded-rect fills (via `ctx.roundRect`) per text line, painted before
  text strokes and fills. Line metrics come from `ctx.measureText`; pill
  geometry expands by `pill.paddingXPx` horizontally and `pill.paddingYPx`
  vertically; `pill.radiusPx` rounds the corners.
- **R2.3** The GPU texture cache key must include glow and pill fields.
  `titleContentHash()` in `src/engine/title.ts` is extended to hash
  `glow.color`, `glow.blurPx`, `pill.paddingXPx`, `pill.paddingYPx`,
  `pill.radiusPx`, `pill.color`, `pill.opacity` alongside existing `TitleStyle`
  fields. Stale textures must never be served after a style change.
- **R2.4** Rasterization runs in the pipeline worker via the existing
  `TitleTextureCache` (which owns the OffscreenCanvas). No Canvas2D work runs
  on the main thread. The upload path is `copyExternalImageToTexture` — no
  `getImageData`, no CPU readback, no `putImageData`.
- **R2.5** Karaoke highlight: when `words` is present and a `highlightColor`
  is set in the preset, the rasterizer produces two texture variants per
  segment change: the full-line raster (no highlight) and a highlight raster
  where the active word at the current playhead is drawn in `highlightColor`
  while remaining words use the base style. On word-boundary crossing a new
  highlight raster replaces the previous one; the full-line raster is reused
  unchanged. When `words` is absent or `highlightColor` is unset, only the
  full-line raster is produced (karaoke silently disabled).
- **R2.6** CJK script falls back to the system font stack via canvas font
  fallback: `'LocalCut Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`.
  This stack is documented in a code comment in `rasterizeTitleToCanvas()` and
  in `docs/CAPTION-STYLES.md`. No CJK font is bundled.

## R3 — Composite-time animation (per-frame uniform, not per-frame raster)

- **R3.1** Enter and exit animations are applied at composite time by computing
  a `CaptionAnimUniforms` struct and passing it into the Phase 12 compositor as
  part of the caption `TextureCompositeLayer`. The cached texture is not
  re-rasterized per frame. The compositor submits one `queue.submit` per frame
  (hard gate 4 is not relaxed).
- **R3.2** `CaptionAnimUniforms` is defined in
  `src/engine/captions/animation-curves.ts` as:
  `{ opacity: number; translateXPx: number; translateYPx: number; scaleX: number; scaleY: number; cropRightFrac: number }`.
  Default identity: `{ opacity: 1, translateXPx: 0, translateYPx: 0, scaleX: 1, scaleY: 1, cropRightFrac: 1 }`.
- **R3.3** `computeCaptionAnimUniforms(preset, segStart, segDuration, currentTimeS): CaptionAnimUniforms`
  is exported from `src/engine/captions/animation-curves.ts`. It is a pure
  function with no side effects, suitable for Node-environment unit tests.
  It calls Phase 15 interpolation utilities from
  `src/engine/keyframes/interpolation.ts` (`lerp`, `easeInOut`, `easeOut`).
- **R3.4** When `animation.durationS` overlap exists (segment shorter than
  `2 × animation.durationS`), enter and exit durations are each clamped to
  `segDuration / 2`. At `t = 0.5` within the clamped window the animation is
  considered fully in.
- **R3.5** Animation curves per kind:
  - `'pop'`: enter — `scaleX/Y` eases `0 → 1.15 → 1.0` (overshoot),
    `opacity` eases `0 → 1`; exit — `scaleX/Y` eases `1.0 → 0.8`, `opacity`
    eases `1 → 0`.
  - `'bounce'`: enter — `translateYPx` animates `+40 → -8 → 0` px, `opacity`
    eases `0 → 1`; exit — `translateYPx` `0 → +40`, `opacity` `1 → 0`.
  - `'slide-up'`: enter — `translateYPx` eases `+60 → 0`, `opacity` `0 → 1`;
    exit — reverse.
  - `'slide-down'`: enter — `translateYPx` eases `-60 → 0`, `opacity` `0 → 1`;
    exit — reverse.
  - `'typewriter'`: enter — `cropRightFrac` advances `0 → 1` linearly over
    `durationS`; no exit animation (full line stays visible).
  - `'none'`: identity; no interpolation performed.
  - Karaoke word highlight does not use `cropRightFrac`; it swaps to a
    pre-rasterized highlight texture variant at word boundaries (see R2.5).
- **R3.6** `cropRightFrac` is applied in the compositor as a UV horizontal crop
  on the caption texture. If `TextureCompositeLayer` does not yet carry a
  `uvCropMax: [number, number]` uniform, it is added in
  `src/engine/compositor.ts` and the WGSL composite shader is extended with a
  `uvCropMax: vec2f` uniform (default `vec2f(1.0, 1.0)`). Caption layers pass
  `[cropRightFrac, 1.0]`; non-caption layers pass `[1.0, 1.0]` unchanged.
- **R3.7** Per-frame cost budget: `computeCaptionAnimUniforms` is O(1)
  arithmetic (no allocations, no Canvas2D, no GPU readback). Up to 3
  simultaneous animated caption segments add < 5 µs total per frame on a
  modern CPU, well within the realtime budget.

## R4 — Preset import/export (local-first)

- **R4.1** A "Export preset" button in the caption style Inspector panel calls
  `exportCaptionAnimPreset(preset)` (in `src/ui/CaptionStyleInspector.tsx`),
  which serializes the preset as UTF-8 JSON and triggers a save via
  `showSaveFilePicker` with suggested filename `<preset-id>.caption-preset.json`
  and type filter `{ description: 'Caption preset', accept: { 'application/json': ['.json'] } }`.
  When `showSaveFilePicker` is unavailable, falls back to `<a download>`.
- **R4.2** An "Import preset" button in the same panel opens a file picker
  (`showOpenFilePicker` or `<input type="file" accept=".json">`), reads the
  selected `.json` file, and validates it via `validateCaptionAnimPreset()` in
  `src/engine/captions/anim-style.ts`. Validation errors surface an inline
  message naming the first failing field; the project state is not mutated on
  error.
- **R4.3** On successful import, the preset is assigned a new UUID `id`
  (ignoring any `id` in the file), forced `builtIn: false`, and added to
  `ProjectDoc.customAnimCaptionPresets`. A success notice shows the preset's
  `label`. If a preset with the same `label` already exists in the project, the
  user is asked: "Update existing?" (overwrites the matching entry) or "Save as
  copy" (appends with new UUID).
- **R4.4** No network requests occur during import/export. The only I/O is the
  local File System Access or `<a download>` path.
- **R4.5** Preset JSON files are not included as separate assets in Phase 23
  media bundles. Custom presets live in `project.json`; a test asserts the
  Phase 23 bundle asset manifest never lists files with `captionStyleSchemaVersion`
  in their content.
- **R4.6** **Bounded memory.** Preset JSON files are read via `File.text()`
  (whole-file decode) — acceptable because preset files are user-authored
  stylesheet records with no embedded raster data. The validator caps file
  size at 64 KiB before parsing; oversized files are rejected with a
  field-named error. No streaming JSON parser is required at this scale.

## R5 — ProjectDoc schema migration (version 11 → 12)

> Note: v11 was claimed by Phase 46 (config persistence). Phase 30 is the
> `11 → 12` step. v10 documents migrate through v11 first via the existing
> chain; both v11 and v12 carry `customAnimCaptionPresets` as an optional
> array (Phase 30 is the producer; Phase 46 didn't touch the field).

- **R5.1** `PROJECT_SCHEMA_VERSION` in `src/engine/project.ts` is bumped from
  `11` to `12`. The validator/migration entry point is a new `deserializeV12`
  function in `src/engine/project.ts` (delegating to `deserializeV10` for the
  shared field surface). No transformation is required for documents already
  at v11 — `customAnimCaptionPresets` is optional and absent → `undefined`.
- **R5.2** `CaptionSegment.words` is optional; migration never touches existing
  segments. The validator in `src/engine/project.ts` (`parseCaptionSegment`)
  uses the `isRecord / requiredString / finiteNumber` pattern and treats
  `words` as entirely optional (undefined or a valid array).
- **R5.3** Documents at versions below 11 first run existing migrations to
  reach version 11, then the new `11 → 12` step applies. Each migration is a
  pure function; the chain is sequential.
- **R5.4** A document at version 12 opened by a build that expects version 11
  is caught by the existing "unknown version" guard in `src/engine/project.ts`
  (`deserializeProject` switch — unmatched `schemaVersion` returns
  `{ ok: false, reason: 'Unsupported project schemaVersion' }`).

## R6 — Preview/export parity

- **R6.1** `activeCaptionPayloadsAt(tracks, timeS, customPresets)` in
  `src/engine/captions/render.ts` is extended to accept the project's custom
  presets array and return, alongside each raster payload, the
  `CaptionAnimUniforms` computed for `timeS`. Both the preview rAF loop and the
  export frame pump call this function; parity is structural.
- **R6.2** Burn-in export writes the styled raster with the same composite
  uniforms as preview for the same `timeS`. No separate export rendering path
  exists for caption styling.
- **R6.3** `burnedIn: false` tracks skip composite-path inclusion; sidecar
  export in `src/engine/captions/export.ts` is unchanged (plain text only).
  Animated style fields are never written into SRT or VTT output.
- **R6.4** Styled captions survive Phase 23 bundle export/import:
  `customAnimCaptionPresets` in `ProjectDoc` serializes into `project.json`,
  and bundle import restores it exactly. The worker's `BundleWorkerContext.getProjectState()`
  must include the field so `runExportProjectBundle` passes it into
  `serializeProject`; without this thread-through, custom-preset references
  in segment styles survive but the preset definitions don't, and importing
  the bundle elsewhere silently falls back to `"subtitle"`. A regression test
  asserts a round-tripped bundle preserves at least one custom preset.

## R7 — Performance

- **R7.1** On the accelerated tier (WebGPU + SharedArrayBuffer + crossOriginIsolated),
  a 1080p preview with up to 3 simultaneously visible animated caption segments
  sustains 30 fps. Verified by manual smoke test (R9.4).
- **R7.2** A raster upload triggered by a text or style change must complete
  asynchronously and not block the rAF loop. The compositor shows the previous
  raster until the upload completes — no blank flash during re-rasterization.
- **R7.3** There must be no `getImageData`, Canvas2D readback, or CPU pixel
  round-trip anywhere in the caption animation per-frame path. This is enforced
  by code review per AGENTS.md P0 guidelines.

## R8 — Capability gating

- **R8.1** No new capability probe entries are required. Caption styling builds
  on Canvas2D (universally available) and the existing WebGPU compositor
  (already gated). Existing Phase 8/26 tiers are unchanged.
- **R8.2** On the reduced capability tier (no WebGPU), styled burn-in captions
  are not available; the Inspector shows the same reduced-tier notice as the
  Phase 22 baseline burn-in feature. Non-burned-in styled captions are
  unaffected.

## R9 — Tests and documentation

- **R9.1** `src/engine/captions/anim-style.test.ts`: all 10 built-in presets
  pass `validateCaptionAnimPreset()`; `resolveAnimPreset` fills all optional
  fields with defaults; import validation rejects each of: missing `id`,
  missing `captionStyleSchemaVersion`, wrong version number, missing `anchor`,
  `animation.durationS` below 0.05 and above 1.0; validation surfaces the
  offending field name; import forces `builtIn: false` and ignores the file's
  `id`.
- **R9.2** `src/engine/captions/animation-curves.test.ts`: for each of the 5
  animated kinds (`pop`, `bounce`, `slide-up`, `slide-down`, `typewriter`),
  asserts `computeCaptionAnimUniforms` at `t = 0`, `t = 0.5`, and `t = 1`
  normalized enter progress gives expected values within `±0.01`; asserts
  `'none'` returns exact identity; asserts overlap-clamp logic when segment is
  shorter than `2 × durationS`.
- **R9.3** `src/engine/captions/render.test.ts` (extends existing): adds cases
  for `activeCaptionPayloadsAt` with an animated preset — non-identity uniforms
  at a time inside the enter window; identity uniforms outside the animation
  window; karaoke `cropRightFrac` advances between word boundaries when `words`
  is present.
- **R9.4** `src/engine/title.test.ts` (extends existing): `titleContentHash`
  returns distinct hashes when `glow.color`, `glow.blurPx`, or `pill` fields
  change; hash is stable for identical inputs.
- **R9.5** `src/engine/project.test.ts` (extends existing): version 11 → 12
  upgrade preserves all v11 fields and leaves `customAnimCaptionPresets`
  `undefined` when absent; a v12 document with a non-empty
  `customAnimCaptionPresets` round-trips through `serializeProject` /
  `deserializeProject` with all entries intact; invalid preset entries are
  dropped gracefully without rejecting the whole document; existing caption
  tracks and segments survive v12 deserialization.
- **R9.6** All new tests run in Vitest Node environment with no media fixtures.
  Test count must grow. `npm run build` must pass (strict TypeScript).
- **R9.7** `docs/CAPTION-STYLES.md` is created covering: the 10 built-in preset
  reference table (id, label, animation kind, glow/pill flags); import/export
  workflow; animation type descriptions with parameter ranges; karaoke word-timing
  format (field names, constraints) and a note that Phase 29 ASR output populates
  the same field automatically; the CJK font fallback stack and its limitations;
  bundle portability guarantee. `docs/USER-GUIDE.md` is updated to link to
  `docs/CAPTION-STYLES.md`.
