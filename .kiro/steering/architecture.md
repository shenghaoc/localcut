# Architecture & Development Phases

The performance characteristics are not incidental — they are the product. The architecture should protect the fast path without making purity more important than a user successfully editing a video. All media compute is client-side because the deployment model assumes static Cloudflare hosting and no paid server media pipeline.

## Performance Philosophy

1. **Client compute first** — the user's browser CPU/GPU does the media work. Cloudflare serves the app; it does not decode, render, encode, store, or proxy user media.
2. **Accelerated path first** — the best experience uses WebCodecs, WebGPU, workers, OffscreenCanvas, `SharedArrayBuffer`, and zero-copy frame flow.
3. **Compatibility paths are allowed** — a slower client-side path is acceptable when it is explicitly named, measured, and surfaced as a lower capability tier. Do not hide a fallback behind "desktop-like" claims.
4. **Main thread stays interactive** — no unbounded decode, encode, mux, GPU, or pixel-processing loops on the main thread. Bounded capability probes, file picking, UI mirrors, and tiny preview helpers are acceptable when measured.
5. **Avoid CPU round-trips on the accelerated hot path** — never use `getImageData` or Canvas2D readback in the WebGPU preview/export loop. A compatibility preview/export path may use client CPU or Canvas APIs only when labeled and separate from the accelerated pipeline.
6. **Use `SharedArrayBuffer` when available** — SAB remains the high-frequency clock for the accelerated engine. A degraded preview clock may use throttled messages or rAF if cross-origin isolation is unavailable.
7. **Effect chain should submit once per frame in the accelerated engine** — compatibility effects can trade quality or resolution for reach, but must not regress the premium path.
8. **Export remains pipelined** with bounded queues and `encodeQueueSize` backpressure wherever WebCodecs encoding is available.
9. **Measure and adapt** — timestamp queries, throughput probes, proxy preview resolution, and quality/speed export modes should drive visible capability tiers.

## Threading Architecture

### Main Thread — Interactive Shell

SolidJS, DOM, command forwarding, SAB/rAF clock reads, low-frequency state updates, capability messaging, file picker affordances, and bounded probes. Do not put sustained media pipelines here.

### Pipeline Worker — Accelerated Engine

WebGPU device, OffscreenCanvas, Mediabunny, WGSL effect pipeline, authoritative timeline, playback loop, export.

### Compatibility Engine — Reduced Capability

Future compatibility modules may support limited client-side preview/export when WebGPU, SAB, or File System Access are missing. They must be separate from the accelerated engine, lower resolution by default, visibly labeled, and covered by capability-specific tests.

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

`Float64Array` view: `[0]` currentTime (s), `[1]` duration (s), `[2]` playState (0 paused, 1 playing), `[3]` audioClock (s).

### Meter SAB Layout (Phase 16)

Separate `Float32Array` SAB passed at `init` alongside the audio ring. The AudioWorklet is the single writer; the UI reads via rAF.

`[0]` peakL, `[1]` peakR, `[2]` rmsL, `[3]` rmsR — see `MeterIndex` in `src/protocol.ts`.

## Accelerated GPU Pipeline (Premium Hot Path)

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
- From Phase 12 the chain runs per layer (colour → transform → composite) through one shared `compositeLayers` encode; multiple `importExternalTexture` calls within a frame are expected, and the single `queue.submit` per frame still holds.
- Any fallback that violates these rules must be outside the accelerated engine and visibly reported as a compatibility tier.

## Development Phases

Build capability tracks in an order that protects the premium path while making the editor useful on more machines. Specs are planning tools, not product dogma.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Scaffolding, COOP/COEP, worker skeleton, SAB clock, Mediabunny metadata import | Done |
| 2 | Off-main-thread decode, zero-copy preview, play/seek, adaptive preview res, throughput probe | Done |
| 3 | Timeline model, cut/split/trim/reorder, frame cache | Done |
| 4 | WebGPU compute effect chain (single submission) | Done |
| 5 | AudioWorklet, A/V sync, waveforms | Done |
| 6 | Pipelined export, progress/ETA, quality/speed toggle | Done |
| 7 | PWA polish, Cloudflare Pages deploy | Done |
| 8 | Capability-tier UX and compatibility engine planning | Done |
| 9 | Project persistence (versioned doc, IndexedDB autosave), snapshot undo/redo, media re-linking | Done |
| 10 | Timeline UX: px-per-second zoom/scroll, gap-tolerant moves, snapping, multi-select, markers | Planned |
| 11 | Media library: batch import, budgeted thumbnails, image-still/audio-only sources, track management | Planned |
| 12 | Multi-track compositing: layered resolve, single-submission N-layer composite, per-clip transforms | Planned |
| 13 | Transitions: cut-point model, dual-stream readahead, 2-input mix in the single submission | Planned |
| 14 | Titles/text: edit-time raster cached as a GPU texture, composited via the transform path | Planned |
| 15 | Keyframed parameters with shared preview/export sampling; `.cube` LUT grading | Planned |
| 16 | Audio mixing: shared mix stage, master bus, pan, fades/crossfades, SAB level meters | Active |
| 17 | Export expansion: probed codecs (H.264/VP9/AV1), size/fps/bitrate overrides, range export | Planned |

## Critical Implementation Details

- **`crossOriginIsolated`** — hard gate for the accelerated SAB clock, not for showing the editor shell. If false, show a limited capability tier and block only features that truly require SAB until a compatibility engine exists.
- **Keyframe seek** — decode from nearest preceding sync sample; LRU frame cache ±N frames.
- **Audio master clock** — drop video frames if lagging; never stall audio.
- **Export backpressure** — bounded queue 3–5 frames; check `encodeQueueSize` before decoding next.
- **shader-f16** — request feature; load `*.f16.wgsl` when available; f32 fallback must match behaviour.

## Testing

- Engine: Vitest with mocked WebGPU/WebCodecs; timeline and seek logic in isolation.
- Integration: import → cut → export → valid timed MP4.
- Performance regression: export benchmark; submission-count-per-frame thresholds.
