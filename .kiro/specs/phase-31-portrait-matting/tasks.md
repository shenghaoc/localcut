# Tasks: Phase 31 — Portrait Video Matting

> Status: **Deployed and verified.** A real model is wired and confirmed working
> end to end (Chrome, hardware WebGPU): Google's **MediaPipe Selfie Segmentation**
> (`selfie_segmentation.tflite`, Apache-2.0) loads via the same-origin `/_model/gcs/`
> proxy + OPFS cache, runs zero-copy on the shared `GPUDevice`, and "Remove
> background" cleanly keeps the person. Project schema is **v15** (Phase 36 took v14).
> Two latent bugs were found and fixed in the process — see design.md "Two
> non-obvious constraints": the ES-module-worker `importScripts` polyfill, and the
> `rgba8unorm` (not `r8unorm`) alpha-texture storage format.
>
> Earlier history: the original "foundations" (PR #80) implemented an offline CPU
> pre-computation pipeline around a GPL-licensed model; that was corrected (license +
> architecture) before the realtime build-out below. Keep the branch green after
> every group.

## T0 — Corrections to existing foundations (do first)

- [x] **T0.1** **License purge**: remove RVM as the default/primary everywhere — code
      comments, manifest examples, docs, UI copy. The verdict (design.md) was later
      revised: **MediaPipe Selfie Segmentation (Apache-2.0) is the deployed default**
      (MODNet has no hostable `.tflite` weights; RVM is GPL-3.0 and rejected). Recorded
      in design.md and `docs/USER-GUIDE.md`.
- [x] **T0.2** Delete the CPU preprocessing path in `src/engine/matte/matte-inference.ts`
      (`createImageBitmap`/`OffscreenCanvas`/`getImageData`) and the packed-alpha
      `postMessage` hops; delete the offline batch orchestration
      (`request-matte-frames`/`matte-frames-decoded` protocol, App.tsx job state machine,
      worker batch decode loop).
- [x] **T0.3** Retire the separate matte inference worker (`matte-worker.ts`,
      `matte-bridge.ts` inference paths); keep manifest/SHA-256 verification and probe
      plumbing for reuse. The dedicated worker survives only if it later hosts the
      MediaPipe fallback.
- [x] **T0.4** Remove the export "missing matte" warning stopgap from
      `src/engine/export.ts` / `worker.ts` (obsolete under per-frame inference).
- [x] **T0.5** Extend `ClipMatte` with `mode: 'remove' | 'replace' | 'blur'` and
      `blurRadius?`; `schemaVersion` bump; serialization + undo tests updated.
      Existing `enabled`/`modelKey`/`strength` fields and mutations survive.

## T1 — Shared-device ORT session (gate for everything below)

- [x] **T1.1 — Shared-device runtime implemented on LiteRT.js** (unblocks the
      ORT dead-end). The earlier onnxruntime-web attempt was abandoned: ORT 1.26
      would not run on the compositor's device (it ignored an injected
      `env.webgpu.device`, replaced it during `InferenceSession.create`, and a
      deployed-model run threw `WebGPU validation failed. [Buffer] ... cannot be
      used with [Device]` — proving the session ran on a device of its own).

      LiteRT.js (`@litertjs/core`, the runtime Phase 28/29 already use) provides
      exactly the missing piece: `setWebGpuDevice(compositorDevice)` before
      `loadAndCompile({ accelerator: 'webgpu' })`, plus GPU-buffer tensor IO
      (`new Tensor(gpuBuffer, [1,H,W,3], 'float32')` in, `tensor.toGpuBuffer()`
      out). `matte-engine.ts` now: shares the renderer device, wraps the
      preprocess output buffer as the input tensor, and feeds the output buffer
      straight into the resolve pass — no CPU pixel round-trip. LiteRT loads
      lazily in the pipeline worker (ES-module worker → dynamic
      `import('@litertjs/core')` via `matte/litert-loader.js`), WASM served from
      the shared `/litert/<sha>/` runtime dir. Model format is `.tflite`,
      NHWC; the preprocess shader packs NHWC and derives H/W from the model's
      input details.

      ⚠ Still needs a hardware-WebGPU run with a deployed MODNet `.tflite` to
      confirm end-to-end (CI cannot exercise WebGPU + a real model). The
      device-sharing mechanism is the one ORT lacked, so the architectural
      blocker is resolved; this is verification, not a redesign.
- [x] **T1.2** `matte-session.ts` in the pipeline worker: per-clip session lifecycle
      (create on first matted frame, key by `clipId`, release on delete/disable/dispose),
      MODNet manifest loading via the existing checksum path.

## T2 — Zero-copy inference passes

- [x] **T2.1** `matte-preprocess.wgsl`: external texture → resized/normalized **NHWC**
      float32 GPU buffer at model input resolution (TFLite/LiteRT models are NHWC). The
      normalization is manifest-parameterized (`inputRange`: `unit` [0,1] for MediaPipe
      Selfie, `signed-unit` [-1,1] for MODNet-style). Consumes the P19 proxy-resolution
      decode feed in preview.
- [x] **T2.2** Run inference per displayed frame with GPU IO binding; alpha tensor →
      `r8unorm` alpha texture without CPU contact.
- [x] **T2.3** `matte-temporal.wgsl`: EMA smoothing pass over the previous alpha
      texture; history owned by the clip session; reset per the R4.2 discontinuity
      policy (seek, >1.5-frame source-time jump, clip boundary, toggle, model swap).
- [x] **T2.4** Repurpose `matte-cache.ts` as a reuse cache (paused playhead/scrub):
      correctness never depends on a hit; keep byte budget + `.destroy()` discipline.
- [ ] **T2.5** Tests: session lifecycle (created/released exactly once per clip),
      discontinuity reset triggers, cache reuse vs recompute decision logic.
      (Model ops + serialization covered in `matte-model.test.ts`; GPU-coupled
      engine internals still need a mocked-device harness.)

## T3 — Modes in the compositor

- [x] **T3.1** `remove`: existing `matte-apply.wgsl` (+ `.f16`) survives as the remove
      variant (alpha × matte × strength).
- [x] **T3.2** `blur`: masked separable blur pass weighted by inverse matte;
      `blurRadius` uniform; stays inside the single per-frame submission.
- [x] **T3.3** `replace`: UI composition recipe — place/link a chosen timeline source as
      the layer beneath the matted clip; no shader change; document in design.md.
- [x] **T3.4** Export parity: guided-upsample WGSL pass (joint bilateral, full-res luma
      guide) applied to model-resolution alpha on the export path only.
- [ ] **T3.5** Tests: uniform packing for blur/strength; pass skipped for non-matted
      layers; preview/export produce the same matte math at their respective
      resolutions.

## T4 — Fallback + chroma key

- [x] **T4.0 — Deploy a real model.** MediaPipe Selfie Segmentation
      (`selfie_segmentation.tflite`, Apache-2.0) is the deployed default: manifest at
      `/models/matte/manifest.json`, weights fetched via the new same-origin
      `/_model/gcs/` proxy (Cloudflare Worker + Vite dev), OPFS-cached + SHA-256
      verified. UI is labeled "(Experimental)" and the model is documented as
      "segmentation, not matting". **Verified working end to end in Chrome.**
- [ ] **T4.1** Non-WebGPU labeled reduced-tier UX. The deployed segmenter already runs
      on the WASM accelerator if WebGPU is unavailable; what remains is the explicit
      capability-tier surface ("segmentation, not matting — reduced edge quality").
- [ ] **T4.2** `chroma-key.wgsl` (+ `.f16`): standalone non-ML effect — key color,
      tolerance, softness uniforms; Inspector controls; tests for uniform packing.

## T5 — UI

- [x] **T5.1** Inspector matte section: mode selector (remove/replace/blur), strength,
      blur radius, replace-background picker, status; existing enable toggle + badge +
      capability row survive.
- [~] **T5.2** Model pin surfacing: pin round-trips verbatim and the engine posts a
      mismatch warning status (`matte-status`) when the deployed model differs;
      dedicated Inspector display of the pin still pending.

## T6 — Acceptance verification

- [ ] **T6.1** Realtime: measured preview fps at proxy resolution with matting enabled
      on the accelerated tier meets the preview budget (fixture + harness, not manual
      eyeballing).
- [ ] **T6.2** Temporal stability: static-camera talking-head fixture; mean |Δalpha|
      between consecutive frames under the bound; automated.
- [ ] **T6.3** Determinism: `matteTestMode` double-run hash equality; automated.
- [ ] **T6.4** Bundle round-trip: matte settings + model pin survive P23
      export/import; mismatch warning fires when the deployed model differs.
- [ ] **T6.5** Lifetime audit: every alpha texture/GPU buffer destroyed exactly once;
      `pnpm run check` green; test count grows.
