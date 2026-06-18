# Interpolation model assets (Phase 37 — Frame Interpolation)

Phase 37 runs RIFE-class learned frame interpolation on **ONNX Runtime Web (ORT)**, WebGPU
execution provider, built on the shared ORT foundation (`src/engine/ml/ort/`). The model is
an **ONNX** graph because the permissively licensed RIFE-class candidates ship as
ONNX/PyTorch.

## Status: not yet configured (feature hidden)

`manifest.json` here is a **`template`** — `validateInterpolationManifest` rejects any manifest
with `"template": true`, so the feature reports **"No compatible interpolation model
configured"** and stays hidden. There is no silent fallback. To enable the feature, vendor a
real model and replace the template (see below).

## How model bytes are delivered (local-first, no cloud inference)

- Fetched **on explicit user action** through the same-origin Worker proxy
  (`/_model/{hf,gh,gcs}/…`, `src/worker/index.ts`) — never a
  direct cross-origin browser fetch (COEP `require-corp`). The host allowlist is
  `assertTrustedOrtModelUrl` (`src/engine/ml/ort/ort-asset-loader.ts`).
- **SHA-256 + size verified** before the session is created, and **OPFS-cached by digest**
  (`loadVerifiedAsset` / `createOpfsAssetStore`) — offline after the first download.
- The ORT WASM/JSEP runtime (~26 MB) is served same-origin via the Worker reverse-proxy at
  `/_ort/` (version-pinned), not vendored. Model bytes are never embedded in the app bundle.

## Model decision (2026-06-16 Chrome probe)

The first candidate to carry through R9 is **Practical-RIFE 4.25.lite**, exported from the
upstream weights rather than a third-party ONNX repost. Practical-RIFE's model table states
that the linked trained-model contents are under the same MIT licence as the project, and
4.25.lite is the lower-compute variant recommended by the upstream table for most scenes.

Do **not** ship `yuvraj108c/rife-onnx` from Hugging Face as-is. A Chrome probe against
`rife47_ensemble_True_scale_1_sim.onnx` fetched successfully through `/_model/hf/`, with
`sizeBytes = 21458882` and
`sha256-0a3a52814d07d919b8336c6b66677baaeeec517bdd4ac4f6852d4bf2680ebb5a`, and the graph
signature is usable (`img0`, `img1`, `timestep` -> `output`). However, the repository has no
README/licence/provenance file, and ORT-WebGPU session creation in Chrome stayed at
`create-session` beyond the validation threshold. Treat it as a rejected probe, not a
vendored source of truth.

| Model                         | License / source                                      | Decision                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Practical-RIFE 4.25.lite**  | **MIT** upstream trained-model links                  | **Selected first conversion candidate.** Arbitrary timestep and lower-compute variant; must be exported to ONNX from source weights and R9-validated. |
| **CAIN** (AAAI'20)            | **MIT** repo; pretrained links from upstream Dropbox  | Fallback if RIFE conversion/session creation still stalls. Flow-free graph lowers WebGPU-op risk, but midpoint-only recursion and ONNX export remain. |
| **FILM** (Google)             | **Apache-2.0**                                        | Quality fallback only. Ships as TensorFlow SavedModel, so conversion and warp/gather op risk are higher.                                              |
| Third-party RIFE ONNX reposts | Usually unclear unless explicitly documented per file | Reject unless licence/provenance, size/SHA, IO, and Chrome ORT-WebGPU session/run all pass.                                                           |

## To enable (the R9 validation gate)

1. Pick a model whose **licence is verified permissive** (commercial-OK).
2. Export/obtain the **ONNX** graph; host it on an allowlisted host (HF / GitHub / GCS).
3. Confirm **every graph node runs on ORT-WebGPU** (no full-frame WASM/CPU fallback) with the
   browser-mode per-node-EP harness. If any node falls back, reject the model.
4. Replace `manifest.json`: remove `"template"`, set the real `model.url` (proxy path),
   `model.sizeBytes` + `model.checksum` (sha256), and the `io` contract (`layout`,
   `input0Name`/`input1Name`/`timestepName`, `outputName`, `flowOutput`/`flowOutputName`,
   sizes, `maxDisplacement`) matching the exported graph's signature.

License + provenance for the shipped model must be recorded here and in the app's third-party
attributions. See `.kiro/specs/phase-37-frame-interpolation/` and `docs/ML-RUNTIME.md`.
