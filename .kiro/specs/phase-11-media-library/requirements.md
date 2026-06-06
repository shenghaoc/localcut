# Requirements: Phase 11 — Media Library + Stills + Tracks

## R1 — Batch Import + Bin

- **R1.1** Import many files in one pick or drop; each lands in a media bin as an unplaced asset.
- **R1.2** The bin lists name, duration, stream summary, and a thumbnail per asset; assets drag onto timeline tracks.
- **R1.3** Importing no longer auto-creates tracks; placement is an explicit user action.

## R2 — Budgeted Thumbnails

- **R2.1** Thumbnails decode in the pipeline worker through a dedicated per-asset sink — never the playback iterator.
- **R2.2** Frames downscale via `createImageBitmap` resize and transfer as bitmaps; no `getImageData`, no Canvas2D readback, no GPU round-trip.
- **R2.3** Generation is budgeted (bounded concurrency, per-frame ceiling) and LRU-cached; playback never stalls behind thumbnails.
- **R2.4** Every decoded `VideoFrame` in the thumbnail path closes exactly once.

## R3 — Stills + Audio-Only Sources

- **R3.1** Image files import as still sources that serve one decoded frame for any timestamp; on-timeline duration is clip-driven and adjustable.
- **R3.2** Audio-only files import as audio assets and place onto audio tracks.

## R4 — Track Management

- **R4.1** Add, remove, and reorder video/audio tracks from the UI; empty tracks are valid.
- **R4.2** Source pruning keys off bin membership so unplaced assets survive.

## R5 — Filmstrips

- **R5.1** Video clips render a filmstrip sampled across the clip from the thumbnail cache; strips regenerate on trim.

## R6 — Tests

- **R6.1** Unit-test the still source's frame model and clip-driven duration.
- **R6.2** Unit-test track add/remove/reorder and prune-by-bin-membership.
- **R6.3** Unit-test thumbnail cache keys and eviction.
