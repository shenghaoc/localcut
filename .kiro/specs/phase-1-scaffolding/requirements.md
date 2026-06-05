# Requirements: Phase 1 — Scaffolding + File Import

## R1 — Project scaffolding

- **R1.1** Vite + SolidJS + TypeScript strict; npm lockfile only.
- **R1.2** Single-page layout with placeholder panels (preview, timeline, inspector, toolbar).
- **R1.3** `vite-plugin-pwa` manifest and service worker configured.

## R2 — Cross-origin isolation

- **R2.1** `public/_headers` sets COOP `same-origin` and COEP `require-corp`.
- **R2.2** Vite `server` and `preview` send the same headers.
- **R2.3** `assertCrossOriginIsolated()` on main thread and in worker; fatal banner if false.

## R3 — Pipeline worker skeleton

- **R3.1** ES module worker (`worker: { format: 'es' }`).
- **R3.2** OffscreenCanvas transferred from main on mount.
- **R3.3** Typed command/state protocol in `src/protocol.ts`.
- **R3.4** SharedArrayBuffer clock buffer allocated on main, passed in `init` command.

## R4 — File import

- **R4.1** File System Access API with drag-and-drop and `<input type="file">` fallback.
- **R4.2** Mediabunny lazy `BlobSource` read — never buffer whole file.
- **R4.3** Metadata extracted: duration, resolution, codecs, track count, decodability.
- **R4.4** Metadata displayed in inspector; duration written to SAB.

## R5 — Verification

- **R5.1** `npm run build` and `npm test` pass.
- **R5.2** Status bar shows `crossOriginIsolated` when headers active.
