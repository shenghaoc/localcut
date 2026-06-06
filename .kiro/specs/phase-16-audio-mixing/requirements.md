# Requirements: Phase 16 — Audio Mixing Polish

## R1 — Shared Mix Stage + Master Bus

- **R1.1** Per-sample gain/pan/fade math lives in one pure mix stage consumed by both the live audio pump and the export mixer; the two paths cannot drift.
- **R1.2** A master gain stage applies after track summation in both paths and persists in the project document; the existing ±1 clamp stays.

## R2 — Per-Track Pan

- **R2.1** Each track carries a stereo pan applied with an equal-power pan law, consistently in preview and export.
- **R2.2** Mono sources pan correctly into the stereo field.

## R3 — Fades + Crossfades

- **R3.1** Clips carry audio fade-in/fade-out durations; envelopes apply sample-accurately from clip-relative position within the mix window.
- **R3.2** When a Phase 13 transition sits on a track carrying audio, an equal-power crossfade derives from the transition window; fades work without transitions.

## R4 — Level Meters

- **R4.1** The AudioWorklet computes peak/RMS and writes to a small dedicated SAB region with fixed indices and a single writer, documented like the clock layout.
- **R4.2** The UI reads meters via rAF; no per-sample `postMessage`.

## R5 — Tests

- **R5.1** Unit-test the pan law, fade envelope shaping, and master-gain application through the shared mix stage.
- **R5.2** Test preview/export mix equality on a known PCM fixture.
