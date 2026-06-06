# Tasks: Phase 12 — Multi-Track Compositing + Transforms

> Status: **Planned**. Layered resolution first, then the encoder refactor — UI gizmo rides last.

## Layered resolution

- [ ] **T1.1** Add `resolveAllAt` returning all overlapping video clips, z-ordered by track array position (last topmost).
- [ ] **T1.2** Route preview (`worker.ts` render callback) and export (`export.ts` frame loop) through the layered result.
- [ ] **T1.3** Unit-test ordering and overlap handling.

## Composite encoder

- [ ] **T2.1** Refactor `EffectChain` so `encodeColourChain` takes per-call params instead of instance state.
- [ ] **T2.2** Add `compositeLayers(encoder, layers, accumulator)` in `gpu.ts` taking the discriminated layer union (`'frame'` now; `'texture'` arm reserved for Phase 14); wire `present` and `renderForExport` through it.
- [ ] **T2.3** Add `transform.wgsl` + `composite-over.wgsl` (+ `.f16` variants); accumulator texture cleared per frame.
- [ ] **T2.4** Derive the layer budget from the throughput probe; degrade over-budget stacks visibly.

## Transform model

- [ ] **T3.1** `TransformParams` on `TimelineClip` with identity defaults; `setClipTransform`; `set-transform` command; snapshot + `schemaVersion` bump.
- [ ] **T3.2** Uniform packing with documented offsets; unit-test packing and fit-mode math.

## Gizmo + fit modes

- [ ] **T4.1** Add `src/ui/PreviewGizmo.tsx`: DOM drag/resize/rotate handles emitting transform commands.
- [ ] **T4.2** Inspector transform section with numeric fields and fit/fill/letterbox modes.

## Verification

- [ ] **T5.1** Submission-counter test: one `queue.submit` per frame at 1/2/N layers.
- [ ] **T5.2** Manual: two-layer stack + PiP via gizmo; preview matches export; no frame leak.
- [ ] **T5.3** `npm run build` and `npm test` green; test count grows.
