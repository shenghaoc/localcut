# Tasks: Phase 14 — Titles + Text

> Status: **Planned**. Model first, raster path second; composite integration reuses Phase 12 machinery.

## Title model

- [ ] **T1.1** Add source-less `kind: 'title'` clips with `title { text, style }`; create via `add-title`, edit via `set-title`.
- [ ] **T1.2** Ensure existing split/trim/move/delete ops handle title clips; serialize via Phase 9.
- [ ] **T1.3** Unit-test model ops and serialization.

## Raster path

- [ ] **T2.1** Add `src/engine/titles.ts`: worker OffscreenCanvas 2D raster, debounced on `set-title`.
- [ ] **T2.2** Upload via `copyExternalImageToTexture` into a texture cache keyed `(clipId, contentHash)` where the hash covers the text and every style field; comment the edit-only nature explicitly.
- [ ] **T2.3** Unit-test cache keying and invalidation across text changes and every style field, including the text-only-edit case.

## Composite integration

- [ ] **T3.1** Branch the `compositeLayers` loop: title layers bind the cached texture instead of an imported external texture — still one submission.
- [ ] **T3.2** Title position/scale flow through the Phase 12 transform uniform.

## Styles, fonts, safe areas

- [ ] **T4.1** Style controls (size, colour, background, outline, shadow, alignment) in the Inspector.
- [ ] **T4.2** Bundle open-licence fonts under `public/fonts/`; `FontFace`-load in the worker before raster; feature-detect `queryLocalFonts` as optional.
- [ ] **T4.3** Toggleable title/action safe-area guides as a DOM overlay on the preview.

## Verification

- [ ] **T5.1** Upload-once check: playback never rasters or uploads; edits do exactly once.
- [ ] **T5.2** Manual: lower-third over footage, live restyle, trim/move, export parity, offline raster.
- [ ] **T5.3** `npm run build` and `npm test` green; test count grows.
