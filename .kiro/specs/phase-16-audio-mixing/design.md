# Design: Phase 16 — Audio Mixing Polish

> Status: **Planned** — one shared mix stage: master bus, pan, fades, and meters identical in preview and export.

## Goal

Replace the duplicated sum-with-gain mixes with one pure mix stage used by the live pump and the export mixer, then build master gain, per-track pan, clip fades, transition crossfades, and level meters on top of it.

## Shared mix stage

`src/engine/audio-mix.ts` (new, pure): `applyMixStage(pcm, { gain, pan, fadeEnvelope, master })` — consumed by both `pumpAudioOnce` (`src/engine/worker.ts`) and `mixAudioWindow` (`src/engine/export.ts`). Preview equals export by construction; the existing ±1 clamp and the no-resampling guard stay.

## Features

- **Master bus** — gain stage after track summation in both paths; stored in the project document (Phase 9).
- **Pan** — per-track stereo pan with an equal-power pan law; mono sources pan correctly.
- **Fades** — per-clip `audioFadeIn`/`audioFadeOut` seconds; envelopes computed sample-accurately from clip-relative position inside the mix window.
- **Crossfade** — when a Phase 13 transition sits on a track that carries audio, equal-power crossfade gains derive from the transition window (`mixT` reuse). Fades do not depend on transitions.

## Meters

The AudioWorklet computes peak/RMS and writes to a small dedicated SAB region — fixed indices, single writer, documented beside the clock layout in `src/protocol.ts` and passed at `init` alongside the audio ring. When the region lands, mirror its layout into the shared-layout documentation in `.kiro/steering/architecture.md` so steering stays current. The UI reads via rAF in new `src/ui/meters.ts` plus a meter strip component. No per-sample `postMessage`.

## Protocol + UI

- Commands `set-track-pan`, `set-master-gain`, `set-clip-fade { edge, durationS }`.
- Snapshots: `TimelineTrackSnapshot.pan`, clip `audioFadeIn`/`audioFadeOut`; master gain in the project document.
- Inspector: pan control + fade fields per selection; Toolbar/mixer strip: master fader + meters.

## Validation

- Unit tests: pan law, fade envelope shaping, master-gain application through `applyMixStage`.
- Preview/export mix equality on a known PCM fixture.
- Manual: pan a track hard left, fade a clip in/out, crossfade across a dissolve, watch meters track peaks without UI jank.
