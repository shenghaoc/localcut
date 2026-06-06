# Design: Phase 17 — Export Expansion

> Status: **Complete** — probed codec choice, output overrides, and range export; never offer an option the browser can't encode.

## Goal

Parameterize the export pipeline beyond fixed H.264+AAC at source-capped resolution: a probed codec/container matrix, resolution/fps/bitrate overrides, and in/out range export — all client-side and feature-detected.

## Settings + probing

```
ExportSettings { codec: 'h264' | 'vp9' | 'av1', container: 'mp4' | 'webm',
                 width, height, fps, videoBitrate, range?: { startS, endS } }
```

- `probeExportCodecs()` runs `VideoEncoder.isConfigSupported` across the candidate matrix when the dialog opens — a bounded probe in the spirit of the existing throughput probe; unsupported combinations are hidden, not failed.
- Container maps from codec: H.264 → MP4 (`Mp4OutputFormat`), VP9/AV1 → WebM via Mediabunny's output formats.

## Pipeline changes (`src/engine/export.ts`)

- `buildExportPlan(settings)` replaces the bare preset; size derivation becomes override-aware; presets remain quick defaults that fill a settings object.
- The encoder-support assertions and the video/audio sample-source configs parameterize on the chosen codec.
- Range export: the interleave loop runs `startFrame..endFrame`, the audio window mirrors it, and output timestamps re-base to zero — timeline resolution already takes absolute times, so only loop bounds change.
- ETA derivation re-computes for the chosen codec and settings; last-used settings persist via Phase 9.

## Protocol + UI

- The `export-start` payload becomes `{ settings: ExportSettings }`; a new `export-codecs { supported }` state answers dialog-open probing.
- `src/ui/ExportDialog.tsx` grows codec/resolution/fps/bitrate/range controls populated from the probe; presets stay as one-click defaults.

## Validation

- Unit tests: support-filtered option lists, range frame-bounds + timestamp re-base math, parameterized plan output.
- Manual: export VP9/WebM (and AV1 where supported); export a mid-timeline range and verify duration and first-frame timestamps; unsupported codecs never appear in the dialog.
