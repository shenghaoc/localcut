# Tasks: Phase 39 — Vertical and Platform Finishing

## T1 — Project aspect-ratio mode: data model and schema (R1)

- [ ] **T1.1** `src/protocol.ts`: add `ProjectAspect = '16:9' | '9:16' | '1:1' | '4:5'`
  type alias; add `ProjectFormat { aspect: ProjectAspect }` interface; add
  `CoverFrameDoc { timeS: number; titleClipId?: string | null }` interface;
  extend `ExportPresetDoc` with `targetLufs?: number`.
- [ ] **T1.2** `src/engine/project.ts`: add `projectFormat?: ProjectFormat` and
  `cover?: CoverFrameDoc` to `ProjectDoc`; bump `PROJECT_SCHEMA_VERSION` to the
  next unused number above 10 (check merged state of PR #63 before assigning);
  write `parseProjectFormat(value: unknown): ProjectFormat` (defaults unknown
  aspect to `'16:9'`) and `parseCoverFrame(value: unknown): CoverFrameDoc |
  undefined` using `finiteNumber`/`optionalString`; call both from
  `deserializeProject`, falling back to `{ aspect: '16:9' }` and `undefined`
  respectively; update `serializeProject` to include both fields when present;
  update `SerializeProjectOptions` to include `projectFormat?` and `cover?`.
- [ ] **T1.3** `src/engine/project.ts` (or a new `src/engine/aspect.ts`): add
  `ASPECT_OUTPUT_SIZES` constant map and export
  `aspectOutputSize(aspect: ProjectAspect): { width: number; height: number }`.
- [ ] **T1.4** `src/protocol.ts`: add to `WorkerCommand` union:
  `| { type: 'set-project-format'; aspect: ProjectAspect }`
  `| { type: 'set-cover-frame'; timeS: number; titleClipId?: string | null }`;
  add to `WorkerStateMessage` union:
  `| { type: 'project-format-changed'; aspect: ProjectAspect }`
  `| { type: 'cover-frame-changed'; cover: CoverFrameDoc | null }`.

## T2 — Worker: aspect-mode command handling (R1)

- [ ] **T2.1** `src/engine/worker.ts`: declare a module-level `let projectFormat:
  ProjectFormat = { aspect: '16:9' }` mirroring the worker's view of the
  project format; initialise it when a project is loaded or restored from a
  snapshot (same point where `timeline`, `captionTracks`, etc. are restored).
- [ ] **T2.2** `src/engine/worker.ts`: handle `'set-project-format'` command:
  push an undo snapshot; update `projectFormat`; re-run `buildPreviewLadder`
  with `aspectOutputSize(aspect)`, re-initialise `adaptive`, call
  `ensurePreview()` so whichever renderer is active resizes from the new
  adaptive tier, and post `{ type: 'project-format-changed', aspect }`.
- [ ] **T2.3** `src/engine/worker.ts`: update `TITLE_ONLY_CANVAS` usage (lines
  ~246, ~3601–3602, ~3767–3769) to derive width/height from
  `aspectOutputSize(projectFormat.aspect)` instead of the hardcoded
  `{ width: 1920, height: 1080 }`.
- [ ] **T2.4** `src/engine/worker.ts`: handle `'set-cover-frame'` command: push
  an undo snapshot; update a module-level `let cover: CoverFrameDoc | null`;
  post `{ type: 'cover-frame-changed', cover }`.
- [ ] **T2.5** `src/engine/worker.ts`: include `projectFormat` and `cover` in
  the `serializeProject` call used by autosave/snapshot so they survive page
  reloads and undo/redo.

## T3 — Export: cover-frame generation (R3)

- [ ] **T3.1** `src/engine/project-bundle/types.ts`: add `'cover'` to
  `BundleAssetKind` union: `export type BundleAssetKind = 'media' | 'lut' |
  'caption' | 'thumbnail' | 'waveform' | 'proxy' | 'cover'`.
- [ ] **T3.2** `src/protocol.ts` (or `src/engine/render-queue.ts`): add
  `coverExportError: string | null` to `RenderQueueJob` (and
  `PersistedQueueJob` if that mirrors the same type); add
  `| { type: 'cover-export-warning'; jobId: string; error: string }` to
  `WorkerStateMessage`.
- [ ] **T3.3** `src/engine/worker.ts`: implement `exportCoverFrame(cover:
  CoverFrameDoc, outputStem: string, outputDir: FileSystemDirectoryHandle):
  Promise<{ ok: true } | { ok: false; error: string }>` following the design
  steps: seek compositor → render one frame → `copyTextureToBuffer` →
  `createImageBitmap` → `OffscreenCanvas.convertToBlob({ type: 'image/jpeg',
  quality: 0.9 })` → write `<outputStem>.cover.jpg` to `outputDir`. Include
  the comment `// Cover export: one-shot readback, not a sustained pixel loop
  — hard gate 2 exemption` before the readback step.
- [ ] **T3.4** `src/engine/worker.ts`: call `exportCoverFrame` after a
  render-queue job's video mux is complete if `cover !== null`. Store a
  failure result in `job.coverExportError` and post `cover-export-warning`;
  do not fail the overall job.
- [ ] **T3.5** Bundle serializer (`src/engine/project-bundle/`): when `cover`
  is set, accept a worker-provided cover JPEG blob, write it as
  `cover/<stem>.cover.jpg`, and include it as a `BundleAsset` with
  `kind: 'cover'`.

## T4 — Platform export presets (R4)

- [ ] **T4.1** `src/engine/export-presets.ts`: extend `BUILT_IN_PRESETS` with
  the six platform presets from R4.2 (Douyin 1080×1920@30, Shorts 1080×1920@30,
  Shorts 1080×1920@60, Reels 1080×1920@30, Xiaohongshu 1080×1350@30,
  Xiaohongshu Square 1080×1080@30); each row sets `builtIn: true` and includes
  `targetLufs: -14`.
- [ ] **T4.2** `src/engine/export-presets.ts`: update `parseExportPresetDoc` to
  pass `targetLufs: finiteNumber(value.targetLufs) ?? undefined` through;
  update `createPresetFromSettings` to accept and forward optional `targetLufs`.
- [ ] **T4.3** `src/engine/export-presets.ts`: add
  `resolvePlatformPresetCodec(preset: ExportPresetDoc, probe: CapabilityProbeResult):
  { codec: ExportVideoCodec; container: ExportContainer } | { blocked: true; reason: string }`
  that first honors the preset's requested codec/container when supported, then
  falls back between H.264/MP4 and VP9/WebM; import
  `exportConstraintsForProbe` from `src/engine/capability-probe-v2.ts`.

## T5 — Safe-zone JSON and validator (R2)

- [ ] **T5.1** Create `public/safe-zones/safe-zones.v1.json` with the four
  platform entries from the design (Douyin, Xiaohongshu, Shorts, Reels) with
  the zone rect values given in `design.md`.
- [ ] **T5.2** Create `src/engine/safe-zones.ts` exporting: `SafeZoneRect`,
  `SafeZoneEntry`, `SafeZonePlatform`, `SafeZoneFile` interfaces;
  `validateSafeZoneFile(json: unknown): SafeZoneFile | null` with hand-rolled
  validation (no zod) checking schema version, supported platform `aspect`,
  array non-emptiness, zone `kind` membership, and rect values in [0, 1] with
  x+w ≤ 1 and y+h ≤ 1; returns
  `null` (never throws) on any violation; logs a `console.error` describing
  the first failure.

## T6 — UI: format picker and aspect-ratio preview (R1)

- [ ] **T6.1** `src/ui/App.tsx`: add `const [projectAspect, setProjectAspect] =
  createSignal<ProjectAspect>('16:9')`; update the `project-format-changed`
  message handler (in the worker message switch) to call `setProjectAspect`;
  derive `previewAspectStyle` as a memo returning the CSS string
  `"${outW} / ${outH}"` from `aspectOutputSize(projectAspect())`.
- [ ] **T6.2** `src/ui/App.tsx`: apply `style={{ '--preview-aspect': previewAspectStyle() }}`
  on the `.preview` container element so CSS `var(--preview-aspect)` resolves
  to the current output aspect.
- [ ] **T6.3** `src/global.css`: change `.preview-canvas`, `.safe-area-overlay`,
  and `.safe-zone-overlay` to use the same project-format sizing inputs:
  `aspect-ratio: var(--preview-aspect, 16 / 9)`, a numeric
  `var(--preview-aspect-num, 1.778)` fallback in both canvas and overlay width
  formulas, and the measured `--preview-canvas-*` custom properties so overlays
  align to the displayed canvas rather than the full preview panel.
- [ ] **T6.4** `src/ui/App.tsx` (preview toolbar): add a segmented-control
  `<fieldset role="group" aria-label="Project format">` with four radio-button
  styled items: `16:9 Landscape`, `9:16 Vertical`, `1:1 Square`, `4:5 Portrait`;
  on change, post `{ type: 'set-project-format', aspect }` to the worker;
  each item has `aria-label="Set project format to <aspect> (<name>)"`.

## T7 — UI: safe-zone overlay and platform picker (R2)

- [ ] **T7.1** Create `src/ui/SafeZoneOverlay.tsx`: a SolidJS component accepting
  `platform: SafeZonePlatform | null` and `outputWidth: number; outputHeight:
  number` props; renders a `<div class="safe-zone-overlay" aria-hidden="false">`
  with one child `<div>` per zone; each child is positioned absolutely using
  `left: zone.rect.x * 100 + '%'`, `top: zone.rect.y * 100 + '%'`,
  `width: zone.rect.w * 100 + '%'`, `height: zone.rect.h * 100 + '%'`; styled
  by `zone.kind` per the design; each child has `aria-label={zone.label}` and
  `title={zone.label}`.
- [ ] **T7.2** `src/global.css`: add `.safe-zone-overlay` (position absolute,
  inset 0, pointer-events none, z-index 3); add `.safe-zone-rect-occluded`
  (background rgb(255 80 80 / 22%), border 1px dashed rgb(255 80 80 / 70%),
  position absolute, box-sizing border-box); add `.safe-zone-rect-caution`
  (background rgb(255 200 0 / 10%), border 1px dashed rgb(255 200 0 / 55%),
  position absolute, box-sizing border-box).
- [ ] **T7.3** `src/ui/App.tsx`: fetch `safe-zones/safe-zones.v1.json` on mount
  by prepending `import.meta.env.BASE_URL` and validate with
  `validateSafeZoneFile`; store the result in a signal
  `const [safeZoneFile, setSafeZoneFile] = createSignal<SafeZoneFile | null>(null)`.
  If validation fails, log a console error but do not crash the shell.
- [ ] **T7.4** `src/ui/App.tsx` (preview toolbar): add a platform picker
  `<select aria-label="Safe zone platform">` with `<option value="">Off</option>`
  followed by options for each platform in `safeZoneFile()` whose `aspect`
  matches `projectAspect()`; store selected platform id in
  `const [selectedPlatformId, setSelectedPlatformId] = createSignal<string>('')`.
  When `projectAspect()` changes and the selected platform's aspect no longer
  matches, reset `selectedPlatformId` to `''`.
- [ ] **T7.5** `src/ui/App.tsx`: render `<SafeZoneOverlay>` inside the `.preview`
  container (sibling to `.safe-area-overlay`) with `platform` derived from
  `safeZoneFile()?.platforms.find(p => p.id === selectedPlatformId()) ?? null`
  and `outputWidth`/`outputHeight` from `previewSize()`.

## T8 — UI: cover-frame picker (R3)

- [ ] **T8.1** `src/ui/App.tsx`: add `const [coverFrame, setCoverFrame] =
  createSignal<CoverFrameDoc | null>(null)`; update the `cover-frame-changed`
  message handler to call `setCoverFrame`.
- [ ] **T8.2** `src/ui/App.tsx` (Inspector panel or preview toolbar): add a
  "Set Cover Frame" button; on click, post `{ type: 'set-cover-frame', timeS:
  currentTime(), titleClipId: null }` to the worker; include an optional
  title-clip selector `<select>` listing clips from `titleClips()` so the user
  can pick a title overlay.
- [ ] **T8.3** `src/ui/App.tsx`: when `coverFrame()` is non-null, request a
  composited cover thumbnail via `{ type: 'request-cover-thumbnail', timeS,
  titleClipId }`; create an object URL for the returned JPEG blob, revoke stale
  URLs on cleanup, and render the result with `aria-label="Cover frame preview"`
  next to the button.
- [ ] **T8.4** `src/ui/App.tsx`: display `coverExportError` (from
  `cover-export-warning` messages) as a non-blocking inline warning in the
  render queue panel: "Cover export failed: <error>".

## T9 — Export dialog: aspect-mismatch warning and preset codec resolution (R1, R4)

- [ ] **T9.1** `src/ui/ExportDialog.tsx`: after the user selects a preset or
  changes export dimensions, accept `projectAspect` as an `ExportDialogProps`
  prop from `App.tsx` and compute whether `settings.width / settings.height`
  matches that project aspect ratio (within a 1% tolerance); if not, show an
  inline `<p class="export-aspect-warning" role="alert">` reading
  "Export dimensions (<w>×<h>) do not match project format (<aspect>). The
  output may appear letterboxed."
- [ ] **T9.2** `src/ui/ExportDialog.tsx`: when a platform preset is selected,
  call `resolvePlatformPresetCodec(preset, capabilityProbe())` from
  `src/engine/export-presets.ts`; if the result has `blocked: true`, show an
  `<p class="export-preset-blocked" role="alert">` with the reason string and
  disable the Export button; if the result is a fallback (vp9 instead of h264),
  show a banner "H.264 is not supported on this device; falling back to VP9
  (WebM)."
- [ ] **T9.3** `src/ui/ExportDialog.tsx`: show platform presets (those with ids
  matching `builtin-douyin-*`, `builtin-shorts-*`, `builtin-reels-*`,
  `builtin-xhs-*`) in a dedicated "Platform" group in the preset selector,
  sorted with aspect-matching presets first and mismatched presets below a
  divider.

## T10 — Unit tests (R5)

- [ ] **T10.1** `src/engine/safe-zones.test.ts` (new file): import
  `../../../public/safe-zones/safe-zones.v1.json` with `{ assert: { type:
  'json' } }` and call `validateSafeZoneFile`; assert non-null. Cases:
  rejects `safeZoneSchemaVersion` ≠ 1; rejects `rect.x + rect.w > 1`;
  rejects `rect.y + rect.h > 1`; rejects `kind: 'unknown-kind'`; returns null
  (no throw) for `null`, empty object, array input.
- [ ] **T10.2** `src/engine/project.test.ts` (extend existing or create adjacent):
  serialise a `ProjectDoc` with `projectFormat: { aspect: '9:16' }` and
  `cover: { timeS: 12.5, titleClipId: 'clip-abc' }`; deserialise and assert
  both fields equal the input. Serialise without `projectFormat`; deserialise
  and assert `projectFormat.aspect === '16:9'`. Assert the `schemaVersion` in
  the serialised output equals the new bumped constant.
- [ ] **T10.3** `src/engine/export-presets.test.ts` (extend): assert all six
  platform preset ids exist in `BUILT_IN_PRESETS` and each has a valid codec,
  container, positive width/height/fps/videoBitrate, and `targetLufs` present.
  Assert `targetLufs: -14` survives `parseExportPresetDoc`.
  `resolvePlatformPresetCodec` cases: h264 supported → `{ codec: 'h264' }`; h264
  unsupported + vp9 supported → `{ codec: 'vp9', container: 'webm' }` (assert
  no banner suppression); both unsupported → `{ blocked: true }` with a
  non-empty `reason` string.

## T11 — Docs and quality gate (R5)

- [ ] **T11.1** `docs/USER-GUIDE.md`: add section **"Project format"** explaining
  16:9/9:16/1:1/4:5 modes, that clips re-letterbox automatically on format
  change, and that the change is undoable.
- [ ] **T11.2** `docs/USER-GUIDE.md`: add section **"Platform safe zones"**
  describing the platform picker, the occluded/caution visual encoding, and a
  note that zone estimates are editorial and updatable.
- [ ] **T11.3** `docs/USER-GUIDE.md`: add section **"Cover frame"** explaining
  how to set a cover frame, optional title overlay, and where the
  `<stem>.cover.jpg` file appears after export.
- [ ] **T11.4** `docs/USER-GUIDE.md`: add section **"Platform export presets"**
  with the preset table from R4.2, the codec-fallback behaviour, the
  aspect-mismatch warning, and a note that `targetLufs` is stored for future
  Phase 36 loudness normalisation but is currently inert.
- [ ] **T11.5** Verify `npm run build` exits 0 with strict TypeScript (no new
  `any` casts, no unresolved types). Verify `npm test` exits 0 and test count
  is greater than before this phase.
