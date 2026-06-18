# Requirements: ML runtime — compositor single-device adoption

> **Plan only — not yet implemented.** This spec is the follow-up to
> `ml-runtime-ort-device-ownership` (PR #121). It wires the **compositor to adopt
> ORT's `GPUDevice`** so frame-coupled ORT-WebGPU output (matte, interpolation,
> beauty) composites zero-copy on a single device. Until it lands, those engines
> stay gated off via `MatteBackendEngine.compositesOnRendererDevice = false` (and
> the equivalent worker guards), so nothing composites ORT output today.

## Background

ORT owns the WebGPU `GPUDevice` and ignores an externally-supplied one
([microsoft/onnxruntime#26107][ort-26107]); the device it creates is exposed as
`OrtSessionHandle.device`. PR #121 made the frame-coupled engines run their own
preprocess/resolve WGSL passes on that ORT-owned device, but the `PreviewRenderer`
(`src/engine/gpu.ts`) still creates and owns a **separate** device via
`initGpu()`. WebGPU resources cannot cross devices, so the compositor cannot bind
an ORT-device texture (`encodeMatte`, beauty-warp, the interpolation output) — the
reason the worker currently refuses to composite those views.

This spec makes the renderer run on ORT's device so the single-device, zero-copy
contract holds end to end.

[ort-26107]: https://github.com/microsoft/onnxruntime/issues/26107

## R0 — Hard constraints (must not regress)

- **R0.1** No model bytes or the ORT runtime fetched/instantiated at app startup.
  Device adoption happens **only** when an ORT-WebGPU feature is first activated by
  explicit user action — never at boot.
- **R0.2** The common path (no ML feature, or LiteRT-only) keeps the renderer on
  its own `initGpu()` device, unchanged. Adoption is opt-in per ORT-WebGPU
  activation, not a global default.
- **R0.3** No decode/inference/pixel loops on the main thread; the single
  WebGPU-submission-per-frame invariant for the accelerated chain is preserved.
- **R0.4** Every `VideoFrame` still `.close()`d exactly once; no leaked GPU
  resources across the device transition.

## R1 — Single-device invariant

- **R1.1** When any frame-coupled ORT-WebGPU engine (matte-onnx, interpolation,
  beauty) is active, the `PreviewRenderer` and that engine compute on the **same**
  `GPUDevice` — ORT's (`ort.env.webgpu.device` / `handle.device`).
- **R1.2** Matte/beauty/interpolation output textures are bound by the compositor
  with **no cross-device copy and no CPU readback** (zero-copy hot path).

## R2 — Adoption lifecycle

- **R2.1** Define the adoption seam: when the first ORT-WebGPU engine obtains
  ORT's device, the renderer adopts it. Evaluate and choose between:
  - **(A) Lazy rebuild** — tear down the current `PreviewRenderer` and reconstruct
    it on `ort.env.webgpu.device`, reconfigure the canvas context for the new
    device, re-establish size/scope/title/callout state, and re-render the current
    frame. (Preferred; preserves no-startup-load.)
  - **(B) Up-front bootstrap** — create ORT's device before constructing the
    renderer. *Rejected* unless deferred to first ORT-WebGPU activation, because it
    otherwise forces the ORT runtime to load at GPU init (violates R0.1).
  - **(C) Cross-device copy** — copy ORT output to the renderer device. *Rejected*
    for the accelerated path (violates the zero-copy hard gate); only admissible as
    a separate, explicitly-labelled compatibility fallback.
- **R2.2** Idempotent + safe: adopting when already on ORT's device is a no-op;
  adoption never runs mid-frame (serialize against the render loop).
- **R2.3** Reversible on teardown: if all ORT-WebGPU features are released and the
  ORT device is torn down, the renderer returns to a valid device (or the editor
  degrades gracefully) without a dead canvas.

## R3 — Rebuild correctness (if approach A)

- **R3.1** Every device-bound resource is recreated on the new device: all
  compute/render pipelines and bind-group layouts (currently `readonly`, created in
  the constructor) and all lazily-allocated per-size textures/buffers
  (storage/transform/acc/scope/skin/etc.). No handle from the old device survives.
- **R3.2** The old device's resources are destroyed and the old device released,
  with no validation errors or use-after-free against in-flight work.
- **R3.3** Canvas `GPUCanvasContext` is reconfigured for the new device
  (`context.configure({ device: ortDevice, … })`).

## R4 — Worker wiring

- **R4.1** Flip the gate added in PR #121: once adoption is in place,
  `compositesOnRendererDevice` (or its successor) reports `true` for the ORT
  backends, and the worker composites their views again.
- **R4.2** The one-time "compositing unavailable" notice and the matte/beauty/
  interpolation engine comments are updated from "will adopt …" to the realized
  behaviour.

## R5 — Device loss

- **R5.1** ORT device loss tears down both the ORT sessions and the adopted
  compositor coherently; surfaces a clear capability/diagnostic message; never
  leaves a hung preview.

## R6 — Verification

- **R6.1** Browser-mode (real WebGPU) test proving a matte/beauty/interpolation
  output texture produced on ORT's device is composited by the renderer on that
  same device (no cross-device validation error).
- **R6.2** A test/guard that the no-ML and LiteRT-only paths still use the
  `initGpu()` device (no unnecessary adoption/rebuild).
- **R6.3** Full quality gate green; no test-count regression.

## R7 — Docs

- **R7.1** `docs/ML-RUNTIME.md` "GPU device ownership" section updated to describe
  the realized renderer-adoption mechanism (remove the "gated off until …"
  qualifier once true).
