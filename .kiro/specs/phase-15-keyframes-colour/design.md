# Design: Phase 15 — Keyframes + Advanced Colour

> Status: **Planned** — animate effect and transform parameters; LUT grading via 3D textures.

## Goal

Add per-parameter keyframe tracks sampled at one shared point so preview and export interpolate identically, plus `.cube` LUT import as a registry-style chain pass. Downstream uniform plumbing stays untouched — keyframes resolve to today's flat scalars before packing.

## Keyframe model

```
Keyframe { t, value, easing: 'linear' | 'ease' | 'hold' }
clip.keyframes?: Record<paramKey, Keyframe[]>   // absent = static scalar (today)
```

- Pure `src/engine/keyframes.ts`: insert/move/delete/sample with sorted invariants.
- `sampleClipParamsAt(clip, t)` collapses keyframe tracks onto flat `ClipEffectParams` + `TransformParams` immediately before uniform packing; the preview render callback (`src/engine/worker.ts`) and the export frame loop (`src/engine/export.ts`) both call it — preview equals export by construction.
- The snapshot keeps flat `effects` for the Inspector's current-value display and adds the optional `keyframes` sidecar (project `schemaVersion` bump; absent means static).

## LUT pass

- `src/engine/lut.ts` parses `.cube` (plain text parse, no eval; malformed files reject gracefully) into a 3D `GPUTexture`, cached per LUT file.
- New `lut-apply.wgsl` (+ `.f16`, behaviour-matched) samples the LUT with a strength uniform, registered as another `src/engine/effects.ts` registry entry — the registry is the designed extension point.

## Protocol + UI

- Commands `set-keyframe` / `delete-keyframe { clipId, key, t, value, easing }`, `import-lut { clipId, file }`, `set-lut-strength`.
- Inspector: per-slider keyframe diamond (toggle at playhead) and previous/next-keyframe navigation; reuse the existing 80ms debounce so one drag edits one keyframe.

## Validation

- Unit tests: keyframe insert/sort/sample/easing; `.cube` parser across valid/malformed/odd-sized files; preview-vs-export sampled-value continuity.
- f16 LUT banding check against the f32 fallback.
- Manual: animate opacity + position across a clip; apply a LUT with keyframed strength; export parity.
