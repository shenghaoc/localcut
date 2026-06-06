# Requirements: Phase 12 — Multi-Track Compositing + Transforms

## R1 — Layered Resolution

- **R1.1** `resolveAllAt` returns every video clip overlapping a timestamp, ordered by track z-order (track array order; last track topmost).
- **R1.2** Preview and export both consume the layered result; single-clip lookups disappear from both paths.

## R2 — Single-Submission Composite

- **R2.1** Per frame, each layer imports its external texture, runs its colour chain, transforms, and composites premultiplied "over" onto an accumulator — all inside one `GPUCommandEncoder` and one `queue.submit`.
- **R2.2** External textures are re-imported every frame; multiple imports within one frame are expected, while caching across frames stays banned.
- **R2.3** Concurrent layer count is budgeted from the throughput probe; over-budget stacks degrade visibly, never silently stall.

## R3 — Per-Clip Transform

- **R3.1** Position, scale, rotation, opacity, and anchor are stored per clip; the identity transform is a no-op pass-through.
- **R3.2** Transforms pack into a uniform consumed by a dedicated compute pass; f16 and f32 shader variants stay behaviour-matched.

## R4 — Preview Gizmo + Fit Modes

- **R4.1** Drag/resize/rotate handles overlay the preview as DOM (no pixel access) and emit transform commands.
- **R4.2** Fit/fill/letterbox modes handle size-mismatched layers; picture-in-picture is just a transform.

## R5 — Tests

- **R5.1** Unit-test `resolveAllAt` ordering and overlap handling.
- **R5.2** Unit-test transform uniform packing and fit-mode math.
- **R5.3** A submission-counter test proves one submit per frame with N layers; every imported frame closes exactly once.
