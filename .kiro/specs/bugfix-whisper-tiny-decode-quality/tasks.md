# Tasks: Bugfix — Whisper-tiny decode quality thresholds

> Status: **Complete.**

- [x] Add `AsrDecodeParams` interface to `src/protocol.ts` with optional
  `logProbThreshold`, `noSpeechThreshold`, `compressionRatioThreshold`, and
  `temperatures` fields. Add optional `decode?: AsrDecodeParams | null` to
  `AsrModelManifestSnapshot`.
- [x] Validate the optional `decode` section in `model-manifest.ts`
  (`validateDecodeParams`): each field must be a finite number (or array of
  finite numbers for temperatures); missing fields are null/undefined.
- [x] Refactor `whisper-decode.ts`: rename hardcoded constants to
  `DEFAULT_*`; read resolved values from `decodeParams` in
  `TranscribeWindowParams`, falling back to defaults.
- [x] Wire `asr-worker.ts` to pass `manifest.decode` into `transcribeWindow`.
- [x] Ship tuned `decode` section in `manifest-tiny.json`:
  `logProbThreshold=-1.5`, `noSpeechThreshold=0.75`,
  `compressionRatioThreshold=3.0`, `temperatures=[0,0.2,0.4]`.
- [x] Add explicit `decode` section to `manifest.json` (base) matching the
  built-in defaults for documentation.
- [x] Add unit tests for decode-param validation (valid, partial, invalid,
  absent/backwards-compatible).
- [x] Add unit tests verifying the silence gate and temperature schedule respect
  manifest-supplied `decodeParams`.
- [x] `pnpm run check` green (format, lint, typecheck, 1187 tests, prod build).
