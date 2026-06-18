# Requirements: ML Runtime - LiteRT/TFLite Retirement

This spec is implemented in PR #123. It completes the unify-on-ORT policy after
`ml-runtime-compositor-device-adoption`: repo-owned ML features now use ONNX
Runtime Web, with ORT-WebGPU for frame-coupled video models and ORT-WASM for
small non-frame-coupled models. The former secondary runtime, its assets, loaders,
model manifests, fallback pickers, and setup scripts are removed.

## R0 - Hard Constraints

- **R0.1** ORT remains the only repo-owned ML runtime. The WASM execution provider
  stays because it is part of ORT and is required for ASR/audio-cleanup features.
- **R0.2** No model or runtime loads at startup. All model assets remain
  explicit-load, digest-verified, and OPFS-cached.
- **R0.3** Smart Reframe's MediaPipe Tasks Vision model path is out of scope. It
  is not the retired runtime and its `.tflite` asset references must remain valid.
- **R0.4** There is no cloud inference, server-side media processing, telemetry,
  or direct cross-origin browser model fetch.

## R1 - Dependency

- **R1.1** The compositor device-adoption spec must be present before this spec
  flips frame-coupled matte to ORT-WebGPU, because ORT owns the `GPUDevice` and
  the renderer must adopt it for zero-copy composition.

## R2 - Portrait Matte On ORT

- **R2.1** `public/models/matte-onnx/manifest.json` must pin a real,
  license-verified permissive ONNX matte model with URL, size, SHA-256, and full
  IO contract.
- **R2.2** The matte model is frame-coupled and must pin ORT-WebGPU with
  `tensorLocation: "gpu-buffer"`; no WASM/CPU full-frame fallback is allowed.
- **R2.3** `DEFAULT_MATTE_BACKEND` is `ort-onnx`; the old matte engine, loader,
  manifest, model directory, and matte-specific preprocess shader are removed.

## R3 - ASR And Audio Cleanup On ORT

- **R3.1** Auto Captions exposes only ORT Whisper models in the catalog and UI.
  Protocol, probe, controller, diagnostics, and panel code use the ORT engine
  discriminator and no retired fallback recommendation.
- **R3.2** Audio Cleanup exposes only ONNX Runtime DTLN. `CleanupBackendKind`,
  bridge spawning, controller load commands, and `App.tsx` manifest wiring collapse
  to the ORT worker and `public/models/dtln-onnx/manifest.json`.

## R4 - Runtime, Assets, Build, And Service Worker

- **R4.1** Remove `@litertjs/core`, setup/postinstall hooks, runtime assets,
  retired model directories, retired loaders, retired runtimes, and their tests.
- **R4.2** Remove the Vite runtime-asset copy plugin and Workbox runtime caches for
  the retired runtime/model paths. Keep ORT proxy/runtime caching.
- **R4.3** Retire parity scripts that import deleted runtime files or deleted model
  directories.

## R5 - Diagnostics And Docs

- **R5.1** Diagnostics report `mlRuntime: "ort"` only.
- **R5.2** Update active runtime docs, user guide content, model READMEs, and
  affected phase specs/READMEs: Phase 28, Phase 29, Phase 31, and Phase 40.
- **R5.3** Active documentation must not describe selectable retired fallback
  engines or plan-only behavior.

## R6 - Verification

- **R6.1** Typecheck, unit tests, and build must pass.
- **R6.2** A fresh install must not install the removed runtime dependency or run a
  runtime-asset setup script.
- **R6.3** Grep sweeps over current code/public docs must leave only intentional
  historical spec mentions and Smart Reframe's explicitly out-of-scope MediaPipe
  Tasks Vision model path.
