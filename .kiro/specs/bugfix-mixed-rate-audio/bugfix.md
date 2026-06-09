# Bugfix — Mixed-rate audio resampling

> Status: **Active**. Bugfix spec for mixed sample-rate audio handling. Mediabunny
> demuxes and decodes but does not resample, so timelines mixing 44.1 kHz and
> 48 kHz sources could not export and played back at the wrong pitch. Tracks the
> changes landing on `claude/beautiful-johnson-1kjhvv` (PR #54).

## Summary

LocalCut Studio decodes audio through Mediabunny's `AudioSampleSink`, which yields
PCM at each source's **native** sample rate. The mixer and the AudioWorklet ring
both assume a single output rate, so any timeline mixing sources of different
rates was broken: export threw on the rate mismatch, and the source-health panel
warned the user without the engine doing anything about it. This spec adds a
streaming polyphase resampler, wires it into both the export mixer and the
real-time playback path, and corrects the ring's rate contract. Architecture is
preserved:

- SolidJS UI on the main thread; the pipeline worker owns media I/O, the timeline,
  playback, WebGPU, and export.
- Mediabunny remains the primary media adapter; the resampler **complements** it,
  it does not replace any demux/decode.
- No CPU pixel round-trip on the accelerated preview/export hot path; this is an
  audio-only change.
- No server-side processing and no AI.

## Bugs

### B1 — Mixed sample rates are a hard blocker

`export.ts` threw when an audible source's `audioSampleRate` differed from the
export plan's rate, and `source-health.ts` raised a `mixed-audio-sample-rates`
**warning** describing the problem without a remedy. A 44.1 kHz music bed under a
48 kHz video could not be exported at all.

**Expected:** A streaming `AudioResampler` (polyphase sinc with a Kaiser window)
converts between arbitrary rates. The export throw is removed; the source-health
note drops to **info** severity and states that the audio will be resampled.

### B2 — Resampling keyed off the source rate, never the target

The `SequentialAudioSource` is constructed in `mediabunny-adapter.ts` with the
source's **own** native rate, so the in-method check `decodedRate !== this.sampleRate`
was always false — resampling never fired even after the resampler existed. The
export plan derives its rate from the **first** audible source, so a later clip at
a different rate was handed to the mixer mislabelled as the plan rate, producing
speed/pitch drift.

**Expected:** `pcmWindowAt` / `pcmAt` take an explicit `targetSampleRate`; the
resample decision compares the **decoded sample's** native rate against the
caller's target. The export mixer passes `plan.audioSampleRate`; the playback
writer passes the ring's canonical rate. The resampler is cached by
`(sourceRate, targetRate, channels)`.

### B3 — Playback pitch and clock wrong for non-48 kHz sources

The AudioWorklet (`public/audio-playback.worklet.js`) copies ring frames **1:1**
to the output at the fixed `AudioContext` rate (48 kHz) and uses the ring's
`SAMPLE_RATE` header **only** for the clock seconds. The worker overwrote that
header to each loaded handle's native rate (`worker.ts`), which patched the clock
math but left the actual audio playing at the wrong pitch, and made the header
"last-handle-wins" for mixed timelines.

**Expected:** The worker stops overwriting the ring `SAMPLE_RATE` per handle; the
ring stays at its canonical init rate (the `AudioContext` rate). `pcmAt` resamples
every source to that rate, so playback pitch **and** clock are both correct, and
all PCM written to the single ring shares one rate.

### B4 — Streaming DSP correctness

Independent DSP faults in the resampler and its `SequentialAudioSource` integration
(found across review rounds):

- **Data loss on window overflow** — when a decoded chunk resamples to more frames
  than the requested window, the surplus was discarded when the sample was closed.
- **Boundary distortion / unconsumed-frame loss** — the filter produced output
  using zero-padded out-of-bounds samples at the right edge, and a fixed-size
  history cap dropped unconsumed input on small/downsampled chunks.
- **State reset between contiguous packets** — resetting the filter after every
  decoded chunk discarded the history tail `process()` carries between calls,
  causing periodic clicks and cumulative drift.
- **Out-of-bounds read at even `filterSize`** — the loop bound let the inner tap
  loop read one sample past the buffer for the default `filterSize = 16`, yielding
  `NaN`.
- **Aliasing on downsample** — the sinc used a fixed full-band cutoff, so content
  above the destination Nyquist folded into the audible band when downsampling.

**Expected:** A stateful `AudioResampler` carries a dynamically-sized history
buffer and only emits frames whose full filter window is covered; the
`SequentialAudioSource` buffers surplus resampled frames (`resampleBuffer`) and
drains them on the next call; filter state persists across contiguous packets and
resets only on seek/resync/EOF; the loop bound checks the actual maximum tap
index; the sinc cutoff scales to `min(1, outputRate / inputRate)` and each
interpolation phase is normalized to unity DC gain.

### B5 — Stale resampled audio across timestamp jumps

`pcmWindowAt` drained any residual `resampleBuffer` before checking whether the
request was contiguous with the previous call, so leftover samples from a prior
position could bleed into a new timestamp after a clip boundary or short gap that
did not exceed the resync threshold.

**Expected:** The buffer tracks its expected next output cursor; a request that
diverges from it discards the buffer instead of draining it. The cursor advances
on every drain so contiguous small windows keep consuming the same buffer.

### B6 — Documentation and source-health severity

Repository policy makes `docs/` the single source of truth for user-visible
behaviour (rendered in the in-app Help panel). The mixed-rate behaviour changed
but the docs and the warning severity did not.

**Expected:** `source-health.ts` emits the mixed-rate note at **info** severity
with "(will be resampled on export)"; `docs/USER-GUIDE.md` documents the resampling
behaviour under both *Source Health Warnings* and *Audio Mixing*.

### B7 — Build & test hard gate

`npm run build` and `npm test` stay green. Tests cover: resampler identity
passthrough, frame counts via `process()` + `flush()`, exact PCM windows across
decoded boundaries, gap-fill with silence, resampling on mismatched rates, and the
per-call target-rate path (a passthrough at the construction rate vs. a resample at
a different target).

## Non-goals

- No Mediabunny replacement; demux/decode stays on Mediabunny.
- No AI of any kind.
- No change to the accelerated `VideoFrame → importExternalTexture → compute chain
  → queue.submit` pipeline.
- Not fixing the pre-existing AudioWorklet **channel** mismatch (the worklet
  captures `RING_CHANNELS` once at construction while the worker overwrites it per
  handle) — orthogonal to sample rate and out of scope here.
- Not a high-order/anti-imaging-optimal resampler; a 16-tap windowed sinc is
  sufficient for the documented 44.1 kHz ↔ 48 kHz range and bounded downsampling.

## Acceptance criteria

- A timeline mixing a 44.1 kHz source with a 48 kHz source **exports** without
  error, in tune, with no drift.
- The same timeline **plays back** at the correct pitch with an accurate playhead.
- The mixed-rate source-health note is informational and states the audio will be
  resampled; the behaviour is documented in the user guide.
- `npm run build` and `npm test` pass; resampler and target-rate coverage is added
  (test count grows; nothing existing is silently dropped).
