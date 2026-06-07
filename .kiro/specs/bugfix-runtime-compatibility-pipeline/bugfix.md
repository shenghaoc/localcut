# Bugfix - Runtime compatibility pipeline and API truth

> Status: **Active**. This bugfix turns the Phase 26 compatibility foundation into a
> real reduced runtime path, and removes API claims that are stronger than the web
> platform supports.

## Summary

The repository currently passes build/tests and can render the accelerated shell, but
the non-core browser tiers are mostly labels and helper code. That is not enough for
creator users who just need a dependable browser-native path to import, play, make
basic edits, and export. The product must be honest about the browser tier it is
running on and must not expose controls that cannot complete.

The architecture remains unchanged:

- The pipeline worker owns decode, preview, transport-clock writes, and export.
- The main thread stays interactive and does not run sustained media loops.
- The accelerated WebGPU path keeps using the existing zero-copy preview compositor.
- Reduced tiers are explicitly reduced and labeled; they are not feature-parity claims.
- Core editing/export stays client-compute only. No server media processing is added.

## Bugs

### B1 - Reduced tiers are not real editing/export paths

`compatibility-webgpu` and `limited-webcodecs` are routed to `renderer: null` in the
worker, which means imported media cannot use real reduced playback/export. The UI
then has to block transport/export or rely on thumbnail-only fallback behavior.

**Expected:** `compatibility-webgpu` gets a reduced worker-owned WebGPU backend when
the compatibility adapter is available. `limited-webcodecs` gets a worker-owned
Canvas2D/OffscreenCanvas backend. `shell-only` remains no-media.

### B2 - UI gates controls on "accelerated" instead of actual backend readiness

Transport and export are disabled unless the coarse UI tier is `accelerated`, even
when a reduced preview/export backend is available.

**Expected:** controls gate on worker-reported `previewReady` and `exportReady`.
Labels explain whether the backend is accelerated, GPU compatibility, limited
WebCodecs, or shell only.

### B3 - Export assumes File System Access and accelerated WebGPU

Direct export requires a `FileSystemFileHandle` and a `PreviewRenderer`. Reduced
tiers and browsers without `showSaveFilePicker` need an in-memory blob download path.

**Expected:** direct accelerated export preserves the file-handle path. Reduced
export can write to a memory target and send an `export-download-ready` message for
the UI to download.

### B4 - Title/caption layers are GPU-texture-only during playback

Playback metadata only carries a title texture id. That works for the accelerated
GPU texture cache but gives Canvas2D no title payload to rasterize.

**Expected:** layer metadata carries the title/caption payload. The accelerated path
continues to read cached GPU textures; the reduced path rasterizes the payload into
a worker canvas.

### B5 - API documentation overclaims direct GPU texture export

The current export capture uses `new VideoFrame(OffscreenCanvas, ...)`, which is a
valid WebCodecs constructor source. It is not a standardized direct
`GPUTexture -> VideoFrame` API.

**Expected:** docs/spec copy describe the standard path honestly and keep the
strong no-CPU-readback claim limited to the accelerated preview hot path.

## Acceptance criteria

- `ready` reports `previewBackend`, `exportBackend`, `previewReady`, and `exportReady`.
- Core Chromium sessions continue to use the existing accelerated renderer.
- Compatibility WebGPU sessions request the compatibility adapter and run a reduced
  GPU backend without requiring optional features such as `shader-f16`.
- Limited WebCodecs sessions render preview frames in the worker with Canvas2D and
  can export through a constrained WebCodecs/Mediabunny blob path.
- Shell-only sessions do not expose import/play/export as working media controls.
- Every `VideoFrame`/decoded frame/ImageBitmap owned by the reduced paths is closed
  exactly once on success, cancellation, and error paths.
- `npm run build`, `npm test`, and a Browser plugin smoke pass.
