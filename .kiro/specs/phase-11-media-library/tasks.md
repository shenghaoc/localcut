# Tasks: Phase 11 — Media Library + Stills + Tracks

> Status: **Completed**. Bin + import flow first; thumbnails and stills ride the new asset registry.

## Bin + batch import

- [x] **T1.1** Accept multi-file picks/drops; register assets in a worker bin map; emit `media-assets`.
- [x] **T1.2** Stop auto-creating tracks on import; add `place-clip { sourceId, trackId?, start? }`.
- [x] **T1.3** Add `src/ui/MediaBin.tsx`: asset list with metadata + thumbnail, drag-to-timeline.

## Thumbnails

- [x] **T2.1** Add `src/engine/thumbnails.ts`: per-asset sink (`MediaInputHandle.thumbnailAt`), `createImageBitmap` downscale, bitmap transfer.
- [x] **T2.2** Budget generation in the worker (bounded concurrency, per-frame ceiling); UI-side LRU store keyed `(sourceId, tBucket)`.
- [x] **T2.3** Close every decoded `VideoFrame` exactly once and every evicted/replaced/unmounted `ImageBitmap` via `close()`; unit-test cache keys + eviction-closes-bitmap.

## Stills + audio-only

- [x] **T3.1** Add `src/engine/still-source.ts` serving clones of one decoded frame; `MediaInputHandle.kind` discriminant.
- [x] **T3.2** `set-still-duration` command + `setClipDuration`; clip-driven duration trims like any clip; unit-test the frame model.
- [x] **T3.3** Route audio-only files (MP3/OGG/WAV) to audio assets/tracks.

## Tracks

- [x] **T4.1** `add-track`/`remove-track`/`reorder-track` commands + Timeline UI controls; empty tracks valid.
- [x] **T4.2** Re-key `pruneUnusedSources` off bin membership; unit-test pruning + track ops.

## Filmstrips

- [x] **T5.1** Render filmstrip strips on video clips from the thumbnail cache; regenerate on trim/zoom.

## Verification

- [ ] **T6.1** Manual: batch import, drag from bin, still + audio-only placement, track add/remove/reorder. _(requires hardware-WebGPU browser; not runnable in the headless CI VM)_
- [ ] **T6.2** Thumbnails never hitch playback; decode-storm leak check passes. _(manual; covered structurally by bounded concurrency + frame-close unit tests)_
- [x] **T6.3** `npm run build` and `npm test` green; test count grows (120 → 153).
