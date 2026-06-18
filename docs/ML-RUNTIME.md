# ML runtime policy

This document is the single source of truth for **how on-device ML models run**
in this editor. It governs new ML features and the migration of existing ones.

> Everything here runs in the user's browser. Models are downloaded from a small
> allowlist of hosts through a same-origin proxy and cached locally. No frames,
> tensors, or inference results ever leave the device, and there is no
> server-side or cloud inference of any kind.

## TL;DR

- **ONNX is the model format.** ORT/ONNX is the runtime for all new ML features;
  **LiteRT/TFLite is the legacy path being retired** feature-by-feature as
  license-verified ONNX models land. No new feature targets LiteRT.
- **ORT-WebGPU is the primary runtime** for full-frame / video-coupled models.
- **ORT-WebNN is opt-in per model**, only after operator-support proof.
- **ORT-WASM is allowed only** for small, non-frame-coupled models.
- **Full-frame inference must never silently fall back to WASM or CPU tensors.**
- **Models are sourced directly from their ONNX publisher** (`onnx-community` on
  Hugging Face) through the same-origin `/_model/hf` proxy (with GitHub / GCS for
  vendor-published assets) — **not re-hosted on R2** — never a direct cross-origin
  browser fetch, and every asset is pinned by size + SHA-256.
- **ORT owns the WebGPU `GPUDevice`; the renderer adopts it.** ORT ignores an
  externally-supplied device (microsoft/onnxruntime#26107), so you cannot hand it
  the compositor's device: ORT bootstraps its own and the renderer adopts
  `ort.env.webgpu.device` for its passes — never the other way round.

## Why ONNX Runtime Web

The repo's first wave of ML features (DTLN audio cleanup, Whisper auto-captions,
portrait matte) shipped on **LiteRT.js**. LiteRT was chosen because, at the time,
it was the only runtime that let inference share the compositor's `GPUDevice` for
zero-copy GPU-buffer tensor IO — ORT ignored an injected `env.webgpu.device` (see
the note in `src/engine/matte/matte-engine.ts`).

ONNX's far larger model ecosystem, the WebNN execution provider, and a single
runtime for the whole app make **ONNX Runtime Web the repo's runtime, and LiteRT
the legacy path being retired.** No new feature targets LiteRT, and the shipped
LiteRT features migrate to ORT/ONNX as license-verified ONNX models land (each
keeping LiteRT as a selectable rollback only until parity is proven). **Whisper
auto-captions** migrated first: an int8-quantized ONNX encoder/decoder pair on the
ORT-WASM EP is now the default Auto Captions model (see "Whisper auto-captions on
ORT" below), with the LiteRT fp32 build kept as a selectable fallback.

### One runtime, three execution providers

ORT Web ships a single JSEP build (`ort-wasm-simd-threaded.jsep.wasm`) that backs
the WebGPU, WebNN, **and** WASM execution providers from **one binary** — the EP is
chosen per session, not per bundle. Two consequences drive the unify-on-ORT policy:

- The **WASM EP is a baseline we cannot ditch.** It is the only path that runs
  where WebGPU/WebNN are unavailable (older browsers, software-rendered or headless
  environments, locked-down enterprise). Because it lives in the same binary we
  already load for the WebGPU EP, that baseline costs no extra runtime download.
- Carrying LiteRT _in addition_ means shipping and maintaining a **second** ML
  runtime for capabilities the one ORT binary already covers. So the policy is to
  run **as much as possible on the single ORT runtime** — WebGPU where it helps,
  WebNN where proven, WASM as the universal floor — and **retire LiteRT** rather
  than split features across two engines. Earlier code treated WebGPU/WebNN/WASM as
  if they implied separate runtimes; they do not.

### GPU device ownership (ORT-owned, renderer adopts)

ORT does **not** adopt an externally-created `GPUDevice`. A `device` set on
`ort.env.webgpu` is ignored and ORT creates its own internally
([microsoft/onnxruntime#26107][ort-26107], open) — a GPU buffer created on any
other device then fails ORT's tensor validation. So there is exactly one WebGPU
path, and it is the inverse of LiteRT's:

- **ORT bootstraps and owns the device** (`deviceOwner: 'ort-webgpu'`). The device
  ORT created is read back from `ort.env.webgpu.device` and returned as
  `OrtSessionHandle.device`.
- **The renderer adopts ORT's device** for its own WGSL passes — the compositor is
  (re)built on `handle.device` so matte/interpolation/beauty output composites
  zero-copy. (Frame-coupled ORT-WebGPU features are gated off until this compositor
  single-device adoption ships with the first license-verified model; the engines
  already run their own preprocess/resolve passes on `handle.device`.)
- **WebNN is the one place a renderer device flows toward ORT**, and only via an
  `MLContext` _pre-created_ from it (`deviceOwner: 'webnn-context'`) — a supported
  API, unlike injecting a raw `GPUDevice`.

This is proven by the spikes in `src/engine/ml/ort/`:

- `ort-device-ownership.browser.test.ts` — a `GPUBuffer` created from the
  ORT-owned `ort.env.webgpu.device` is used by **both** an app WebGPU compute pass
  and ORT's `Tensor.fromGpuBuffer` (`deviceOwner` is `ort-webgpu`).
- `webnn-shared-context.browser.test.ts` — an `MLContext` created from the
  renderer's `GPUDevice` is handed to ORT's WebNN EP, with `MLTensor` output
  staying on-device (no hot-path readback).

[ort-26107]: https://github.com/microsoft/onnxruntime/issues/26107

## Execution-provider policy

The execution provider (EP) is **pinned per model** in the manifest and resolved
by `src/engine/ml/ort/ep-policy.ts`. The list is handed to ORT verbatim — the
foundation never appends ORT's implicit WASM fallback.

| EP       | Use it for                                      | Tensor location | Notes                                                           |
| -------- | ----------------------------------------------- | --------------- | --------------------------------------------------------------- |
| `webgpu` | Full-frame / video-coupled models (**primary**) | `gpu-buffer`    | ORT owns the `GPUDevice`; the renderer adopts it. Zero-copy IO. |
| `webnn`  | A specific model, **only after operator proof** | `ml-tensor`     | Opt-in per model; `MLContext` pre-created from the `GPUDevice`. |
| `wasm`   | Small, **non-frame-coupled** models             | `cpu`           | Tokenizers, classifiers, one-shot helpers.                      |

### The frame-coupled hard gate

A model is **frame-coupled** when it runs per video frame in the preview /
export hot path — matte (Phase 31) and frame interpolation (Phase 37) qualify.
Smart Reframe's optional ORT face detector runs in a one-shot analysis pass at
the analysis fps (default 2 fps), **not** in the preview/export hot path, so it
is **not** frame-coupled and is allowed to declare `wasm` alongside
`webgpu`/`webnn`; the detector's own loader gates WASM by input tensor size to
keep the analysis worker responsive. For frame-coupled models:

- The EP list **must not** contain `wasm`, and **must** include at least one
  GPU-class EP (`webgpu` or `webnn`).
- `resolveExecutionProviders()` **throws** rather than degrade to CPU. This is the
  same architectural hard gate as the rest of the accelerated pipeline: a
  full-frame path may be slower on a compatibility tier, but it is never a silent
  CPU pixel/tensor round-trip.
- `validateOrtManifest()` enforces the rule at validation time too, so a
  misconfigured manifest is rejected before any bytes are fetched.

`wasm` (and CPU tensors) are reserved for small models whose latency does not
gate playback or export.

## Model hosting & integrity

Model assets are large binaries that ORT compiles and runs. They are therefore
loaded under the same trust rules as the LiteRT assets:

- **Sourced directly from the ONNX publisher.** Models come from their publisher
  (`onnx-community` on Hugging Face) — **not re-hosted on R2**. Allowed hosts:
  Hugging Face (`*.huggingface.co`, `*.hf.co`), GitHub (`raw.githubusercontent.com`,
  `objects.githubusercontent.com`, `github.com`), and Google Cloud Storage
  (`storage.googleapis.com`) for vendor-published assets. See
  `ORT_TRUSTED_MODEL_HOSTS`.
- **Same-origin proxy, not direct fetch.** The app is cross-origin isolated
  (`COEP: require-corp`), so cross-origin model fetches go through the Worker's
  `/_model/hf/`, `/_model/gh/`, `/_model/gcs/` reverse proxies.
- **Pinned bytes.** Every manifest declares an exact `sizeBytes` and a
  `sha256-…` checksum; `loadOrtModelAsset()` verifies bytes before use and caches
  them in OPFS keyed by digest (reusing the Phase 29 asset cache — the download
  and cache logic is **not** duplicated). Do not add an ONNX model without a
  pinned size + SHA.
- **No model loads at startup.** `onnxruntime-web` is reached only through the
  dynamic imports in `ort-loader.ts`, so the WebGPU/WebNN/WASM runtimes
  code-split out of the initial bundle and load on first use. The
  `no-startup-load.test.ts` guard enforces this at the module-graph level.
- **The ORT runtime WASM is proxied same-origin.** ORT fetches a ~26 MB
  `ort-wasm-simd-threaded.jsep.wasm` (plus its `.mjs` glue) at runtime. That file
  exceeds Cloudflare Workers' 25 MiB per-file static-asset limit, so — unlike the
  smaller LiteRT runtime, which is vendored under `/litert/` — it cannot be
  vendored. Instead the Worker reverse-proxies it from the jsDelivr npm CDN at
  `/_ort/` (version-pinned; see `src/worker/index.ts` and the dev proxy in
  `vite.config.ts`), and `createOrtSession()` sets `ort.env.wasm.wasmPaths` to
  `/_ort/` (see `ortWasmBasePath()`). The browser fetch is therefore same-origin
  (the Worker fetches jsDelivr server-side), satisfying COEP `require-corp`
  without a direct cross-origin browser request. Self-hosting the runtime from the
  app's own origin / object storage is a drop-in alternative if a CDN dependency is
  undesirable.
- **The ORT runtime never precaches.** The lazily-imported ORT JS chunks
  (`*onnxruntime*`) are excluded from the Workbox precache, and the proxied WASM
  (`/_ort/`) is runtime-cached (CacheFirst) rather than precached, so the service
  worker never downloads the ORT runtime at install. `no-startup-load.test.ts`
  asserts the precache exclusion in `vite.config.ts`.

## Diagnostics

The diagnostics snapshot carries an optional `mlRuntime` summary
(`MlRuntimeDiagnosticSummary`):

- `mlRuntime`: `'litert' | 'ort'` — which runtime is active. The deployed default
  Auto Captions and audio cleanup report `'ort'`; LiteRT-default features (matte)
  report `'litert'` until they migrate.
- `ortEp`: `'webgpu' | 'webnn' | 'wasm'` — the resolved EP (ORT only).
- `tensorLocation`: `'cpu' | 'gpu-buffer' | 'ml-tensor'` — where tensors live.
- `deviceOwner`: `'ort-webgpu' | 'webnn-context'` — which subsystem owns the
  compute device, so a device-sharing regression is visible. WebGPU is always
  `ort-webgpu` (ORT owns the device — #26107); there is no `'renderer'` owner.

## Migration guidance (PR101 / PR103 and future ML PRs)

All ML work targets ORT, never LiteRT (which is being retired):

- **Frame interpolation (PR101)** is frame-coupled: ship it as an ONNX model with
  `executionProviders: ['webgpu']` and `frameCoupled: true`, with `gpu-buffer`
  tensor IO. It must **not** list `wasm` — the EP policy will reject it. Use
  `createOrtSession()` (no `device` argument): ORT owns the device
  (`deviceOwner: 'ort-webgpu'`), the engine runs its preprocess/postprocess passes
  on `handle.device`, and the renderer adopts that device to composite the result.
  Do **not** try to inject the compositor's device — ORT ignores it (#26107).
- **PR103** and any other new model feature: author an `OrtModelManifest`
  (`format: 'onnx'`, pinned size + SHA), load bytes via `loadOrtModelAsset()`,
  and create the session via `createOrtSession()`. Choose the EP from the table
  above; default to `webgpu` unless the model is small and non-frame-coupled.
- **Whisper auto-captions** has migrated to ORT (this PR) — see the section
  below. The LiteRT Whisper path stays as a selectable fallback.
- **Portrait matte ORT/ONNX backend (spike)** is the worked example of migrating
  an existing LiteRT feature without regressing it. The **deployed default stays
  LiteRT** MediaPipe Selfie Segmentation (`matte-engine.ts`); an **experimental**
  ORT/ONNX backend (`matte-onnx-engine.ts`, manifest `public/models/matte-onnx/`)
  runs a MODNet-class true-matting model on ORT-WebGPU with `gpu-buffer` tensor IO
  on **ORT's own device** (the renderer adopts it; ORT ignores an injected device —
  #26107). It is gated twice — the `__MATTE_ONNX_SPIKE__` build flag (off by
  default; `src/engine/matte/matte-backend.ts`) **and** a real pinned ONNX model
  (the shipped manifest is a `template`, so the backend stays disabled).
  The EMA temporal-smoothing and recurrent-state-reset contract is shared verbatim
  with the LiteRT engine (`matte-temporal.ts` + `matte-resolve.wgsl`). GPL-family
  weights (e.g. RVM) are rejected by `validateMatteOnnxManifest`. ORT-WebNN for
  matte is allowed only after a per-operator support proof. `DEFAULT_MATTE_BACKEND`
  flips to `ort-onnx` only once ORT quality + performance parity is proven.
- **DTLN audio cleanup** now also ships an **ORT/ONNX backend** alongside LiteRT,
  selectable in the Audio Cleanup panel (`src/engine/audio-cleanup/dtln-ort-runtime.ts`,
  `public/models/dtln-onnx/manifest.json`). DTLN's tensors are tiny, so it pins
  the `wasm` (CPU) execution provider with CPU tensors — it is **not**
  frame-coupled, so the EP policy permits `wasm`. ONNX is now the default after
  real-audio A/B parity against LiteRT was verified; LiteRT remains selectable as
  the rollback path. This is the migration template for a
  small, non-frame-coupled LiteRT feature moving onto the ORT foundation.
- **Remaining LiteRT-default deployed features (portrait matte)** keep working
  unchanged on their current path **as the legacy backend**. They migrate to
  ORT/ONNX — retiring LiteRT — once a license-verified ONNX model and the
  compositor's adoption of ORT's device pass quality + performance proof.

## Whisper auto-captions on ORT (non-frame-coupled exemplar)

Auto Captions is the first shipped ORT text/audio feature and the template for a
**small, non-frame-coupled** model — the opposite end of the policy from frame
interpolation:

- **EP: `wasm`, tensor location `cpu`.** ASR is not per-video-frame, so the
  no-WASM hard gate does not apply. The autoregressive decoder is latency-bound
  by per-step graph dispatch, where a GPU EP's per-call sync overhead and
  patchier Whisper op coverage make WASM the robust default. The ASR worker is
  lazily spawned as a module worker and does not share the renderer `GPUDevice`.
- **Encoder + no-past decoder.** The model is an encoder/decoder **pair**
  (`onnx-community/whisper-*`), not one graph. The shipped `decoder` is the
  no-past graph; each greedy step re-runs it with the full token sequence and
  reads the last logits row, so the shared engine-agnostic `whisper-decode.ts`
  drives both the ORT and LiteRT runtimes unchanged. `whisper-ort-runtime.ts`
  builds both sessions via `createOrtSession()` and fetches only `logits` (the
  no-past decoder can also emit `present.*` KV tensors, which are ignored and
  disposed defensively).
- **int8 by default.** Quantized ONNX is ~77 MB (base) / ~41 MB (tiny) versus the
  290 MB fp32 LiteRT base — a far friendlier PWA download. See
  `public/models/whisper-onnx/README.md` for the full size-vs-quality table and
  the digest-provenance procedure.
- **Manifest:** `src/engine/asr/ort-whisper-manifest.ts` validates the ONNX
  Whisper manifest (multi-asset encoder/decoder/tokenizer + IO contract), reusing
  the audio/token/decode validators from the LiteRT manifest. The worker routes a
  fetched manifest to the ORT path on its `runtime: "ort-whisper"` discriminator.

## Foundation module map

All under `src/engine/ml/ort/`:

| Module                  | Responsibility                                                               |
| ----------------------- | ---------------------------------------------------------------------------- |
| `ort-types.ts`          | Shared, runtime-free types (EP, tensor location, device owner, manifest).    |
| `ort-loader.ts`         | Lazy dynamic imports of the WebGPU / `all`-WebNN / WASM builds.              |
| `ort-model-manifest.ts` | ONNX manifest validation (format, provenance, integrity, EP policy).         |
| `ort-asset-loader.ts`   | Trusted-host check + verified, OPFS-cached load (reuses the Phase 29 cache). |
| `ep-policy.ts`          | Execution-provider resolution + the frame-coupled no-WASM gate.              |
| `ort-session.ts`        | `InferenceSession.create` wrapper with pinned EPs and device wiring.         |
| `webnn-context.ts`      | `MLContext`-from-`GPUDevice` helper (clean `unsupported` fallback).          |
| `onnx-fixture.ts`       | Dev/test-only in-memory identity ONNX model for the spikes.                  |
