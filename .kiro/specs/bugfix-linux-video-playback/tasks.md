# Tasks: Bugfix — Video with unsupported codec blocks audio playback

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `fix/video-decode-fallback` (PR #82).

## T1 — Remove `canDecode` guard + codec normalization (B1)

- [x] **T1.1** In `mediabunny-adapter.ts`, change the condition from
  `if (primaryVideo && primaryVideoInspection?.canDecode)` to
  `if (primaryVideo)`.
- [x] **T1.2** Add optional chaining on `primaryVideoInspection?.frameRateMode`
  in the `minFrameDuration` calculation.
- [x] **T1.3** Export `normalizeH264CodecString` from `webcodecs-decoder.ts`
  and import in `mediabunny-adapter.ts` (deduplication).
- [x] **T1.4** Normalize codec string in `tryCreateWebCodecsVideoSource()`
  before `isConfigSupported`.
- [x] **T1.5** Normalize codec string in `WebCodecsVideoDecoder.samples()`
  before `decoder.configure()`.
- [x] **T1.6** Monkey-patch `canDecode` and `getDecoderConfig` on affected
  tracks so Mediabunny's `VideoSampleSink` also works with normalized codec.

## T2 — Hardware acceleration retry

- [x] **T2.1** In `tryCreateWebCodecsVideoSource()`, retry `isConfigSupported`
  without `hardwareAcceleration` on failure.
- [x] **T2.2** In `WebCodecsVideoDecoder.samples()`, retry `isConfigSupported`
  without `hardwareAcceleration` on failure.
- [x] **T2.3** In monkey-patched `canDecode`, retry without
  `hardwareAcceleration` on failure.

## T3 — Conformance post-processing (B2)

- [x] **T3.1** Post-process warnings after frame source creation: mark
  `unsupported-video-codec` as non-blocking when `frameSource` is non-null.
- [x] **T3.2** Recompute conformance health from updated warnings.

## T4 — Tests

- [x] **T4.1** Add unit tests for `normalizeH264CodecString` in
  `webcodecs-decoder.test.ts` — 8 test cases covering passthrough,
  normalization, profiles, case insensitivity.
- [x] **T4.2** `vp build` passes (strict TypeScript).
- [x] **T4.3** `vp test run` passes — 97 files, 1032 tests green.

## T5 — Manual verification

- [x] **T5.1** On Linux Chromium, import an MP4 with `avc1.64000d` — video
  plays back on the timeline and audio plays for the full duration.
- [ ] **T5.2** The source-health warning for unsupported video codec is still
  shown in the Media Bin details popover (informational, non-blocking).
- [ ] **T5.3** Import an audio-only file — still works as before.
- [ ] **T5.4** Import a file with a truly unsupported codec (e.g. HEVC) —
  accepted onto timeline, playback error surfaces in status bar.
