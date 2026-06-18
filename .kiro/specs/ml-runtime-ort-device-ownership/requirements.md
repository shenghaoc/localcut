# Requirements: ML runtime — ORT-owned GPU device + unify-on-ORT policy

> **Policy + foundation correction (completed).** Codifies how on-device ML runs
> in the editor and corrects the ORT foundation to match the runtime's real
> behaviour. Three threads: (1) ORT owns the WebGPU `GPUDevice` — it cannot adopt
> an externally-created one ([microsoft/onnxruntime#26107][ort-26107]); (2) unify
> on the single ORT runtime (which backs WebGPU/WebNN/WASM from one binary) and
> retire LiteRT/TFLite; (3) source models directly from their ONNX publisher, not
> re-hosted on R2.
>
> This spec is the **landed** baseline. Two follow-ups are tracked separately and
> explicitly **out of scope** here: the compositor adopting ORT's device
> (`ml-runtime-compositor-device-adoption`) and removing LiteRT once ONNX
> replacements land (`ml-runtime-litert-retirement`).

[ort-26107]: https://github.com/microsoft/onnxruntime/issues/26107

## R0 — Hard constraints (inherited, unchanged)

- **R0.1** No cloud AI, inference API, account, API key, or upload of user media /
  frames / tensors. All inference runs on the user's device.
- **R0.2** No model bytes or weights fetched, parsed, or instantiated at startup.
- **R0.3** Models load only on explicit user action; size shown before any fetch.
- **R0.4** No decode/inference/pixel loops on the SolidJS main thread.

## R1 — GPU device ownership (the correction)

- **R1.1** ORT does **not** adopt an externally-created `GPUDevice`. A `device` set
  on `ort.env.webgpu` is ignored; ORT creates its own internally (#26107), and a
  GPU buffer created on any other device fails ORT's tensor validation.
- **R1.2** There is therefore exactly one WebGPU path: **ORT bootstraps and owns
  the device**, reported as `deviceOwner: 'ort-webgpu'`. The device ORT created is
  read back from `ort.env.webgpu.device` and returned to callers.
- **R1.3** The renderer **adopts** ORT's device for its own passes — never the
  inverse. The `'renderer'` device-owner (renderer device injected into ORT) is
  removed from the type system so no code can claim the impossible.
- **R1.4** WebNN is the **only** place a renderer device legitimately flows toward
  ORT, and only via an `MLContext` *pre-created* from it
  (`deviceOwner: 'webnn-context'`) — a supported API, unlike injecting a raw
  `GPUDevice`. This path is preserved unchanged.

## R2 — Unify on the single ORT runtime

- **R2.1** ORT Web's JSEP build (`ort-wasm-simd-threaded.jsep.wasm`) backs the
  WebGPU, WebNN, **and** WASM EPs from one binary; the EP is chosen per session,
  not per bundle. Code and docs must not treat the three EPs as separate runtimes.
- **R2.2** The **WASM EP is the un-droppable floor** — the only path where
  WebGPU/WebNN are unavailable — and it ships inside the binary already loaded for
  the WebGPU EP, so it costs no extra runtime download.
- **R2.3** Policy: run as much as possible on the single ORT runtime and **retire
  LiteRT/TFLite**. No new feature targets LiteRT; shipped LiteRT features migrate
  as license-verified ONNX models land (LiteRT kept selectable only until parity
  is proven). *Removing the LiteRT code is the separate retirement spec.*

## R3 — Model sourcing (direct from ONNX, not R2)

- **R3.1** Models come directly from their ONNX publisher (`onnx-community` on
  Hugging Face) via the same-origin `/_model/hf` proxy; GitHub/GCS cover
  vendor-published assets. R2 is **not** a model host.
- **R3.2** The ORT trusted-host allowlist (`ORT_TRUSTED_MODEL_HOSTS`) drops
  `*.r2.dev` / `*.r2.cloudflarestorage.com`. Tests, template manifests, and model
  READMEs must not advertise R2 as a host.
- **R3.3** Integrity rules unchanged: every asset size-checked + SHA-256-verified +
  OPFS-cached by digest; no startup load; no cloud fallback.

## R4 — Foundation type-safety

- **R4.1** `CreateOrtSessionOptions` exposes no `device` input for WebGPU. The
  WebNN `mlContext` path remains.
- **R4.2** `OrtDeviceOwner` is `'ort-webgpu' | 'webnn-context'` (no `'renderer'`);
  diagnostics follow.
- **R4.3** Frame-coupled ORT engines obtain their device from the session
  (`handle.device`) and run their own preprocess/resolve WGSL passes on it; the
  worker no longer injects `renderer.gpuDevice` into them. The LiteRT matte engine
  (which *can* adopt an external device) still receives the renderer device.

## R5 — Docs are the source of truth

- **R5.1** `docs/ML-RUNTIME.md` states ORT/ONNX as the runtime, LiteRT as the
  legacy path being retired, the one-runtime/three-EP rationale, the
  ORT-owned-bootstrap + renderer-adoption device model (citing #26107), and
  direct-from-ONNX sourcing. Code and docs must agree.

## R6 — Quality gate

- **R6.1** `format:check + lint + typecheck + test + build` green; test count does
  not decrease. The frame-coupled ORT engines stay double-gated (spike flag +
  template manifest), so deployed behaviour is unchanged.
