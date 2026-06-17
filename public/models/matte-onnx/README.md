# Portrait matte — experimental ORT/ONNX backend (Phase 31 spike)

This directory holds the manifest for an **experimental** portrait-matte backend that runs
an **ONNX** matting/segmentation model on **ONNX Runtime Web (ORT)**, WebGPU execution
provider, built on the Phase 105 ORT foundation (`src/engine/ml/ort/`). It is a spike to
evaluate replacing the deployed LiteRT path with a MODNet-class **true-matting** model — it
does **not** change the current default.

## Current default vs. this experimental backend

|          | Deployed default (LiteRT)                                                             | Experimental (this dir, ORT/ONNX)                          |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Manifest | `public/models/matte/manifest.json`                                                   | `public/models/matte-onnx/manifest.json`                   |
| Runtime  | `@litertjs/core` (LiteRT.js), WebGPU                                                  | `onnxruntime-web`, WebGPU EP                               |
| Model    | MediaPipe Selfie Segmentation (`.tflite`, Apache-2.0) — segmentation, **not** matting | A MODNet-class `.onnx` true-matting model (to be vendored) |
| Engine   | `src/engine/matte/matte-engine.ts`                                                    | `src/engine/matte/matte-onnx-engine.ts`                    |
| Status   | **Default, verified working end to end**                                              | **Off by default**, template (disabled)                    |

The LiteRT MediaPipe path stays the default until ORT model quality **and** performance are
proven. This backend is selected only when **both** are true: the `__MATTE_ONNX_SPIKE__`
build flag is on (`MATTE_ONNX_SPIKE=1`, see `vite.config.ts` + `src/engine/matte/matte-backend.ts`)
**and** a real ONNX model is pinned here (the shipped `manifest.json` is a `template`, so by
default the backend reports "no compatible ONNX matte model configured" and the matte path
degrades to the unmatted clip — no crash, no fallback to a different model).

## Status: not yet configured (backend disabled)

`manifest.json` is a **`template`** — `validateMatteOnnxManifest` rejects any manifest with
`"template": true`, so the experimental backend stays disabled. There is no silent fallback
and the deployed LiteRT default is unaffected. To enable it, vendor a real model and replace
the template (see below).

## How model bytes are delivered (local-first, no cloud inference)

Identical trust rules to every other on-device model (see `docs/ML-RUNTIME.md`):

- Fetched **on explicit user action** through the same-origin Worker proxy
  (`/_model/{hf,gh,gcs}/…`, `src/worker/index.ts`) or a Cloudflare **R2** bucket — never a
  direct cross-origin browser fetch (COEP `require-corp`). The host allowlist is
  `assertTrustedOrtModelUrl` (`src/engine/ml/ort/ort-asset-loader.ts`).
- **SHA-256 + size verified** before the session is created, and **OPFS-cached by digest**
  (`loadVerifiedAsset` / `createOrtOpfsAssetStore`) — offline after the first download.
- The ORT WASM/JSEP runtime (~26 MB) is served same-origin via the Worker reverse-proxy at
  `/_ort/` (version-pinned), not vendored. Model bytes are never embedded in the app bundle.

## Output contract (alpha/mask shape + value range)

The `io` block must state the alpha output explicitly — the resolve pass relies on it:

- `outputName` — ONNX output tensor name for the alpha/mask.
- `outputLayout` — `nchw` or `nhwc`.
- `outputChannels` — **must be `1`** (single-channel alpha). The output buffer is therefore
  `[1, 1, H, W]` (NCHW) or `[1, H, W, 1]` (NHWC); both index as `y*W + x`, so the EMA resolve
  shader is shared verbatim with the LiteRT engine. Multi-channel / softmax (fg/bg) outputs
  need a resolve variant and are out of scope for the spike.
- `outputRange` — **must be `unit`** (alpha in `[0, 1]`). Bake a sigmoid into the export so
  the output is already `[0, 1]`; `signed-unit` is declared in the type for forward
  compatibility but rejected by the validator (it would need a resolve denormalize).

The input contract — `inputName`, `layout` (`nchw`/`nhwc`), `inputWidth`/`inputHeight`,
`inputChannels` (`3`), `bytesPerElement` (`4`, FP32), and `inputRange` (`unit` `[0,1]` or
`signed-unit` `[-1,1]`) — drives the preprocess pass (`matte-onnx-preprocess.wgsl`).

## Model decision (license gate)

Same evaluation as the deployed default (see `.kiro/specs/phase-31-portrait-matting/design.md`),
re-applied to ONNX where the **true-matting** options actually exist:

| Model                        | License / source                            | Decision                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MODNet**                   | **Apache-2.0** (`github.com/ZHKKKe/MODNet`) | **Selected first conversion candidate.** Trimap-free true matting; ships as PyTorch/ONNX (no hostable `.tflite`, which is why LiteRT couldn't use it). Must be exported/obtained as ONNX, license-verified, and pass the full-WebGPU op-support gate. |
| **RVM** (RobustVideoMatting) | **GPL-3.0**                                 | **Rejected on license.** Technically the strongest (recurrent temporal state), but copyleft is disqualifying in an MIT app. `validateMatteOnnxManifest` hard-rejects any GPL-family `license`.                                                        |
| **U²-Net / IS-Net portrait** | Apache-2.0 / MIT variants exist             | Fallback candidate; verify the specific checkpoint's license and op support per file.                                                                                                                                                                 |
| Third-party ONNX reposts     | Usually unclear unless documented per file  | Reject unless license/provenance, size/SHA, IO, and Chrome ORT-WebGPU session/run all pass.                                                                                                                                                           |

## To enable

1. Pick a model whose **license is verified permissive** (commercial-OK). **Copyleft weights
   (GPL/LGPL/AGPL, by SPDX id or spelled-out name) are rejected** — both by policy and by the
   manifest validator (`isCopyleftLicense`).
2. Export/obtain the **ONNX** graph; host it on an allowlisted host (HF / GitHub / GCS / R2).
3. Confirm **every graph node runs on ORT-WebGPU** (no full-frame WASM/CPU fallback) with the
   browser-mode per-node-EP harness. If any node falls back, reject the model. ORT-WebNN is an
   option only **after** a per-operator support proof — and the engine has no WebNN tensor path
   yet, so `validateMatteOnnxManifest` currently rejects any `executionProviders` other than
   exactly `["webgpu"]`.
4. Replace `manifest.json`: remove `"template"`, keep `executionProviders` as `["webgpu"]`, set
   the real `model.url`, `model.sizeBytes`, and `model.checksum` (sha256), and the real `io`
   contract (input/output names, layout, `inputRange`, and the alpha output shape/range above)
   matching the exported graph. The runtime also re-validates the produced alpha tensor's element
   count against the declared single-channel `inputWidth × inputHeight` before binding it.
5. Verify temporal stability and preview/export performance against the deployed LiteRT
   default before considering any change to `DEFAULT_MATTE_BACKEND`.

License + provenance for any shipped model must be recorded here and in the app's third-party
attributions. See `.kiro/specs/phase-31-portrait-matting/` and `docs/ML-RUNTIME.md`.
