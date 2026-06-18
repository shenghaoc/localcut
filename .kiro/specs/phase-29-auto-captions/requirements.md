# Requirements: Phase 29 - Auto Captions

> Current runtime note: Auto Captions now uses ONNX Runtime Web only. The model
> catalog ships `public/models/whisper-onnx/manifest.json` and
> `manifest-tiny.json`; the removed browser-speech and retired-runtime paths are
> not valid fallback engines.

## R0 - Hard Constraints

- **R0.1** No cloud ASR, API key, account, telemetry, or upload of user audio.
- **R0.2** No ASR model or ORT runtime loads at startup.
- **R0.3** Model assets load only after an explicit user action.
- **R0.4** ASR inference runs in the dedicated ASR worker, not on the SolidJS main
  thread or the pipeline worker.
- **R0.5** ASR failure must not break import, edit, playback, captions, or export.

## R1 - Model Catalog

- **R1.1** The catalog contains only ORT Whisper entries.
- **R1.2** The default model is Whisper Base ONNX int8; Whisper Tiny ONNX int8 is
  the smaller/faster option.
- **R1.3** Every model manifest declares encoder, decoder, tokenizer, size,
  SHA-256, language tokens, decode thresholds, and `runtime: "ort-whisper"`.
- **R1.4** Model files are fetched through trusted same-origin proxies, verified,
  and cached in OPFS by digest.

## R2 - Runtime

- **R2.1** ASR uses ORT-WASM with CPU tensors because it is not frame-coupled.
- **R2.2** `whisper-decode.ts` remains runtime-neutral decode logic.
- **R2.3** `asr-worker.ts` rejects any manifest whose runtime is not
  `ort-whisper`.
- **R2.4** The probe recommends `ort-whisper` when WebAssembly is available and
  `none` otherwise.

## R3 - UI And Caption Track Integration

- **R3.1** The Auto Captions panel shows ORT model names, provider, download size,
  model status, progress, and last run duration.
- **R3.2** Generated captions create normal Phase 22 caption tracks with language,
  segment timing, undo/redo, sidecar export, and burn-in support.
- **R3.3** Timeline-range transcription remains disabled until mixed timeline
  audio extraction lands.

## R4 - Verification

- **R4.1** Tests cover model catalog trust, ORT manifest validation, no-startup
  load, worker cancellation, controller flow, caption track creation, and UI
  unavailable states.
- **R4.2** Manual verification covers first model load, cached reload, selected
  clip transcription, cancel, undo, no-speech handling, and unavailable browser
  messaging.
