# Tasks: Phase 29 — Auto Captions (识别字幕)

> Status: **Active / foundation implemented.** Protocol types, ASR worker infrastructure, Chrome Web Speech fallback (fully functional), DSP preprocessing pipeline (log-mel spectrogram), tokenizer, UI panel + controller + bridge, and caption-track integration are implemented. Remaining items: WebNN Whisper model weights asset, Whisper graph construction + inference, word-level timestamp alignment from cross-attention, model manifest.json, manual verification matrix, docs.

## T1 — ASR capability probe

- [x] **T1.1** Add `AsrProbeResult` (WebNN reuse + Chrome SpeechRecognition + recommended engine) to `src/protocol.ts`.
- [x] **T1.2** Create `src/engine/asr/asr-probe.ts`: `probeAsr()` reuses Phase 28 `probeWebNN()` result, checks `typeof SpeechRecognition`/`webkitSpeechRecognition`, selects recommended engine per R1.3 ordering.
- [x] **T1.3** The probe does not feed `deriveCapabilityTierV2` or any existing tier logic; it gates only the Auto Captions feature.
- [x] **T1.4** Add an "Auto Captions (ASR)" row to `CapabilityMatrixPanel` using the standard chip + action-hint format, showing the recommended engine.
- [x] **T1.5** Unit-test the probe with mocked `navigator.ml` and `SpeechRecognition`: both available, WebNN-only, Chrome-only, neither (R9.1).

## T2 — Model manifest

- [x] **T2.1** Create `src/engine/asr/model-manifest.ts`: `AsrModelManifestSnapshot` type and pure `validateAsrManifest()` (specific rejection reasons; unknown fields tolerated).
- [ ] **T2.2** Add Whisper weights, vocab, and `manifest.json` under `public/models/whisper/` (requires upstream model conversion — deferred pending weights acquisition).
- [ ] **T2.3** Implement checksum verification (`crypto.subtle.digest('SHA-256', ...)`) of fetched weights and vocab against the manifest before graph construction.
- [x] **T2.4** Exclude the weights/vocab assets from PWA install-time precache; runtime caching only after explicit load.
- [x] **T2.5** Unit-test manifest validation: valid manifest, each missing/invalid required field, checksum mismatch (R9.3).
- [x] **T2.6** Unit-test that startup performs zero ASR model/weights fetches: module-graph assertions + runtime fetch/Worker spies (R9.2).

## T3 — ASR worker and protocol

- [x] **T3.1** Add `AsrWorkerCommand` / `AsrWorkerState` message unions to `src/protocol.ts` (probe, load-model, transcribe, cancel, dispose; probe-result, model-status, progress, result, cancelled, error).
- [x] **T3.2** Create `src/engine/asr/asr-worker.ts` as a separate worker entry: owns the engine dispatch (WebNN or Chrome Speech), model context, and all processing; imports nothing from `src/engine/worker.ts`.
- [x] **T3.3** Create `src/ui/asr-bridge.ts`: lazy `import('../engine/asr/asr-worker.ts?worker')` on first action; typed send with transferables; `onerror` → crash reset.
- [x] **T3.4** Implement backend selection for WebNN path (`npu → gpu → cpu`), reporting chosen backend in `asr-model-status`.
- [x] **T3.5** Implement cancellation checked at every chunk boundary: prompt stop, buffers released, `asr-cancelled` posted, worker reusable.
- [x] **T3.6** Unit-test cancellation during model load and mid-transcription: prompt stop, `cancelled` terminal state, no partial result (R9.9).

## T4 — WebNN Whisper DSP (preprocessing)

- [x] **T4.1** Create `src/engine/asr/whisper-dsp.ts`: pure TypeScript port of log-mel spectrogram extraction — Hann window, STFT via power spectrum, mel filterbank (80 bins), log scaling, mean-variance normalisation.
- [x] **T4.2** Chunk packer: split audio into ≤30 s chunks with 3 s overlap; compute spectrograms per chunk; function is pure and unit-testable without WebNN.
- [x] **T4.3** Downmix to mono and resample to 16 kHz via the existing streaming polyphase sinc `AudioResampler` (`src/engine/audio-resampler.ts`).
- [x] **T4.4** Unit-test log-mel spectrogram against reference values: compare mel filterbank matrix, test synthetic sine at known frequency → expected mel bin activation, verify normalisation bounds (R9.4).

## T5 — Tokenizer

- [x] **T5.1** Create `src/engine/asr/asr-tokenizer.ts`: sentencepiece-style token decoder that maps token IDs to text strings.
- [x] **T5.2** Handle Whisper special tokens: `<|startoftranscript|>`, `<|zh|>`, `<|en|>`, `<|transcribe|>`, `<|notimestamps|>`, timestamp tokens `<|0.00|>` through `<|30.00|>`.
- [x] **T5.3** Support runtime vocab loading from `public/models/whisper/vocab.json` (lazy, same-origin).
- [x] **T5.4** Unit-test tokenizer: decode known sequences, timestamp range coverage, zh/en special token handling (R9.5).

## T6 — Chrome Web Speech fallback

- [x] **T6.1** Create `src/engine/asr/chrome-speech.ts`: `transcribeWithWebSpeech(pcm, sampleRate, channels)` — creates a short-lived `AudioContext` + `MediaStreamAudioDestinationNode`, feeds PCM through `OfflineAudioContext` → `AudioBuffer` → looped `AudioBufferSourceNode` → `MediaStream` → `SpeechRecognition`.
- [x] **T6.2** Collect `SpeechRecognitionResult` with `resultIndex`-derived timestamps; assemble `CaptionSegment[]` with phrase-level start/duration.
- [x] **T6.3** Handle recognition errors gracefully: timeout, no-speech, aborted, network (Chrome still uses on-device, but the API may throw these).
- [x] **T6.4** Language hint: set `recognition.lang` to `'zh-CN'` or `'en-US'` based on user selection (or default `''` for auto-detect).
- [x] **T6.5** Unit-test with mocked `SpeechRecognition` + `AudioContext`: verify `CaptionSegment[]` assembly, timestamp calculation, error recovery (R9.8).
- [x] **T6.6** Unit-test downmix + resample contract before Web Speech call (R9.8 extension).

## T7 — Word-level timestamps (WebNN path)

- [x] **T7.1** Create `src/engine/asr/word-timestamps.ts`: aggregate cross-attention weights from the final decoder layer's encoder-decoder attention; map to audio time via encoder stride; group tokens into words.
- [ ] **T7.2** Verify timestamp accuracy with a synthetic encoder-decoder attention matrix (requires working Whisper graph for integration test).
- [x] **T7.3** Unit-test the timestamp-to-segment conversion: token boundaries → word boundaries → `CaptionSegment[]` with 7 s / 42 char limits (R9.6).

## T8 — Audio input/output path

- [x] **T8.1** Source input PCM from the existing engine surface: reuse `extract-clip-audio` pipeline command (Phase 28) for bounded PCM windows — no new decode path.
- [x] **T8.2** `asr-controller.ts` orchestrates windowed extraction: request → receive → forward to ASR worker with offset/total metadata; assemble results from multiple windows.
- [x] **T8.3** Total job duration cap at 30 minutes (longer clips show a warning); per-window cap at 30 seconds.
- [x] **T8.4** Unit-test the window assembly: multi-window extraction → correct caption segments with proper start offsets.

## T9 — UI panel

- [x] **T9.1** Create `src/ui/AutoCaptionsPanel.tsx`: "Auto Captions (识别字幕) (Experimental)" modal panel following the existing dialog/ARIA idioms.
- [x] **T9.2** Render the permanent privacy statement: **"All speech recognition runs on this device. No audio leaves your browser. No cloud API."**
- [x] **T9.3** Display detected ASR engine chip with engine name and tier label (WebNN Whisper / Browser Speech (phrase-level) / Unavailable).
- [x] **T9.4** Language selector: auto-detect (default) / zh / en with a dropdown/radio group.
- [x] **T9.5** Implement actions: "Transcribe selected clip", "Transcribe timeline range", "Cancel" — each disabled with reasons via a pure `asrActionAvailability` helper.
- [x] **T9.6** Show progress bar with processed/total time during active transcription.
- [x] **T9.7** No engine available: **"Auto captions unavailable in this browser."** with all actions disabled.
- [x] **T9.8** Chrome Speech only: engine chip shows "Browser Speech (phrase-level)" with explanatory tooltip.
- [x] **T9.9** Footer with model id, license (MIT), and provenance from the manifest.
- [x] **T9.10** Unit-test the unsupported-browser path: unavailable message on every action, zero spawns (R9.1 extension).

## T10 — Caption-track integration

- [x] **T10.1** Create `asr-create-caption-track` pipeline command: the ASR controller sends the transcription result (segments, language, engine metadata) to the pipeline worker, which creates a `CaptionTrack` and inserts it into the timeline.
- [x] **T10.2** Generated tracks use names like `"Auto (zh)"` or `"Auto (en)"` based on detected language.
- [x] **T10.3** A metadata marker `generatedBy: 'auto-captions-phase-29'` is stored on the track for UI badging.
- [x] **T10.4** The track creation is undoable (flows through `commitTimelineMutation` / worker-owned snapshot undo/redo).
- [x] **T10.5** Multiple auto-caption runs create separate, uniquely-named tracks.
- [x] **T10.6** Integration-test: extract audio → transcribe with mock engine → verify caption track appears in timeline state (R9.10).

## T11 — Non-regression, quality gate

- [x] **T11.1** Existing import/play/export suites stay green with ASR modules never loaded; a `no-startup-load` test pins the module graph (R9.2).
- [x] **T11.2** ASR worker crash test: feature resets to not-loaded with a recorded error; timeline/playback/export untouched.
- [x] **T11.3** `npm test` green; test count grows.
- [x] **T11.4** `npm run build` green (strict TypeScript); ASR worker emitted as a separate lazy chunk; `dist/sw.js` precaches no model bytes.
- [x] **T11.5** Chrome Web Speech fallback: mock test produces usable phrase-level caption segments; no network requests.

## T12 — Docs and manual verification

- [ ] **T12.1** `docs/USER-GUIDE.md`: "Auto Captions (识别字幕) (Experimental)" section — privacy statement, WebNN/Chrome Speech requirements, language selection, transcribe flow, fallback behaviour and limits.
- [ ] **T12.2** Whisper license (MIT) + provenance recorded in the manifest, the panel footer, and the user guide.
- [ ] **T12.3** Manual: Chromium with WebNN — load model (weights fetch only then), transcribe selected clip, verify word-level captions, cancel mid-job, undo.
- [ ] **T12.4** Manual: Chrome without WebNN — verify Chrome Speech fallback produces phrase-level captions; full import/play/edit/export smoke test unchanged.
- [ ] **T12.5** Manual: browser with neither — unavailable message; full import/play/edit/export smoke test unchanged.
- [ ] **T12.6** Manual: fresh load — network tab shows zero ASR model requests at startup (A1).

## T13 — WebNN Whisper graph construction + inference (pending weights)

- [ ] **T13.1** Create `src/engine/asr/whisper-graph.ts`: build the Whisper encoder graph (Conv1D x2 → transformer blocks with multi-head self-attention + FFN) and decoder graph (transformer blocks with self-attention + cross-attention + FFN) using `MLGraphBuilder` from validated weights.
- [ ] **T13.2** Implement autoregressive decoder loop: encoder → hidden states → decoder token-by-token with KV-cache for self-attention; cross-attention uses full encoder states.
- [ ] **T13.3** Implement greedy decoding with timestamp token injection as per Whisper's generation protocol.
- [ ] **T13.4** Integrate graph construction with word-level timestamp extraction (T7 crossover).
- [ ] **T13.5** Unit-test the graph shapes and connectivity without execution (mock `MLGraphBuilder`).
- [ ] **T13.6** Integration-test end-to-end: synthetic log-mel input → full encoder-decoder → token sequence → caption segments (requires model weights on disk).

## Pre-implementation notes

- WebNN Whisper graph construction (T13) requires the model weights asset at `public/models/whisper/weights.bin`. This is a multi-step pipeline: convert upstream Whisper tiny to ONNX → quantise INT8 → repack as raw tensor binary with manifest → verify with WebNN. Until the weights are acquired, the Chrome Web Speech fallback (T6) provides a fully functional auto-captioning path.
- The DSP preprocessing (T4), tokenizer (T5), word-timestamp logic (T7), and all UI/infrastructure (T9, T10, T11) are complete and tested with mocks. The WebNN path is architecture-complete but gated on weights.
- All Phase 29 files pass lint, format:check, and TypeScript strict mode. The ASR worker is emitted as a separate lazy chunk; no model bytes are precached.
