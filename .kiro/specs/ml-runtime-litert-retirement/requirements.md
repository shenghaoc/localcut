# Requirements: ML runtime — LiteRT/TFLite retirement

> **Plan only — not yet implemented.** This spec completes the unify-on-ORT policy
> set in `ml-runtime-ort-device-ownership` (PR #121): migrate the remaining
> LiteRT-default feature (portrait matte) to a license-verified ONNX model on ORT,
> then **delete the LiteRT/TFLite runtime, loaders, assets, and dependency** so the
> app runs on a single ML runtime (ORT). Retiring LiteRT does **not** remove the
> WASM execution provider — that is ORT's own un-droppable floor.

## R0 — Hard constraints

- **R0.1** **Parity before removal.** No LiteRT path is deleted until its ORT/ONNX
  replacement is the proven-equivalent default (quality + performance), with the
  LiteRT path retained as a selectable rollback only up to that point.
- **R0.2** **Single ML runtime end state.** After this spec, `@litertjs/core`,
  `*.tflite` assets, the `/litert/` runtime, and all LiteRT loader/runtime code are
  gone; ORT is the only ML runtime.
- **R0.3** **The WASM floor stays.** ORT-WASM remains the universal fallback EP;
  "retire LiteRT" ≠ "drop WASM". No startup model load; no cloud inference.
- **R0.4** No user-facing regression: import/edit/preview/export, Auto Captions,
  Audio Cleanup, and portrait matte keep working throughout.

## R1 — Dependencies & sequencing

- **R1.1** Portrait-matte migration **depends on**
  `ml-runtime-compositor-device-adoption` — the ORT matte engine's output lives on
  ORT's device and cannot composite until the renderer adopts that device. The
  matte default must not flip to ONNX before that lands.
- **R1.2** The ASR (Whisper) and Audio Cleanup (DTLN) LiteRT paths are already
  **non-default** (ORT is the shipped default; LiteRT is a selectable fallback), so
  their removal is independent of R1.1 and can proceed once the team accepts losing
  the LiteRT rollback.

## R2 — Portrait matte → ONNX

- **R2.1** Pin a **license-verified permissive** ONNX matting/segmentation model
  (MODNet-class) in `public/models/matte-onnx/manifest.json` (real `model.url` on an
  allowlisted host, `sizeBytes` + SHA-256, full `io` contract). GPL-family weights
  are rejected (`validateMatteOnnxManifest`).
- **R2.2** The model must pass the full-WebGPU operator-support gate (no full-frame
  WASM/CPU fallback — frame-coupled hard gate).
- **R2.3** Prove quality + performance parity against the deployed LiteRT MediaPipe
  Selfie Segmentation on the fixture matrix before flipping the default.
- **R2.4** Retire the `__MATTE_ONNX_SPIKE__` build flag once the ONNX backend is the
  default; the EMA temporal contract + resolve shader (`matte-temporal.ts`,
  `matte-resolve.wgsl`) stay (shared, not LiteRT-specific).

## R3 — Flip defaults

- **R3.1** `DEFAULT_MATTE_BACKEND` → `ort-onnx`; remove the LiteRT matte option.
- **R3.2** Remove the LiteRT entries from the ASR `model-catalog` and the Audio
  Cleanup backend picker; ORT becomes the only option for each.

## R4 — Remove LiteRT code & assets

- **R4.1** Delete the LiteRT matte engine + loader (`src/engine/matte/matte-engine.ts`,
  `matte-engine.concurrency.test.ts`, `src/engine/matte/litert-loader.{js,d.ts}`),
  collapsing `matte-backend.ts` to the single ORT engine.
- **R4.2** Delete the LiteRT ASR runtime + loader (`src/engine/asr/litert-runtime.ts`,
  `litert-runtime.test.ts`, `litert-loader.{js,d.ts}`) and the LiteRT Whisper
  manifests; keep the engine-agnostic `whisper-decode.ts` and the ORT runtime.
- **R4.3** Delete the LiteRT DTLN runtime + manifests
  (`src/engine/audio-cleanup/dtln-runtime.ts`, its tests, `public/models/dtln/…`);
  keep the ORT DTLN runtime.
- **R4.4** Remove `@litertjs/core` from `package.json` + lockfile, the
  `scripts/setup-litert-assets.mjs` script, the `setup:litert` + `postinstall`
  hooks, and the vendored `public/litert/` assets.

## R5 — Diagnostics & types cleanup

- **R5.1** `mlRuntime` diagnostic enum drops `'litert'` → `'ort'` only;
  `buildWorkerDiagnosticSnapshot` and `mlRuntimeSummary` report `'ort'`
  unconditionally; remove LiteRT capability probes/rows.
- **R5.2** The `compositesOnRendererDevice` distinction (added in #121 to separate
  the LiteRT renderer-device engine from the ORT engine) becomes moot once only ORT
  remains — retire the flag (after `ml-runtime-compositor-device-adoption` makes ORT
  composite), simplifying `MatteBackendEngine`.

## R6 — Docs

- **R6.1** `docs/ML-RUNTIME.md` drops the LiteRT history/fallback framing and
  becomes ORT-only (keep the #26107 device-ownership and EP-policy content).
- **R6.2** Update the affected feature specs/READMEs (Phase 29/31, audio cleanup)
  to state ORT as the sole runtime.

## R7 — Verification

- **R7.1** Full quality gate green; test count does not decrease for retained logic
  (LiteRT-specific tests are removed with their code; ORT coverage stays).
- **R7.2** Manual matrix: matte (ONNX), Auto Captions (ORT), Audio Cleanup (ORT)
  all verified on the fixture set; a fresh `pnpm install` no longer fetches LiteRT
  assets and the app boots with no LiteRT references.
