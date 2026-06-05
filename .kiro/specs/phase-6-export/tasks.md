# Tasks: Phase 6 — Pipelined Export

> Status: **Planned**. Execution order respects dependencies.

## Encode + mux

- [x] **T1.1** Mediabunny `VideoSampleSource`/`AudioSampleSource` + MP4 mux output.
- [x] **T1.2** File System Access API output stream (no whole-file buffering).
- [x] **T1.3** `VideoEncoder.isConfigSupported` / `AudioEncoder.isConfigSupported` probe before first use; actionable error on failure.

## Pipeline

- [x] **T2.1** `export.ts` — timeline walk feeding decode → effects → encode → mux.
- [x] **T2.2** Bounded inter-stage queues (3–5 frames).
- [x] **T2.3** `encodeQueueSize` backpressure via awaited Mediabunny sample sources.
- [x] **T2.4** Export reads the shared processed texture into a `VideoFrame`; no CPU readback; `.close()` each.

## Presets + ETA

- [x] **T3.1** `protocol.ts` — `export-start { preset, output }` / `export-cancel` / `export-progress` / `export-complete`.
- [x] **T3.2** Map Quality/Fast presets to encoder bitrate + preset.
- [x] **T3.3** ETA from `hardware-probe` fps × preset factor.

## UI

- [x] **T4.1** `ExportDialog.tsx` — preset toggle, progress bar, ETA, cancel.
- [x] **T4.2** Plain estimate messaging on sub-real-time hardware.

## Verification

- [ ] **T5.1** Export → open output in VLC / QuickTime / `<video>`; A/V in sync; edits + effects baked.
- [ ] **T5.2** Timestamp queries confirm encoder is the bottleneck.
- [ ] **T5.3** Cancel mid-export leaves no leaked frames; output handle released.
- [x] **T5.4** `npm run build` and `npm test` green.
