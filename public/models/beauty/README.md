# Beauty model assets (Phase 32b — Landmark-Driven Beauty)

Phase 32b runs face detection + dense landmark inference on **ONNX Runtime Web (ORT)**, WebGPU
execution provider, built on the Phase 105 ORT foundation (`src/engine/ml/ort/`). Models are
**ONNX** graphs (not MediaPipe `.task` bundles — the browser never fetches or parses `.task`).
The smoothed landmarks drive a worker-owned WGSL mesh-warp pass (`src/engine/shaders/beauty-warp.wgsl`).

## Status: not yet configured (feature hidden)

`manifest.json` here is a **`template`** — `validateBeautyManifest` rejects any manifest with
`"template": true`, so the feature reports **"No compatible beauty model configured"** and the
Inspector Beauty controls stay hidden/disabled (R1.3, R7.1). There is no silent fallback and the
GPU warp never runs (the compositor guard requires real landmarks). To enable, vendor a
license-verified detector + landmark ONNX pair and replace the template (see below).

## How model bytes are delivered (local-first, no cloud inference)

- Fetched **on explicit user action** through the same-origin Worker proxy
  (`/_model/{hf,gh,gcs}/…`, `src/worker/index.ts`) or a same-origin static path — never a direct
  cross-origin browser fetch (COEP `require-corp`). The host allowlist is enforced by
  `validateModelUrl` (`src/engine/beauty/model-manifest.ts`) and
  `assertTrustedOrtModelUrl` (`src/engine/ml/ort/ort-asset-loader.ts`).
- **SHA-256 + size verified** before sessions are created, and **OPFS-cached by digest**
  (`loadOrtModelAsset` / `createOrtOpfsAssetStore`) — offline after the first download.
- The ORT WASM/JSEP runtime is served same-origin via the Worker reverse-proxy at `/_ort/`
  (version-pinned), not vendored. Model bytes are never embedded in the app bundle.

## Manifest shape (two ONNX assets)

| Asset       | Input (NHWC or NCHW)  | Outputs                                           |
| ----------- | --------------------- | ------------------------------------------------- |
| `detector`  | image `[1,192,192,3]` | `boxes` `[1,N,4]` + `scores` `[1,N,1]` (same `N`) |
| `landmarks` | image `[1,256,256,3]` | `landmarks` `[1,478,3]` (v1 topology)             |

Each asset carries `url`, `sizeBytes`, `checksum` (`sha256-<64 hex>`), `license`, `source`,
`provider`, `modelCard`, and explicit `inputs`/`outputs` tensor contracts. Top-level `sizeBytes`
must equal the sum of all asset sizes. `topologyVersion` must be `1` and `landmarkCount` `478`.

## To enable (the validation gate)

1. Pick detector + landmark models whose **licence is verified permissive** (commercial-OK).
   FaceMesh / MediaPipe-derived ONNX exports are the v1 target.
2. Export/obtain the **ONNX** graphs; host them on an allowlisted host (HF / GitHub / GCS /
   same-origin static).
3. Confirm the graphs run on ORT-WebGPU (the frame-coupled EP policy forbids a WASM/CPU
   full-frame preview fallback).
4. Replace `manifest.json`: remove `"template"`, fill real `url`/`sizeBytes`/`checksum` for both
   assets, set the top-level `sizeBytes` to their sum, and confirm the tensor contracts match the
   exported graphs' signatures.

License + provenance for the shipped models must be recorded here and in the app's third-party
attributions. See `.kiro/specs/phase-32b-landmark-driven-beauty/` and `docs/ML-RUNTIME.md`.
