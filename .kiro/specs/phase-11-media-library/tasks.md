# Tasks: Phase 11 — Media Library + Stills + Tracks

> Status: **Planned**. Bin + import flow first; thumbnails and stills ride the new asset registry.

## Bin + batch import

- [ ] **T1.1** Accept multi-file picks/drops; register assets in a worker bin map; emit `media-asset`.
- [ ] **T1.2** Stop auto-creating tracks on import; add `place-clip { sourceId, trackId, start }`.
- [ ] **T1.3** Add `src/ui/MediaBin.tsx`: asset list with metadata + thumbnail, drag-to-timeline.

## Thumbnails

- [ ] **T2.1** Add `src/engine/thumbnails.ts`: per-asset sink, `createImageBitmap` downscale, bitmap transfer.
- [ ] **T2.2** Budget generation (bounded concurrency, per-frame ceiling) and LRU-cache keyed `(sourceId, tBucket)`.
- [ ] **T2.3** Close every decoded `VideoFrame` exactly once; unit-test cache keys + eviction.

## Stills + audio-only

- [ ] **T3.1** Add `src/engine/still-source.ts` serving clones of one decoded frame; `MediaInputHandle.kind` discriminant.
- [ ] **T3.2** `set-still-duration` command; clip-driven duration trims like any clip; unit-test the frame model.
- [ ] **T3.3** Route audio-only files to audio assets/tracks.

## Tracks

- [ ] **T4.1** `add-track`/`remove-track`/`reorder-track` commands + Timeline UI controls; empty tracks valid.
- [ ] **T4.2** Re-key `pruneUnusedSources` off bin membership; unit-test pruning + track ops.

## Filmstrips

- [ ] **T5.1** Render filmstrip strips on video clips from the thumbnail cache; regenerate on trim.

## Verification

- [ ] **T6.1** Manual: batch import, drag from bin, still + audio-only placement, track add/remove/reorder.
- [ ] **T6.2** Thumbnails never hitch playback; decode-storm leak check passes.
- [ ] **T6.3** `npm run build` and `npm test` green; test count grows.
