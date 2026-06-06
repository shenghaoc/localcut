# Tasks: Phase 12 — Multi-Track Compositing + Transforms

> Status: **Complete**. Layered resolution first, then the encoder refactor — UI gizmo rides last.

## Layered resolution

- [x] **T1.1** Add `resolveAllAt` returning all overlapping video clips, z-ordered by track array position (last topmost).
- [x] **T1.2** Route preview (`worker.ts` render callback) and export (`export.ts` frame loop) through the layered result.
- [x] **T1.3** Unit-test ordering and overlap handling.

## Composite encoder

- [x] **T2.1** Refactor `EffectChain` so `encodeColourChain` takes per-call params instead of instance state (per-layer uniform-buffer pool keeps the single submission correct).
- [x] **T2.2** Add `compositeLayers(encoder, layers)` in `gpu.ts` taking the discriminated layer union (`'frame'` now; `'texture'` arm reserved for Phase 14); wire `present` and `renderLayeredForExport` through it.
- [x] **T2.3** Add `transform.wgsl` + `composite-over.wgsl` (+ `.f16` variants) and `clear.wgsl`; accumulator cleared to opaque black per frame.
- [x] **T2.4** Derive the layer budget from the throughput probe (`layerBudgetFromProbe`); degrade over-budget stacks visibly (drop topmost + one-time warning).

## Transform model

- [x] **T3.1** `TransformParams` on `TimelineClip` with identity defaults; `setClipTransform`; `set-transform` command; snapshot + `schemaVersion` bump (3 → 4).
- [x] **T3.2** Uniform packing with documented inverse-affine layout; unit-test packing and fit-mode math.

## Gizmo + fit modes

- [x] **T4.1** Add `src/ui/PreviewGizmo.tsx`: DOM drag/resize/rotate handles emitting transform commands (no canvas pixel access).
- [x] **T4.2** Inspector transform section with numeric fields and fit/fill/letterbox modes.

## Verification

- [x] **T5.1** Submission-counter test: one `queue.submit` per frame at 0/1/2/N layers.
- [ ] **T5.2** Manual: two-layer stack + PiP via gizmo; preview matches export; no frame leak. *(requires hardware WebGPU browser; not runnable in this CI-like env)*
- [x] **T5.3** `npm run build` and `npm test` green; test count grows (153 → 173).
