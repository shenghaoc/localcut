# Requirements: Phase 4 — WebGPU Compute Effect Chain

## R1 — Effect registry

- **R1.1** Each effect = a WGSL compute shader + a typed uniform-buffer layout (`effects.ts`).
- **R1.2** Pipelines compile once at startup, not per frame.
- **R1.3** At minimum: brightness/contrast, saturation, colour temperature.

## R2 — Single-submission chain

- **R2.1** The full active effect chain encodes into one `GPUCommandEncoder` and submits once per frame.
- **R2.2** Compute passes ping-pong storage textures (A → B → C); no CPU readback between passes.
- **R2.3** Submission count per frame is exactly one for the effect chain (verifiable via timestamp queries).

## R3 — Per-clip parameters

- **R3.1** Effects assigned per clip with parameter values stored in the timeline model.
- **R3.2** Inspector sliders emit debounced parameter-update commands to the worker.
- **R3.3** Parameter changes update uniforms only — no pipeline recompile.

## R4 — f16 / f32 variants

- **R4.1** Request the `shader-f16` device feature; load `*.f16.wgsl` variants when granted.
- **R4.2** Provide behaviourally identical f32 fallback shaders when absent.
- **R4.3** Variant selection happens once at device acquisition.

## R5 — Shared preview/export texture

- **R5.1** Preview present and export encode consume the **same** processed output texture.
- **R5.2** The effect chain is never run twice for one frame.

## R6 — Verification

- **R6.1** ≥3 adjustable effects via inspector, applied per clip.
- **R6.2** 1080p30 preview with 2–3 effects stays smooth.
- **R6.3** Timestamp-query (or submission counter) confirms one submission per frame.
- **R6.4** `npm run build` and `npm test` green.
