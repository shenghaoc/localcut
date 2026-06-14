# Tasks: Phase 28 LiteRT DTLN Audio Cleanup

> Status: **Implemented in this PR (spec + implementation).**

## T1 — DTLN DSP and runtime

- [x] Create `src/engine/audio-cleanup/dtln-dsp.ts`: radix-2 512-point
  FFT/iFFT, magnitude/phase extraction, mask application, overlap-add
  synthesis. Constants: `DTLN_BLOCK_LEN=512`, `DTLN_BLOCK_SHIFT=128`,
  `DTLN_FREQ_BINS=257`, `DTLN_SAMPLE_RATE=16000`.
- [x] Create `src/engine/audio-cleanup/dtln-runtime.ts`: LiteRT.js runtime
  wrapping two TFLite models with LSTM state tensors. Reuses the untyped
  `litert-loader.js` boundary from Phase 29. Accelerator fallback order:
  preferred → wasm. `runModel1(magnitude)→mask`,
  `runModel2(estimated)→enhanced`, `resetState()`.

## T2 — Model manifest and asset pipeline

- [x] Rewrite `src/engine/audio-cleanup/model-manifest.ts`: two-model
  manifest (`model1`, `model2` each with `url`, `sizeBytes`, `checksum`)
  replacing the NPY tensor-packing format. Validates `audio.sampleRate=16000`,
  `blockLen=512`, `blockShift=128`, and `stateShape`.
- [x] Create `public/models/dtln/manifest.json`: MIT license, source
  `https://github.com/breizhn/DTLN`, GitHub proxy URLs
  (`/_model/gh/breizhn/DTLN/master/pretrained_model/`), real SHA-256
  checksums and byte sizes (model_1: 1,459,944 B, model_2: 2,515,804 B).
- [x] Delete `public/models/rnnoise/manifest.json` and
  `public/models/rnnoise/weights.bin`.

## T3 — Cleanup worker migration

- [x] Rewrite `src/engine/audio-cleanup/cleanup-worker.ts`: fetch manifest,
  download both TFLite models via Phase 29 `asset-cache` (OPFS caching +
  SHA-256 verification + progress), create `DtlnRuntime`. Processing uses
  `DtlnDsp` + runtime per-frame pipeline.
- [x] Rewrite `src/engine/audio-cleanup/cleanup-jobs.ts`:
  `CleanupInferenceRunner` interface now has `runModel1`/`runModel2` (was
  single `infer`). `CleanupJobProcessor` takes `DtlnDsp` + runner. Frame
  size is `DTLN_BLOCK_SHIFT=128` (was `RNNOISE_FRAME_SIZE=480`).
- [x] Rewrite `src/ui/cleanup-bridge.ts`: classic worker via `new Worker(
  new URL(...), { type: 'classic' })` (was ES module `?worker` import)
  because LiteRT.js loads WASM via `importScripts`.

## T4 — Controller and protocol

- [x] Update `src/protocol.ts`: remove `WebNNProbeResult`,
  `WebNNDeviceTypeSnapshot`, old manifest types. Add `CleanupAccelerator`,
  `CleanupProbeResult { wasmAvailable, accelerator }`,
  `CleanupModelAssetSnapshot`. `cleanup-load-model` takes `manifestUrl`,
  `wasmPath`, `preferredAccelerator`. `cleanup-model-status` uses
  `accelerator` (was `backend`). `cleanup-result.sampleRate` is `16000`
  (was `48000`).
- [x] Rewrite `src/ui/cleanup-controller.ts`: `CleanupControllerPorts` uses
  `manifestUrl`/`wasmPath` (was `fetchManifest`/`weightsUrl`).
  `CLEANUP_SAMPLE_RATE=16000`, `CLEANUP_BLOCK_SHIFT=128`.
  `setCleanupProbe()` replaces `setWebNNProbe()`. `modelId: 'dtln'` (was
  `'rnnoise'`). Availability gated on WASM (was WebNN).

## T5 — Capability probe and UI

- [x] Update `src/engine/capability-probe-v2.ts`: remove `probeWebNN()`
  import; create inline `CleanupProbeResult` from `WebAssembly` presence.
  Result field: `cleanup` (was `webnn`).
- [x] Update `src/ui/CapabilityMatrixPanel.tsx`: "Audio cleanup (LiteRT
  DTLN)" row with WASM availability (was "WebNN" row).
- [x] Update `src/ui/AudioCleanupPanel.tsx`: engine label "LiteRT DTLN",
  accelerator display, footer "DTLN (MIT, Interspeech 2020) via LiteRT".
- [x] Update `src/ui/App.tsx`: `manifestUrl`/`wasmPath` ports,
  `setCleanupProbe()`.

## T6 — GitHub model proxy

- [x] Add `/_model/gh/` proxy prefix in `src/worker/index.ts` (Cloudflare
  Worker) rewriting to `https://raw.githubusercontent.com`. Refactor the
  existing HF proxy into a shared `proxyModel()` function used by both
  `/_model/hf/` and `/_model/gh/` prefixes.

## T7 — Deleted modules

- [x] Delete `src/engine/audio-cleanup/rnnoise-dsp.ts` (846 lines of
  TypeScript DSP port).
- [x] Delete `src/engine/audio-cleanup/rnnoise-graph.ts` (264 lines of
  WebNN graph construction).
- [x] Delete `src/engine/audio-cleanup/webnn-probe.ts` (65 lines of
  `navigator.ml` probing).

## T8 — Tests

- [x] Delete `rnnoise-dsp.test.ts` and `webnn-probe.test.ts` (deleted
  modules).
- [x] Rewrite `cleanup-jobs.test.ts`: `DtlnDsp` + `CleanupInferenceRunner`
  with `runModel1`/`runModel2`; 128-sample frame alignment; chunking
  determinism; progress monotonicity; cancellation.
- [x] Rewrite `model-manifest.test.ts`: two-model DTLN manifest validation;
  shipped `manifest.json` byte-level verification.
- [x] Rewrite `cleanup-controller.test.ts`: `CleanupProbeResult`,
  `setCleanupProbe()`, `manifestUrl`/`wasmPath` ports, `accelerator: 'wasm'`,
  `sampleRate: 16000`, `modelId: 'dtln'`.
- [x] Rewrite `no-startup-load.test.ts`: module-graph assertions for DTLN
  (not rnnoise); classic worker URL pattern; runtime zero-fetch invariant.
- [x] Update `cleaned-audio.test.ts`, `cleaned-audio-persistence.test.ts`,
  `export.test.ts`: `modelId: 'dtln'` (was `'rnnoise'`).

## T9 — Config and quality gate

- [x] Update `vite.config.ts`: SW runtime cache rule
  `/models/dtln/` (was `/models/rnnoise/`).
- [x] Update `node-test-shims.d.ts`: comment references `dtln` (was
  `rnnoise`).
- [x] `pnpm run check` green: format, lint, typecheck, 1161 tests, build.
- [ ] Manual smoke: load model via GitHub proxy, preview, A/B, apply,
  export, undo.
