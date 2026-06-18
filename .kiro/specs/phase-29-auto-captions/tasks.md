# Tasks: Phase 29 - Auto Captions

- [x] **T1 - ORT model catalog.** Catalog contains Whisper Base ONNX int8 and
      Whisper Tiny ONNX int8 manifests under `public/models/whisper-onnx/`.
- [x] **T2 - Manifest validation.** ORT Whisper manifests validate encoder,
      decoder, tokenizer, execution provider, IO, language tokens, and decode
      thresholds.
- [x] **T3 - Lazy worker runtime.** `asr-worker.ts` loads ORT only after explicit
      user action and rejects non-`ort-whisper` manifests.
- [x] **T4 - Audio preprocessing and decode.** Selected clip audio is downmixed,
      resampled, log-mel processed, decoded greedily, and converted into caption
      segments.
- [x] **T5 - UI and controller.** Auto Captions panel shows ORT model choices,
      load/transcribe/cancel actions, progress, and model status.
- [x] **T6 - Caption track creation.** ASR results flow through the pipeline
      worker into undoable Phase 22 caption tracks.
- [x] **T7 - Retirement cleanup.** PR #123 removed non-ORT catalog entries,
      retired runtime/loader files, retired public manifests, and stale fallback
      probe recommendations.
- [x] **T8 - Tests.** Catalog, manifest, probe, controller, worker, decode,
      caption-track, UI, and no-startup-load tests cover the retained path.
- [ ] **T9 - Manual matrix.** Validate first load, cached load, selected-clip
      transcription, cancellation, no-speech result, undo, sidecar export, and
      unavailable-browser messaging.
