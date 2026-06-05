# Tasks: Phase 5 — Audio

> Status: **Planned**. Execution order respects dependencies.

## Graph + clock

- [ ] **T1.1** `audio.ts` — `AudioContext` (main) + `AudioWorkletProcessor` registration.
- [ ] **T1.2** Per-track `GainNode` → master bus → destination.
- [ ] **T1.3** Audio thread writes `AudioContext.currentTime` to a SAB slot; extend clock layout in `protocol.ts`.

## Decode + feed

- [ ] **T2.1** Worker audio decode (Mediabunny/WebCodecs) to PCM.
- [ ] **T2.2** SAB ring buffer feeding the worklet (real-time-safe, no allocation on audio thread).

## Sync

- [ ] **T3.1** `playback.ts` reads audio clock; selects nearest video frame.
- [ ] **T3.2** Drop-frame-on-lag policy; audio never stalls.
- [ ] **T3.3** Sync verified across seek and pause/resume.

## Mixing controls

- [ ] **T4.1** `protocol.ts` — per-track `set-gain` / `mute` / `solo` commands.
- [ ] **T4.2** Apply to gain nodes; solo mutes non-soloed tracks.

## Waveforms

- [ ] **T5.1** Worker computes min/max peak buckets per clip once.
- [ ] **T5.2** Transfer peaks to main; `Waveform.tsx` paints audio-lane canvas.

## Verification

- [ ] **T6.1** Manual: play with A/V sync; seek/pause/resume keep sync; mute/solo/volume correct.
- [ ] **T6.2** `npm run build` and `npm test` green.
