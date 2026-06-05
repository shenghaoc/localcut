# Design: Phase 7 — PWA + Deployment

> Status: **Planned**.

## Goal

Ship the editor as an installable, fully-offline PWA on Cloudflare Pages, with COOP/COEP preserved in production so `crossOriginIsolated` (and therefore the SAB clock) keeps working.

## PWA (already scaffolded in Phase 1)

- `vite-plugin-pwa` is configured (`registerType: 'autoUpdate'`, manifest, `workbox.globPatterns` including `wgsl`/`wasm`). Phase 7 hardens and verifies it.
- Confirm precache covers the worker chunk and shader assets; offline reload serves the full app shell.
- Update-flow: autoUpdate registers the new service worker; surface a non-blocking "reload to update" affordance if needed.

## Cross-origin isolation in production

```
public/_headers (Cloudflare Pages):
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
```

- These headers are load-bearing — without them `SharedArrayBuffer` and the clock architecture fail.
- No third-party runtime subresources (would otherwise need CORP/CORS under COEP).

## Deployment

- Static `dist/` → Cloudflare Pages; build command `npm run build`, output dir `dist/`.
- No server runtime, env secrets, or functions — pure static hosting.

## Verification

- Lighthouse PWA audit passes.
- Installable on supported desktop browsers; offline after first load.
- Deployed `crossOriginIsolated === true`.
- `dist/` contains `sw.js`, `manifest.webmanifest`, and precached assets.

## Acceptance

- Installable; fully offline after first load.
- `crossOriginIsolated === true` in production.
- Lighthouse PWA audit passes.
