# Requirements: Phase 5 — Audio

## R1 — Playback graph

- **R1.1** AudioWorklet-based playback graph (`audio.ts`); `AudioContext` created on the main thread per spec.
- **R1.2** Per-track gain nodes feeding a master bus.
- **R1.3** Processing graph + `AudioWorkletProcessor` run on the audio thread.

## R2 — Audio as master clock

- **R2.1** `AudioContext.currentTime` is the A/V timing reference.
- **R2.2** The audio clock reaches the pipeline worker via the SharedArrayBuffer (audio thread writes, worker reads).
- **R2.3** Playback selects the video frame matching the audio clock; if video lags, drop frames — never stall audio.

## R3 — Sync robustness

- **R3.1** A/V sync holds during steady playback.
- **R3.2** Sync survives seek and pause/resume.

## R4 — Mixing controls

- **R4.1** Per-track volume.
- **R4.2** Mute / solo per track.
- **R4.3** Multi-track mix is summed correctly to the master bus.

## R5 — Waveforms

- **R5.1** Waveform peak data computed in the worker, sent once per clip.
- **R5.2** `Waveform.tsx` renders peaks onto audio-lane canvases.

## R6 — Verification

- **R6.1** Audio stays in sync with video through seek and pause/resume.
- **R6.2** Volume, mute, solo behave correctly; multi-track mix is correct.
- **R6.3** `npm run build` and `npm test` green; `crossOriginIsolated` unchanged.
