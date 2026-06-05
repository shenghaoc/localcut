# Requirements: Phase 2 — Zero-Copy Preview

## R1 — Decode in worker

- **R1.1** Video decode via Mediabunny/WebCodecs entirely in pipeline worker.
- **R1.2** `Input` retained across playback; disposed on re-import or worker dispose.
- **R1.3** Every decoded `VideoFrame` closed after use.

## R2 — Zero-copy WebGPU preview

- **R2.1** `importExternalTexture` per frame within the same command submission as sampling.
- **R2.2** Present processed output to OffscreenCanvas via WebGPU — not Canvas2D.
- **R2.3** Main thread never receives `VideoFrame` or GPU textures.

## R3 — Transport

- **R3.1** Play/pause/seek commands drive `playback.ts` loop.
- **R3.2** Worker writes `currentTime` to SAB each frame; main scrubhead follows.
- **R3.3** Seek decodes from nearest preceding keyframe.
- **R3.4** Frame-step forward/back one frame.

## R4 — Adaptive preview

- **R4.1** Measure per-frame decode + render budget.
- **R4.2** Auto-drop preview to 720p or 540p when budget exceeded; export config stays full resolution.
- **R4.3** Visible preview resolution indicator in UI.

## R5 — Throughput probe

- **R5.1** On first file import, silently encode ~2s of test frames.
- **R5.2** Store encode throughput (fps) for session; expose to main for future ETA (Phase 6).

## R6 — Verification

- **R6.1** `crossOriginIsolated` remains true.
- **R6.2** Dev-mode frame leak detector warns on stale open frames.
- **R6.3** Unit tests for seek/keyframe logic where mockable.
