# Design: Phase 5 — Audio

> Status: **Planned**.

## Goal

Make audio the master clock. An AudioWorklet graph plays per-track audio through gain nodes to a master bus; `AudioContext.currentTime` (relayed via the SAB) drives which video frame the worker presents. Waveforms are computed in the worker and rendered on audio lanes.

## Clock topology

```
AudioContext (main thread, per spec)
  └─ AudioWorkletProcessor (audio thread) ── writes audio clock ──▶ SAB
                                                                     │
Pipeline worker reads SAB audio clock ──▶ pick nearest video frame ─┘
  video lags? drop frames. never stall audio.
```

The Phase 2 SAB clock layout extends with an audio-clock slot so the worker reads the audio thread's authoritative time rather than its own estimate.

## Graph (`audio.ts`)

```
per-track AudioBufferSource/decoded chunks
  → per-track GainNode (volume, mute/solo)
  → master GainNode (master bus)
  → AudioContext.destination
```

- Mute = gain 0; solo = mute all non-soloed tracks.
- Decode audio via Mediabunny/WebCodecs in the worker; feed PCM to the worklet through a ring buffer (SAB) to keep the audio thread real-time-safe.

## Waveforms

- Worker computes min/max peak buckets per clip once at import/edit.
- Sends peak arrays (transferable) to main; `Waveform.tsx` paints them on the audio lane canvas.

## Modules to touch

| Module | Work |
|--------|------|
| `audio.ts` | AudioContext + worklet graph; per-track gain; master bus; clock source |
| `playback.ts` | Read audio clock from SAB; frame selection; drop-frame-on-lag |
| `protocol.ts` | Audio-clock SAB slot; track gain/mute/solo commands; waveform message |
| `worker.ts` | Audio decode; waveform computation; mix coordination |
| `Waveform.tsx` | Render peak data on audio lanes |
| `Timeline.tsx` | Audio lanes hosting waveforms |

## Acceptance

- Audio in sync with video; sync survives seek and pause/resume.
- Per-track volume, mute/solo functional.
- Waveforms render on audio lanes.
- Multi-track mix is correct.
