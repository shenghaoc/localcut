# Bugfix: Phase 28/29 LiteRT hardening

> Status: **Spec + implementation (this PR).** Fixes five cross-cutting
> correctness and efficiency issues in the existing LiteRT-backed Audio Cleanup
> and Auto Captions paths without changing their worker/UI boundaries.

## Problem

Phase 28 (DTLN Audio Cleanup) and Phase 29 (LiteRT Whisper ASR) are already on
their real on-device runtimes, but a review surfaced five bugs that degrade the
current implementation:

- Auto Captions still exposes the transcribe action before the model is loaded,
  and queued worker failures should retain the transcribe job context instead of
  falling back to a generic worker error.
- Audio Cleanup always requests the `wasm` accelerator from the controller, so
  LiteRT never even attempts WebGPU/WebNN when the browser has already probed
  them as available. Its worker also lets `cleanup-end` finalize against stale
  state after a reload/dispose because `handleEnd` is missing the existing
  `loadGeneration` guard pattern.
- The DTLN runtime treats LiteRT as a one-time process-global load regardless of
  accelerator options, so a later re-init can silently reuse the wrong
  JSPI/non-JSPI runtime. The DSP also allocates fresh magnitude/phase buffers on
  every 128-sample frame.
- Whisper's `reflectPad` emits `NaN` for empty PCM, poisoning the log-mel path
  instead of failing safely.
- The ASR LiteRT runtime can strand compiled models on constructor/fallback
  error paths instead of deleting every unsuccessful compilation result.

## Decision

Keep the current architecture intact: Solid controllers stay orchestration-only,
workers own LiteRT + DSP, and there is still no startup model load, no cloud
fallback, and no pipeline-worker coupling. The bugfix hardens the existing
implementations instead of redesigning them:

- Gate ASR transcription on an already-loaded model and preserve job-scoped
  worker errors for queued transcribe failures.
- Let Audio Cleanup request the best already-probed accelerator and still fall
  back to `wasm` in the runtime.
- Treat LiteRT load options as part of the runtime identity, guard stale worker
  generations consistently, and reuse DSP scratch buffers in hot paths.
- Define empty-PCM Whisper preprocessing as zero-filled padding so no mel path
  can emit `NaN`.
- Delete compiled LiteRT models on every unsuccessful ASR runtime path before
  retrying or rethrowing.

## Acceptance

- Auto Captions disables and short-circuits transcribe actions until
  `modelStatus === 'loaded'`, and queued transcribe failures stay job-scoped.
- Audio Cleanup requests the probed accelerator (`webnn` → `webgpu` → `wasm` as
  reported by the probe), but still falls back to `wasm` inside the runtime when
  accelerated LiteRT load/compile fails.
- `cleanup-end` never posts stale results after a newer load generation wins.
- DTLN runtime re-init honors changed LiteRT load options, and the DSP no longer
  allocates per-frame magnitude/phase arrays.
- Whisper empty PCM preprocessing returns finite values and the mel front-end
  never emits `NaN` for empty input.
- ASR compiled models are deleted on constructor and fallback error paths.
- `pnpm run check` is green with added or expanded tests and no test count
  decrease.
