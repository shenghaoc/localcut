# Tasks: Phase 10 — Timeline UX + Gap Model

> Status: **Completed**. Land the gap model first — every interaction feature builds on time-based placement.

## Gap model

- [x] **T1.1** Add `moveClipTo(toStart)` with same-track overlap rejection; retire index-based `reorderClip`.
- [x] **T1.2** Change the `move-clip` payload to `toStart`; bump the project `schemaVersion` with the Phase 9 serializer.
- [x] **T1.3** Keep `relayoutSequential` behind an explicit `close-gaps` command only.
- [x] **T1.4** Unit-test moves, overlap rejection, gap preservation, and old-project compatibility.

## Zoom + scroll

- [x] **T2.1** `pxPerSecond` signal + scroll container in `Timeline.tsx`; clip geometry from `start × pps`.
- [x] **T2.2** Zoom controls + keyboard, recentred on the playhead; adaptive ruler ticks.

## Snapping

- [x] **T3.1** Add `src/ui/timeline-interaction.ts` with model-derived snap targets (edges, playhead, markers, zero) and threshold logic.
- [x] **T3.2** Wire drag/trim to snapping with a visible toggle; unit-test target resolution.

## Multi-select + clipboard + markers

- [x] **T4.1** Shift-click and marquee selection; selection set mirrored in UI state.
- [x] **T4.2** Batch `move-clips`/delete/`duplicate-clip` as single history entries.
- [x] **T5.1** Copy/paste (`paste-clips` at playhead) and duplicate.
- [x] **T5.2** Marker model + `add-marker`/`delete-marker` + ruler lane + next/previous navigation; persist via Phase 9.

## Keyboard

- [x] **T6.1** Add `src/ui/keyboard.ts`: focus-aware map for split (S), delete, J/K/L, zoom, undo/redo, clipboard.

## Verification

- [x] **T7.1** Model unit tests green (moves, overlap, snap, batch, markers); test count grows.
- [x] **T7.2** Manual: zoom + snap + marquee group-move + paste + marker hop on a long timeline.
- [x] **T7.3** `npm run build` and `npm test` green.
