# Design: Phase 11 — Media Library + Stills + Tracks

> Status: **Planned** — multi-asset authoring: a bin, stills, audio-only sources, and explicit tracks.

## Goal

Replace import-equals-placement with a media bin: assets import (in batches) as unplaced sources, then drag onto tracks the user manages explicitly. Image stills and audio-only files become first-class sources. All thumbnailing happens worker-side, budgeted, and off the accelerated hot path.

## Thumbnail path (off the hot path, no readback)

```
dedicated per-asset sink → VideoFrame
  → createImageBitmap(frame, { resizeWidth }) → frame.close()
  → transfer bitmap to UI
```

- Never the playback iterator: `SequentialFrameSource` forbids overlapping `frameAt` (`src/engine/frame-source.ts`), so thumbnails open their own sink per asset.
- Browser-side bitmap resize only — no `getImageData`, no Canvas2D readback, no GPU round-trip.
- Bounded concurrency + per-frame ceiling in the worker; transferred bitmaps land in a UI-side LRU store keyed `(sourceId, tBucket)` whose eviction discipline mirrors `src/engine/frame-cache.ts`; filmstrips re-sample on trim.
- Ownership is explicit: transfer detaches the bitmap from the worker, so the UI store owns it and must call `ImageBitmap.close()` on eviction, replacement, and unmount — closing frees GPU-side pixels, the same discipline as `VideoFrame.close()`. The worker keeps request bookkeeping only and regenerates on demand.
- Lives in new `src/engine/thumbnails.ts`, deliberately distinct from the limited-tier `src/compatibility/thumbnail.ts`.

## Still sources

`SequentialFrameSource` already wraps a minimal `samples()` interface — add `src/engine/still-source.ts` that decodes the image once and serves clones of that frame for any timestamp. `MediaInputHandle` gains `kind: 'video' | 'image' | 'audio'` (`src/engine/media-io.ts`); a still clip's duration is clip-driven and trims like any clip.

## Worker + protocol

- Import registers assets in a bin map and emits `media-asset` — no auto track creation (today `worker.ts` appends a track per import).
- `pruneUnusedSources` re-keys off bin membership so unplaced assets survive cleanup.
- Commands: multi-file `import`, `place-clip { sourceId, trackId, start }`, `set-still-duration`, `add-track`, `remove-track`, `reorder-track`. States: `media-asset`, `thumbnail`.

## UI

| Piece | Work |
|-------|------|
| `src/ui/MediaBin.tsx` (new) | asset list with metadata + thumbnail; drag to timeline |
| `src/ui/Timeline.tsx` | add/remove/reorder track controls; drop target uses Phase 10 free placement |
| `src/ui/TimelineClip.tsx` | filmstrip strip rendered from transferred bitmaps |

## Validation

- Batch-import several clips; place, trim, and play them across explicitly managed tracks.
- A still on an upper track holds its frame for its full duration; an audio-only file plays on an audio track.
- Thumbnails appear progressively without playback hitches; a decode-storm test shows no `VideoFrame` leak.
