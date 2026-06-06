# Tasks: Phase 14 — Titles + Text

> Status: **Implemented**. Model first, raster path second; composite integration reuses Phase 12 machinery.

## Title model

- [x] **T1.1** Add source-less `kind: 'title'` clips with `title { text, style }`; create via `add-title`, edit via `set-title`.
- [x] **T1.2** Ensure existing split/trim/move/delete ops handle title clips; serialize via Phase 9 (schema v6).
- [x] **T1.3** Unit-test model ops and serialization (`title.test.ts`, `timeline.test.ts`, `project.test.ts`).

## Raster path

- [x] **T2.1** Add `src/engine/titles.ts`: worker OffscreenCanvas 2D raster, run on `add-title`/`set-title` (debounced in the Inspector).
- [x] **T2.2** Upload via `copyExternalImageToTexture` into a texture cache keyed `(clipId, contentHash)` where the hash covers the text and every style field; the edit-only nature is commented explicitly.
- [x] **T2.3** Unit-test cache keying and invalidation across text changes and every style field, including the text-only-edit case (`titles.test.ts`).

## Composite integration

- [x] **T3.1** Branch the `compositeLayers` loop: title layers bind the cached texture instead of an imported external texture — still one submission.
- [x] **T3.2** Title position/scale flow through the Phase 12 transform uniform.

## Styles, fonts, safe areas

- [x] **T4.1** Style controls (size, colour, background, outline, shadow, alignment) in the Inspector.
- [x] **T4.2** Bundle open-licence fonts under `public/fonts/` (Inter + Lora, OFL); `FontFace`-load in the worker before raster; feature-detect `queryLocalFonts` as optional (`hasLocalFontAccess`).
- [x] **T4.3** Toggleable title/action safe-area guides as a DOM overlay on the preview.

## Verification

- [x] **T5.1** Upload-once check: `get` never rasters/uploads, `rasterize` uploads once and reuses on no-op (`titles.test.ts`).
- [ ] **T5.2** Manual: lower-third over footage, live restyle, trim/move, export parity, offline raster.
- [x] **T5.3** `npm run build` and `npm test` green; test count grew 180 → 206.
