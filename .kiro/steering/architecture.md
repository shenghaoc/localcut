# Architecture & Development Phases

The performance characteristics are not incidental — they are the product. Do not simplify the threading model or the zero-copy GPU path "for clarity".

## Performance Philosophy (Non-Negotiable)

1. **Main thread does NO media work** — SolidJS forwards user intent to the pipeline worker.
2. **Frames stay on GPU decode → encode** — zero CPU round-trips; never `getImageData` or Canvas2D readback on the hot path.
3. **Playback clock in `SharedArrayBuffer`** — worker writes; main reads in rAF; no per-frame `postMessage`.
4. **Effect chain = one WebGPU command submission** per frame (Phase 4+).
5. **Export pipelined** with bounded queues and `encodeQueueSize` backpressure (Phase 6).
6. **Measure with timestamp queries** — profile GPU; encoder is usually the bottleneck.
7. **Adapt to hardware** — proxy preview resolution, startup throughput probe, quality/speed export toggle.

## Threading Architecture

### Main Thread — UI Only

SolidJS, DOM, command forwarding, SAB clock read, low-frequency state updates. **No** media objects, WebGPU, or decoders.

### Pipeline Worker — All Media Work

WebGPU device, OffscreenCanvas, Mediabunny, WGSL effect pipeline, authoritative timeline, playback loop, export.

### Audio — AudioWorklet

`AudioContext` created on main (spec); processing on audio thread. Audio clock is master for A/V sync (Phase 5).

```
┌─────────────────┐   commands (postMessage)    ┌──────────────────────┐
│   Main Thread   │ ──────────────────────────> │   Pipeline Worker    │
│   (SolidJS UI)  │                              │  WebGPU + OffscreenCanvas
│                 │ <────────────────────────── │  Mediabunny          │
│                 │   state updates (low-freq)   │  Effect shaders      │
└────────┬────────┘                              │  Timeline (authoritative)
         │                                       └──────────┬───────────┘
         │  reads clock (no messages)                       │ writes clock
         │         ┌──────────────────────────┐             │
         └────────>│   SharedArrayBuffer       │<────────────┘
                   │   [currentTime, duration, playState]    │
                   └──────────────────────────┘
```

### Shared Clock Layout

`Float64Array` view: `[0]` currentTime (s), `[1]` duration (s), `[2]` playState (0 paused, 1 playing).

## Zero-Copy GPU Pipeline (Hot Path)

```
VideoFrame (decoder, GPU memory)
    → importExternalTexture (valid ONLY this submission)
    → compute pass chain (colour → transform → overlays) in ONE GPUCommandEncoder
    → queue.submit once
    → PREVIEW: present to OffscreenCanvas (zero-copy)
    → EXPORT: VideoFrame from output texture → encoder (no CPU readback)
    → videoFrame.close()  (mandatory)
```

**Rules:**

- Re-import `importExternalTexture` every frame; never cache across submissions.
- Preview and export share the **same** processed texture — do not run the chain twice.
- Effects are compute shaders with ping-pong storage textures.

## Development Phases

Build sequentially. **Establish threading and zero-copy in Phase 2**, not as a retrofit.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Scaffolding, COOP/COEP, worker skeleton, SAB clock, Mediabunny metadata import | Done |
| 2 | Off-main-thread decode, zero-copy preview, play/seek, adaptive preview res, throughput probe | **Active** |
| 3 | Timeline model, cut/split/trim/reorder, frame cache | Planned |
| 4 | WebGPU compute effect chain (single submission) | Planned |
| 5 | AudioWorklet, A/V sync, waveforms | Planned |
| 6 | Pipelined export, progress/ETA, quality/speed toggle | Planned |
| 7 | PWA polish, Cloudflare Pages deploy | Planned |

## Critical Implementation Details

- **`crossOriginIsolated`** — hard gate; clear error if false.
- **Keyframe seek** — decode from nearest preceding sync sample; LRU frame cache ±N frames.
- **Audio master clock** — drop video frames if lagging; never stall audio.
- **Export backpressure** — bounded queue 3–5 frames; check `encodeQueueSize` before decoding next.
- **shader-f16** — request feature; load `*.f16.wgsl` when available; f32 fallback must match behaviour.

## Testing

- Engine: Vitest with mocked WebGPU/WebCodecs; timeline and seek logic in isolation.
- Integration: import → cut → export → valid timed MP4.
- Performance regression: export benchmark; submission-count-per-frame thresholds.
