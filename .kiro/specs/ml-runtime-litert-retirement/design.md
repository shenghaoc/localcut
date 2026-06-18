# Design — ML runtime: LiteRT/TFLite retirement

> **Plan only — not yet implemented.** Records the removal scope, what stays, the
> licensing bar, and the sequencing/gating. Implementation is for a later agent.

## Goal

End state: **one ML runtime, ORT.** ORT already backs Auto Captions (default) and
Audio Cleanup (default); LiteRT survives as (a) the deployed portrait-matte default
and (b) selectable rollbacks for ASR/DTLN. This spec migrates matte to ONNX and
then deletes everything LiteRT.

## Current LiteRT footprint (inventory)

- **Matte:** `src/engine/matte/matte-engine.ts` (LiteRT MediaPipe Selfie, the
  deployed default), `matte-engine.concurrency.test.ts`, `matte/litert-loader.{js,d.ts}`.
  The ORT path (`matte-onnx-engine.ts`, `matte-onnx-model.ts`,
  `public/models/matte-onnx/`) already exists but is spike-flag + template gated.
- **ASR:** `src/engine/asr/litert-runtime.ts` (+ test), `asr/litert-loader.{js,d.ts}`,
  LiteRT Whisper manifests under `public/models/whisper/`. ORT runtime
  (`whisper-ort-runtime.ts`) is the default; `whisper-decode.ts` is engine-agnostic.
- **Audio Cleanup:** `src/engine/audio-cleanup/dtln-runtime.ts` (+ test),
  `public/models/dtln/`. ORT runtime (`dtln-ort-runtime.ts`, `public/models/dtln-onnx/`)
  is the default.
- **Runtime/assets/build:** `@litertjs/core` (package.json + lockfile),
  `scripts/setup-litert-assets.mjs`, `setup:litert` + `postinstall` scripts,
  vendored `public/litert/` WASM.
- **Diagnostics/UI:** `mlRuntime: 'litert'` in `src/diagnostics/types.ts`,
  `src/engine/diagnostics.ts`, `src/ui/diagnostic-snapshot.ts`; LiteRT options in the
  ASR `model-catalog` and the Audio Cleanup / Auto Captions panels; the
  `compositesOnRendererDevice` flag in `matte-backend.ts`.

## What stays (not LiteRT-specific)

- ORT engines + foundation (`src/engine/ml/ort/`), the WASM EP, `whisper-decode.ts`.
- The shared matte temporal contract `matte-temporal.ts` and `matte-resolve.wgsl`
  (used by the ORT engine too).
- `face-detector.ts` / MediaPipe Tasks-Vision BlazeFace in Smart Reframe is a
  separate `@mediapipe/tasks-vision` path, **not** LiteRT.js/TFLite — out of scope
  here (its own ORT migration, if any, is tracked separately).

## Sequencing & gates

1. **(dep)** Land `ml-runtime-compositor-device-adoption` so the ORT matte engine's
   ORT-device output can composite.
2. **R2** Pin a real, permissive ONNX matte model; prove quality+perf parity vs the
   LiteRT MediaPipe Selfie default on the fixture matrix.
3. **R3.1** Flip `DEFAULT_MATTE_BACKEND` → `ort-onnx`; retire `__MATTE_ONNX_SPIKE__`.
4. **R4.1** Delete the LiteRT matte engine + loader; collapse `matte-backend.ts`.
5. **R3.2 + R4.2/R4.3** Remove the LiteRT ASR/DTLN selectable fallbacks + runtimes +
   manifests (independent of step 1; gated only on accepting loss of the rollback).
6. **R4.4** Drop `@litertjs/core`, the setup script + `postinstall`, `public/litert/`.
7. **R5** Simplify diagnostics (`mlRuntime: 'ort'` only), retire the
   `compositesOnRendererDevice` flag, drop LiteRT probes/rows.
8. **R6** ORT-only docs.

Steps 4–7 are deletions that must each keep the quality gate green; they can be
separate commits/PRs if the diff is large, but all live under this spec.

## Licensing bar

The ONNX matte model must be permissively licensed (Apache-2.0 / MIT / BSD or
equivalent). GPL-family weights (e.g. RVM) are rejected both by policy and by
`validateMatteOnnxManifest` (`isCopyleftLicense`). Record digest provenance in
`public/models/matte-onnx/README.md`.

## Risks

- **Model supply / parity (highest).** A permissive MODNet-class ONNX that passes
  the full-WebGPU op gate and matches MediaPipe Selfie quality may need evaluation
  across candidates. Until R2.3 passes, **do not** flip the default or delete LiteRT
  matte — the rollback is the safety net.
- **Losing the ASR/DTLN rollback.** Removing the LiteRT fallbacks is a one-way door;
  confirm the ORT defaults have shipped without regression first.
- **Hidden LiteRT coupling.** Some UI copy and capability rows assume two runtimes;
  grep-sweep `litert`/`tflite` to zero (outside historical spec text) as the
  done-signal.

## Touch points

See the inventory above; the done-signal is `grep -riE 'litert|tflite|@litertjs'
src/ public/ scripts/ package.json` returning only ORT-migration history in spec
text, plus a clean `pnpm install` that fetches no LiteRT assets.
