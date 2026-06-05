# Tasks: Phase 3 — Timeline + Editing

> Status: **Planned**. Execution order respects dependencies.

## Model

- [ ] **T1.1** `timeline.ts` — `Clip`/`Track` ops: `split`, `remove`, `reorder`, `trim` (pure functions).
- [ ] **T1.2** `timeline.ts` — `resolveAt(timeline, t)` → `{ clip, sourceTime }`.
- [ ] **T1.3** Unit tests for every edit op and for `resolveAt` boundary cases.

## Protocol + worker

- [ ] **T2.1** `protocol.ts` — `split` / `delete-clip` / `move-clip` / `trim-clip` commands; `timeline-state` message.
- [ ] **T2.2** `worker.ts` — apply edits to the authoritative model; broadcast mirror snapshot.
- [ ] **T2.3** Multi-source import: assign stable `sourceId` per `Input`; keep inputs alive.

## Playback

- [ ] **T3.1** `playback.ts` — select source frame via `resolveAt` per timestamp.
- [ ] **T3.2** Seamless clip-boundary crossing (decode-ahead / pre-roll next clip).
- [ ] **T3.3** Seek resolves owning clip and decodes from nearest keyframe.

## Frame cache

- [ ] **T4.1** `frame-cache.ts` — LRU keyed by `(sourceId, timestamp)`, bounded by memory budget.
- [ ] **T4.2** Cache-hit scrubbing path; `.close()` evicted frames exactly once.

## UI

- [ ] **T5.1** `TimelineTrack.tsx` / `TimelineClip.tsx` — proportional blocks from the mirror.
- [ ] **T5.2** Draggable scrubhead + click-to-seek on ruler.
- [ ] **T5.3** Drag-reorder and edge-trim gestures emit edit commands (debounced).

## Verification

- [ ] **T6.1** Manual: split, delete, reorder, trim; play across boundaries; scrub.
- [ ] **T6.2** `npm run build` and `npm test` green.
- [ ] **T6.3** No `VideoFrame` leaks under scrub/seek stress (dev leak tracker clean).
