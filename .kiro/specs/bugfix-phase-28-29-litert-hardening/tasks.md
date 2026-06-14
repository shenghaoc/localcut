# Tasks: Phase 28/29 LiteRT hardening

- [x] Add the Phase 28/29 LiteRT hardening bugfix spec (`bugfix.md`,
  `design.md`, `tasks.md`).
- [x] Gate Auto Captions transcription on `modelStatus === 'loaded'` in both the
  action-availability helper and the controller entrypoint.
- [x] Preserve job-scoped ASR worker errors for queued transcribe failures.
- [x] Pass the probed preferred accelerator through the Audio Cleanup controller
  instead of hardcoding `wasm`.
- [x] Add the missing `loadGeneration` guard to `cleanup-worker.ts` `handleEnd`.
- [x] Make `dtln-runtime.ts` honor changed LiteRT load options across re-init,
  not just the first process-global load.
- [x] Reuse DTLN DSP magnitude/phase scratch buffers instead of allocating them
  per frame.
- [x] Guard Whisper `reflectPad` against empty PCM and prove the mel path stays
  finite.
- [x] Delete compiled ASR LiteRT models on all unsuccessful constructor/fallback
  paths.
- [x] Add or extend unit tests for ASR gating/error correlation, cleanup
  accelerator selection and stale-finalization guard, DTLN runtime re-init,
  DTLN DSP output equivalence, Whisper empty-PCM handling, and ASR compiled
  model cleanup.
- [x] Run `pnpm run check`.
