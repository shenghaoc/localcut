# Design: Phase 28/29 LiteRT hardening

## Scope

This is a correctness and lifetime hardening pass across the existing LiteRT
ASR and DTLN subsystems. It does **not** add new model assets, new UI surfaces,
or new worker ownership boundaries.

## ASR controller + worker

The Auto Captions panel keeps its explicit **Load model** action. Transcription
is no longer a "load if needed" shortcut: both the action-availability helper
and the controller short-circuit until `modelStatus === 'loaded'`. This makes
the button state honest and keeps the worker protocol aligned with the current
model lifecycle.

The ASR worker's serial queue is hardened so a queued transcribe failure can
still emit a job-scoped `asr-error` if an unexpected rejection escapes the
transcribe handler. The controller already accepts both scoped and generic
errors for the active job, so this change narrows the worker contract instead of
requiring a UI redesign.

## Audio Cleanup accelerator + stale finalization

`CleanupProbeResult.accelerator` becomes the controller's source of truth for
the preferred LiteRT accelerator. The main-thread capability probe computes the
best candidate from cheap browser feature detection, and the controller passes
that through to `cleanup-load-model`. The runtime still owns real fallback to
`wasm`, so unsupported accelerated loads remain safe.

The cleanup worker's `handleEnd` captures the current `loadGeneration` at entry
and re-checks it after each awaited finalization step, matching the existing
load guard pattern used elsewhere in the worker. Once a newer generation wins,
the stale `cleanup-end` path drops its output instead of posting it.

## DTLN runtime + DSP

LiteRT's WASM runtime is process-global, but the *loaded options* still matter:
WebNN needs the JSPI load path and plain WASM/WebGPU do not. The runtime tracks
the load options currently resident in LiteRT, reloads when the requested
options differ, and documents that choice in code.

The DTLN DSP promotes `magnitude` and `phase` to reusable instance fields so the
128-sample hot path stops allocating them every frame. Output semantics stay
unchanged: the same FFT inputs produce the same masked/iFFT/overlap-add result.

## Whisper DSP + ASR runtime lifetime

`reflectPad` treats empty PCM as a defined zero-filled padded buffer. That keeps
the STFT/mel path finite without inventing fake reflected samples from
out-of-range indices.

The ASR LiteRT runtime deletes every compiled model that does not become owned
by a successfully returned `LiteRtRuntimeImpl`. Constructor failures, failed
accelerated candidates, and failed fallback construction all clean up their
temporary compiled model before retrying or throwing.
