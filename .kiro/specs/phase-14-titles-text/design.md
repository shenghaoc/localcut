# Design: Phase 14 — Titles + Text

> Status: **Planned** — text overlays rendered on edit, cached on the GPU, composited like any other layer.

## Goal

Title clips live on overlay tracks and carry text plus style. Rasterization happens only when the title changes — OffscreenCanvas 2D in the worker, uploaded once through `copyExternalImageToTexture` and cached — then every frame composites the cached texture through the Phase 12 layer machinery. The hot path never touches Canvas2D.

## Raster path (event-driven, not per-frame)

```
set-title (edit, debounced)
  → rasterizeTitle(text, style) on a worker OffscreenCanvas 2D
  → copyExternalImageToTexture → GPUTexture cached by (clipId, styleHash)

present/export (per frame)
  → cached texture enters compositeLayers as a layer (no import, no raster)
```

This is the engine's first 2D→GPU upload path — deliberately on the cold edit path. The upload happens on `set-title`, never inside `present`; code comments must say so explicitly so reviews don't flag a hot-path CPU round-trip.

## Model

- Title clips are source-less: `kind: 'title'`, `start`/`duration` like any clip, handled by existing split/trim/move/delete ops on overlay tracks.
- `title { text, style }` on the clip; style covers size, colour, background, outline, shadow, alignment.
- Position and scale ride the Phase 12 transform — the composite loop in `gpu.ts` gains a small branch that uses the cached title texture instead of an imported external texture, still inside the one submission.

## Fonts (offline-safe)

Bundle 2–3 open-licence fonts under `public/fonts/`, loaded in the worker with `FontFace` before the first raster. `queryLocalFonts` is a feature-detected enhancement only — the PWA must render titles offline.

## Protocol + UI

- Commands `add-title`, `set-title { text, style }`; `TimelineClipSnapshot` gains optional `title`.
- New `src/engine/titles.ts` owns the raster canvas + texture cache.
- Inspector: title text + style controls. Preview: toggleable title/action safe-area guides (pure DOM overlay on `PreviewCanvas.tsx`).

## Validation

- Unit tests: title model ops; `styleHash` keying invalidates on every style field and reuses on no-op edits.
- Upload-once check: edits upload a texture; playback frames do not raster or upload.
- Manual: lower-third over footage, restyle live, trim/move the title clip, export parity, raster works offline.
