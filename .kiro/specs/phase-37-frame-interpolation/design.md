# Design: Phase 37 — Frame Interpolation

> Status: **Planned (ORT/ONNX).** RIFE-class learned frame interpolation through **ONNX
> Runtime Web (ORT)** on the **WebGPU** execution provider, built on the Phase-105 ORT
> foundation (`src/engine/ml/ort/`). Render-cache-backed, export-only below the high tier,
> bounded-segment preview on the high tier, probe-derived time estimate before every run,
> probe-driven tiling for VRAM. Local-first: no cloud, no accounts, no telemetry.

## Goal

Synthesise plausible in-between frames entirely on-device: smooth slow motion (Phase 35
ramps), fps upconversion at export (24→60), and optional flow-field motion blur. Honest about
cost (estimate first, render-cache-backed, export-only below the high tier) and degrades
explicitly (hidden when no WebGPU or no compatible model) — never a silent hang, never a CPU
fallback for the full-frame model.

## Why ORT/ONNX (not LiteRT)

The other on-device ML features (DTLN P28, Whisper P29, matte P31) run LiteRT `.tflite`,
because permissive `.tflite` models exist for them. **For frame interpolation no
permissively-licensed, hosted `.tflite` exists** — FILM ships as a TF SavedModel and
RIFE/CAIN/IFRNet as PyTorch/ONNX. RIFE-class interpolators *are* published as **ONNX**, and
ORT-WebGPU keeps tensors device-resident, so interpolation targets **ORT**. This is exactly
the case the Phase-105 ORT foundation was built for (`docs/ML-RUNTIME.md`).

The earlier "ORT-Web rejected" framing is replaced by an accurate device policy: **ORT-WebGPU
does not assume external renderer-owned device injection in general; for this feature the
renderer's `GPUDevice` is injected into ORT** (`env.webgpu.device = device`, `deviceOwner:
'renderer'`), which the foundation's `ort-device-ownership.browser.test.ts` proves keeps a
`GPUBuffer` usable by both an app compute pass and ORT's `Tensor.fromGpuBuffer`.

## Built on the Phase-105 ORT foundation (`src/engine/ml/ort/`)

Phase 37 consumes, and does not re-implement, the foundation:

| Module | What Phase 37 uses |
|--------|--------------------|
| `ort-loader.ts` | Lazy dynamic `import('onnxruntime-web/webgpu')` (no ORT in the startup bundle); `ortWasmBasePath()` = `/_ort/` (the Worker reverse-proxies ORT's ~26 MB WASM from a version-pinned CDN, same-origin under COEP). |
| `ort-session.ts` | `createOrtSession({ modelBytes, manifest, device, tensorLocation: 'gpu-buffer' })` → `OrtSessionHandle { session, primaryEp, tensorLocation, deviceOwner, device }`. Injects the renderer device, pins the EP list, sets `preferredOutputLocation`. |
| `ep-policy.ts` | The **frame-coupled hard gate**: a `frameCoupled` model may never resolve to `wasm`/CPU and must pin a GPU-class EP. Interpolation manifests set `frameCoupled: true`. |
| `ort-asset-loader.ts` | `loadOrtModelAsset(asset, { store })` — trusted-host allowlist (`assertTrustedOrtModelUrl`: HF/GitHub/GCS/**R2** + the `/_model/*` proxy) over the Phase 29 `loadVerifiedAsset` (SHA-256 + OPFS cache). |
| `ort-model-manifest.ts` | `validateOrtManifest` (format `onnx`, provenance, integrity, EP policy, frame-coupled tensor-location gate). |
| `ort-types.ts` | `OrtModelManifest`, `OrtExecutionProvider`, `OrtTensorLocation`, `OrtDeviceOwner`. |
| Diagnostics `mlRuntime` | `mlRuntime` / `ortEp` / `tensorLocation` / `deviceOwner` summary. |

> **What's new in Phase 37:** the interpolation *manifest IO contract* (input/output names,
> layout, timestep) and the *engine* (preprocess/postprocess WGSL + tiling + timestep +
> shot-guard + cache); the runtime, asset loading, EP policy, device sharing, and the device
> spike are all the foundation's.

## Dependencies (prerequisite contracts)

| Phase | Relied on |
|-------|-----------|
| Phase 105 — ORT foundation | the modules above (merged to main). |
| Phase 35 — Speed ramps | a retime model with a per-segment frame-handling mode; Phase 37 adds `synthesize`. **Not yet in the repo** — the slow-motion use awaits it. |
| Phase 33 — Smart Reframe | shot-boundary detection (histogram diff), consumed by the shot-guard (R10). |
| Phase 19 — Render cache | `RenderCacheKey`, dependency index, preview/export + original/proxy modes, bounded chunking, eviction. |
| Phase 25 — Diagnostics | estimate conventions, recent-errors + redaction, the `mlRuntime` summary. |
| Phase 27 / 6 / 17 / 24 | `DualStreamFrameSource` read-ahead; pipelined export + backpressure; `ExportSettings`; render queue/presets. |

## Non-goals

- Realtime interpolation on all tiers (high tier previews *bounded* segments; lower tiers
  export-only).
- Video super-resolution; interpolation across shot boundaries (refused, R10); factors above
  ≤4×/pair in v1.
- **No WASM/CPU fallback** for the full-frame model (`ep-policy` forbids it); no cloud.
- Bitwise reproducibility (FP16/EP nondeterminism accepted; cache is key-based).
- Shipping non-commercial weights, or a placeholder manifest that looks loadable (R2.4).

## Model candidates (none enabled until validated — R9)

No candidate is wired until its license, size, SHA-256, IO contract, static/dynamic shapes,
and **full ORT-WebGPU operator support** are verified (R9). The shipped `manifest.json` is a
`template` (rejected by the validator) so the feature stays hidden until then.

| Model | License | Notes | ORT-WebGPU op risk |
|-------|---------|-------|--------------------|
| **CAIN** | **MIT** | Flow-free (PixelShuffle + channel attention); midpoint t=0.5 → recurse for ≤4×. **No warping op** → most likely to pass the R9 full-WebGPU gate. | Low (convs + channel attention + depth-to-space). |
| **FILM** | Apache-2.0 | Large-motion quality; native arbitrary `time` input. ONNX export via the community/`ai-edge-torch` path. | Medium (warp/gather ops). |
| **RIFE / IFRNet** | code MIT; **RIFE weights often non-commercial** | Published as ONNX; runs in-browser via ORT-Web elsewhere. | Medium (flow warp); RIFE license must be cleared before shipping. |

Recommendation: **CAIN** for the best chance of passing the op-support gate with a clean
license; FILM for quality if its ops convert. The choice is finalised at R9 vendor time.

## Architecture

```
Main (SolidJS)                            UNCHANGED core editor when unused/unavailable
  ├─ availability(probe) — tier + WebGPU → preview-and-export / export-only / unavailable
  ├─ Inspector (Phase 35 ramp): duplicate | blend | synthesize ; Load model ; estimate ; Preview segment
  ├─ ExportDialog / RenderQueue: fps-upconvert ; estimate (states EP) ; motion-blur toggle
  └─ worker-bridge (typed postMessage)
                                                         ▼
Pipeline worker (src/engine/worker.ts) — owns renderer.gpuDevice
  ├─ InterpolationEngine (src/engine/interpolation/interpolation-engine.ts)
  │   ├─ loadModel: fetch /models/interpolation/manifest.json → validateInterpolationManifest
  │   │            → loadOrtModelAsset (trusted host + SHA-256 + OPFS) → createOrtSession(device)
  │   ├─ synthesise(F0,F1,tau,W,H,plan): importExternalTexture×2 → interp-preprocess WGSL
  │   │            (GPUBuffer, model layout) → ort.Tensor.fromGpuBuffer → session.run
  │   │            (gpu-buffer output) → interp-postprocess WGSL → tile region of output texture
  │   ├─ tiling (≥1080p, halo, stitch), timesteps (≤4× cap), shot-guard (Phase 33 refusal)
  │   └─ render-cache (interpolationHash incl. EP), estimate (states EP)
  └─ diagnostics: availability, EP, tensorLocation, deviceOwner, model status, estimate vs actual
```

The UI holds only signals/serialisable state; it never sees `VideoFrame`s, ORT tensors, GPU
handles, or model bytes.

## Frame synthesis pipeline (zero-copy, device-resident)

Per output instant `t` from a bracketing pair `(F0,F1)`, fractional `tau`:

1. Shot-guard (Phase 33): a boundary between `t0` and `t1` → hold/cut, record refusal, no model run.
2. Tile plan (R4): ≥1080p or over-budget → overlapping tiles; else one tile.
3. Per tile: `importExternalTexture(F0/F1)` → **interp-preprocess WGSL** writes two normalized
   tensors into `GPUBuffer`s in the manifest `io.layout` (NCHW for RIFE/FILM) → wrap with
   **`ort.Tensor.fromGpuBuffer`** (+ a tiny CPU `tau` scalar tensor) → **`session.run`** with
   `preferredOutputLocation: 'gpu-buffer'` → read the output tensor's **`.gpuBuffer`** →
   **interp-postprocess WGSL** writes the tile's core region (halo dropped) into the output
   texture. **No `getData()`; no CPU pixel round-trip.**
4. Stitch tiles → `F_t`; deliver to compositor (bounded preview) or encoder (export); write
   the render-cache chunk (R6). `F0/F1` are *borrowed* (the caller closes them once per
   interval, since a pair feeds several `tau`); ORT input tensors wrap our reused buffers
   (`.dispose()` does not free them); the `gpu-buffer` output tensor is `.dispose()`d after the
   postprocess pass that reads it completes.

The session runs on the renderer's injected device (`deviceOwner: 'renderer'`), so the
preprocess/postprocess passes, ORT compute, and the compositor all share one `GPUDevice`.

**Why cap at ≤4×/pair (v1):** single-step interpolation is most reliable near `tau=0.5`; many
interior samples or deep recursion compound large-motion failures and multiply cost + cached
intermediates. 4× covers 24→60 (2.5×) and 0.25× slow-mo while bounding the worst-case estimate
and VRAM. Fixed-midpoint models (CAIN, `io.timestepName: null`) recurse for non-midpoint
instants, bounded by the same cap.

**Hard-gate note.** Interpolation is bounded batch synthesis, outside the realtime
single-submission-per-frame compositor gate; the realtime compositor still submits once per
displayed (cached) frame.

## VRAM tiling, time estimate, render cache

- **Tiling** (`tiling.ts`, pure): VRAM budget from WebGPU limits × safety; ≥1080p tiles with a
  halo sized to `io.maxDisplacement`; seam-free stitch; **refuse** (not crash) when a minimum
  tile won't fit (R4).
- **Estimate** (`interpolation-estimate.ts`, pure): frames × tiles/frame × calibrated ms/tile;
  the calibration profile is keyed by **EP** + hardware; the surfaced estimate states the EP
  and tensor location (R5); ±30% on fixture profiles.
- **Render cache** (Phase 19): `RenderCacheKey.interpolationHash` over `{ mode, factorCap,
  targetFps, rampHash, modelId, modelVersion, ep, tilingProfile, motionBlur }`; changing any
  invalidates the affected ranges; `ExportSettings.interpolation` joins
  `canonicalExportSettingsForCache`; preview/export + original/proxy separation hold; cached by
  key, not output digest (R6).

## Manifest + delivery

`public/models/interpolation/manifest.json` is an **ORT manifest** (`validateOrtManifest`:
`format: 'onnx'`, `frameCoupled: true`, pinned `executionProviders`, digest-pinned `model`)
plus an interpolation `io` block (layout, `input0Name`/`input1Name`/`timestepName`,
`outputName`, `flowOutput`/`flowOutputName`, sizes, `maxDisplacement`). `validateInterpolationManifest`
adds the io parse and **rejects any `template: true` manifest (R2.4)** — the shipped file is a
template, so the feature is hidden until a real model is vendored. Assets load via
`loadOrtModelAsset` (allowlisted host + `/_model/*` proxy + SHA-256 + OPFS); the SW caches
`/models/interpolation/` (not precached at install); ORT's WASM is proxied at `/_ort/`.

## Capability gating

`deriveInterpolationAvailability(tier, hasWebGpuDevice, hasUsableRuntime)` →
`preview-and-export` (core-webgpu) / `export-only` (compatibility-webgpu) / `unavailable`
(no WebGPU). Never feeds `CapabilityTierV2`. A `template`/absent/invalid manifest surfaces as
**"No compatible interpolation model configured"** (the engine reports `failed` with that
message). WASM is policy-forbidden for this frame-coupled feature (`ep-policy`).

## Protocol + worker

UI-facing protocol (frames/tensors never cross): `interp-probe` / `interp-load-model
{ catalogId }` / `interp-estimate` / `interp-preview-segment` / `interp-cancel` /
`interp-dispose`; states `interp-availability` / `interp-model-status { status, accelerator,
sizeBytes, error }` / `interp-estimate-result` / `interp-progress` / `interp-preview-ready` /
`interp-refusal` / `interp-cancelled` / `interp-error`. `ExportSettings.interpolation`
(`{ mode: 'fps-upconvert'; factorCap; motionBlur }`, default off). Worker handlers: probe
(tier+device→availability), load (`InterpolationEngine.ensureModelLoaded` + status via
`onStatus`), estimate (`planTiles` + `estimateSynthesisMs`), cancel, dispose.

## Modules

| Module | Work |
|--------|------|
| `src/engine/ml/ort/*` | **Reuse** (Phase 105): loader, session, ep-policy, asset-loader, manifest, types. |
| `interpolation/interpolation-model.ts` | `OrtModelManifest` + interpolation `io`; `validateInterpolationManifest` (template/frame-coupled gates); `toModelIoContract`. |
| `interpolation/interpolation-engine.ts` | ORT WebGPU session via `createOrtSession(device)`; `fromGpuBuffer` IO; tiled `synthesise`; `VideoFrame`/tensor lifetimes. |
| `interpolation/{timesteps,tiling,interpolation-estimate,shot-guard,ssim}.ts` | Pure logic (cap, tiling, estimate, refusal, quality metric). |
| `shaders/interp-preprocess.wgsl`, `interp-postprocess.wgsl` | External texture → NCHW/NHWC `GPUBuffer`; output buffer → tile region. |
| `cache-key.ts`, `cache-invalidation.ts`, `render-cache-integration.ts` | `interpolationHash` (incl. EP) + invalidation + chunk IO. |
| `worker.ts`, `protocol.ts` | `interp-*` dispatch/messages; `ExportSettings.interpolation`. |
| `ui/InterpolationControls.tsx` + Inspector/ExportDialog/DiagnosticsPanel | controls + diagnostics (wiring pending). |
| `public/models/interpolation/{manifest.json,README.md}`, `docs/USER-GUIDE.md` | template manifest + provenance + guide. |

## Third-party libraries

- **`onnxruntime-web` (ORT, MIT, Microsoft)** — added by Phase 105; reached only through the
  lazy `ort-loader` dynamic imports (no ORT in the startup bundle). Phase 37 adds no runtime
  dependency.
- **The interpolation model** is an ONNX asset fetched through the trusted-host `/_model/*`
  proxy, digest-pinned; permissive license verified at R9 vendor time. No npm model dep.
- SSIM, tiling, timestep, estimate math are hand-written pure TypeScript.

## Testing strategy

- **Unit (node, mocked):** timesteps + cap; shot-guard; tiling (1080p/4K + refuse); estimate
  (±30%, EP-keyed); cache key/invalidation (incl. EP + `ExportSettings.interpolation`);
  **manifest validation incl. ONNX/frame-coupled/EP-policy and template→hidden**; availability
  matrix; no-startup-fetch; SSIM metric. (The ORT foundation's own 53 tests cover the runtime.)
- **Browser-mode (GPU, R9/R14.9–10):** no-CPU-readback proof (tensors stay `gpu-buffer`, no
  `getData`); per-node-EP harness (every node on WebGPU or approved WebNN; any full-frame
  WASM/CPU fallback → reject + "No compatible interpolation model configured"); SSIM floor on
  panning fixtures; VRAM within bound at 1080p/4K.
- **Playwright (UI-critical, model mocked):** availability gating + estimate display +
  fps-upconvert settings recorded.
- **Quality gate:** `vp run check` green; test count grows.

## Validation

| Scenario | Expected |
|----------|----------|
| App startup | No model/ORT fetch; no ORT chunk in the entry bundle; pipeline worker boots normally. |
| `core-webgpu`, real model loaded | Slow-mo `synthesize` + bounded preview; fps-upconvert export; device shared (`deviceOwner: 'renderer'`), no CPU readback. |
| `compatibility-webgpu` | Export only, labelled slow, estimate shown. |
| No WebGPU / template manifest | "No compatible interpolation model configured"; core editor unaffected; **no WASM fallback**. |
| Frame-coupled manifest pins `wasm` | Rejected at validation (`ep-policy`), feature hidden. |
| 1080p & 4K | Tiling within the probed VRAM bound; seam-free; too-small budget refuses. |
| Change mode/factor/fps/model/EP/motion-blur | Affected render-cache ranges invalidate. |
| Shot boundary | Synthesis refused → hold/cut, reported. |
| Off-allowlist model URL / checksum mismatch | `assertTrustedOrtModelUrl` refusal / hard integrity error; no fallback source. |
| Quality gate | `vp run check` green; test count grows. |
