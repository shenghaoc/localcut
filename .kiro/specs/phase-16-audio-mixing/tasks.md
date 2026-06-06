# Tasks: Phase 16 — Audio Mixing Polish

> Status: **Planned**. Factor the shared mix stage first — every feature then lands once for both preview and export.

## Shared mix stage

- [ ] **T1.1** Add `src/engine/audio-mix.ts`: pure `applyMixStage(pcm, { gain, pan, fadeEnvelope, master })`.
- [ ] **T1.2** Rewire `pumpAudioOnce` and `mixAudioWindow` through it; keep the ±1 clamp and no-resampling guard.
- [ ] **T1.3** Preview/export mix equality test on a PCM fixture.

## Master + pan

- [ ] **T2.1** Master gain stage after summation; `set-master-gain`; persist in the project document.
- [ ] **T2.2** Per-track pan with an equal-power law; `set-track-pan`; mono handling; unit-test the law.

## Fades + crossfade

- [ ] **T3.1** Clip `audioFadeIn`/`audioFadeOut` + `set-clip-fade`; sample-accurate envelopes in the mix window.
- [ ] **T3.2** Equal-power crossfade derived from Phase 13 transition windows on audio-carrying tracks.
- [ ] **T3.3** Unit-test envelope shaping and crossfade gains.

## Meters

- [ ] **T4.1** AudioWorklet peak/RMS written to a dedicated fixed-index SAB region (single writer); document beside the clock layout; pass at `init`.
- [ ] **T4.2** Add `src/ui/meters.ts` rAF reader + meter strip; master fader UI.

## Verification

- [ ] **T5.1** Manual: hard-pan, fade in/out, dissolve crossfade, meters track peaks smoothly.
- [ ] **T5.2** `npm run build` and `npm test` green; test count grows.
