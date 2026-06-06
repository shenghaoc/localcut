# Tasks: Phase 15 — Keyframes + Advanced Colour

> Status: **Planned**. The shared sampler is the keystone — land it before any UI; LUT rides the effect registry.

## Keyframe model

- [ ] **T1.1** Add `src/engine/keyframes.ts`: `Keyframe { t, value, easing }`, pure insert/move/delete/sample with sorted invariants.
- [ ] **T1.2** Add the optional `keyframes` sidecar to clips + snapshot (`schemaVersion` bump); absent = static scalar.
- [ ] **T1.3** Unit-test insert/sort/sample/easing.

## Shared sampler

- [ ] **T2.1** Add `sampleClipParamsAt(clip, t)` collapsing keyframe tracks to flat effect + transform params before uniform packing.
- [ ] **T2.2** Route the preview render callback and the export frame loop through the same sampler.
- [ ] **T2.3** Continuity test: identical sampled values preview-vs-export across a keyframed parameter.

## Inspector UI

- [ ] **T3.1** Keyframe diamond per animatable slider (set/clear at playhead) + previous/next navigation.
- [ ] **T3.2** Reuse the 80ms debounce so one drag edits one keyframe; commands `set-keyframe`/`delete-keyframe`.

## LUT

- [ ] **T4.1** Add `src/engine/lut.ts`: `.cube` text parser (no eval, graceful rejection) → 3D `GPUTexture`, cached per file.
- [ ] **T4.2** Add `lut-apply.wgsl` (+ `.f16`) as an effect-registry entry with a strength uniform; `import-lut`/`set-lut-strength` commands + Inspector picker.
- [ ] **T4.3** Unit-test the parser; banding check f16 vs f32.

## Verification

- [ ] **T5.1** Manual: animate opacity/position, keyframed LUT strength, export parity.
- [ ] **T5.2** `npm run build` and `npm test` green; test count grows.
