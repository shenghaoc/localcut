# Tasks — ML runtime: ORT-owned GPU device + unify-on-ORT policy

All tasks below are **complete** (this spec documents landed work). Each maps to
the requirements in `requirements.md`.

- [x] **T1 — Foundation types (R1.2, R1.3, R4.2).** `ort-types.ts`:
      `OrtDeviceOwner` → `'ort-webgpu' | 'webnn-context'` (dropped `'renderer'`),
      doc comment cites onnxruntime#26107; module header reframes ORT as the
      runtime and LiteRT as the legacy path being retired.
- [x] **T2 — Session wrapper (R1.1–R1.4, R4.1).** `ort-session.ts`: removed the
      `device` input option; `resolveDeviceOwner(primaryEp, hasMlContext)` →
      WebGPU always `'ort-webgpu'`; deleted the `env.webgpu.device` injection; read
      the ORT-owned device back via `await ort.env.webgpu.device` into
      `handle.device`; kept the WebNN `MLContext` path. Updated `ort-session.test.ts`.
- [x] **T3 — Matte ONNX engine (R4.3).** `matte-onnx-engine.ts`: dropped the
      `device` option; `this.device` is nullable and adopted from `handle.device`
      in `loadModel`; preprocess/resolve passes + dispose use the ORT-owned device;
      flipped the source-contract test to assert no injection + `handle.device`
      adoption; updated the concurrency test to set the device via internals.
- [x] **T4 — Interpolation engine (R4.3).** `interpolation-engine.ts`: same rework
      (drop option, adopt `handle.device`, guard nullable, null on dispose);
      updated the concurrency test.
- [x] **T5 — Beauty engine (R4.3).** `beauty-engine.ts`: same rework; device
      adopted from the detector session's `handle.device`; preprocess + `runModel`
      use it; updated `beauty-engine.test.ts` (no model loaded / injected-inference
      paths never touch the device).
- [x] **T6 — Worker wiring (R4.3).** `worker.ts`: stopped passing
      `renderer.gpuDevice` into `MatteOnnxEngine` / `InterpolationEngine` /
      `BeautyEngine`; LiteRT `MatteEngine` still gets it. Comments cite #26107 +
      docs/ML-RUNTIME.md.
- [x] **T7 — Reframe face detector (R4.1).** `face-detector-ort.ts`: removed the
      unused `device` option and its forward into `createOrtSession`.
- [x] **T8 — Drop R2 as a model host (R3.1–R3.2).** `ort-asset-loader.ts`: removed
      `*.r2.dev` / `*.r2.cloudflarestorage.com` from `ORT_TRUSTED_MODEL_HOSTS` +
      comments; `ort-asset-loader.test.ts` now asserts R2 is rejected and tightens
      the suffix-anchor test on an allowlisted host; reframe test sample URLs moved
      from `/_model/r2/` to `/_model/hf/`.
- [x] **T9 — Manifests + READMEs (R3.1).** Dropped "or a Cloudflare R2 bucket"
      from the `matte-onnx` / `reframe-face` / `interpolation` template manifests
      and their READMEs; removed the R2 mention from `whisper/README.md`.
- [x] **T10 — Policy doc (R2.1–R2.3, R5.1).** `docs/ML-RUNTIME.md`: ORT/ONNX as the
      runtime with LiteRT/TFLite retiring; new "One runtime, three execution
      providers" rationale (WASM floor in the same binary); "GPU device ownership"
      section (ORT-owned bootstrap + renderer adoption, citing #26107); EP table,
      diagnostics, model-hosting, and migration guidance updated; R2 removed.
- [x] **T11 — Quality gate (R6.1).** format:check + lint + typecheck + 2400 unit
      tests + production build all green; no test-count regression.

## Deliberately deferred (separate specs / PRs)

- [ ] **Compositor single-device adoption** — rebuild/run `PreviewRenderer` on
      ORT's device so frame-coupled ORT output composites zero-copy. Tracked in
      `ml-runtime-compositor-device-adoption`. (Plan-only until then.)
- [ ] **LiteRT retirement** — migrate matte to a license-verified ONNX model and
      delete the LiteRT runtimes/loaders/assets. Tracked in
      `ml-runtime-litert-retirement`. (Plan-only until then.)
