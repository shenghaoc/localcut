# Requirements: Phase 14 — Titles + Text

## R1 — Title Clips

- **R1.1** Title clips are source-less clips (`kind: 'title'`) on overlay tracks with `start`/`duration` like any clip, placed/trimmed/moved by existing timeline operations.
- **R1.2** A title clip carries text plus a style object; both serialize into the project document.

## R2 — Edit-Time Raster

- **R2.1** Titles rasterize only when text or style changes — debounced, event-driven — never per frame.
- **R2.2** The raster uploads once per edit to a cached GPU texture keyed by clip id + a content hash covering the text and every style field; playback frames composite the cached texture without touching Canvas2D.
- **R2.3** Any text or style change invalidates exactly the affected cache entry; a text-only edit must never serve a stale texture.

## R3 — Styles + Fonts

- **R3.1** Style covers size, colour, background, outline, shadow, and alignment.
- **R3.2** Fonts are offline-safe: bundled open-licence fonts load in the worker before raster; `queryLocalFonts` is a feature-detected enhancement, never required.

## R4 — Layout + Safe Areas

- **R4.1** Title position and scale ride the Phase 12 transform machinery — no separate positioning system.
- **R4.2** The preview offers toggleable title/action safe-area guides as a pure DOM overlay.

## R5 — Tests

- **R5.1** Unit-test title clip model operations and serialization.
- **R5.2** Unit-test raster cache keying: text changes and every style field change invalidate; unchanged content reuses the cached texture; a text-only edit re-rasters.
