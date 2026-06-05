# Design: Phase 6 — Pipelined Export

> Status: **Planned**.

## Goal

Render the timeline to a valid MP4 entirely off-main-thread, pipelined so decode, the effect chain, and encode overlap. Bounded queues plus `encodeQueueSize` backpressure keep memory flat and the encoder saturated. ETA comes from the Phase 2 throughput probe, adjusted for the chosen preset.

## Pipeline (`export.ts`)

```
timeline walk
  → decode (N+2) ──▶ [queue 3–5] ──▶ effect chain (N+1) ──▶ [queue 3–5] ──▶ encode (N) ──▶ mux
                                                                              ▲
                              backpressure: if encoder.encodeQueueSize > T, await drain
```

- While frame N encodes, N+1 is in the GPU effect chain and N+2 is decoding.
- The effect chain is the **same** single-submission encoder from Phase 4; export reads its output texture into a new `VideoFrame` for the encoder — no CPU readback.
- Every `VideoFrame` `.close()`d exactly once across all stages.

## Presets (quality/speed)

| Preset | Bitrate | Encoder preset |
|--------|---------|----------------|
| Quality | higher | slower / better |
| Fast | lower | faster |

`ExportDialog.tsx` selects the preset; the worker maps it to the `VideoEncoder` config. ETA = `frames / (probeFps × presetFactor)`.

## Progress + cancel

- Worker posts low-frequency `export-progress { done, total, etaSeconds }`.
- Cancel flag checked at each stage boundary; drains queues, closes frames, finalizes/aborts the mux, releases the output handle.

## Modules to touch

| Module | Work |
|--------|------|
| `export.ts` | Pipelined walk; bounded queues; backpressure; progress/ETA; cancel |
| `media-io.ts` | Mediabunny encode + MP4 mux; File System Access output stream |
| `hardware-probe.ts` | Provide probe fps → ETA |
| `ExportDialog.tsx` | Preset toggle; progress bar; ETA; cancel button |
| `protocol.ts` | `export-start { preset, output }`, `export-cancel`, `export-progress`, `export-complete` |

## Acceptance

- Output MP4 valid in VLC, QuickTime, browser `<video>`; A/V in sync; edits + effects baked in.
- 10-min 1080p30 exports in < 5 min at Quality on hardware encoders; proportionally faster at Fast.
- Timestamp queries show the encoder as the bottleneck (decode/effects don't stall it).
- Progress bar + probe-derived ETA; clean cancel.
- Quality/speed toggle visibly changes export time.
