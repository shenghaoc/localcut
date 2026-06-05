# Tasks: Phase 7 — PWA + Deployment

> Status: **Planned**. Execution order respects dependencies.

## PWA hardening

- [ ] **T1.1** Verify `vite-plugin-pwa` manifest (icons, name, theme/background) and `registerType: 'autoUpdate'`.
- [ ] **T1.2** Confirm `workbox.globPatterns` precaches worker chunk + `wgsl`/`wasm` assets.
- [ ] **T1.3** Offline reload serves full app shell after first load.
- [ ] **T1.4** Optional non-blocking "reload to update" affordance on new SW.

## Cross-origin isolation

- [ ] **T2.1** Confirm `public/_headers` COOP/COEP ship in `dist/` for Cloudflare Pages.
- [ ] **T2.2** Verify `crossOriginIsolated === true` in a production-like preview.
- [ ] **T2.3** Audit for third-party runtime subresources (must be none).

## Deployment

- [ ] **T3.1** Cloudflare Pages project: build `npm run build`, output `dist/`.
- [ ] **T3.2** Document deploy steps in README.

## Verification

- [ ] **T4.1** Lighthouse PWA audit passes.
- [ ] **T4.2** Install + offline reload works after first visit.
- [ ] **T4.3** Production `crossOriginIsolated === true`.
- [ ] **T4.4** `npm run build` green; `sw.js` + `manifest.webmanifest` in `dist/`.
