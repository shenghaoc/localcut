# Design: Runtime compatibility pipeline and API truth

## D1 - Backend readiness contract

Extend `src/protocol.ts` with:

```ts
type PreviewBackend = 'core-webgpu' | 'compat-webgpu' | 'canvas2d' | 'none';
type ExportBackend = 'core-webgpu' | 'compat-webgpu' | 'canvas2d' | 'none';
```

The worker `ready` message includes `previewBackend`, `exportBackend`,
`previewReady`, and `exportReady`. UI controls consume those fields instead of
inferring readiness from the coarse UI tier.

## D2 - Worker backend selection

`handleInit` selects one backend from the Phase 26 probe result:

- `core-webgpu`: existing `initGpu(canvas)` and `PreviewRenderer`.
- `compatibility-webgpu`: compatibility WebGPU initialization with no optional
  feature requirements. It reuses the existing compositor in a reduced f32 mode.
- `limited-webcodecs`: `CanvasCompatibilityRenderer` on the transferred
  `OffscreenCanvas`.
- `shell-only`: no renderer, no media backend.

The accelerated path is unchanged. Reduced paths still run in the dedicated worker.

## D3 - Canvas2D reduced renderer

`src/engine/compatibility/canvas-compositor.ts` owns the Canvas2D backend:

- Draws decoded `VideoFrame` layers synchronously before playback closes them.
- Applies fit/fill/letterbox, position, scale, rotation, anchor, and opacity using
  the same transform model as the GPU path.
- Rasterizes title/caption payloads with the existing title rasterizer.
- Captures export frames with `new VideoFrame(OffscreenCanvas, { timestamp, duration })`.
- Never calls `getImageData` and never moves media loops to the main thread.

## D4 - Reduced export

`src/engine/compatibility/compat-export.ts` adds `exportTimelineReduced`:

- Reuses the existing export plan, range, audio mix, progress, and codec helpers
  where possible.
- Supports only H.264/MP4 and VP9/WebM based on probed support.
- Uses `BufferTarget` for blob-download export and preserves direct file-handle
  output when a handle is available.
- Applies `waitForEncodeQueue` backpressure before adding video samples.
- Emits a reduced-mode warning when audio must be omitted by browser constraints.

## D5 - UI wiring and labels

`App.tsx` stores worker backend readiness and computes:

- `previewSurfaceAvailable()`
- `exportSurfaceAvailable()`
- `pipelineLabel()`

Toolbar transport, keyboard playback, export dialog availability, status copy, and
capability messaging use those values. Bundle/render-queue export remains core-only
because it depends on file/directory handles and the accelerated export contract.

## D6 - API truth in docs

Update Phase 26/stability wording where it implies compatibility preview/export are
still intentionally disabled or that export is direct `GPUTexture -> VideoFrame`.
The documented truth is:

- `GPUDevice.importExternalTexture({ source: VideoFrame })` is the accelerated
  preview input path and the external texture expires when the frame closes.
- `new VideoFrame(OffscreenCanvas, ...)` is the standardized export capture used by
  both accelerated and reduced renderers.
- Codec support is per codec; constructor presence is not enough.
