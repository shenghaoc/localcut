# Requirements: Phase 17 — Export Expansion

## R1 — Probed Codec Choice

- **R1.1** Export offers H.264, VP9, and AV1 with matching containers, filtered by `VideoEncoder.isConfigSupported` probing at dialog-open; unsupported combinations are hidden, never offered to fail.
- **R1.2** Containers map from codec — H.264 to MP4, VP9/AV1 to WebM — through Mediabunny's output formats.

## R2 — Output Overrides

- **R2.1** An `ExportSettings` object (codec, container, width/height, fps, bitrate, range) replaces the bare preset; presets remain as one-click defaults that fill settings.
- **R2.2** Export size derivation honours overrides instead of the fixed source-capped resolution.

## R3 — Range Export

- **R3.1** In/out points define the exported span; the video interleave loop and the audio window clamp to the range.
- **R3.2** Output timestamps re-base to zero so the file starts at the range start.

## R4 — Settings Persistence + ETA

- **R4.1** Last-used export settings persist via the Phase 9 project document.
- **R4.2** ETA derivation accounts for the chosen codec and settings.

## R5 — Tests

- **R5.1** Unit-test support-filtered option lists from mocked probe results.
- **R5.2** Unit-test range frame-bounds math and timestamp re-basing.
- **R5.3** Unit-test the parameterized export plan against overrides.
