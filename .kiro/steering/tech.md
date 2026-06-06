# Technology Stack & Constraints

## Core Stack

- **Runtime**: Modern desktop browser with progressive capability tiers. Chromium with WebCodecs + WebGPU + SAB is the full-performance target; other browsers may run reduced client-side workflows when feature detection supports them.
- **Frontend**: SolidJS (no meta-framework) + Vite + `vite-plugin-solid`.
- **Language**: TypeScript strict mode throughout.
- **Package manager**: **npm only** (`packageManager` in `package.json`; `package-lock.json` lockfile).
- **Media I/O**: Mediabunny (latest) — tree-shaken MP4/QTFF/WebM demux/mux + WebCodecs abstractions.
- **GPU**: WebGPU compute shaders for accelerated effects and preview; future compatibility preview paths may use lower-resolution Canvas/WebGL/WebCodecs combinations when clearly labeled.
- **Audio**: Web Audio API + AudioWorklet (Phase 5).
- **Files**: File System Access API with drag-and-drop fallback.
- **PWA**: `vite-plugin-pwa` — offline installable static app.
- **Deploy**: Cloudflare static hosting for `dist/` (Pages or Workers Static Assets). Do not depend on paid server compute for media processing.

## Hard Constraints

1. **crossOriginIsolated** — `SharedArrayBuffer` requires COOP/COEP. Headers in `public/_headers` and Vite `server`/`preview` config. Gate accelerated features when false, but keep the editor shell alive with a clear limited-mode explanation.
2. **Client-side media compute only** — decode, effects, preview, audio, and export run in the user's browser. Cloudflare hosts the app and headers; it does not process user media.
3. **Main thread responsiveness** — no sustained decode, encode, mux, GPU, or pixel-processing loops on main. Bounded probes and UI-only compatibility helpers are allowed when measured.
4. **Pipeline worker** — `src/engine/worker.ts` owns the accelerated WebGPU/OffscreenCanvas/Mediabunny path and authoritative timeline operations.
5. **Mediabunny imports** — use `BlobSource` for lazy disk reads; never buffer whole files in memory.
6. **WGSL shaders** — `assetsInclude: ['**/*.wgsl']` in Vite; f16 variants gated on `shader-f16` device feature.
7. **Build target** — `esnext`; ES module workers (`worker: { format: 'es' }`).

## Optional Runtime Features (feature-detect, never assume)

- `shader-f16` — half-precision colour-grade shaders with f32 fallback
- `subgroups` — warp-level reductions with shared-memory fallback
- `timestamp-query` — GPU profiling (dev/diagnostics)
- `SharedArrayBuffer` / cross-origin isolation — accelerated clock and audio buffers
- File System Access API — best save/open UX; provide drag/drop and future download fallbacks
- WebGPU — accelerated effects/preview; future limited modes must feature-detect alternatives

## Vite COOP/COEP (required for full-performance tier)

```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

`public/_headers` must mirror the same for Cloudflare static production hosting.
