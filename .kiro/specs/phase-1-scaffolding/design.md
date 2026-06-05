# Design: Phase 1 — Scaffolding + File Import

> Status: **Completed** (PR #1).

## Goal

Establish the performance-oriented threading skeleton before any decode/render work. Prove COOP/COEP, worker transfer, SAB clock, and Mediabunny metadata import.

## Delivered Architecture

- Vite + SolidJS + TypeScript strict; `vite-plugin-pwa` configured.
- `public/_headers` + Vite dev/preview COOP/COEP headers.
- `src/engine/worker.ts` — pipeline worker entry; WebGPU device init stub; command dispatch.
- `PreviewCanvas` — `transferControlToOffscreen()` once; main never touches canvas again.
- `createSharedClock()` — rAF poll of `Float64Array` SAB; scrubhead driven without per-frame messages.
- `openMediaFile()` — Mediabunny `BlobSource` + `[MP4, QTFF, WEBM]`; metadata to inspector.
- Import UX — File System Access API, file input fallback, drag-and-drop.

## Out of Scope (deferred to Phase 2)

- Video decode and frame presentation
- Playback loop and seek-to-frame
- Adaptive preview resolution and throughput probe
