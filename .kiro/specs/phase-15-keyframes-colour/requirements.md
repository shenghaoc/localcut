# Requirements: Phase 15 — Keyframes + Advanced Colour

## R1 — Keyframe Model

- **R1.1** Any animatable effect or transform parameter may carry an optional sorted keyframe track `{ t, value, easing }[]`; an absent track means today's flat scalar (backward compatible).
- **R1.2** Keyframe add/move/delete/sample are pure functions with sorted-order invariants; easing covers linear, ease, and hold.

## R2 — Shared Interpolation

- **R2.1** Keyframe tracks collapse to flat scalar params at one shared sampling point immediately before uniform packing; downstream effect/transform plumbing is unchanged.
- **R2.2** Preview and export both call the same sampler, so interpolated values are identical by construction.

## R3 — Inspector Keyframe UI

- **R3.1** Each animatable slider gains a keyframe diamond that sets/clears a keyframe at the playhead, plus previous/next-keyframe navigation.
- **R3.2** The existing parameter debounce is reused so one slider drag edits one keyframe.

## R4 — LUT Import

- **R4.1** `.cube` files parse (plain text, no eval) into a 3D GPU texture; malformed files reject gracefully.
- **R4.2** LUT application is a registry-style pass in the effect chain with a per-clip strength uniform; f16 and f32 variants stay behaviour-matched.

## R5 — Tests

- **R5.1** Unit-test keyframe insert/sort/sample/easing.
- **R5.2** Unit-test the `.cube` parser across valid, malformed, and differently sized files.
- **R5.3** Test preview-vs-export sampled-value continuity on a keyframed parameter.
