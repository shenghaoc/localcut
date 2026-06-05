# Technology Stack & Constraints

## Core Stack

- **Runtime**: Modern Chromium desktop browser (WebCodecs + WebGPU required for full functionality).
- **Frontend**: SolidJS (no meta-framework) + Vite + `vite-plugin-solid`.
- **Language**: TypeScript strict mode throughout.
- **Package manager**: **npm only** (`packageManager` in `package.json`; `package-lock.json` lockfile).
- **Media I/O**: Mediabunny (latest) — tree-shaken MP4/QTFF/WebM demux/mux + WebCodecs abstractions.
- **GPU**: WebGPU compute shaders for effects; render pipeline for preview.
- **Audio**: Web Audio API + AudioWorklet (Phase 5).
- **Files**: File System Access API with drag-and-drop fallback.
- **PWA**: `vite-plugin-pwa` — offline installable static app.
- **Deploy**: Cloudflare Pages (`dist/`).

## Hard Constraints

1. **crossOriginIsolated** — `SharedArrayBuffer` requires COOP/COEP. Headers in `public/_headers` and Vite `server`/`preview` config. Gate on startup in main thread and worker; surface clear errors if false.
2. **Main thread** — SolidJS UI only. No `VideoFrame`, WebGPU device, decoders, or encoders on main.
3. **Pipeline worker** — `src/engine/worker.ts` owns WebGPU, OffscreenCanvas, Mediabunny, timeline (authoritative), playback, export.
4. **Mediabunny imports** — use `BlobSource` for lazy disk reads; never buffer whole files in memory.
5. **WGSL shaders** — `assetsInclude: ['**/*.wgsl']` in Vite; f16 variants gated on `shader-f16` device feature.
6. **Build target** — `esnext`; ES module workers (`worker: { format: 'es' }`).

## Optional Runtime Features (feature-detect, never assume)

- `shader-f16` — half-precision colour-grade shaders with f32 fallback
- `subgroups` — warp-level reductions with shared-memory fallback
- `timestamp-query` — GPU profiling (dev/diagnostics)

## Vite COOP/COEP (required)

```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

`public/_headers` must mirror the same for Cloudflare Pages production.
