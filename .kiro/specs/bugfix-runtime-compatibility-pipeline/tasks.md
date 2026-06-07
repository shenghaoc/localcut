# Tasks: Runtime compatibility pipeline and API truth

> Status: **Active**. Tasks map to `bugfix.md` and `design.md`.

## T1 - Spec and protocol

- [x] **T1.1** Add this bugfix spec.
- [x] **T1.2** Add backend readiness and blob-download messages to `src/protocol.ts`.
- [x] **T1.3** Update compatibility readiness flags to reflect implemented reduced paths.

## T2 - Worker backend selection

- [x] **T2.1** Add compatibility WebGPU initialization without optional feature requirements.
- [x] **T2.2** Add Canvas2D backend initialization for `limited-webcodecs`.
- [x] **T2.3** Post accurate backend readiness in `ready`.
- [x] **T2.4** Keep `shell-only` as no-media.

## T3 - Reduced preview rendering

- [x] **T3.1** Implement `CanvasCompatibilityRenderer`.
- [x] **T3.2** Carry title/caption payloads in playback layer metadata.
- [x] **T3.3** Route playback render callbacks to core, compat GPU, or Canvas2D.
- [x] **T3.4** Preserve close-once frame ownership.

## T4 - Reduced export

- [x] **T4.1** Implement `exportTimelineReduced` with `BufferTarget` and optional file handle output.
- [x] **T4.2** Add `export-download-ready` UI handling.
- [x] **T4.3** Allow direct export when `exportReady` is true; keep queue/bundle export core-only.
- [x] **T4.4** Emit reduced-mode warnings for constrained codec/audio behavior.

## T5 - Tests and QA

- [x] **T5.1** Add/adjust unit tests for readiness, renderer close invariants, blob export, and UI gating.
- [x] **T5.2** Run `npm run build`.
- [x] **T5.3** Run `npm test`.
- [x] **T5.4** Run Browser plugin smoke on desktop and mobile-width viewports.

Browser QA note: desktop load, capability panel, Safe Areas interaction, console health,
and mobile-width startup were verified with the Browser plugin. Local file import/export
smoke remains manual because the available Browser API does not expose file upload.
