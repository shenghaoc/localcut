# Tasks: Phase 6 — Pipelined Export

> Status: **Planned**. Execution order respects dependencies.

## Encode + mux

- [ ] **T1.1** `media-io.ts` — Mediabunny `VideoEncoder`/`AudioEncoder` + MP4 mux output.
- [ ] **T1.2** File System Access API output stream (no whole-file buffering).
- [ ] **T1.3** `VideoEncoder.isConfigSupported` probe before first use; actionable error on failure.

## Pipeline

- [ ] **T2.1** `export.ts` — timeline walk feeding decode → effects → encode → mux.
- [ ] **T2.2** Bounded inter-stage queues (3–5 frames).
- [ ] **T2.3** `encodeQueueSize` backpressure; await drain above threshold.
- [ ] **T2.4** Export reads the shared processed texture into a `VideoFrame`; no CPU readback; `.close()` each.

## Presets + ETA

- [ ] **T3.1** `protocol.ts` — `export-start { preset, output }` / `export-cancel` / `export-progress` / `export-complete`.
- [ ] **T3.2** Map Quality/Fast presets to encoder bitrate + preset.
- [ ] **T3.3** ETA from `hardware-probe` fps × preset factor.

## UI

- [ ] **T4.1** `ExportDialog.tsx` — preset toggle, progress bar, ETA, cancel.
- [ ] **T4.2** Plain estimate messaging on sub-real-time hardware.

## Verification

- [ ] **T5.1** Export → open output in VLC / QuickTime / `<video>`; A/V in sync; edits + effects baked.
- [ ] **T5.2** Timestamp queries confirm encoder is the bottleneck.
- [ ] **T5.3** Cancel mid-export leaves no leaked frames; output handle released.
- [ ] **T5.4** `npm run build` and `npm test` green.
