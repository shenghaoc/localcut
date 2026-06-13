# Tasks: Phase 30 — Animated Caption Styles

## T1 — Animated style model and preset library (R1, R2 built-ins)

- [ ] **T1.1** Create `src/engine/captions/anim-style.ts`: export
  `CAPTION_ANIM_SCHEMA_VERSION = 1`, `CaptionAnimKind` union, `CaptionPillConfig`,
  `CaptionAnimConfig`, `CaptionAnimStylePreset` interface, and
  `ANIM_CAPTION_PRESETS` (10 required built-in presets, `Object.freeze`d). Each
  built-in must have a stable `id`, a non-empty `label`, and `builtIn: true`.
- [ ] **T1.2** Implement `resolveAnimPreset(presetId, customPresets)` in the
  same file: searches `ANIM_CAPTION_PRESETS` first, then `customPresets`, falls
  back to `ANIM_CAPTION_PRESETS[0]` (`"subtitle"`) when not found. Never throws.
- [ ] **T1.3** Implement `validateCaptionAnimPreset(raw)` in the same file using
  the `isRecord / requiredString / finiteNumber` pattern from
  `src/engine/project.ts`. Must enforce `captionStyleSchemaVersion === 1`,
  required string `anchor`, required number `maxWidthPercent` in `[20, 100]`,
  `animation.durationS` in `[0.05, 1.0]`, and return `{ ok: false; field; message }`
  naming the first offending field. Does not assign or validate `id` (caller
  does that on import).
- [ ] **T1.4** Export `ANIM_CAPTION_PRESET_DEFAULTS` const and
  `resolveAnimPreset` for use by all downstream callers so fallback logic is
  not duplicated. All optional fields must have a defined default value in this
  const.
- [ ] **T1.5** Extend `CaptionSegment` in `src/engine/captions/types.ts` with
  `words?: ReadonlyArray<{ text: string; startS: number; endS: number }>`.
  Update the type guard / validator in the same file to treat `words` as
  optional: accept undefined, accept a valid ordered non-overlapping array, and
  emit a non-fatal warning log (not a throw) for overlapping or out-of-range
  entries.

## T2 — ProjectDoc schema version bump and migration (R5)

- [ ] **T2.1** Bump `PROJECT_SCHEMA_VERSION` from `10` to `11` in
  `src/engine/project.ts`. Add `customAnimCaptionPresets?: CaptionAnimStylePreset[]`
  to the `ProjectDoc` interface. Update the hand-rolled validator to accept
  this field as optional (undefined → treated as empty array; if present, each
  element is validated by calling `validateCaptionAnimPreset`).
- [ ] **T2.2** Add migration step `10 → 11` in `src/engine/persistence.ts`:
  insert `customAnimCaptionPresets: []` when the field is absent. The migration
  is a pure function; no caption segment mutation is required. Chain it after
  the existing v9→v10 step.
- [ ] **T2.3** Verify the existing "unknown version" guard in
  `src/engine/persistence.ts` (the check that blocks documents at
  `schemaVersion > PROJECT_SCHEMA_VERSION`) remains intact — no change needed
  if the guard is generic, but add a comment citing this requirement.

## T3 — Raster extensions: glow and pills (R2 rasterization, R4 raster rules)

- [ ] **T3.1** Extend `TitleContent` or add `TitleRasterExtras` in
  `src/engine/title.ts` with optional `glow?: { color: string; blurPx: number }`
  and `pill?: CaptionPillConfig`. Extend `rasterizeTitleToCanvas(ctx, w, h, content, extras?)`:
  when `extras.glow` is set, add the two-pass shadow technique (zero-offset glow
  pass then text-body pass with `ctx.shadowBlur = 0`); when `extras.pill` is
  set, measure each text line and draw a `roundRect` fill before the text.
- [ ] **T3.2** Extend `titleContentHash(content, extras?)` in
  `src/engine/title.ts` to include `glow.color`, `glow.blurPx`, `pill.*`
  fields in the NUL-separated hash string. Callers that omit `extras` receive
  the same hash as before (backward-compatible).
- [ ] **T3.3** Update the call sites in `src/engine/captions/render.ts` (caption
  burn-in path) and `src/engine/titles.ts` (title clip path) to pass `extras`
  when resolving a `CaptionAnimStylePreset`. Non-caption callers pass `undefined`.
- [ ] **T3.4** Implement the karaoke highlight raster variant in
  `src/engine/captions/render.ts`: when `words` is present on the active segment
  and the preset has a `highlightColor`, rasterize a second texture variant
  (`captionTextureId(trackId, segmentId, 'highlight')`) with the active word
  drawn in `highlightColor`. Cache this variant in `TitleTextureCache` alongside
  the full-line raster. Re-rasterize only on word-boundary crossing or segment/
  style change — not per frame.

## T4 — Animation curves module (R3)

- [ ] **T4.1** Create `src/engine/captions/animation-curves.ts`: define and
  export `CaptionAnimUniforms` interface and `CAPTION_ANIM_IDENTITY` const.
- [ ] **T4.2** Implement `computeCaptionAnimUniforms(preset, segStartS, segDurationS, currentTimeS)`
  in the same file. Import Phase 15 utilities from
  `src/engine/keyframes/interpolation.ts` (`lerp`, `easeInOut`, `easeOut` —
  confirm exact exported names before coding). The function must be a pure
  function with no imports from browser-only modules.
- [ ] **T4.3** Implement the overlap-clamp logic: when
  `segDurationS < 2 × animation.durationS`, clamp each of enter and exit
  `durationS` to `segDurationS / 2`. Document with an inline comment.
- [ ] **T4.4** Implement `cropRightFrac` for typewriter: linearly advance from
  `0` to `1` over the enter `durationS` starting at `segStartS`. Exit is
  `'none'` for typewriter (hold at 1 through segment end) — lock this decision
  in a comment.
- [ ] **T4.5** Implement karaoke active-word identification: given a `words`
  array and `currentTimeS`, return the index of the active word where
  `word.startS <= currentTimeS < word.endS`, or `-1` when outside all word
  ranges. This function is a pure lookup (no animation interpolation) and is
  called from `activeCaptionPayloadsAt` to select the highlight texture variant.
  It does not call `computeCaptionAnimUniforms` (separate concern). Karaoke
  does not use `cropRightFrac` for word sweeping — the highlight variant is a
  fully rasterized texture swapped at word boundaries.

## T5 — Compositor crop-uniform extension (R3.6)

- [ ] **T5.1** Extend `TextureCompositeLayer` in `src/engine/compositor.ts` with
  `uvCropMax?: [number, number]` (default `[1.0, 1.0]` when absent).
- [ ] **T5.2** Update the WGSL composite shader (the relevant `.wgsl` file under
  `src/engine/` — find the file, do not guess the path) to accept a `uvCropMax`
  uniform per layer. Apply it as a UV clamp on the sample coordinate:
  `uv.x = clamp(uv.x, 0.0, uvCropMax.x)`. Only U is cropped (horizontal reveal);
  V is unclamped.
- [ ] **T5.3** Ensure existing non-caption layers pass `[1.0, 1.0]` when
  `uvCropMax` is absent, producing the same visual output as before. Add a
  brief comment explaining the caption-only nature of this uniform.

## T6 — Render integration: animated payloads (R6)

- [ ] **T6.1** Extend `CaptionRasterPayload` in `src/engine/captions/render.ts`
  with `animUniforms: CaptionAnimUniforms`. Update `activeCaptionPayloadsAt`
  to call `computeCaptionAnimUniforms` for each active segment and include the
  result. For segments on non-animated presets, include `CAPTION_ANIM_IDENTITY`.
- [ ] **T6.2** Add the `customPresets` parameter to `activeCaptionPayloadsAt`:
  `(tracks, timeS, customPresets: readonly CaptionAnimStylePreset[])`. Update
  all callers (preview path and export path) to pass the array from `ProjectDoc`.
- [ ] **T6.3** In the compositor path (worker), apply the `animUniforms` to the
  `TextureCompositeLayer` built from each `CaptionRasterPayload`:
  - Multiply the layer transform's `opacity` by `animUniforms.opacity`.
  - Add `animUniforms.translateXPx` / `translateYPx` to the layer transform
    (additive, not replacing the anchor-based position).
  - Set `scaleX`, `scaleY` on the layer transform.
  - Set `uvCropMax = [animUniforms.cropRightFrac, 1.0]` (active for typewriter
    animation; karaoke uses texture variant swap, so karaoke caption layers pass
    `[1.0, 1.0]`).
- [ ] **T6.4** Verify that the caption composite layers are included in the
  single `queue.submit` per frame — no additional submission is introduced.
  Add a `// single-submit invariant: caption layers included here` comment at
  the submit call site.

## T7 — Protocol extensions (R1.6, R4.2)

- [ ] **T7.1** Add `CaptionAnimCommand` variants to `WorkerCommand` in
  `src/protocol.ts`:
  `'caption-import-custom-preset'` (carries the validated preset after UUID
  assignment), `'caption-delete-custom-preset'` (carries `presetId`),
  `'caption-set-anim-style'` (carries `trackId`, optional `segmentId`,
  `presetId`), `'caption-set-words'` (carries `trackId`, `segmentId`,
  `words | null`). Follow existing kebab-case discriminant naming.
- [ ] **T7.2** Add `'caption-custom-presets-updated'` to `WorkerStateMessage`
  in `src/protocol.ts`, carrying `presets: readonly CaptionAnimStylePreset[]`.
  Worker emits this after any import/delete so the UI preset picker stays in sync.
- [ ] **T7.3** Handle all new commands in `src/engine/worker.ts`: mutate
  `ProjectDoc.customAnimCaptionPresets` and reply with
  `'caption-custom-presets-updated'`.

## T8 — Preset import/export UI (R4)

- [ ] **T8.1** Create or extend `src/ui/CaptionStyleInspector.tsx`:
  implement the preset picker grid (built-ins first, then custom presets);
  per-field override controls for `titleStyle`, `glow`, `pill`, `animation`;
  "Export preset" button calling `serializeAndSavePreset(preset)`;
  "Import preset" button calling `openAndImportPreset()`.
- [ ] **T8.2** Implement `serializeAndSavePreset(preset)`: serialize to UTF-8
  JSON, call `showSaveFilePicker` with `{ description: 'Caption preset', accept: { 'application/json': ['.json'] } }`
  and suggested name `<preset.id>.caption-preset.json`; fall back to
  `<a download>` when `showSaveFilePicker` is not defined. No worker message is
  sent for export (pure main-thread I/O).
- [ ] **T8.3** Implement `openAndImportPreset()`: open via `showOpenFilePicker`
  (fallback `<input type="file" accept=".json">`), read the file as text, call
  `validateCaptionAnimPreset(JSON.parse(...))`. On failure, show an inline error
  naming the offending field. On success, assign a new UUID (using `crypto.randomUUID()`),
  force `builtIn: false`, and dispatch `'caption-import-custom-preset'` to the
  worker. Display the label in a success notice.
- [ ] **T8.4** Implement the "Save as preset" action (saves current Inspector
  overrides as a new custom preset with a user-provided label): prompts for a
  label, builds a `CaptionAnimStylePreset` from the current state, dispatches
  `'caption-import-custom-preset'`.
- [ ] **T8.5** Implement the "Update / Save as copy" conflict resolution prompt
  (R4.3): when the incoming preset `label` matches an existing custom preset,
  show a two-button prompt; "Update" overwrites the matching entry by ID; "Save
  as copy" appends with a new UUID.
- [ ] **T8.6** Accessibility pass: keyboard reachable (Tab / Enter on all
  interactive elements), ARIA labels on all icon-only buttons, ARIA live region
  on the success/error notice, no media objects or GPU handles in this file,
  `onCleanup` for any signal subscriptions.

## T9 — Unit tests (R9.1–R9.5)

- [ ] **T9.1** Create `src/engine/captions/anim-style.test.ts`:
  - All 10 built-in presets pass `validateCaptionAnimPreset()`.
  - `resolveAnimPreset` returns the plain-subtitle fallback for an unknown ID.
  - `ANIM_CAPTION_PRESET_DEFAULTS` covers every optional field.
  - Validation rejects: missing `id`, wrong `captionStyleSchemaVersion` (0, 2,
    'foo'), missing `anchor`, `animation.durationS = 0.04` (below min),
    `animation.durationS = 1.01` (above max); each rejection names the field.
  - Import path: import sets `builtIn: false` and ignores the file's `id`.
- [ ] **T9.2** Create `src/engine/captions/animation-curves.test.ts`:
  - For each of the 6 kinds (pop, bounce, slide-up, slide-down, typewriter, none),
    assert `computeCaptionAnimUniforms` at t=0/0.5/1 (normalized enter progress)
    matches expected values within ±0.01.
  - Assert `'none'` returns exact `CAPTION_ANIM_IDENTITY` (no floating-point drift).
  - Assert overlap clamping: segment 0.3 s long with `durationS = 0.25` (overlap
    of 0.05 s) clamps each to 0.15 s; check that mid-segment t=0.15 s is in
    hold phase.
  - Assert karaoke active-word helper returns correct word index when
    `currentTimeS` falls within a word range, and returns `-1` outside all
    word ranges.
- [ ] **T9.3** Extend `src/engine/captions/render.test.ts`:
  - `activeCaptionPayloadsAt` with an animated preset at a time inside the enter
    window returns non-identity `animUniforms` (at minimum `opacity < 1` or
    `scaleX < 1` depending on kind).
  - At a time in the hold phase, returns `CAPTION_ANIM_IDENTITY`.
  - At a time in the exit window, returns non-identity uniforms in the expected
    direction.
  - Karaoke: texture ID switches to highlight variant when `currentTimeS`
    falls within a word range; uses full-line variant when `words` is absent
    or `currentTimeS` is outside all word ranges.
- [ ] **T9.4** Extend `src/engine/title.test.ts`:
  - `titleContentHash` returns distinct hashes when `glow.color` changes.
  - Distinct when `glow.blurPx` changes.
  - Distinct when `pill.radiusPx` changes.
  - Stable (same hash) for two calls with identical inputs.
  - Callers that pass `extras = undefined` get the same hash as before this
    extension (no regression in existing test cases).
- [ ] **T9.5** Extend `src/engine/captions/types.test.ts`:
  - `words` validator accepts a valid ordered non-overlapping array.
  - Accepts undefined/absent field (no error).
  - Emits a warning (not a throw) for overlapping word ranges.
  - Emits a warning for a word whose `endS` exceeds `segment.start + segment.duration`.
- [ ] **T9.6** Extend `src/engine/persistence.test.ts`:
  - v10 → v11 migration inserts `customAnimCaptionPresets: []` when absent.
  - A v11 document round-trips through serialize → parse with all fields intact.
  - Existing v10 caption tracks and segments load correctly post-migration (no
    field mutation on `CaptionSegment` entries).

## T10 — Quality gate verification

- [ ] **T10.1** `npm run build` succeeds with zero TypeScript errors. All new
  types must be strict-mode compatible (no `any` except at explicit runtime
  validation boundaries in validators, which must be cast to `unknown` on entry).
- [ ] **T10.2** `npm test` is green and the test count is strictly greater than
  before this phase. No existing test may be deleted or weakened.
- [ ] **T10.3** Confirm no `getImageData`, `toDataURL`, `readPixels`, or any
  other CPU pixel readback appears in the caption animation hot path. Search
  `src/engine/captions/` and `src/engine/compositor.ts` for these strings;
  annotate the result in the PR description.
- [ ] **T10.4** Confirm there is exactly one `queue.submit` call site per frame
  in `src/engine/compositor.ts` (or the relevant compositor file). If the
  `uvCropMax` extension added a second submit, refactor before merging.

## T11 — Documentation (R9.7)

- [ ] **T11.1** Create `docs/CAPTION-STYLES.md`: built-in preset reference table
  (id, label, enter animation kind, glow flag, pill flag); custom preset
  import/export workflow (file type, how to share); animation type descriptions
  with parameter ranges (`durationS [0.05, 1.0]`); karaoke word-timing format
  (`text`, `startS`, `endS`, ordering and overlap rules) with a note that Phase
  29 ASR output populates the `words` field automatically; CJK font fallback
  stack and its limitations (no bundled CJK font; system font fallback only);
  bundle portability guarantee (custom presets embed in `project.json`).
- [ ] **T11.2** Update `docs/USER-GUIDE.md` to include a "Caption styles and
  animation" section (or a link to `docs/CAPTION-STYLES.md`) if not already
  present, adjacent to the existing captions section.
- [ ] **T11.3** Manual smoke test (document result in PR description):
  import an SRT file → assign `"neon-glow"` preset → enable burn-in → scrub
  preview (verify glow renders, no blank flash on scrub) → play timeline
  (verify enter animation fires at segment start) → export MP4 → confirm
  burned-in frame at a fixed timestamp matches the preview screenshot at the
  same timestamp. Assign `"karaoke"` preset to a segment without `words` →
  confirm full-line style renders with no error in console.
