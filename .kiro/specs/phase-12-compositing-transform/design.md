# Design: Phase 12 — Multi-Track Compositing + Transforms

> Status: **Planned** — cash in the reserved "colour → transform → overlays" slot without giving up the single submission.

## Goal

Render every overlapping video layer, not just the first match: `resolveAt` (`src/engine/timeline.ts`) gains a layered sibling `resolveAllAt`, and the renderer composites N transformed layers inside the one `GPUCommandEncoder` / one `queue.submit` the architecture demands. Per-clip transforms make picture-in-picture an arrangement, not a feature.

## Frame encoder sketch

```
ONE GPUCommandEncoder per frame:
  clear accumulator
  for each layer in resolveAllAt(t):     // track order = z-order, last on top
    importExternalTexture(frame)         // re-imported every frame, never cached
    colour chain (A/B/C scratch, per-layer params)
    transform pass (position/scale/rotation/anchor)
    composite-over (premultiplied) → accumulator
  present(accumulator)                   // preview
  capture(accumulator) → encoder         // export
ONE queue.submit
```

Multiple `importExternalTexture` calls per frame are expected and allowed — the gate bans caching imports *across* frames, not several within one. State this in code comments so reviews don't false-positive.

## Key refactor

`EffectChain` currently holds `params` as instance state (`src/engine/effects.ts`); layers differ within a frame, so `encodeColourChain` takes params per call. Both `present` and `renderForExport` (`src/engine/gpu.ts`) route through one new `compositeLayers(encoder, layers, accumulator)` — preview equals export by construction, and compositing is never re-implemented in `export.ts`.

## Model + protocol

- `TransformParams { x, y, scale, rotation, opacity, anchor }` on `TimelineClip`, identity by default; `setClipTransform` in `timeline.ts`.
- Command `set-transform`; `TimelineClipSnapshot.transform` added (project `schemaVersion` bump).
- Layer budget derives from the existing throughput probe; over-budget stacks drop the topmost layers with a visible notice.

## New shaders

`transform.wgsl` and `composite-over.wgsl` (+ `.f16` variants, behaviour-matched per house rule) in `src/engine/shaders/`.

## UI

- `src/ui/PreviewGizmo.tsx` (new): DOM-overlay drag/resize/rotate handles emitting transform commands — no canvas pixel access.
- Inspector gains a transform section (numeric fields + fit/fill/letterbox modes).

## Validation

- Submission-counter test holds at one per frame with 1, 2, and N layers.
- `resolveAllAt` ordering/overlap unit tests; transform packing + fit-mode math unit tests.
- Manual: stack two clips, PiP the top layer with the gizmo, export — preview and file match; every imported frame closed once.
