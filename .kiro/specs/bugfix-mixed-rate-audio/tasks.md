# Tasks: Bugfix — Mixed-rate audio resampling

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `claude/beautiful-johnson-1kjhvv` (PR #54).

## T1 — Polyphase sinc resampler (B1, B4)

- [x] **T1.1** Add `src/engine/audio-resampler.ts`: `AudioResampler` with a
  Kaiser-windowed polyphase filter table (`filterSize = 16`, `tablePoints = 512`,
  `beta = 6`) and a `resampleBlock()` one-shot helper.
- [x] **T1.2** Carry a dynamically-sized history buffer across `process()` calls;
  emit a frame only when its full filter window is covered (right-edge guard on the
  maximum tap index, which also fixes the even-`filterSize` out-of-bounds read).
- [x] **T1.3** Scale the sinc cutoff to `min(1, outputRate / inputRate)` and
  normalize each phase row to unity DC gain (anti-aliasing + flat gain).
- [x] **T1.4** Identity fast path when `inputRate === outputRate`.
- [x] **T1.5** `audio-resampler.test.ts`: passthrough, frame counts via
  `process()` + `flush()`, up/down conversions finite and non-silent.

## T2 — Target-rate integration in SequentialAudioSource (B2, B4, B5)

- [x] **T2.1** Add `targetSampleRate?` to `pcmWindowAt` and `pcmAt`; resample on
  `decodedRate !== targetRate` and key `getResampler` by
  `(sourceRate, sourceChannels, targetRate)` building with `outputRate: targetRate`.
- [x] **T2.2** Use `targetRate` for all output-frame arithmetic (silence fill,
  cursor advance, drain); keep decoded rate for source-frame arithmetic.
- [x] **T2.3** Buffer surplus resampled frames (`resampleBuffer`) and drain them
  first on the next call; do **not** reset the resampler between contiguous packets.
- [x] **T2.4** Track `resampleBufferCursor`; discard the buffer on a non-contiguous
  request (`|time − cursor| > 1e-4`) and advance it on every drain; clear all
  resampler state in `reset()`.
- [x] **T2.5** Resample the playback chunk in `pcmAt` before channel mapping.

## T3 — Canonical ring rate + channels on playback (B3)

- [x] **T3.1** In `worker.ts`, remove the per-handle
  `Atomics.store(header, SAMPLE_RATE, …)` writes (source registration + re-link).
  Add a comment explaining the worklet plays 1:1 at the canonical `AudioContext` rate.
- [x] **T3.2** Pass the ring's `sampleRate` (now canonical) as the target to
  `pcmAt` in the playback writer.
- [x] **T3.3** Remove the per-handle `Atomics.store(header, CHANNELS, …)` writes
  (source registration + re-link). The worklet reads `RING_CHANNELS` once at
  construction and never re-reads; overwriting it per-handle caused stride mismatch
  for mono sources. `pcmAt` already upmixes to the requested channel count.

## T4 — Export mixer target rate (B2)

- [x] **T4.1** Pass `plan.audioSampleRate` to every `pcmWindowAt` call in
  `mixAudioWindow` (per-clip mix and both transition-crossfade sides).
- [x] **T4.2** Remove the dead mixed-rate guard loop that previously threw.
- [x] **T4.3** Update `export.test.ts` assertions for the new `pcmWindowAt`
  signature.

## T5 — Source health + docs (B6)

- [x] **T5.1** In `source-health.ts`, emit `mixed-audio-sample-rates` at `info`
  severity with "(will be resampled on export)".
- [x] **T5.2** In `docs/USER-GUIDE.md`, add the **Mixed audio sample rates** health
  entry and a **Sample Rate Handling** subsection under *Audio Mixing*.

## T6 — Coverage and gate (B7)

- [x] **T6.1** `audio-source.test.ts`: target-rate test (passthrough at the
  construction rate vs. resample at a different target).
- [x] **T6.2** `npm run build` green; `npm test` green; test count grows.

## T7 — Manual verification

- [ ] **T7.1** Build a timeline with a 44.1 kHz audio clip under a 48 kHz video
  clip; play back — pitch is correct and the playhead tracks accurately.
- [ ] **T7.2** Export the same timeline — the rendered file is in tune with no
  drift across the clip boundary.
- [ ] **T7.3** Confirm the Media Details popover shows the mixed-rate note as
  informational, and the user guide describes the behaviour.
