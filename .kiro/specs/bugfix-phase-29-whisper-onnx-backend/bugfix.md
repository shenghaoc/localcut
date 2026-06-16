# Bugfix / follow-up: Auto Captions — Whisper ONNX backend

## Problem

Phase 29 Auto Captions runs OpenAI Whisper on **LiteRT.js** from a single fused
`.tflite` graph. The shipped models are full-precision: Whisper Base is **~290 MB**
and Tiny **~152 MB**. For a client-compute PWA, that first download is a poor UX —
the user waits on hundreds of MB before the first caption. The repo's long-term ML
runtime is **ONNX Runtime Web (ORT)** (see `docs/ML-RUNTIME.md`), and Whisper was
explicitly slated to migrate to ORT in its own PR. ORT also unlocks **quantized**
Whisper, which is dramatically smaller at comparable caption quality.

## Goal

Add an ORT/ONNX Whisper backend that becomes the default Auto Captions engine,
using a curated Hugging Face ONNX Whisper-family model, while preserving Phase 29's
guarantees (explicit user-triggered download, OPFS cache by digest, offline after
first verified load, no startup model load) and the existing worker-owned ASR
architecture. Do not blindly keep the 290 MB fp32 base as the default.

## Requirements

- **R1 — ONNX manifest.** Add `public/models/whisper-onnx/manifest.json` (and a
  tiny variant) declaring encoder + no-past decoder ONNX assets and the tokenizer
  vocabulary, each with real `sizeBytes` + SHA-256; plus source, license, provider,
  model card, supported languages (en/zh), and decode config. An optional
  `decoderWithPast` asset is permitted (reserved) but not required.
- **R2 — ORT runtime.** Add `whisper-ort-runtime.ts` implementing the engine-
  agnostic `WhisperRuntime` interface on ORT. Use the EP that best fits a small,
  non-frame-coupled model (WASM); use GPU/MLTensor IO only if it helps and does not
  complicate decode. Worker-owned; no main-thread inference.
- **R3 — Preserve Phase 29 guarantees.** Explicit user-triggered download, OPFS
  cache keyed by digest, offline after first verified load, and no model load at
  startup (ORT reached only via the lazy `ort-loader` dynamic import).
- **R4 — Product decision.** Evaluate tiny/base × fp32/fp16/int8 and document size
  vs quality. Default to a quantized model small enough for good PWA UX; keep the
  fp32 LiteRT builds selectable as the high-fidelity fallback.
- **R5 — Tests.** Manifest validation; tokenizer/decode invariants; no-startup-load;
  cache-corruption behavior; en/zh language-token handling.
- **R6 — Constraints.** Use ORT directly (no Transformers.js runtime abstraction);
  fetch only via the same-origin `/_model/hf` proxy (never a direct browser HF
  fetch); no cloud ASR fallback.
