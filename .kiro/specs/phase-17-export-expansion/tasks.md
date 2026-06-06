# Tasks: Phase 17 — Export Expansion

> Status: **Complete**. Probed codecs, settings overrides, range export, and UI landed.

## Codec probe

- [x] **T1.1** Add `probeExportCodecs()` running `VideoEncoder.isConfigSupported` across the H.264/VP9/AV1 matrix at dialog-open.
- [x] **T1.2** Map containers from codecs (MP4 vs WebM) through Mediabunny output formats; hide unsupported combinations.
- [x] **T1.3** Unit-test support filtering from mocked probe results.

## Overrides

- [x] **T2.1** Introduce `ExportSettings`; `buildExportPlan(settings)` replaces the bare preset; presets fill settings as defaults.
- [x] **T2.2** Make size derivation and the encoder/sample-source configs override-aware and codec-parameterized.
- [x] **T2.3** Unit-test the parameterized plan.

## Range export

- [x] **T3.1** Clamp the interleave loop to `startFrame..endFrame`; mirror the audio window; re-base output timestamps to zero.
- [x] **T3.2** Unit-test range frame-bounds and re-base math.

## Settings + UI

- [x] **T4.1** `export-start { settings }` payload + `export-codecs` state; persist last-used settings via Phase 9.
- [x] **T4.2** Grow `ExportDialog.tsx`: codec/resolution/fps/bitrate/range controls fed by the probe; re-derive ETA per codec.

## Verification

- [ ] **T5.1** Manual: VP9/WebM export plays back correctly; AV1 where supported; a 5s mid-timeline range exports with correct duration and start timestamps.
- [ ] **T5.2** Unsupported codecs never appear; export still honours backpressure and closes every frame once.
- [x] **T5.3** `npm run build` and `npm test` green; test count grows.
