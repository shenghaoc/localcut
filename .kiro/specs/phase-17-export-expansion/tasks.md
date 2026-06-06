# Tasks: Phase 17 — Export Expansion

> Status: **Planned**. Settings object + probe first; range export and UI follow.

## Codec probe

- [ ] **T1.1** Add `probeExportCodecs()` running `VideoEncoder.isConfigSupported` across the H.264/VP9/AV1 matrix at dialog-open.
- [ ] **T1.2** Map containers from codecs (MP4 vs WebM) through Mediabunny output formats; hide unsupported combinations.
- [ ] **T1.3** Unit-test support filtering from mocked probe results.

## Overrides

- [ ] **T2.1** Introduce `ExportSettings`; `buildExportPlan(settings)` replaces the bare preset; presets fill settings as defaults.
- [ ] **T2.2** Make size derivation and the encoder/sample-source configs override-aware and codec-parameterized.
- [ ] **T2.3** Unit-test the parameterized plan.

## Range export

- [ ] **T3.1** Clamp the interleave loop to `startFrame..endFrame`; mirror the audio window; re-base output timestamps to zero.
- [ ] **T3.2** Unit-test range frame-bounds and re-base math.

## Settings + UI

- [ ] **T4.1** `export-start { settings }` payload + `export-codecs` state; persist last-used settings via Phase 9.
- [ ] **T4.2** Grow `ExportDialog.tsx`: codec/resolution/fps/bitrate/range controls fed by the probe; re-derive ETA per codec.

## Verification

- [ ] **T5.1** Manual: VP9/WebM export plays back correctly; AV1 where supported; a 5s mid-timeline range exports with correct duration and start timestamps.
- [ ] **T5.2** Unsupported codecs never appear; export still honours backpressure and closes every frame once.
- [ ] **T5.3** `npm run build` and `npm test` green; test count grows.
