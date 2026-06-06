# Design: Phase 13 — Transitions

> Status: **Planned** — cut-point transitions mixed inside the single submission, robust to trim and move.

## Goal

Attach transitions to the boundary between two same-track clips and mix them on the GPU during a window centred on the cut. The Phase 12 composite encoder gains one 2-input pass; the model gains a sibling `transitions[]` list that re-validates as clips edit.

## Model

```
Transition { id, trackId, fromClipId, toClipId, durationS, kind, params }
kind: 'cross-dissolve' | 'dip-to-black' | 'wipe' | 'slide'
```

- Boundary objects referenced by clip id — not overlap regions, which would fight `resolveAt`'s overlap shadowing (`src/engine/timeline.ts`) and break under trim.
- Centred on the cut: each side needs `durationS / 2` of source headroom, validated with the same source-bounds logic trim uses.
- Every edit re-validates adjacency; deleting or separating a neighbour drops the transition explicitly.

## Resolution + decode

- `resolveAllAt` (Phase 12) additionally reports `{ outgoing, incoming, mixT }` when the timestamp falls inside a transition window; both clips decode as readahead through `src/engine/frame-cache.ts`.
- Two clips cut from one source need a second decode sink — `SequentialFrameSource` forbids overlapping `frameAt` on a single iterator (the same constraint Phase 11 thumbnails solved with per-asset sinks).

## Mix pass

New `transition-mix.wgsl` (+ `.f16`, behaviour-matched) replaces the plain over-blend for the transition pair, parameterized by `kind` and `mixT` — still one encoder, one `queue.submit`. Export shares the identical path through `compositeLayers`; transitions are never re-implemented in `export.ts`.

## Protocol + UI

- Commands `add-transition`, `remove-transition`, `set-transition { durationS, kind }`; `timeline-state` carries the transition list; transitions persist in the project document.
- Cut-point affordance between adjacent clips in `Timeline.tsx`/`TimelineClip.tsx`; duration drag; kind picker in the Inspector.

## Validation

- Unit tests: placement validation, headroom clamping, survival/drop across trim/move/delete.
- Submission counter stays at one during transition windows; both frames close exactly once.
- Manual: dissolve between two clips, trim past the boundary (transition drops cleanly), export parity check.
