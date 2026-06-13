# Tasks: Remove the Chrome Speech fallback (Phase 29)

- [x] Reframe the bugfix spec around removing the dead Chrome Speech fallback.
- [x] Delete the Chrome Speech adapter (`chrome-speech.ts`) and its ambient
  typings (`web-speech.d.ts`) from the active code path.
- [x] Remove the `speechRecognition` probe field from `AsrProbeResult` and the
  `probeSpeechRecognition()` helper.
- [x] Remove every "Browser Speech disabled for clips" label/footer from the
  Auto Captions and Capability UI; point copy at the on-device WebNN engine.
- [x] Keep WebNN as a diagnostic only; `probeAsr` never recommends an engine.
- [x] Reject empty/whitespace-only ASR results before creating caption tracks.
- [x] Run the repository quality gate (`pnpm run check`).
- [ ] (PR #94) Land the LiteRT-over-WebNN Whisper runtime and re-enable Auto
  Captions — out of scope here.
