# Design: Phase 26 — Cross-browser Compatibility Engine

> Status: **Optional** — expands useful workflows beyond Chromium desktop without weakening the premium path.

## Goal

Define and implement `CapabilityTierV2`: a four-level tier system that maps each browser's actual runtime capabilities to a named, honest experience. The premium `core-webgpu` path is unchanged. Safari and Firefox gain reduced but functional preview and export modes driven entirely by what their APIs support. All new paths live under `src/engine/compatibility/`, are tested in isolation, and are permanently labeled in the UI so users are never misled about what tier they are on.

## CapabilityTierV2

| Tier | Minimum requirements | Preview | Export | Clock |
|------|----------------------|---------|--------|-------|
| `core-webgpu` | WebGPU standard adapter + WebCodecs decode + full H.264/VP9/AV1 encode probes + SAB + OffscreenCanvas + `crossOriginIsolated` | Full GPU: effect chain, multi-layer, full resolution | H.264 / VP9 / AV1 (probed muxable pairs) | SAB `Float64Array` |
| `compatibility-webgpu` | WebGPU (standard or compat adapter) + WebCodecs decode + OffscreenCanvas; SAB not required | GPU render via OffscreenCanvas; reduced effect set; proxy resolution | Encode where probed; File System Access or blob download | SAB (if available) / rAF-message |
| `limited-webcodecs` | WebCodecs `VideoDecoder` + OffscreenCanvas present; no WebGPU | Canvas2D OffscreenCanvas compositing, <=720p | WebCodecs H.264/VP9 encode where probed; File System Access or blob download | SAB (if available) / rAF-message |
| `shell-only` | Neither WebGPU nor WebCodecs | Static unavailability message | Controls hidden | N/A |

## Reference capability matrix

> Verified at spec-writing time; must be re-checked at implementation and before each release.

| Feature | Chrome/Edge 120+ | Safari 17+ | Firefox 126+ |
|---------|-----------------|------------|-------------|
| WebGPU standard adapter | ✓ | ✓ (partial feature coverage) | ✗ (behind flag) |
| WebGPU compatibility adapter | ✓ | ✗ | ✗ |
| WebCodecs `VideoDecoder` presence | ✓ | ✓ | ✓ |
| WebCodecs `VideoEncoder` presence | ✓ | ✓ | ✗ |
| H.264 decode | ✓ | ✓ | ✓ |
| VP9 decode | ✓ | ✓ | ✓ |
| AV1 decode | ✓ | ✗ | ✗ |
| H.264 encode | ✓ | ✓ (limited profiles) | ✗ |
| VP9 encode | ✓ | ✗ | ✗ |
| AV1 encode | ✓ | ✗ | ✗ |
| AAC audio decode | ✓ | ✓ | ✓ |
| Opus audio decode | ✓ | ✓ | ✓ |
| AAC audio encode | ✓ | ✓ | ✗ |
| Opus audio encode | ✓ | ✗ | ✗ |
| SharedArrayBuffer (with COOP/COEP) | ✓ | ✓ | ✓ |
| OffscreenCanvas | ✓ | ✓ | ✓ |
| File System Access API | ✓ | ✗ | ✗ |
| OPFS | ✓ | ✓ | ✓ |
| AudioWorklet | ✓ | ✓ | ✓ |

Expected tier per browser under default server configuration (COOP/COEP served correctly):

| Browser | Expected tier |
|---------|--------------|
| Chrome/Edge (standard COOP/COEP origin) | `core-webgpu` |
| Chrome/Edge (missing COOP/COEP) | `compatibility-webgpu` |
| Chrome/Edge (compatibility adapter forced) | `compatibility-webgpu` |
| Safari 17+ (COOP/COEP served) | `compatibility-webgpu` (WebGPU present, encode limited) |
| Firefox 126+ | `limited-webcodecs` (no WebGPU, decode-only) |
| Any browser (no WebGPU, no WebCodecs) | `shell-only` |

## Probe strategy

`probeCapabilities()` runs once on the main thread before the pipeline worker is spawned. It must complete before any worker `init` message is sent. The resolved result is attached to the `init` payload so the worker knows which pipeline to start.

```typescript
// src/protocol.ts

type FeatureSupport = 'supported' | 'unsupported' | 'unknown';

interface CodecProbeResult {
  h264Decode: FeatureSupport;
  vp9Decode:  FeatureSupport;
  av1Decode:  FeatureSupport;
  h264Encode: FeatureSupport;
  vp9Encode:  FeatureSupport;
  av1Encode:  FeatureSupport;
  aacDecode:  FeatureSupport;
  opusDecode: FeatureSupport;
  aacEncode:  FeatureSupport;
  opusEncode: FeatureSupport;
}

interface CapabilityProbeResult {
  crossOriginIsolated:  boolean;
  sharedArrayBuffer:    FeatureSupport;
  webGPUCore:           FeatureSupport;
  webGPUCompat:         FeatureSupport;
  compatibilityAdapter: boolean;          // true when only compat adapter succeeded
  webCodecsDecode:      FeatureSupport;   // VideoDecoder presence
  webCodecsEncode:      FeatureSupport;   // VideoEncoder presence
  codecs:               CodecProbeResult;
  fileSystemAccess:     FeatureSupport;
  opfs:                 FeatureSupport;
  audioWorklet:         FeatureSupport;
  offscreenCanvas:      FeatureSupport;
  tier:                 CapabilityTierV2;
}

type CapabilityTierV2 =
  | 'core-webgpu'
  | 'compatibility-webgpu'
  | 'limited-webcodecs'
  | 'shell-only';
```

Tier derivation — pure function, evaluated in order:

```typescript
function deriveCapabilityTierV2(p: Omit<CapabilityProbeResult, 'tier'>): CapabilityTierV2 {
  const hasGPU     = p.webGPUCore === 'supported' || p.webGPUCompat === 'supported';
  const hasDecoder = p.webCodecsDecode === 'supported';
  const hasFullVideoEncodeSet =
    p.webCodecsEncode === 'supported' &&
    p.codecs.h264Encode === 'supported' &&
    p.codecs.vp9Encode === 'supported' &&
    p.codecs.av1Encode === 'supported';
  const hasSAB     = p.sharedArrayBuffer === 'supported';
  const hasOC      = p.offscreenCanvas   === 'supported';

  if (p.webGPUCore === 'supported' && hasDecoder && hasFullVideoEncodeSet && hasSAB && hasOC && p.crossOriginIsolated)
    return 'core-webgpu';
  if (hasGPU && hasDecoder && hasOC)
    return 'compatibility-webgpu';
  if (hasDecoder && hasOC)
    return 'limited-webcodecs';
  return 'shell-only';
}
```

Individual codec probes use `VideoDecoder.isConfigSupported` and `VideoEncoder.isConfigSupported` with representative configs (e.g. `{ codec: 'avc1.42E01E', ... }`). Probe errors are caught and mapped to `'unknown'`.

## Clock degradation

In every tier the **worker is the sole clock writer** and the main thread only reads — the `PlaybackController` advances time on its own internal real-time loop. The only thing the tier changes is the transport of that time to the main thread:

| Tier | Clock source | Mechanism |
|------|-------------|-----------|
| `core-webgpu` | SAB `Float64Array[0]` | Worker writes SAB; main reads via rAF (unchanged) |
| `compatibility-webgpu` | SAB when available, otherwise `clock-update` message | Worker writes SAB on isolated origins; when SAB is absent the worker posts `{ type: 'clock-update', currentTime, duration, playing }` from its playback loop instead |
| `limited-webcodecs` | SAB when available, otherwise `clock-update` message | Same SAB-first rule; the compositor worker posts `clock-update` only when SAB is absent |
| `shell-only` | N/A | No playback worker started |

The main thread never pushes time into the worker (no `clock-tick`); doing so would fight the worker's own playback loop with per-frame `seek`s. The message path is only taken when SAB is unavailable (`clockView === null`), driven by the probe result, never when `crossOriginIsolated` is true and SAB is present. Because the worker only writes from its playback loop (and once on pause/seek/step), the playhead never advances while paused.

## WebGPU compatibility mode pipeline

When the resolved tier is `compatibility-webgpu`, the worker initializes a modified GPU pipeline in `src/engine/compatibility/compat-webgpu-preview.ts` instead of the standard one. This applies both to compatibility-adapter sessions and standard-adapter sessions downgraded by missing SAB/COOP or reduced encode support. Key differences from the premium path:

| Aspect | Premium (`core-webgpu`) | Compat GPU (`compatibility-webgpu`) |
|--------|------------------------|-------------------------------------|
| Frame ingestion | `importExternalTexture(videoFrame)` | `createImageBitmap(videoFrame)` -> `copyExternalImageToTexture` |
| Texture format | `rgba16float` (with f16) | `rgba8unorm` |
| Shader features | f16, subgroups, timestamp-query (probed) | None assumed; re-probed per-adapter |
| Effect set | Full (color-grade, LUT, transform, composite, custom) | `color-grade` and `transform` only |
| `queue.submit` | Once per frame | Once per frame (unchanged) |
| `videoFrame.close()` | After `importExternalTexture` | After `createImageBitmap` |
| `ImageBitmap.close()` | N/A | After `copyExternalImageToTexture` |

The module must not import any symbol from `src/engine/worker.ts` or the effect pipeline. It may import the WGSL shader loader helper and the timeline resolver.

## Canvas2D compositor (`limited-webcodecs` tier)

`src/engine/compatibility/canvas-compositor.ts` — runs in a dedicated worker with an `OffscreenCanvas` transferred from the main thread.

```
Timeline resolveAllAt(t)
  → per clip: VideoDecoder.decode(chunk)
  → VideoFrame
  → createImageBitmap(frame, { resizeWidth, resizeHeight })  // aspect-preserving cap within 1280×720
  → frame.close()                                             // exactly once
  → OffscreenCanvas 2D context:
      ctx.clearRect(...)
      for each layer (Z order):
        ctx.globalAlpha = clip.opacity
        ctx.drawImage(bitmap, dstX, dstY, dstW, dstH)
        bitmap.close()                                        // exactly once
  → transferToImageBitmap()  →  postMessage to main (display; receiver closes the previous displayed bitmap before replacement)
```

Constraints enforced at the module boundary:
- Decoded frame queue bounded to 3 frames per track (drop oldest if full); the bound guards against a non-positive size spinning forever.
- Decode loop driven by the worker's own playback transport (the worker owns the clock and posts `clock-update` to the main thread when SAB is absent); loop exits cleanly on `pause` or `seek` via `AbortController`.
- Resolution cap: aspect-preserving `resizeWidth` and `resizeHeight` are computed so neither dimension exceeds 1280×720 before `createImageBitmap`.
- The transferred display bitmap is owned by the main preview consumer, which closes it after drawing or before replacing it with a newer frame.
- Effects unavailable notice is encoded in the worker's init response, not inferred at the UI layer.

## Compatibility export (`limited-webcodecs` tier)

`src/engine/compatibility/compat-export.ts`:

```
Timeline frames (Canvas compositor output — ImageBitmap)
  → new VideoFrame(bitmap, { timestamp, duration })
  → bitmap.close()                // exactly once
  → VideoEncoder (H.264 or VP9, first probe success)
      encodeQueueSize guard: await until < 4 before each frame
  → EncodedVideoChunk[]
  → Mediabunny mux for a probed codec/container pair → Uint8Array[] → Blob → download
  → videoFrame.close()            // exactly once
```

Export constraints:
- Only H.264 and VP9 are attempted; AV1 is not attempted in this tier.
- Audio is muxed if `AudioDecoder`+`AudioEncoder` probes succeed for the matching codec; otherwise the export is video-only and the user is notified.
- GPU effects are not applied; the exported clip is ungraded.
- Unsupported codec/container pairs are disabled before export starts; blob download is a destination fallback, not a fallback for unmuxable encoded chunks.
- The download filename includes a `(limited)` suffix to distinguish from premium exports.
- The existing `ExportProgress` model is reused for progress reporting to the UI.

## Protocol additions

```typescript
// Init accepts an optional SAB for reduced tiers and requires a probe for V2 routing.
interface WorkerInit {
  type: 'init';
  canvas: OffscreenCanvas;
  sab?: SharedArrayBuffer | null;
  audioSab?: SharedArrayBuffer | null;
}

interface WorkerInitV2 extends WorkerInit {
  probeResult: CapabilityProbeResult;
}

// New UI state message
interface CapabilityProbeV2Message {
  type: 'capability-probe-v2';
  result: CapabilityProbeResult;
}
```

The existing `capability-probe` message from Phase 8 remains; the main thread stores the V2 probe immediately after probing, before deciding whether a worker should start. When a worker is started, it echoes `capability-probe-v2` after init so diagnostics can verify that worker state matches the startup probe.

## Diagnostic panel extension

The existing `<CapabilityPanel>` gains a `<CapabilityMatrixPanel>` sub-section. Each row in the matrix:

```
[Feature name]  [chip: ✓ / ✗ / ?]  [Active badge or dash]  [Action link]
```

Example rows:
- `WebGPU standard`  `✗`  `—`  `"Enable hardware acceleration in browser settings"`
- `H.264 encode`  `✓`  `✓ (active)`  `—`
- `SharedArrayBuffer`  `✗`  `—`  `"Serve app with COOP/COEP headers to satisfy one core-tier requirement"` (only shown as an unlock when all other core prerequisites are supported)
- `File System Access`  `✗`  `—`  `"Use Chrome or Edge for direct file saving"`

Panel header shows: tier badge + browser name (from `navigator.userAgent`, display only).

## Export dialog tier overlay

A collapsible "Current tier constraints" section is added to `ExportDialog.tsx`:

- Appears only when the active tier is not `core-webgpu`.
- Lists unavailable codecs with a one-line reason per entry.
- Shows a "Why?" link that opens the diagnostic panel.
- Does not hide unavailable codec options from the picker — they remain visible but disabled with a tooltip.

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/capability-probe-v2.ts` | `probeCapabilities(): Promise<CapabilityProbeResult>`; `deriveCapabilityTierV2()` pure function |
| `src/engine/compatibility/compat-webgpu-preview.ts` | WebGPU compat-mode preview pipeline using `copyExternalImageToTexture`; no `importExternalTexture` |
| `src/engine/compatibility/canvas-compositor.ts` | Canvas2D OffscreenCanvas multi-layer compositor for `limited-webcodecs` tier |
| `src/engine/compatibility/compat-export.ts` | Canvas2D → WebCodecs encode → Mediabunny mux → blob download for `limited-webcodecs` export |
| `src/engine/compatibility/capability-fixtures.ts` | `probeResultFor(tier: CapabilityTierV2): CapabilityProbeResult` factory for tests |
| `src/ui/CapabilityMatrixPanel.tsx` | Per-feature diagnostic rows; imported by existing `CapabilityPanel` |
| `src/ui/ExportDialog.tsx` | Tier constraints section (modified; not replaced) |
| `src/protocol.ts` | `CapabilityTierV2`, `CapabilityProbeResult`, `CodecProbeResult`, `FeatureSupport`, `WorkerInitV2`, `CapabilityProbeV2Message` additions |

## Validation

| Scenario | Expected result |
|----------|----------------|
| Chrome/Edge with COOP/COEP | `core-webgpu`; premium path identical to pre-phase behavior |
| Chrome/Edge without COOP/COEP | `compatibility-webgpu`; GPU preview renders; export limited to probed codecs |
| Chrome with `featureLevel: 'compatibility'` forced | `compatibility-webgpu`; compat pipeline active; status bar shows "GPU (compat)" |
| Safari 17+ with COOP/COEP | `compatibility-webgpu`; GPU preview if adapter available; H.264 export if encoder probes supported |
| Firefox 126+ | `limited-webcodecs`; Canvas2D preview composites; H.264/VP9 export not available (no encoder); effects labeled absent |
| Any browser with no WebGPU and no WebCodecs | `shell-only`; timeline and project tools load; preview and export show unavailability message; no crash |
| Probe throws unexpectedly on one feature | Feature set to `'unknown'`; tier derivation continues with remaining probes; no fatal error |
| `npm run build` and `npm test` | Green; test count grows |
