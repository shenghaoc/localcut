# Requirements: Phase 3 — Timeline + Editing

## R1 — Timeline model

- **R1.1** Authoritative timeline (tracks, clips, in/out points) lives in the pipeline worker (`timeline.ts`).
- **R1.2** Main thread holds a render-only mirror, updated via low-frequency state messages.
- **R1.3** Timeline mutations are commands sent worker-ward; the worker is the single source of truth.

## R2 — Editing operations

- **R2.1** Razor/split a clip at the playhead.
- **R2.2** Delete a clip; remaining clips keep their positions (no implicit ripple unless specified).
- **R2.3** Drag-reorder clips within and across compatible tracks.
- **R2.4** Edge-trim a clip's in/out points without re-importing the source.

## R3 — Timeline UI

- **R3.1** Proportional clip blocks rendered from the mirrored model (`TimelineTrack.tsx` / `TimelineClip.tsx`).
- **R3.2** Draggable scrubhead seeks; click-to-seek on the ruler.
- **R3.3** Drag/trim gestures emit timeline-edit commands (debounced where high-frequency).

## R4 — Playback across clips

- **R4.1** Playback reads the timeline to select the correct clip+source frame for each timestamp.
- **R4.2** Seamless playback across clip boundaries (no gap or stall at cuts).
- **R4.3** Seek resolves to the owning clip and decodes from its nearest keyframe.

## R5 — Frame cache

- **R5.1** LRU cache of decoded `VideoFrame`s around the playhead (`frame-cache.ts`).
- **R5.2** Scrubbing hits the cache instead of re-seeking when frames are resident.
- **R5.3** Evicted frames are `.close()`d exactly once; cache is bounded to a memory budget.

## R6 — Verification

- **R6.1** Unit tests for split/delete/reorder/trim on the pure `timeline.ts` model.
- **R6.2** Unit tests for timestamp → (clip, source-time) resolution.
- **R6.3** `npm run build` and `npm test` green; `crossOriginIsolated` unchanged.
