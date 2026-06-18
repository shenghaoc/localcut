# Design — ML runtime: compositor single-device adoption

This document records the implemented approach, the key risk (a live device swap
of a large compositor), and the sequencing required to keep WebGPU resource
ownership valid.

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

1. **Trigger.** `MatteOnnxEngine`, `InterpolationEngine`, and `BeautyEngine`
   expose an `onDeviceReady(handle.device)` hook during model load, before any
   ORT-device texture/view can be returned to the compositor. The worker routes all
   three hooks through `adoptOrtDevice(ortDevice)`.
2. **Serialize.** Adoption is rejected while a single export or render-queue job is
   active. Otherwise the worker pauses preview, cancels pending renders, waits for
   the playback decode/render chain to become idle, and drains old GPU queue work.
3. **Release old-device dependants.** Before destroying the old renderer device,
   dispose renderer-device state that lives outside `PreviewRenderer`: title and
   callout texture caches, and any active LiteRT matte engine created with the old
   `renderer.gpuDevice`.
4. **Rebuild, don't mutate.** Reconstruct `PreviewRenderer` on `ortDevice` using
   the existing constructor, with `ownsDevice: false` so renderer teardown never
   destroys ORT's device. Recompute `useF16` from `ortDevice.features`.
5. **Re-establish worker-held renderer state.** Replay size, scope SAB,
   scopes/zebra flags, LUT uploads, title/callout caches, and force a re-render of
   the current frame.
6. **Listen for the adopted device.** Replace the initial `initGpu()` device-loss
   listener with a generation-guarded listener on the adopted `ortDevice.lost`.
7. **Flip the gate.** `compositesOnRendererDevice` is `true` for the ORT matte
   backend; the worker composites its views after adoption and retains only an
   unexpected-contract fallback.

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
- **Export swap.** Do not swap while export owns the renderer; reject model
  load/adoption with an actionable error until export or queue work finishes.
- **ORT device ownership.** Adopted renderers are external-device renderers:
  `destroy()` releases renderer resources but does not destroy ORT's device.
- **Matte self-lock.** ORT matte loading must not depend on first flipping the
  compositing flag; the model-load hook adopts the device before returning a matte
  view.
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
