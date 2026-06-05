# Design: Phase 2 — Off-Main-Thread Decode + Zero-Copy Preview

> Status: **Active** — next implementation target.

## Goal

Prove the entire performance architecture end-to-end: hardware decode in the pipeline worker, `importExternalTexture` passthrough to OffscreenCanvas via WebGPU, playback transport, and SAB clock sync.

## Pipeline (per frame, in worker)

```
Mediabunny decode → VideoFrame
    → importExternalTexture
    → passthrough compute/render pipeline (single submission)
    → present to OffscreenCanvas
    → videoFrame.close()
    → write audioClockSeconds to SAB[0]
```

No Canvas2D. No main-thread decode. No CPU pixel readback.

## Modules to implement

| Module | Work |
|--------|------|
| `media-io.ts` | Keep `Input` alive; `VideoSampleSink` or WebCodecs decode to `VideoFrame` |
| `gpu.ts` | Storage textures, passthrough shader, present path |
| `playback.ts` | rAF/worker loop; play/pause/seek; keyframe seek |
| `hardware-probe.ts` | Silent ~2s encode burst on first import; store fps estimate |
| `shaders/passthrough.wgsl` | Copy external texture to output |

## Adaptive preview resolution

- Measure decode + render time per frame.
- If > 33ms budget (30fps), drop preview decode to 720p or 540p.
- Store full-res decode config for export.
- UI indicator: "Preview: 720p" (etc.).

## Throughput probe

On first import: encode short burst of test frames silently. Persist encode fps for session ETA (used in Phase 6 export dialog).

## Acceptance

- Preview renders via WebGPU on OffscreenCanvas.
- Scrubhead tracks playback via SAB with zero per-frame messages.
- All `VideoFrame`s closed; dev leak warnings if any survive > 1 frame period.
- Seek from nearest keyframe; frame-step works.
- Preview resolution drops on slow hardware with visible indicator.
- Throughput probe runs once per session on first import.
