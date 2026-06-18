# Tasks — ML runtime: compositor single-device adoption

Maps to `requirements.md`.

- [x] **T1 — Decide & document the adoption seam (R2.1).** Approach A (lazy
      renderer rebuild on `ort.env.webgpu.device`) is implemented; up-front
      bootstrap and cross-device copy remain rejected for the accelerated path.
- [x] **T2 — Renderer rebuild path in `gpu.ts` (R3).** `PreviewRenderer` can
      rebuild on a supplied external `GPUDevice`, drains old queue work, recomputes
      `shader-f16` from the adopted device, reconfigures the canvas through the
      normal size path, and distinguishes owned vs ORT-owned device destruction.
- [x] **T3 — Worker adoption trigger (R2.2, R2.3).** Matte-ONNX, interpolation,
      and beauty load paths call a shared `adoptOrtDevice(handle.device)` hook.
      The worker serializes adoption against preview and export/queue ownership,
      disposes stale LiteRT matte state, replays size/scope/zebra/LUT/title/callout
      state, and forces preview refresh.
- [x] **T4 — Re-enable compositing (R4).** ORT matte reports renderer-device
      compositing after adoption, the old planned-unavailable guard is removed, and
      source/doc comments describe the realised behaviour.
- [x] **T5 — Device-loss handling (R5).** The worker generation-guards device-loss
      listeners, registers the adopted ORT device, tears down ORT sessions and the
      compositor together, and surfaces recovery diagnostics without hanging
      preview.
- [x] **T6 — Tests (R6).** Node tests cover external-device ownership and f16
      recomputation; browser-mode ORT spike covers same-device compositor binding
      of an ORT-device matte texture.
- [x] **T7 — Docs (R7).** `docs/ML-RUNTIME.md` "GPU device ownership" describes
      the realised renderer-adoption transaction and drops the pending/gated
      qualifier.
- [x] **T8 — Quality gate.** `format:check + lint + typecheck + test + build` green;
      no test-count regression.

## Dependencies

- Builds on `ml-runtime-ort-device-ownership` (merged, PR #121).
- **Prerequisite for** flipping the matte default to ONNX in
  `ml-runtime-litert-retirement` (matte output must composite before LiteRT can be
  retired as the default).
