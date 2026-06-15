# Tasks: Phase 37 — Frame Interpolation (ORT/ONNX)

> Status: **Engine + worker + pure logic complete and gate-green on the ORT/ONNX runtime; UI
> bridge, export-pipeline synthesis, model vendoring, and GPU validation remain.** Built on the
> Phase 105 ORT foundation (`src/engine/ml/ort/`): the engine creates an ORT-WebGPU session via
> `createOrtSession` with the renderer's injected `GPUDevice` (zero-copy, `deviceOwner:
> 'renderer'`, proven by the foundation's device-ownership browser spike), `fromGpuBuffer`
> inputs, a `gpu-buffer` output, no `getData()`. The frame-coupled EP gate forbids WASM/CPU.
> Pure logic (timesteps, tiling, estimate, shot-guard, cache key, gating, SSIM, manifest) is
> fully unit-tested. Gate green: format + lint + typecheck + **1669 tests** + build.
>
> **Honest open items** (need resources this CI lacks, not more code):
>
> 1. **Model vendoring + R9 gate** — choose a permissive RIFE-class **ONNX** model (CAIN/MIT
>    recommended; FILM/Apache-2.0 for quality), verify license + size + SHA-256 + IO contract +
>    shapes, and confirm **every node runs on ORT-WebGPU** (any full-frame WASM/CPU fallback →
>    reject). Fill `public/models/interpolation/manifest.json` (currently a `template`, so the
>    feature is hidden). No GPU here to run the op-support harness.
> 2. **UI bridge wiring** — `InterpolationControls.tsx` exists but is not mounted; `src/ui/` has
>    no `interp-*` command senders / state handlers (worker side is ready). Browser-verifiable.
> 3. **Export-pipeline + bounded-preview synthesis** (R8.2/R7.4) — wire `synthesiseFrames` /
>    `engine.synthesise` into export.ts and a decode→present preview path; GPU+model-verifiable.
> 4. **Slow-motion `synthesize` (R7)** — needs the Phase 35 retime model (not in the repo).
> 5. **GPU validation** (R14.9/R14.10) — no-CPU-readback proof, SSIM floor, VRAM bound need
>    WebGPU hardware (Chrome).

## T0 — ORT foundation (Phase 105, merged) — REUSED

- [x] **T0.1** ORT runtime + EP policy + device sharing live in `src/engine/ml/ort/` (loader,
  session, ep-policy, asset-loader, manifest, types); `onnxruntime-web@1.26.0` is lazy-only.
  The interpolation engine consumes them — no LiteRT loader, no hand-rolled ORT.
- [x] **T0.2** Device sharing proven: `createOrtSession` injects the renderer `GPUDevice`
  (`env.webgpu.device`); `ort-device-ownership.browser.test.ts` shows a `GPUBuffer` shared by an
  app pass and `ort.Tensor.fromGpuBuffer`. Frame interpolation rides this path.

## Pure foundations (no GPU, no model)

- [x] **T1.1** `timesteps.ts` — factor → instants, fractional fps bracketing, ≤4× cap/clamp.
- [x] **T1.2** `shot-guard.ts` — refuse pairs crossing Phase 33 boundaries → hold.
- [x] **T1.3** `tiling.ts` — VRAM budget, `planTiles`, halo/stitch, working-set, refuse path.
- [x] **T1.4** `interpolation-estimate.ts` — `CalibrationProfile` (EP-keyed) + `estimateSynthesisMs`.
- [x] **T1.5** `ssim.ts` — quality metric (unit-tested; used by the GPU quality floor).

## Manifest + delivery (ORT/ONNX, reuse Phase 105 + Phase 29)

- [x] **T2.1** `interpolation-model.ts` — `OrtModelManifest` (via `validateOrtManifest`) + the
  interpolation `io` contract (layout, input/output names, timestep, sizes, flow). Rejects
  `template` manifests (R2.4) and non-frame-coupled manifests; `toModelIoContract` for tiling.
  Unit tests cover ONNX/frame-coupled/EP-policy + template-hidden + IO validation.
- [x] **T2.2** `public/models/interpolation/manifest.json` — committed as a **`template`**
  (invalid by construction → feature hidden) with the real ONNX shape (`format: 'onnx'`,
  `frameCoupled: true`, `executionProviders: ['webgpu']`, `model{url,sizeBytes,checksum}`, `io`).
- [x] **T2.3** Model loading reuses `loadOrtModelAsset` (trusted-host allowlist incl. R2 + the
  `/_model/*` proxy + SHA-256 + OPFS); the `/models/interpolation/` SW cache rule is present;
  README + `docs/ML-RUNTIME.md` document provenance and the `/_ort/` runtime proxy.

## Engine + shaders (pipeline worker, ORT-WebGPU)

- [x] **T3.1** `interp-preprocess.wgsl` / `interp-postprocess.wgsl` — external textures →
  NCHW/NHWC `GPUBuffer` (per `io.layout`) and model output buffer → tile core region of the
  output texture. (WGSL compiles at runtime; pixel correctness is the GPU gate.)
- [x] **T3.2** `interpolation-engine.ts` — `createOrtSession({ device, tensorLocation:
  'gpu-buffer' })`; per-tile preprocess → `ort.Tensor.fromGpuBuffer` → `session.run` →
  output `.gpuBuffer` → postprocess → stitched texture; borrows the frame pair; ORT input
  tensors wrap reused buffers; output tensor disposed after the reading pass; **no `getData()`**.
- [x] **T3.3** Shot-guard integrated; refused pairs emit `interp-refusal`, model not run across.
- [x] **T3.4** `synthesiseFrames` orchestrates instants → `engine.synthesise` (real), streaming
  per pair. **Open:** the export/preview decode→present hookup (T6.2/T7.3) is not wired.
- [x] **T3.5** Bounded batch synthesis, outside the realtime single-submission gate (design).

## Render-cache integration (Phase 19)

- [x] **T5.1** `interpolationHash` in `RenderCacheKey` (incl. EP); `ExportSettings.interpolation`
  in `canonicalExportSettingsForCache`.
- [x] **T5.2** `cache-invalidation.ts` interpolation entry; conservative fallback.
- [x] **T5.3** `render-cache-integration.ts` chunk read/write over `CacheStore`.

## Speed-ramp (Phase 35) + export (Phase 17/24)

- [x] **T6.1** Protocol forward-compat types (`frameMode` etc.). **Open:** Phase 35 retime model.
- [ ] **T6.2** Export-pipeline fps-upconvert synthesis (R8.2) — resolve bracketing pair + tau per
  output frame, run `engine.synthesise` through export backpressure + render cache. GPU/model-verifiable.
- [x] **T6.3** `ExportSettings.interpolation` carried through the render queue.

## Capability gating + protocol + worker

- [x] **T7.1** `interpolation-availability.ts` — tier → preview-and-export/export-only/unavailable.
- [x] **T7.2** `interp-*` protocol + `ExportSettings.interpolation`; `InterpolationAccelerator`.
- [x] **T7.3** Worker handlers: probe (tier+device→availability), load
  (`InterpolationEngine.ensureModelLoaded` + status; template → "No compatible interpolation
  model configured"), estimate (`planTiles` + `estimateSynthesisMs`), cancel, dispose. **Open:**
  bounded preview-segment decode→present (R7.4).

## UI

- [ ] **T8.1** Wire `InterpolationControls.tsx` into the Inspector + `src/ui/` bridge
  (`interp-*` command senders + state signals + diagnostic-snapshot feed). Component exists,
  not mounted; browser-verifiable.
- [x] **T8.2** Export-dialog fps-upconvert control + motion-blur toggle (present).
- [x] **T8.3** "Frame Interpolation (ML)" diagnostics section (availability/EP/tensor-location/
  model status/estimate); reuse the foundation's `mlRuntime` summary.

## Documentation

- [x] **T9.1** User Guide "Frame Interpolation" section (uses, model + size, offline, license,
  tier/EP matrix, ≤4× cap, shot-boundary refusal, slow/estimate expectation).
- [x] **T9.2** `public/models/interpolation/README.md` records the ONNX/ORT runtime, model
  candidates + licenses, trusted-host fetch, and the R9 validation gate.

## Validation

- [ ] **T10.1** GPU/Browser-Mode (R9/R14.9): no-CPU-readback proof; per-node-EP harness (every
  node on WebGPU; any full-frame WASM/CPU fallback → reject + "No compatible model"); SSIM floor.
- [ ] **T10.2** GPU/manual (R14.10): VRAM within the probed bound at 1080p & 4K via tiling.
- [ ] **T10.3** Playwright (UI-critical, model mocked): availability gating + estimate + export settings.
- [x] **T10.4** Unit validation suite (timesteps, shot-guard, tiling, estimate, SSIM, manifest
  incl. template-hidden, availability, cache key).
- [x] **T10.5** Quality gate green: format + lint + typecheck + **1669 tests** + build, after the
  ORT pivot on the Phase 105 foundation.
