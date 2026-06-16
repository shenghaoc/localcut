# Tasks — Auto Captions Whisper ONNX backend

- [x] **T1 — ONNX manifests (R1, R4).** `public/models/whisper-onnx/manifest.json`
      (base int8) + `manifest-tiny.json` (tiny int8), with real `sizeBytes` +
      SHA-256 for encoder/decoder/tokenizer, source/license/provider/model card,
      en/zh languages, and per-model decode config.
- [x] **T2 — Manifest validator (R1).** `ort-whisper-manifest.ts`:
      `AsrOrtModelManifestSnapshot`, `validateOrtWhisperManifest`,
      `ortWhisperManifestAssets`, `isOrtWhisperManifestDocument`. Reuses the LiteRT
      manifest's asset/audio/token/decode validators and the ORT EP policy. Shared
      `AsrTranscribeConfig` + exported helpers added to `model-manifest.ts`.
- [x] **T3 — ORT runtime (R2, R3).** `whisper-ort-runtime.ts` implements
      `WhisperRuntime` on ORT-WASM (encoder + no-past decoder, int64 ids, logits-only
      fetch, mel transpose, dispose). Reaches ORT only via the lazy `ort-loader`.
- [x] **T4 — Worker routing (R2, R3).** `asr-worker.ts` routes on the manifest
      discriminator; shared `downloadVerifiedAssets`; engine-agnostic `LoadedModel`;
      reports the built `engine` in the loaded status.
- [x] **T5 — Catalog + UI (R4).** `model-catalog.ts` gains the two ONNX entries
      (base int8 = recommended default); `protocol.ts` adds `AsrEngine` + the
      loaded-status `engine`; `asr-controller.ts` threads engine into the caption
      track; `AutoCaptionsPanel`/`TranscriptPanel` show the engine-aware label.
- [x] **T6 — Service worker (R3).** `vite.config.ts` NetworkFirst rule for
      `/models/whisper-onnx/` (manifest only; ONNX assets are OPFS-cached).
- [x] **T7 — Tests (R5).** `ort-whisper-manifest.test.ts` (validation, en/zh tokens,
      shipped manifests, cache corruption) + `whisper-ort-runtime.test.ts` (decode
      invariants, no-startup-load). Updated catalog/controller/panel tests.
- [x] **T8 — Docs (R4).** `public/models/whisper-onnx/README.md` (size/quality
      table + digest provenance), `docs/ML-RUNTIME.md` (ORT Whisper section),
      `docs/USER-GUIDE.md` (Auto Captions engine + default model).
- [ ] **T9 — Manual browser smoke test (follow-up).** Verify end-to-end ONNX
      transcription on the built app (`pnpm build` + `pnpm preview`) in Chrome — the
      shipped int8 models pass integrity/validation/decode-wiring tests here, but
      real ORT-WASM inference quality is not verifiable in the unit-test sandbox.
      Tune the manifest `decode` thresholds if int8 confidence trips the gates.
