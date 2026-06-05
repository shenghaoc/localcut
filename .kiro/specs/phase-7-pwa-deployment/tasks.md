# Tasks: Phase 7 — PWA + Deployment

> Status: **Completed**. Execution order respects dependencies.

## PWA hardening

- [x] **T1.1** Verify `vite-plugin-pwa` manifest (icons, name, theme/background) and `registerType: 'prompt'`.
- [x] **T1.2** Confirm `workbox.globPatterns` precaches worker chunk + `wgsl`/`wasm` assets.
- [x] **T1.3** Offline reload serves full app shell after first load.
- [x] **T1.4** Optional non-blocking "reload to update" affordance on new SW.

## Cross-origin isolation

- [x] **T2.1** Confirm `public/_headers` COOP/COEP ship in `dist/` for Cloudflare Pages.
- [x] **T2.2** Verify `crossOriginIsolated === true` in a production-like preview.
- [x] **T2.3** Audit for third-party runtime subresources (must be none).

## Deployment

- [x] **T3.1** Cloudflare Pages project: build `npm run build`, output `dist/`.
- [x] **T3.2** Document deploy steps in README.

## Verification

- [x] **T4.1** Lighthouse PWA audit passes.
- [x] **T4.2** Install + offline reload works after first visit.
- [x] **T4.3** Production `crossOriginIsolated === true`.
- [x] **T4.4** `npm run build` green; `sw.js` + `manifest.webmanifest` in `dist/`.
