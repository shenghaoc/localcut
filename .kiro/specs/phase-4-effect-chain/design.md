# Design: Phase 4 — WebGPU Compute Effect Chain

> Status: **Planned**.

## Goal

Add per-clip colour effects as WGSL compute shaders, chained into a **single** command submission per frame. The processed texture feeds both preview and export (Phase 6) — the chain runs exactly once.

## Effect model (`effects.ts`)

- Registry entry: `{ id, label, shaderF32, shaderF16, uniformLayout, defaults }`.
- Pipelines compiled once at startup; the chosen f16/f32 variant is fixed at device acquisition.
- Per-clip parameters live in the timeline model; the worker packs them into uniform buffers per frame.

## Single-submission chain

```
GPUExternalTexture (imported this frame)
  → pass 1 colour grade   (→ storage A)
  → pass 2 transform/crop (A → storage B)   [future]
  → pass 3 overlays/text  (B → storage C)   [future]
  ── all encoded into ONE GPUCommandEncoder ──
  → queue.submit([encoder.finish()])   // single submission
  → C feeds preview present AND export encode
```

Phase 4 ships the colour-grade passes (brightness/contrast, saturation, colour temperature); transform/overlay slots are reserved in the encoder so later phases extend the same single submission.

## Parameter flow

```
Inspector slider ──(debounced param-update command)──▶ worker
worker: update uniform buffer (no recompile) ──▶ next frame reflects change
```

New `WorkerCommand`: `set-effect-param { clipId, effectId, key, value }`. The active effect list per clip travels in the Phase 3 `timeline-state` mirror.

## f16 gating

- `gpu.ts` requests `shader-f16`; on success, load `*.f16.wgsl`; else load f32.
- Variants are behaviourally identical — precision differs only. Keep math in sync between the pair.

## Modules to touch

| Module | Work |
|--------|------|
| `effects.ts` | Registry, pipeline compile, per-frame encoder builder |
| `gpu.ts` | Storage textures A/B/C; f16/f32 selection; timestamp queries |
| `shaders/*.wgsl` | brightness-contrast, saturation, colour-temperature (+ f16 variants) |
| `timeline.ts` | Per-clip effect assignments + parameters |
| `Inspector.tsx` | Sliders → debounced param-update commands |
| `protocol.ts` | `set-effect-param` command |

## Acceptance

- ≥3 adjustable effects via inspector, applied per clip.
- Entire effect chain is one command submission (verified via timestamp queries / submission counter).
- 1080p30 preview with 2–3 effects stays smooth.
- f16 path used when available, f32 fallback otherwise; identical visual result within precision.
- Preview and export share one processed texture (chain not run twice).
