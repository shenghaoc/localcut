# Tasks: Bugfix — Video with unsupported codec blocks audio playback

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `fix/video-decode-fallback` (PR #82).

## T1 — Remove `canDecode` guard (B1)

- [x] **T1.1** In `mediabunny-adapter.ts`, change the condition at line 554
  from `if (primaryVideo && primaryVideoInspection?.canDecode)` to
  `if (primaryVideo)`.
- [x] **T1.2** Add optional chaining on `primaryVideoInspection?.frameRateMode`
  in the `minFrameDuration` calculation (defensive null guard).

## T2 — Build and test gate

- [x] **T2.1** `vp build` passes (strict TypeScript).
- [x] **T2.2** `vp test run` passes — 97 files, 1032 tests green (no decrease).

## T3 — Manual verification

- [ ] **T3.1** On Linux Chromium, import an MP4 with `avc1.64000d` — video
  plays back on the timeline and audio plays for the full duration.
- [ ] **T3.2** The source-health warning for unsupported video codec is still
  shown in the Media Bin details popover.
- [ ] **T3.3** Import an audio-only file — still works as before.
- [ ] **T3.4** Import a file with a truly unsupported codec (e.g. HEVC) —
  still shows a blocking warning and is rejected from the timeline.
