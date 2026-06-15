# Requirements: Phase 37 — Frame Interpolation

> **Expensive, optional, capability-gated phase.** Adds RIFE-class learned frame
> interpolation through **ONNX Runtime Web (ORT)** for three uses: smooth slow motion (a
> "synthesize frames" mode for Phase 35 speed ramps), fps upconversion at export (e.g.
> 24→60), and optional motion-blur synthesis from the flow field. This is the most
> compute-heavy feature in the app: it runs through the Phase 19 render cache, is export-only
> below the high tier, and previews only bounded segments on the high tier. The core editor
> must be completely unaffected when the feature is unavailable or never used.
>
> **ORT-first, not LiteRT.** Unlike DTLN (Phase 28), Whisper (Phase 29), and matting (Phase
> 31) — which run on LiteRT.js `.tflite` — interpolation runs **ONNX** models on
> **ORT-WebGPU**. The reason is supply: there is no permissively-licensed, hosted
> interpolation `.tflite`, whereas RIFE-class models are published as ONNX. ORT-WebGPU keeps
> tensors device-resident (`Tensor.fromGpuBuffer` / `preferredOutputLocation: 'gpu-buffer'`),
> so the zero-copy contract is preserved **provided the ORT GPUDevice and the
> compositor/renderer device are the same** (R2.7 device policy).

## R0 — Hard Constraints

- **R0.1** No cloud AI, no inference API, no account, no API key, and no upload of user media or frames anywhere. All interpolation runs on the user's device.
- **R0.2** No model code or weights may be fetched, parsed, or instantiated at app startup. App boot must be byte-identical in network behaviour whether or not this feature exists or has ever been used.
- **R0.3** The interpolation model loads only after an explicit user action (enable "synthesize", "Load interpolation model", or "Preview interpolated segment"). The estimated download size is shown **before** any fetch.
- **R0.4** No inference, preprocessing, tiling, or pixel loops on the SolidJS main thread.
- **R0.5** Interpolation is GPU-coupled and runs **in the pipeline worker** on a single shared `GPUDevice` (R2.7). A `GPUDevice` is not transferable across workers; a separate inference worker would force a CPU pixel round-trip and is forbidden for this feature.
- **R0.6** Normal import / play / edit / export must work unchanged when the feature is unavailable, when the model fails to load, or when synthesis fails. Interpolation failure may never break the timeline, the playback clock, the realtime compositor, or the default export path.
- **R0.7** Model artifacts are fetched once at runtime through the app's **same-origin `/_model/` Worker proxy** (`/_model/hf`, `/_model/gh`, `/_model/gcs`, `src/worker/index.ts`, `wrangler.jsonc`) from the trusted-host allowlist (`assertTrustedOrtModelUrl` / `ort-asset-loader.ts`: this origin, Hugging Face, GitHub, Google Cloud Storage, Cloudflare R2), or as a same-origin app asset — never an arbitrary URL (COEP `require-corp` blocks direct cross-origin model CDN fetches in production). Bytes are SHA-256-verified and OPFS-cached for offline reuse (`loadVerifiedAsset`/`createOpfsAssetStore`, the Phase 29 cache reused by the ORT foundation). The **ORT WASM/JSEP runtime** (~26 MB, over the Workers static-asset limit, so proxied rather than vendored) is served same-origin via the Worker reverse-proxy at `/_ort/` (`ortWasmBasePath()`; version-pinned from a CDN, COEP-safe), to which `ort.env.wasm.wasmPaths` points. No media or telemetry ever leaves the device.
- **R0.8** The feature is labelled with its compute cost everywhere it appears (Inspector, export dialog, diagnostics, docs), and every run shows a time estimate first — never a silent long-running hang.
- **R0.9** Out of scope and explicitly not implemented this phase: realtime interpolation on all tiers, video super-resolution, and interpolation across shot boundaries (Phase 33 boundaries are refused, not synthesised across).
- **R0.10** **No WASM/CPU fallback for full-frame interpolation** (R1.2, R2.8) and **no cloud inference** (R0.1). If no graph can run fully on WebGPU (or an approved WebNN path), the feature is hidden — never silently downgraded to a multi-minute CPU run.

## R1 — Capability Probe + Tier Gating

- **R1.1** Interpolation availability is derived from the Phase 8 / Phase 26 capability probe plus an ORT execution-provider (EP) check; it must **not** alter `CapabilityTierV2` derivation or any existing tier/branching logic (mirrors how `CleanupProbeResult` / `AsrProbeResult` gate only their own features). It gates only interpolation.
- **R1.2** Backend policy is exact:
  - **Primary — ORT-WebGPU.** The only generally-enabled backend.
  - **Optional — ORT-WebNN.** Enabled **only** for a model that has passed a model-specific operator-coverage **and** `MLTensor` IO-binding proof (R2.7); otherwise not offered.
  - **Forbidden — ORT-WASM / CPU tensors for the full-frame model.** No code path. A graph that cannot run fully on WebGPU (or the approved WebNN path) is rejected (R9).
- **R1.3** Tier behaviour: `core-webgpu` (high tier) → bounded-segment preview (R7.4) **and** export; `compatibility-webgpu` → export only, labelled slow; `limited-webcodecs` / `shell-only` (no usable WebGPU) → hidden/disabled with a specific reason.
- **R1.4** The probe reports the selected EP (`'webgpu' | 'webnn'`) and the WebGPU device limits used for VRAM/tiling; it is cheap, side-effect free, and never loads the model. Probe errors map to "unavailable", never throw.
- **R1.5** The availability result + selected EP surface as a "Frame Interpolation (ML)" row in the diagnostics / capability panel, Phase 26 row format, consistent with the Audio Cleanup / Auto Captions rows.

## R2 — ORT Runtime + ONNX Model

- **R2.1** Inference uses **ONNX Runtime Web** (`onnxruntime-web`, `onnxruntime-web/webgpu`): `InferenceSession.create(modelBytes, { executionProviders: ['webgpu'], preferredOutputLocation: 'gpu-buffer' })`. The **`webgpu` EP is primary**; `webnn` is optional per R2.7; `wasm`/`cpu` are forbidden for the full-frame model (R1.2). LiteRT.js is **not** used for interpolation (no hosted permissive `.tflite` exists); it remains the runtime for the `.tflite` features (Phases 28/29/31).
- **R2.2** The shipped model is a RIFE-class learned interpolator delivered as an **ONNX artifact**. A model-candidate table (design.md) lists RIFE-class ONNX options; **no candidate is enabled until** its license, size, SHA-256, input/output contract, static/dynamic shapes, and ORT-WebGPU operator support are all verified (R9). Non-commercial-only weights (e.g. some RIFE distributions) must not be shipped.
- **R2.3** A versioned model manifest (`public/models/interpolation/manifest.json`, validated by a pure unit-testable `validateInterpolationManifest`) declares: `id`, `version`, `license`, `provider`, `source`, `modelCard` URL, total `sizeBytes`, the **ONNX** asset(s) (`url`, `sizeBytes`, `checksum` `sha256-<hex>`), and the model I/O contract (input names + dtypes + shapes (static or dynamic), the timestep input convention, output name, whether a flow output exists). Missing/invalid required fields are rejected with a specific reason; the top-level size must equal the sum of asset sizes.
- **R2.4** **Placeholder/template manifests are invalid and hide the feature.** The validator rejects any manifest marked template or carrying a placeholder digest (`sha256-0…0`); an invalid/absent manifest yields availability "no compatible interpolation model configured" — never a loadable-looking but broken model.
- **R2.5** Artifacts are fetched only on explicit user action (R0.3) via the allowlist + `/_model/` proxy (R0.7), through `loadVerifiedAsset` (`asset-cache.ts`): bytes must match `sizeBytes` and `checksum` before session creation; a corrupt download is a hard, user-visible error (a corrupt cache entry silently re-downloads) — never a fall-through to an unverified source. Verified bytes are OPFS-cached by digest (`createOpfsAssetStore`); a Vite SW cache rule covers `/models/interpolation/`; weights are not precached at install; a digest/version change invalidates the cache.
- **R2.6** Download size (manifest) and live progress (`onProgress`, `onSource: 'cache' | 'network'`) are surfaced before/during the fetch (R0.3, R0.8). License + provider + `modelCard` render in the panel and docs attributions.
- **R2.7** **Device policy — one shared `GPUDevice`, no full-frame CPU tensor transfer:**
  - **If the ORT-WebGPU device-ownership spike passes:** interpolation uses the **ORT-owned `GPUDevice`** (`ort.env.webgpu.device`) and the renderer/compositor **adopts that device**. The preprocess/postprocess WGSL passes run on it.
  - **Else (renderer-owned WebGPU + WebNN):** require a **pre-created `MLContext`** built on the renderer's `GPUDevice` and **`MLTensor` IO binding** (ORT-WebNN), so tensors stay device-resident.
  - **No path may upload or download full-frame tensors through CPU.** (Small scalars like the timestep may be CPU tensors.)
- **R2.8** **Runtime tensor IO is device-resident:** preprocess `VideoFrame`/external texture into **`GPUBuffer` input tensors on the same device ORT uses**; bind via **`ort.Tensor.fromGpuBuffer`** (WebGPU) or `MLTensor` (WebNN); request **`preferredOutputLocation: 'gpu-buffer'`** (or preallocated output tensors) and read the output's `.gpuBuffer`. **No `tensor.getData()` / `getData()` in the synthesis path.**

## R3 — Frame Synthesis Pipeline

- **R3.1** Given a bracketing source frame pair `(F0 @ t0, F1 @ t1)` and an output instant `t ∈ (t0, t1)`, the engine synthesises `F_t` zero-copy: `VideoFrame` → `importExternalTexture` → preprocess WGSL (resize/normalise → `GPUBuffer`) → `ort.Tensor.fromGpuBuffer` → `session.run` (output `gpu-buffer`) → postprocess WGSL (`GPUBuffer` → RGBA output texture) → compositor/encoder. No `getImageData`, no Canvas2D readback, no CPU pixel round-trip.
- **R3.2** Every `VideoFrame` opened for synthesis is `.close()`d exactly once; ORT GPU output tensors are `.dispose()`d after the postprocess pass that reads them completes (no use-after-free).
- **R3.3** The interpolation factor is capped at **≤4× density per source frame pair in v1** (≤3 synthesised frames per source interval). Non-integer upconversion (24→60 = 2.5×) brackets each output instant to its source pair at the correct fractional `t`, still ≤4× per interval. Enforced in pure timestep math; the reason is documented in design.md.
- **R3.4** Synthesis is streaming and memory-bounded: pairs flow through Phase 6 export backpressure and Phase 27 `DualStreamFrameSource` read-ahead; no whole-clip/whole-file frame buffering. Render-cache output is bounded, range-aligned chunks (R6).
- **R3.5** Interpolation is a bounded **batch synthesis**, outside the realtime single-submission-per-frame compositor gate; the realtime compositor still submits once per displayed (cached) frame.

## R4 — VRAM Bound via Probe-Driven Tiling

- **R4.1** For inputs **≥1080p**, synthesis tiles into overlapping tiles (halo sized to the model's receptive field / max displacement) so peak GPU working set stays within a probe-derived VRAM budget; tiles stitch seam-free.
- **R4.2** Tile size/count derive from WebGPU limits + a safety factor; peak working set must not exceed the budget at 1080p **and** 4K.
- **R4.3** Tile planning, halo accounting, stitch coverage, and the working-set estimate are pure, GPU-free, unit-testable.
- **R4.4** If even a minimum tile cannot fit the budget, synthesis is refused with a specific reason (offer proxy/lower resolution), never attempted and crashed.

## R5 — Time Estimate (Phase 25 Diagnostics)

- **R5.1** Before any run, the UI surfaces a probe-derived estimate: synthesised-frame count × tiles-per-frame × measured ms-per-tile (+ overhead). **The estimate states the selected EP (`webgpu`/`webnn`) and the tensor location** so the cost model reflects the actual path.
- **R5.2** ms-per-tile comes from a one-time calibration on a single synthetic tile, cached per `{EP, hardware}` profile.
- **R5.3** Estimates within **±30%** of measured wall time on the checked-in fixture profiles; the math is pure and unit-tested.
- **R5.4** For export, the estimate appears in the export dialog / render-queue job before start; for preview, before the bounded segment generates. A cache hit reports ≈0 for the cached span.

## R6 — Render-Cache Integration (Phase 19)

- **R6.1** Synthesised frames are Phase 19 render-cache outputs. `RenderCacheKey` gains an `interpolationHash` covering: enabled/mode (`off`/`slowmo`/`fps-upconvert`), factor, output-instants policy, the speed-ramp curve/hash, `modelId` + `modelVersion`, **EP**, tiling profile, and motion-blur on/off. Changing any of these changes the key hash.
- **R6.2** Invalidation is correct when mode or factor (or fps/ramp/model/EP/motion-blur) changes; ambiguous changes invalidate conservatively (never serve stale synthesised frames).
- **R6.3** Interpolated chunks obey the existing `mode` (preview/export) and `sourceMode` (original/proxy) separation.
- **R6.4** Outputs are cached by key, not by output digest (FP16/EP nondeterminism is accepted).
- **R6.5** Interpolated chunks rank high-cost for eviction; a miss shows the R5 estimate before regenerating.

## R7 — Use (a): Smooth Slow Motion (Phase 35)

- **R7.1** The Phase 35 retime model gains `frameMode: 'duplicate' | 'blend' | 'synthesize'`; `synthesize` generates intermediate frames via R3.
- **R7.2** The slowdown factor maps to output instants per interval, ≤4× cap (R3.3); over-cap requests clamp with a visible note, never silently dropped.
- **R7.3** `synthesize` is selectable only when available (R1.3); otherwise disabled with a reason, falling back to `duplicate`/`blend`.
- **R7.4** On the high tier, "Preview interpolated segment" generates a bounded span (hard cap) into the render cache and plays it; the transport shows a cancellable "synthesising…" state. No continuous realtime interpolated playback in v1.

## R8 — Use (b): fps Upconversion at Export

- **R8.1** `ExportSettings.interpolation` (`{ mode: 'fps-upconvert'; factorCap; motionBlur }`, default off) lets an export synthesise frames to a higher target fps. The default export path never branches on it unless enabled; the field joins the Phase 19 export-settings cache canonicalisation.
- **R8.2** The export plan resolves, per output frame, the bracketing pair + fractional `t`, reusing R3/R6; over-cap intervals clamp with a warning in the export result.
- **R8.3** Integrates with the Phase 24 render queue + Phase 17 settings/presets; a queued job records its interpolation settings + shows the estimate; codec/resolution/fps/source-mode never silently change.
- **R8.4** Available on `core-webgpu` and `compatibility-webgpu` (R1.3); compatibility-webgpu is export-only, labelled slow.

## R9 — Model Validation Gate

- **R9.1** A model candidate is enabled only after a browser-mode/manual harness confirms **every graph node runs on WebGPU** (or the approved WebNN path).
- **R9.2** If any node falls back to WASM/CPU for the full-frame model, the candidate is **rejected**; the UI shows **"No compatible interpolation model configured"** (R0.10, R2.4).
- **R9.3** The harness records the per-node EP assignment and is referenced from the model-candidate table; results are documented before a candidate ships.

## R10 — Shot-Boundary Refusal (Phase 33)

- **R10.1** Synthesis never bridges a Phase 33 detected shot/scene boundary; the synthesisable pair set is filtered against the boundary list.
- **R10.2** At a refused boundary the pipeline holds/cuts for that interval and reports the refusal — never a corrupted frame.
- **R10.3** The pair/boundary filter is a pure, unit-testable function.

## R11 — UI

- **R11.1** Speed-ramp Inspector (Phase 35): `duplicate | blend | synthesize` gated per R1.3/R7.3; model-load affordance with download size (R2.6); R5 estimate (with EP); bounded "Preview interpolated segment" (R7.4) on the high tier.
- **R11.2** Export dialog / render queue (Phase 17/24): fps-upconvert control (R8) with estimate + slow-tier labelling + optional motion-blur toggle.
- **R11.3** Existing panel idioms (dark aesthetic, Kobalte, ARIA/keyboard, `onCleanup`); disabled states carry a specific reason (no WebGPU, no compatible model, model not loaded, over cap, VRAM too small, shot boundary).
- **R11.4** When unavailable (R1.3/R2.4) the controls are hidden or disabled with the reason; the rest of the app is unaffected.
- **R11.5** No `innerHTML`; model id/version/license/provider/`modelCard` render as text/JSX.

## R12 — Diagnostics (Phase 25)

- **R12.1** A "Frame Interpolation (ML)" diagnostics section (display-only): availability + tier, selected EP, tensor location, model loaded/not-loaded + size + cache source, VRAM budget + tile profile, last estimate vs actual, the R9 per-node-EP summary, last shot-boundary refusals, recent errors (redacted).
- **R12.2** Updates flow over the typed protocol from the pipeline worker as low-frequency state — never per frame.
- **R12.3** No media bytes, frame contents, file names, or GPU handles in diagnostics; redaction (Phase 25) applies.

## R13 — Documentation

- **R13.1** `docs/USER-GUIDE.md` + the in-app User Guide gain a "Frame Interpolation" section: the three uses, the ORT/ONNX model + download size, offline-after-first-download, license/provenance, the tier/EP matrix, the ≤4× cap and why, shot-boundary refusal, and the slow/estimate expectation.
- **R13.2** Model license + provenance and the trusted-host fetch path are recorded in `public/models/interpolation/README.md` + third-party attributions, alongside the `onnxruntime-web` ORT-WebGPU notes.

## R14 — Tests

- **R14.1** Unit-test (node, mocked) the timestep math (factor → instants, fractional fps bracketing, ≤4× cap/clamp).
- **R14.2** Unit-test the shot-boundary filter (R10.3).
- **R14.3** Unit-test tiling (R4.3) at mocked 1080p & 4K + refuse path.
- **R14.4** Unit-test the estimate math (R5.3) incl. EP/tensor-location in the profile key.
- **R14.5** Unit-test render-cache key + invalidation (R6.1/R6.2) incl. EP and `ExportSettings.interpolation` canonicalisation; preview/export + original/proxy separation.
- **R14.6** Unit-test manifest validation (R2.3/R2.4): valid manifest, missing/invalid fields, size-sum, `assertTrustedModelUrl` accept/reject, and **placeholder/template → invalid → feature hidden**.
- **R14.7** Unit-test capability gating (R1.2/R1.3): EP selection + tier matrix; "no WebGPU → hidden"; "no compatible model → hidden".
- **R14.8** Unit-test that no model fetch occurs at startup (spy `fetch`); `VideoFrame` closed exactly once in mocked synthesis.
- **R14.9** **Browser-mode (GPU-required):** prove **no CPU readback** in the interpolation path (no `getData`; tensors stay `gpu-buffer`); the SSIM quality floor vs a reference on panning fixtures ≥ recorded threshold. SSIM metric itself is unit-tested in node.
- **R14.10** **Browser-mode/manual (R9):** the per-node-EP harness reports every node on WebGPU (or approved WebNN); a model with any full-frame WASM/CPU fallback is rejected and the UI says "No compatible interpolation model configured". VRAM stays within the probed bound at 1080p & 4K via tiling.
- **R14.11** Playwright only for the UI-critical flow (model mocked): availability gating + estimate display + fps-upconvert settings recorded. No heavy GPU run in CI.
- **R14.12** Quality gate: `vp run check` green; test count grows for the new pure logic.

## R15 — Acceptance Criteria

- **A1** App startup loads no interpolation model/weights; entry bundle free of the interpolation/ORT modules until lazily imported.
- **A2** The model loads only after explicit user action, with download size shown first, fetched via the trusted-host `/_model/` proxy, working offline after first download.
- **A3** Synthesis is zero-copy on a single shared `GPUDevice` (`ort.Tensor.fromGpuBuffer` in, `gpu-buffer` out; no `getData`; no CPU pixel round-trip) and closes every `VideoFrame` exactly once (R14.9 proves no CPU readback).
- **A4** Quality floor met on panning fixtures (R14.9).
- **A5** Peak VRAM within the probed bound at 1080p & 4K via tiling (R14.10); a too-small budget refuses with a reason.
- **A6** Render-cache invalidation correct on mode/factor/fps/model/EP/motion-blur change (R14.5).
- **A7** Time estimates within ±30% (R14.4), shown before every run, stating the EP.
- **A8** Export-only below the high tier; bounded-segment preview on the high tier; hidden/disabled with a reason where WebGPU is absent — never a silent hang; **no WASM/CPU full-frame fallback** (R0.10).
- **A9** Interpolation across Phase 33 shot boundaries is refused (R10).
- **A10** The core editor is byte-identical in behaviour when the feature is unused or unavailable.
- **A11** **Do not merge until one real ONNX interpolation model passes the R9 validation gate (license + size + SHA-256 + IO contract + shapes + full-WebGPU op support), or the feature is honestly hidden.** The placeholder manifest is invalid by construction (R2.4) and keeps the feature hidden until then.
