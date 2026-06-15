# Interpolation model assets (Phase 37 — Frame Interpolation)

Phase 37 runs RIFE-class learned frame interpolation on **ONNX Runtime Web (ORT)**, WebGPU
execution provider, built on the Phase 105 ORT foundation (`src/engine/ml/ort/`). The model is
an **ONNX** graph (not LiteRT `.tflite` — no permissively-licensed interpolation `.tflite` is
published; RIFE-class models ship as ONNX/PyTorch).

## Status: not yet configured (feature hidden)

`manifest.json` here is a **`template`** — `validateInterpolationManifest` rejects any manifest
with `"template": true`, so the feature reports **"No compatible interpolation model
configured"** and stays hidden. There is no silent fallback. To enable the feature, vendor a
real model and replace the template (see below).

## How model bytes are delivered (local-first, no cloud inference)

- Fetched **on explicit user action** through the same-origin Worker proxy
  (`/_model/{hf,gh,gcs}/…`, `src/worker/index.ts`) or a Cloudflare **R2** bucket — never a
  direct cross-origin browser fetch (COEP `require-corp`). The host allowlist is
  `assertTrustedOrtModelUrl` (`src/engine/ml/ort/ort-asset-loader.ts`).
- **SHA-256 + size verified** before the session is created, and **OPFS-cached by digest**
  (`loadVerifiedAsset` / `createOpfsAssetStore`) — offline after the first download.
- The ORT WASM/JSEP runtime (~26 MB) is served same-origin via the Worker reverse-proxy at
  `/_ort/` (version-pinned), not vendored. Model bytes are never embedded in the app bundle.

## Model candidates (choose one; verify before shipping)

| Model              | License                                         | Why / caveat                                                                                                                                                            |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CAIN** (AAAI'20) | **MIT**                                         | Flow-free (PixelShuffle + channel attention) → no `grid_sample`, most likely to pass the full-WebGPU op-support gate; midpoint-only (recurse for ≤4×). **Recommended.** |
| **FILM** (Google)  | **Apache-2.0**                                  | Large-motion quality; native arbitrary `time` input; ONNX export via `ai-edge-torch`/community; warp ops carry WebGPU-op risk.                                          |
| **RIFE / IFRNet**  | code MIT; **RIFE weights often non-commercial** | Published as ONNX; runs in browsers via ORT-Web elsewhere; clear RIFE's weights licence before shipping.                                                                |

## To enable (the R9 validation gate)

1. Pick a model whose **licence is verified permissive** (commercial-OK).
2. Export/obtain the **ONNX** graph; host it on an allowlisted host (HF / GitHub / GCS / R2).
3. Confirm **every graph node runs on ORT-WebGPU** (no full-frame WASM/CPU fallback) with the
   browser-mode per-node-EP harness. If any node falls back, reject the model.
4. Replace `manifest.json`: remove `"template"`, set the real `model.url` (proxy/R2 path),
   `model.sizeBytes` + `model.checksum` (sha256), and the `io` contract (`layout`,
   `input0Name`/`input1Name`/`timestepName`, `outputName`, `flowOutput`/`flowOutputName`,
   sizes, `maxDisplacement`) matching the exported graph's signature.

License + provenance for the shipped model must be recorded here and in the app's third-party
attributions. See `.kiro/specs/phase-37-frame-interpolation/` and `docs/ML-RUNTIME.md`.
