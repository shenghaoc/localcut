# Bugfix: Phase 28 LiteRT DTLN Audio Cleanup

> Status: **Spec + implementation (this PR).** Migrates Phase 28 Local Audio
> Cleanup from WebNN + RNNoise to LiteRT.js + DTLN, matching the framework
> established by Phase 29 (LiteRT Whisper). The cleanup worker is now a
> classic worker running LiteRT.js WASM inference of the DTLN model, with
> asset caching reused from Phase 29.

## Problem

Phase 28 built a hand-written WebNN graph for RNNoise — a bespoke
`MLGraphBuilder` GRU graph, a full TypeScript DSP port of the 2018 C
reference, and a custom `.npy` tensor-packing format with same-origin
weights. Phase 29 then introduced LiteRT.js as a general-purpose on-device
inference framework for Whisper, with manifest-declared TFLite models,
SHA-256-verified OPFS caching, and accelerator fallback.

Having two separate ML runtimes is unnecessary: LiteRT.js can run any
TFLite model, including noise suppression. The hand-built WebNN graph
(~1100 lines of graph construction + DSP) is replaced by ~250 lines of
LiteRT runtime wrapping + DTLN-specific FFT/overlap-add DSP. The DTLN
model (Westhausen, Interspeech 2020, MIT) is a better-quality replacement
than the 2018 WebNN-sample RNNoise demo weights.

## Requirements

- Noise suppression must use LiteRT.js WASM inference of DTLN TFLite
  models, not WebNN graph building. The WASM accelerator is the default;
  WebGPU and WebNN are optional fallbacks through LiteRT.js.
- Model assets (two TFLite files: model_1 and model_2) are fetched via a
  same-origin GitHub proxy (`/_model/gh/`) from breizhn/DTLN on explicit
  user action, digest-verified, and OPFS-cached using the Phase 29
  `asset-cache` module.
- The cleanup worker is a classic worker (not ES module) because LiteRT.js
  loads WASM via `importScripts`.
- Audio contract changes from 48 kHz / 480-sample frames (RNNoise) to
  16 kHz / 128-sample frames (DTLN). The existing `AudioResampler` handles
  input rate conversion in the worker.
- Feature availability is gated on `WebAssembly` presence (broadly
  available) instead of `navigator.ml` (WebNN, rare). The capability probe
  no longer calls `probeWebNN()`.
- All existing Phase 28 invariants are preserved: lazy worker spawn, no
  model load at startup, cancellable jobs, undoable cleaned-audio routing,
  A/B preview, privacy statement.

## Acceptance

- Loading the model fetches two TFLite files from GitHub via the
  `/_model/gh/` proxy, verifies SHA-256 checksums, and reports "loaded" with
  the WASM accelerator.
- Preview and Apply produce denoised audio using the DTLN two-model pipeline
  (STFT → model_1 mask → iFFT → model_2 enhance → overlap-add).
- The app remains usable when WebAssembly is missing, model download fails,
  or checksum verification fails — each path surfaces an explicit error.
- No WebNN code remains: `webnn-probe.ts`, `rnnoise-graph.ts`,
  `rnnoise-dsp.ts`, and `public/models/rnnoise/` are deleted.
- Quality gate (`pnpm run check`) passes with no test count decrease.
