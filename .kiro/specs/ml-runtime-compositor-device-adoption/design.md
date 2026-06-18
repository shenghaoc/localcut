# Design — ML runtime: compositor single-device adoption

> **Plan only — not yet implemented.** Implementation is intended for a later
> agent. This document records the approach, the key risk (a live device swap of a
> large compositor), and the recommended sequencing.

## Problem

`PreviewRenderer` (`src/engine/gpu.ts`) is constructed in `initGpu()` on a device
obtained from `adapter.requestDevice()`, at editor boot — before any ML runtime
loads (ML is lazy, no-startup-load). ORT, when a frame-coupled WebGPU engine
first loads, creates **its own** device (#26107) and exposes it as
`handle.device`. The frame-coupled engines (PR #121) already run their WGSL passes
on ORT's device, but their output textures therefore live on a device the
compositor can't bind. PR #121 added `MatteBackendEngine.compositesOnRendererDevice`
(and worker guards) so the compositor refuses those cross-device views; this spec
removes that refusal by putting the compositor on ORT's device.

## Why this is non-trivial

`PreviewRenderer` owns ~30 `readonly` device-bound pipelines/bind-group layouts
created in its constructor, plus ~20 lazily-allocated per-size resources
(storage/transform/accumulation/scope/skin textures and uniform buffers). A device
is not transferable, and these handles are device-specific, so "adopting" ORT's
device is not a field assignment — it is a full rebuild of the renderer's GPU
state on the new device. That is why PR #121 explicitly deferred it.

## Recommended approach: lazy renderer rebuild (approach A)

1. **Trigger.** The worker's `ensureMatteEngine` / `ensureInterpolationEngine` /
   `ensureBeautyEngine` already construct the engines lazily. When the first such
   engine finishes loading and exposes ORT's device, the worker calls a new
   `adoptOrtDevice(ortDevice)` path.
2. **Rebuild, don't mutate.** Reconstruct `PreviewRenderer` on `ortDevice` (reuse
   the existing constructor — it already builds every pipeline/layout/sampler), so
   no per-field device-swap and no de-`readonly`-ing is needed. Reconfigure the
   canvas `GPUCanvasContext` for `ortDevice`. Reset size so the next render
   reallocates per-size resources on the new device.
3. **Re-establish worker-held renderer state** after the swap: current
   width/height, scope SAB wiring (`setScopeSab`), title/callout texture caches
   (which were created on the old device — rebuild on the new one), and force a
   re-render of the current frame.
4. **Destroy the old device** and its resources once no in-flight work references
   them (drain `queue.onSubmittedWorkDone()` first).
5. **Flip the gate.** `compositesOnRendererDevice` becomes `true` for the ORT
   backends (or the flag is retired); the worker composites their views; update the
   one-time notice and the engine comments.

### Alternatives (rejected / fallback)

- **Up-front ORT-device bootstrap (B):** build the renderer on ORT's device from
  the start. Rejected — it forces the ORT runtime to load at GPU init, breaking
  no-startup-load and penalising the common no-ML path.
- **Cross-device copy (C):** copy/readback ORT output to the renderer device.
  Violates the zero-copy hard gate for the accelerated path; admissible only as a
  separate, explicitly-labelled compatibility-tier fallback, never the default.

## Risks & mitigations

- **Rebuild completeness.** Missing any device-bound field would surface as a
  cross-device validation error only when that pass runs. Mitigation: drive the
  rebuild through the existing constructor + `resize` paths rather than a bespoke
  swap, and add a browser-mode test that exercises matte/beauty/interpolation
  compositing after adoption.
- **Untestable in Node/CI.** A real device swap needs hardware WebGPU; node tests
  can only assert wiring/lifecycle. Use the browser-mode (real-Chromium) suite for
  the end-to-end proof.
- **Mid-frame swap.** Serialize adoption against the render loop; never swap while
  a frame's command buffer is in flight.
- **No-ML regression.** Guard so adoption only triggers for ORT-WebGPU activation;
  the no-ML / LiteRT path keeps the `initGpu()` device untouched.

## Dependency / sequencing

This spec **unblocks** the default-on use of the frame-coupled ORT-WebGPU engines
and is a prerequisite for flipping the matte default to ONNX in
`ml-runtime-litert-retirement`. It can be built and merged independently (the gate
keeps everything safe until then), but should land **before** the LiteRT matte
default is removed.

## Touch points

- `src/engine/gpu.ts` — `PreviewRenderer` rebuild seam; possibly extract a
  device-resource (re)build helper if the constructor can't be reused wholesale.
- `src/engine/worker.ts` — trigger adoption on first ORT-WebGPU engine load;
  re-establish renderer-dependent state; flip the compositing gate.
- `src/engine/matte/matte-backend.ts` + engines — `compositesOnRendererDevice`
  becomes `true` (or retired); update comments.
- `docs/ML-RUNTIME.md` — realised device-ownership description.
