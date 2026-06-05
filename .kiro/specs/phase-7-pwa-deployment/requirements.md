# Requirements: Phase 7 — PWA + Deployment

## R1 — Installable PWA

- **R1.1** `vite-plugin-pwa` produces a valid manifest + service worker (`registerType: 'autoUpdate'`).
- **R1.2** App is installable on supported desktop browsers.
- **R1.3** Manifest icons (192, 512), name, theme/background colours present.

## R2 — Offline

- **R2.1** Workbox precaches app shell + assets (`js`, `css`, `html`, `wasm`, `wgsl`).
- **R2.2** Fully functional offline after first load (no runtime network dependency).

## R3 — Cross-origin isolation in production

- **R3.1** `public/_headers` serves COOP/COEP on Cloudflare Pages.
- **R3.2** `crossOriginIsolated === true` verified in the deployed environment.
- **R3.3** No third-party runtime subresources that COEP would block.

## R4 — Deployment

- **R4.1** Static `dist/` deploys to Cloudflare Pages.
- **R4.2** Build is reproducible from `npm run build`; lockfile committed.

## R5 — Verification

- **R5.1** Lighthouse PWA audit passes.
- **R5.2** Installable; offline reload works after first visit.
- **R5.3** Production `crossOriginIsolated === true`.
- **R5.4** `npm run build` green; service worker + manifest emitted in `dist/`.
