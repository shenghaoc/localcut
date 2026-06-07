# Requirements: Phase 22 — Captions + Subtitle Tracks

## R1 — Structured caption tracks

- **R1.1** The timeline supports a dedicated `kind: 'caption'` track type that stores structured timed text, not raster payloads or per-frame overlays.
- **R1.2** Caption data is represented as `CaptionTrack` containing ordered `CaptionSegment` items with stable ids, `start`, `duration`, `text`, and optional per-segment style overrides.
- **R1.3** Caption tracks serialize into the project document and survive Phase 9 persistence, undo/redo, import/export, and relink flows.
- **R1.4** Caption tracks are independent of title clips; malformed or missing caption data must never block video/audio/timeline editing outside the affected track.

## R2 — Import and parser recovery

- **R2.1** The editor imports SRT and WebVTT into `CaptionImportResult`, preserving segment order, text content, timing, and recoverable parser diagnostics.
- **R2.2** Parser modules for SRT and WebVTT recover from malformed cues where possible: skip or repair the bad cue, keep the rest of the file, and surface diagnostics to the UI.
- **R2.3** Import runs in bounded worker-side work; large caption files must not introduce sustained main-thread parsing or reconciliation loops.
- **R2.4** Imported caption tracks default to non-burned sidecar mode until the user enables burn-in styling/export behavior.

## R3 — Sidecar export without video re-export

- **R3.1** The editor exports caption tracks as SRT and WebVTT sidecar files from timeline text/timing data without invoking the video export pipeline.
- **R3.2** `CaptionExportSettings` lets the user choose source track, output formats, naming, and whether to export the active edit range or the full caption track.
- **R3.3** Sidecar export remains available when the project has no pending video export and does not require recompositing media.

## R4 — Burn-in captions reuse the title path

- **R4.1** Burn-in captions reuse the Phase 14 title raster cache and style model wherever possible; the editor must not introduce a second text rendering stack for caption overlays.
- **R4.2** Caption burn-in enters the same preview/export compositor path as title textures and video layers, preserving preview/export parity.
- **R4.3** Caption rasterization happens only on caption text/style/layout changes or when the active caption segment changes, never as a per-frame Canvas2D path.

## R5 — Editing model and transcript panel

- **R5.1** The UI provides a transcript-style editing panel for caption text, timing, speaker/label metadata if added later, import diagnostics, and segment selection.
- **R5.2** The transcript panel keeps transient UI state on main, but the authoritative caption timeline state lives in the worker and commits through typed commands like other timeline mutations.
- **R5.3** Users can split, merge, trim, retime, move, multi-select, and delete caption segments with undo/redo support.
- **R5.4** Caption edits snap to clips, playhead, markers, neighboring caption boundaries, and the current selection edges using the existing timeline snapping grammar.

## R6 — Styling and inheritance

- **R6.1** `CaptionStyle` is compatible with the Phase 14 title style model and supports preset-based inheritance instead of duplicating a separate styling schema.
- **R6.2** Caption tracks can choose a style preset as the default; segments may override only the fields that differ.
- **R6.3** Styling supports common caption controls needed for sidecar preview and burn-in parity: font family, size, weight, foreground, background, outline, shadow, alignment, safe-area anchoring, and max line width/wrapping policy.

## R7 — Parity and resilience

- **R7.1** Caption timing and styling produce the same visible burn-in result in preview and video export for a given range, capability tier permitting.
- **R7.2** Parser errors, unsupported metadata blocks, or invalid timecodes surface actionable diagnostics and degraded import results, not crashes or blocked sessions.
- **R7.3** Limited or non-isolated capability tiers may disable burn-in preview/export if needed, but sidecar import/edit/export must continue to work.

## R8 — Tests

- **R8.1** Unit-test SRT parse/serialize.
- **R8.2** Unit-test WebVTT parse/serialize.
- **R8.3** Unit-test malformed caption recovery and diagnostic reporting.
- **R8.4** Integration-test import captions → edit text/timing → sidecar export.
- **R8.5** Integration-test burn-in preview/export parity through the shared compositor path.

## Acceptance Criteria

- Importing a mixed-quality `.srt` or `.vtt` file produces a usable caption track plus diagnostics instead of a fatal error.
- Exporting SRT/WebVTT sidecars works without running video encode/mux.
- Enabling burn-in captions reuses the title raster/GPU composite path and yields matching preview/export output.
- Caption edits remain undoable, snappable, and worker-authoritative.
- `npm run build` and `npm test` are expected to stay green when implementation lands.
