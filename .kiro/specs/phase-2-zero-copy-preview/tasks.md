# Tasks: Phase 2 — Zero-Copy Preview

> Status: **Active**. Execution order respects dependencies.

## GPU passthrough

- [ ] **T1.1** `shaders/passthrough.wgsl` — sample external texture to storage/output.
- [ ] **T1.2** `gpu.ts` — ping-pong storage textures, passthrough pipeline compile, present to canvas.
- [ ] **T1.3** Per-frame: import → compute → submit → present; verify single submission (timestamp queries if available).

## Decode + playback

- [ ] **T2.1** Extend `media-io.ts` — decode path returning `VideoFrame` at timestamp.
- [ ] **T2.2** `playback.ts` — worker loop; play/pause/seek; SAB clock writes.
- [ ] **T2.3** Keyframe seek + frame-step commands wired in `worker.ts`.
- [ ] **T2.4** Dev frame leak tracker (warn if open > 1 frame period).

## Adaptive preview

- [ ] **T3.1** Per-frame timing measurement in playback loop.
- [ ] **T3.2** Preview resolution downgrade logic (1080p → 720p → 540p).
- [ ] **T3.3** UI preview resolution badge in toolbar or status bar.

## Throughput probe

- [ ] **T4.1** `hardware-probe.ts` — silent encode burst on first import.
- [ ] **T4.2** Session-persisted encode fps estimate; message to main thread.

## Verification

- [ ] **T5.1** Manual: import MP4, play, pause, seek, frame-step — preview updates, scrubhead syncs.
- [ ] **T5.2** `npm run build` and `npm test` green.
- [ ] **T5.3** No Canvas2D or `getImageData` in `src/engine/` hot path (grep audit).
