# Requirements: Phase 29 — Auto Captions (识别字幕)

> **Experimental phase.** Automatic speech recognition (ASR) fed from the existing PCM pipeline, writing timed captions into the Phase 22 caption-track model. Primary engine: WebNN Whisper-class bilingual zh/en. Low-tier fallback: Chrome 139+ on-device Web Speech API. Zero network calls for inference — all transcription stays on-device.

## R0 — Hard Constraints

- **R0.1** No cloud ASR, no API key, no account, no upload of user audio anywhere. All speech recognition runs on the user's device.
- **R0.2** No ASR model code, weights, or vocab may be fetched, parsed, or instantiated at app startup. App boot must be byte-identical in network behaviour whether or not this feature exists.
- **R0.3** Model weights load only after an explicit user action ("Load ASR model" or "Transcribe").
- **R0.4** No inference, feature extraction, or audio processing loops on the SolidJS main thread.
- **R0.5** ASR inference must not run in the pipeline worker (`src/engine/worker.ts`). A separate, dedicated ASR worker owns the model lifecycle.
- **R0.6** Normal import/play/edit/export must work unchanged when ASR is unsupported, when the model fails to load, or when the ASR worker crashes.
- **R0.7** The feature is labeled **Experimental** everywhere it appears.
- **R0.8** No silent server fallback. Chrome Web Speech is the only allowed non-WebNN path and must be visibly labeled as "phrase-level".
- **R0.9** Weights and vocab assets are served same-origin as static assets; no third-party CDN fetch at runtime.
- **R0.10** Feature must not regress Phase 28 (Local Audio Cleanup) or share state with the cleanup worker.

## R1 — ASR Capability Probe

- **R1.1** Add `AsrProbeResult` reporting: WebNN availability (reusing Phase 28 probe), Chrome `SpeechRecognition` support, and a recommended engine (`'webnn-whisper'` / `'chrome-speech'` / `'none'`).
- **R1.2** The probe is cheap and side-effect free: no model load, no graph build, no `AudioContext` creation.
- **R1.3** The probe does not influence `CapabilityTierV2` derivation; it gates only the Auto Captions feature.
- **R1.4** `modelSupport` from the Phase 28 `WebNNProbeResult` is the ground truth for the WebNN path; if the RNNoise model loaded successfully, Whisper inference is assumed feasible on the same WebNN backend.

## R2 — ASR Worker

- **R2.1** A dedicated worker module (`src/engine/asr/asr-worker.ts`) hosts the WebNN graph, the Web Speech bridge, and all transcription processing.
- **R2.2** The worker module is lazy-loaded (dynamic `import(...?worker)`) only on explicit user action.
- **R2.3** Every long-running operation (model load, transcription) is cancellable. Cancel stops promptly, releases in-flight buffers, leaves the worker reusable.
- **R2.4** The worker communicates over a typed `postMessage` protocol defined in `src/protocol.ts` (commands: probe, load-model, transcribe, cancel, dispose; state: probe-result, model-status, progress, result, cancelled, error). PCM payloads use transferables.
- **R2.5** Closing the panel or disposing the project must terminate the worker and free model memory.

## R3 — WebNN Whisper Path (Primary)

- **R3.1** A model manifest declares: `id`, `version`, `license` (MIT), `source`, `sizeBytes`, SHA-256 `checksum`, audio contract (16 kHz / mono / 160 hop / 80 mel bins), `vocabSize`, `encoderFramesPerSecond`, and supported `languages`.
- **R3.2** Weights ship as `public/models/whisper/weights.bin`; vocab ships as `public/models/whisper/vocab.json`. Both are same-origin only, fetched on explicit user action.
- **R3.3** Manifest validation is a pure, unit-testable function. Fetched weights must match `sizeBytes` and `checksum` before graph construction.
- **R3.4** PWA service worker excludes weights/vocab from install-time precache; runtime caching after successful explicit load is allowed.
- **R3.5** Log-mel spectrogram feature extraction is a pure TypeScript port, unit-testable without WebNN (compare output against reference NumPy/librosa).
- **R3.6** Audio preprocessing: downmix to mono → resample to 16 kHz via existing polyphase sinc resampler → log-mel spectrogram (25 ms window, 10 ms stride, 80 bins) → normalise.
- **R3.7** Long audio is processed in bounded chunks (≤30 s) with 3 s overlap for seamless boundary stitching.
- **R3.8** Word-level timestamps are recovered from cross-attention weights and mapped to audio time via encoder stride.

## R4 — Chrome Web Speech Fallback

- **R4.1** When WebNN is unavailable but Chrome 139+ `SpeechRecognition` is detected, the fallback path activates automatically.
- **R4.2** PCM audio is routed through a short-lived `AudioContext` + `MediaStream` to `SpeechRecognition` with `continuous: true, interimResults: false`.
- **R4.3** Results are phrase-level (no per-word timestamps). The UI labels these as "phrase-level auto-captions".
- **R4.4** Fallback results produce valid `CaptionSegment[]` with approximate start/duration values (per-phrase timestamps).
- **R4.5** The `AudioContext` and `MediaStream` are created and destroyed per job; no persistent audio routing or resource leaks.
- **R4.6** Very long clips (>15 min) are accepted but produce a visible warning about accuracy degradation.

## R5 — Caption Track Integration

- **R5.1** ASR results create a new `CaptionTrack` (or append to an existing target track) with `language` set to the detected/selected language.
- **R5.2** Segments follow the existing `CaptionSegment` model with `id`, `start`, `duration`, and `text` fields.
- **R5.3** Track names include the word "Auto" and the language code, e.g. `"Auto (zh)"`.
- **R5.4** A metadata marker distinguishes auto-generated tracks from manually-imported ones so the UI can show a "generated" badge.
- **R5.5** The operation is undoable (Phase 9 snapshots). Multiple auto-caption runs create separate tracks.
- **R5.6** Auto-caption tracks export identically to manual caption tracks (SRT/VTT sidecar, burn-in via Phase 22).

## R6 — UI

- **R6.1** Add an "Auto Captions (识别字幕) (Experimental)" panel following existing panel patterns.
- **R6.2** Permanent privacy statement: **"All speech recognition runs on this device. No audio leaves your browser. No cloud API."**
- **R6.3** Display detected ASR engine chip: 'WebNN Whisper' or 'Browser Speech (phrase-level)' or 'Unavailable'.
- **R6.4** Language selector: auto-detect (default), force zh, force en.
- **R6.5** Buttons: "Transcribe selected clip", "Transcribe timeline range", "Cancel". Each disabled with reasons when prerequisites are missing.
- **R6.6** Progress bar with "transcribed X of Y seconds" during active transcription.
- **R6.7** When no engine is available: **"Auto captions unavailable in this browser."** with all actions disabled; rest of app unaffected.
- **R6.8** Chrome Speech only: engine chip shows "Browser Speech (phrase-level)" with tooltip about word-level accuracy and WebNN upgrade path.

## R7 — Export and Project State

- **R7.1** Export path unchanged. Auto-captions export identically to manual captions.
- **R7.2** Auto-caption tracks persist in the project document via existing caption-track serialization (Phase 9/22).
- **R7.3** Undo after auto-caption removes the generated track entirely.
- **R7.4** If the WebNN model is not loaded, the feature is not available but no existing project state is affected.

## R8 — Diagnostics

- **R8.1** Diagnostics surface: ASR engine recommendation, WebNN availability, Chrome Speech availability, model status, last transcription engine/language/duration, recent errors.
- **R8.2** Diagnostic state is display-only; no logic elsewhere branches on ASR diagnostic data.

## R9 — Tests

- **R9.1** Unit-test `probeAsr()` with mocked `navigator.ml` and `SpeechRecognition`: all combinations (both, WebNN-only, Chrome-only, none).
- **R9.2** Unit-test that no ASR model/weights/vocab fetch occurs at startup (spy on `fetch`; zero ASR worker spawns).
- **R9.3** Unit-test model manifest validation: valid manifest, missing fields, checksum mismatch.
- **R9.4** Unit-test log-mel spectrogram extraction against reference values (synthetic sine wave input).
- **R9.5** Unit-test tokenizer: decode known token sequences, handle timestamp tokens, zh/en vocab coverage.
- **R9.6** Unit-test word-level timestamp alignment: synthetic cross-attention weights → correct word boundaries.
- **R9.7** Unit-test chunked vs. unchunked ASR: boundary stitching preserves transcript continuity.
- **R9.8** Unit-test Chrome Speech fallback: mock `SpeechRecognition` → correct `CaptionSegment[]` assembly.
- **R9.9** Unit-test cancellation during transcription: prompt stop, no partial result, worker reusable.
- **R9.10** Integration-test: extract clip audio → transcribe (mock engine) → verify caption track created in timeline state.
- **R9.11** Quality gate: `npm run lint`, `npm run format:check`, `npm test`, `npm run build` all green; test count does not decrease.

## R10 — Acceptance Criteria

- **A1** App startup does not load any ASR model/weights/vocab (verified by R9.2).
- **A2** Model loads only after explicit user action.
- **A3** Feature is clearly marked Experimental.
- **A4** No audio leaves the device — all inference is local.
- **A5** WebNN-unsupported browsers get the Chrome Speech fallback or an honest unavailable message.
- **A6** Auto-captions cannot break the core timeline/playback/export path.
- **A7** Caption tracks produced by auto-caption are indistinguishable from imported captions after creation.
- **A8** Bilingual zh/en detection works automatically when both languages are present.
