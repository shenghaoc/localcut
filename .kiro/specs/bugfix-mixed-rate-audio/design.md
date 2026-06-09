# Design: Bugfix — Mixed-rate audio resampling

This document maps each bug in `bugfix.md` to the concrete change and the
invariant it protects. The work adds one new engine module (`audio-resampler.ts`)
and threads a target rate through the existing audio path; no new worker, no new
message type, no rendering change.

## D1 — Polyphase sinc resampler (B1, B4)

`src/engine/audio-resampler.ts` (new)

`AudioResampler` converts an interleaved f32 stream from `inputRate` to
`outputRate` for a fixed channel count. A precomputed filter table holds
`filterSize × tablePoints` taps (defaults: `filterSize = 16`, `tablePoints = 512`,
Kaiser `beta = 6`). For each output frame the table is indexed by the fractional
source position (the polyphase phase) and convolved with `filterSize` input taps.

Streaming correctness:

- **History buffer.** `process(input, inputFrames)` prepends a retained history of
  the trailing unconsumed input, so the filter window spanning a chunk boundary
  uses real samples, never zero padding. The history grows dynamically
  (`keepFrames = totalInputFrames - consumed`); there is no fixed cap that could
  drop unconsumed input.
- **Right-edge guard.** The emit loop stops when the maximum tap index
  `intCenter - halfFilterInt + filterSize` would exceed `totalInputFrames`, so an
  output frame is produced only when its **entire** window is covered. This both
  prevents boundary distortion and fixes an off-by-one out-of-bounds read for even
  `filterSize` (the previous `rightEdge >= totalInputFrames` bound).
- **Anti-aliasing.** The sinc cutoff is `min(1, outputRate / inputRate)`, so
  downsampling attenuates content above the destination Nyquist. Each phase row is
  normalized to sum to 1 (unity DC gain), removing amplitude ripple across phases
  regardless of cutoff.
- **Identity fast path.** When `inputRate === outputRate` (`ratio === 1`),
  `process` returns the input slice unchanged and `flush` returns empty, so the
  common matched-rate case incurs no filtering or latency.
- `reset()` clears history + fraction; `flush()` pushes `filterSize` zero frames to
  drain the tail. `resampleBlock()` is a one-shot convenience wrapper.

## D2 — Target rate threaded through SequentialAudioSource (B2)

`src/engine/audio-source.ts`

`pcmWindowAt` and `pcmAt` gain an optional `targetSampleRate`; both compute
`targetRate = targetSampleRate ?? this.sampleRate`. The resample decision is
`decodedSampleRate !== targetRate` (the decoded sample's own `sampleRate`, not the
constructor field), which is the fix for the "never fires" bug — the adapter
constructs the source with the source's native rate, so comparing against
`this.sampleRate` was always false.

- `getResampler(sourceRate, sourceChannels, targetRate)` caches by all three keys
  and builds the `AudioResampler` with `outputRate: targetRate`. A target change
  rebuilds the resampler and clears the residual buffer.
- All **output**-frame arithmetic (silence fill, cursor advance, drain) uses
  `targetRate`; **source**-frame arithmetic continues to use the decoded rate.
- `pcmAt` (playback) resamples the whole decoded chunk to `targetRate` before
  channel mapping; `pcmWindowAt` (export) resamples the sliced window and buffers
  any surplus.

## D3 — Surplus buffering and stale-buffer discard (B4, B5)

`src/engine/audio-source.ts`

When a resampled chunk yields more frames than the requested window,
`pcmWindowAt` keeps the remainder in `resampleBuffer` (with `resampleBufferOffset`
and `resampleBufferChannels`) and drains it first on the next call, so no audio is
lost when chunk boundaries do not align with the window size.

`resampleBufferCursor` records the expected next output time. On entry,
`pcmWindowAt` discards the buffer when `|time − resampleBufferCursor| > 1e-4`
(a non-contiguous request after a seek, cut, or sub-threshold gap) instead of
draining stale samples into a new position; the cursor advances on every drain so
contiguous small windows keep consuming the same buffer. `reset()` (seek/resync)
clears the buffer, cursor, and resampler so filter history never crosses a
discontinuity. Within a contiguous run the resampler is **not** reset between
packets, preserving the filter tail.

## D4 — Canonical ring rate on the playback path (B3)

`src/engine/worker.ts`

The AudioWorklet plays ring frames 1:1 at the fixed `AudioContext` rate and uses
the ring `SAMPLE_RATE` header only to compute clock seconds
(`public/audio-playback.worklet.js`). The two `Atomics.store(header, SAMPLE_RATE,
handle.audioSampleRate)` calls (on source registration and on re-link) are removed
so the ring stays at its canonical init rate (48 kHz, set by `initAudioRing` in
`src/ui/audio-engine.ts`). The `CHANNELS` store is left unchanged (a separate
axis, out of scope).

The playback writer reads `sampleRate` from the ring header — now the canonical
rate — and passes it to `pcmAt`, so every source resamples to the rate the worklet
actually outputs at. Result: correct pitch (1:1 playback of canonical-rate PCM),
correct clock (`framesConsumed / canonicalRate`), and a single rate across the ring
for mixed timelines.

## D5 — Export mixer passes the plan rate (B2)

`src/engine/export.ts`

The plan rate (`plan.audioSampleRate`, derived from the first audible source in
range) is passed as the `targetSampleRate` argument to every `pcmWindowAt` call in
`mixAudioWindow` — the per-clip mix and both sides of a transition crossfade. The
dead mixed-rate guard loop (which previously threw) is gone. Mixed-rate sources are
now resampled to the plan rate before mixing, so the encoder receives PCM that
matches the rate it labels frames with.

## D6 — Source health + docs (B6)

`src/engine/media-adapters/source-health.ts` — the `mixed-audio-sample-rates`
note is emitted at `info` severity with text noting the audio will be resampled on
export.

`docs/USER-GUIDE.md` — *Source Health Warnings* gains a **Mixed audio sample
rates** entry; *Audio Mixing* gains a **Sample Rate Handling** subsection
describing the polyphase resampling during preview and export.

## D7 — Tests (B7)

- `src/engine/audio-resampler.test.ts` — identity passthrough at matched rates;
  frame counts via `process()` + `flush()` within tolerance; up/down conversions
  finite and non-silent.
- `src/engine/audio-source.test.ts` — exact PCM windows across decoded boundaries;
  silence gap-fill; resampling on mismatched rates; **target-rate** test: a source
  constructed at its native rate returns a verbatim passthrough when the target
  equals that rate and a differing, finite, non-passthrough buffer when the target
  differs (locks in B2).
- `src/engine/export.test.ts` — `mixAudioWindow` assertions updated for the new
  `pcmWindowAt(time, frames, channels, sampleRate)` signature; mixed-rate plan
  still resolves to the first source's rate.

No tests are removed.
