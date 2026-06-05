# Tasks: Phase 1 — Scaffolding + File Import

> Status: **Completed**.

## Scaffolding

- [x] **T1.1** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`.
- [x] **T1.2** SolidJS app shell: `App`, `Toolbar`, `Timeline`, `Inspector`, `PreviewCanvas`.
- [x] **T1.3** Dark professional CSS in `src/global.css`.
- [x] **T1.4** PWA manifest icons and `vite-plugin-pwa` config.

## Isolation & worker

- [x] **T2.1** `public/_headers` COOP/COEP.
- [x] **T2.2** Vite dev/preview header parity.
- [x] **T2.3** `src/protocol.ts` — commands, state messages, `assertCrossOriginIsolated`.
- [x] **T2.4** `src/engine/worker.ts` — init, import, play/pause/seek stubs, dispose.
- [x] **T2.5** `createSharedClock()` + `worker-bridge.ts`.
- [x] **T2.6** `PreviewCanvas` offscreen transfer.

## Import

- [x] **T3.1** `src/engine/media-io.ts` — Mediabunny metadata via `BlobSource`.
- [x] **T3.2** File picker + drag-and-drop in `App.tsx`.
- [x] **T3.3** Inspector metadata display.

## Verification

- [x] **T4.1** `npm run build` green.
- [x] **T4.2** Vitest timeline stub test.
