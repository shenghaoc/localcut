# Tasks — ML runtime: compositor single-device adoption

> **Plan only — not yet implemented.** All tasks are unchecked; a later agent
> implements them. Maps to `requirements.md`.

- [ ] **T1 — Decide & document the adoption seam (R2.1).** Confirm approach A
      (lazy renderer rebuild on `ort.env.webgpu.device`); record the rejection of
      up-front bootstrap (B) and cross-device copy (C). Spike the canvas-context
      reconfigure on a new device in browser mode.
- [ ] **T2 — Renderer rebuild path in `gpu.ts` (R3).** Add a way to (re)construct
      `PreviewRenderer` on a supplied `GPUDevice` — reuse the constructor where
      possible; if not, extract a `buildDeviceResources(device, useF16)` shared by
      the constructor and the rebuild. Reconfigure the `GPUCanvasContext`; reset
      size so per-size resources reallocate on the new device. Destroy old-device
      resources + release the old device after draining in-flight work.
- [ ] **T3 — Worker adoption trigger (R2.2, R2.3).** On the first ORT-WebGPU engine
      load (matte-onnx / interpolation / beauty), call the adoption path with
      `handle.device`; serialize against the render loop; idempotent; reversible on
      teardown. Re-establish renderer-held state (size, scope SAB, title/callout
      caches) and force a re-render.
- [ ] **T4 — Re-enable compositing (R4).** Flip `compositesOnRendererDevice` (or
      retire the flag) for the ORT backends; remove the worker's one-time
      "compositing unavailable" guard; update the matte/interpolation/beauty engine
      comments and `worker.ts` from "will adopt …" to the realised behaviour.
- [ ] **T5 — Device-loss handling (R5).** ORT device loss tears down ORT sessions
      and the adopted compositor coherently; surface a capability/diagnostic
      message; no hung preview.
- [ ] **T6 — Tests (R6).** Browser-mode test: a matte/beauty/interpolation output
      texture produced on ORT's device composites on the renderer (same device, no
      cross-device validation error). Node-level guard: no-ML / LiteRT-only path
      still uses the `initGpu()` device (no rebuild).
- [ ] **T7 — Docs (R7).** Update `docs/ML-RUNTIME.md` "GPU device ownership" to the
      realised renderer-adoption mechanism (drop the "gated off until …" qualifier).
- [ ] **T8 — Quality gate.** `format:check + lint + typecheck + test + build` green;
      no test-count regression.

## Dependencies

- Builds on `ml-runtime-ort-device-ownership` (merged, PR #121).
- **Prerequisite for** flipping the matte default to ONNX in
  `ml-runtime-litert-retirement` (matte output must composite before LiteRT can be
  retired as the default).
