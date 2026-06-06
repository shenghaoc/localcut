# Requirements: Phase 13 — Transitions

## R1 — Transition Model

- **R1.1** A transition attaches to the boundary between two adjacent same-track clips, referencing both clip ids with a duration and kind (cross-dissolve, dip-to-black, wipe, slide).
- **R1.2** A transition centred on the cut requires half its duration of source headroom on each side, validated against source bounds.
- **R1.3** Edits re-validate transitions: trimming, moving, or deleting a neighbour that breaks adjacency drops the transition explicitly, never silently corrupts it.

## R2 — Dual-Stream Readahead

- **R2.1** Inside a transition window both outgoing and incoming clips decode concurrently through the frame cache; playback does not stall at the boundary.
- **R2.2** Two clips drawing from one source use separate decode sinks — one sequential iterator is never read concurrently.

## R3 — Mix Pass

- **R3.1** A parameterized 2-input mix pass blends the two processed layers inside the existing single command submission, driven by the transition kind and progress.
- **R3.2** f16 and f32 shader variants stay behaviour-matched.

## R4 — UI + Export Parity

- **R4.1** Cut points between adjacent clips expose an affordance to add a transition, drag its duration, and pick its kind.
- **R4.2** Export renders transitions through the same encode path as preview; output matches preview.

## R5 — Tests

- **R5.1** Unit-test transition placement, headroom clamping, and survival/drop across trim, move, and delete.
- **R5.2** The submission counter stays at one per frame during transition windows; both decoded frames close exactly once.
