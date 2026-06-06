# Tasks: Phase 22 — Captions + Subtitle Tracks

> Status: **Planned**. Timed-text model first, parser/export second, transcript/timeline UI third, burn-in compositor reuse last.

## Data model and protocol

- [ ] **T1.1** Add `CaptionTrack`, `CaptionSegment`, `CaptionStyle`, `CaptionImportResult`, and `CaptionExportSettings` types in engine/protocol modules.
- [ ] **T1.2** Extend the timeline/project schema with caption tracks and additive defaults for persistence, undo/redo, and snapshot broadcast.
- [ ] **T1.3** Add typed worker commands and state messages for caption import, export, segment editing, styling, and burn-in toggles.

## Parser and serializer modules

- [ ] **T2.1** Add `src/engine/captions/srt.ts` with parse/serialize support and normalized diagnostics.
- [ ] **T2.2** Add `src/engine/captions/webvtt.ts` with parse/serialize support and normalized diagnostics.
- [ ] **T2.3** Add `src/engine/captions/import.ts` format sniffing and recoverable import behavior that preserves valid cues when some are malformed.
- [ ] **T2.4** Add `src/engine/captions/export.ts` for sidecar generation by track and optional range without invoking video export.

## Caption timeline operations

- [ ] **T3.1** Add pure timeline operations for split, merge, trim, move/retime, delete, and segment text/style updates.
- [ ] **T3.2** Reuse Phase 10 snapping primitives so caption segments snap to clips, playhead, markers, neighboring segments, and selection edges.
- [ ] **T3.3** Add worker command handlers that keep caption edits atomic and undoable.

## Transcript panel and timeline UI

- [ ] **T4.1** Add a transcript-style panel for caption rows, text editing, diagnostics, selection, and timing controls.
- [ ] **T4.2** Add caption-lane timeline rendering with move/trim/split/merge affordances and keyboard-accessible equivalents.
- [ ] **T4.3** Keep main-thread transcript state transient only; commit text/timing changes through typed worker commands.

## Style inheritance and presets

- [ ] **T5.1** Reuse the Phase 14 title style model as the base caption preset schema instead of creating a parallel style stack.
- [ ] **T5.2** Add caption track default presets plus per-segment overrides with clear inheritance resolution.
- [ ] **T5.3** Expose burn-in toggle, style preset selection, and override controls in the Inspector.

## Burn-in compositor reuse

- [ ] **T6.1** Add caption-to-title render adaptation so active caption segments raster through the existing Phase 14 title cache path.
- [ ] **T6.2** Include burned-in caption textures in the same preview/export layer resolve used by titles and transformed overlays.
- [ ] **T6.3** Ensure cache invalidation keys cover active segment identity, text, and resolved style fields; no per-frame raster path is introduced.

## Sidecar export UX

- [ ] **T7.1** Add UI for exporting SRT/WebVTT sidecars by caption track and optional timeline range.
- [ ] **T7.2** Ensure sidecar export works with no video export job and no media recomposition.

## Tests

- [ ] **T8.1** Unit-test SRT parse/serialize, including multiline cues and timestamp normalization.
- [ ] **T8.2** Unit-test WebVTT parse/serialize, including headers, cue ids, and supported setting recovery.
- [ ] **T8.3** Unit-test malformed caption recovery and diagnostic aggregation.
- [ ] **T8.4** Integration-test import captions → edit text/timing → sidecar export.
- [ ] **T8.5** Integration-test burn-in preview/export parity through the shared compositor path.

## Verification

- [ ] **T9.1** Manual: import SRT and WebVTT files with both clean and malformed cues; confirm the transcript panel shows usable segments plus diagnostics.
- [ ] **T9.2** Manual: split, merge, trim, retime, and snap caption segments against clips, markers, and playhead; verify undo/redo.
- [ ] **T9.3** Manual: enable burn-in, compare preview versus export output for the same range, and confirm sidecar export still works independently.
- [ ] **T9.4** `npm run build` and `npm test` green; test count grows.

## Acceptance Criteria

- A user can import SRT/WebVTT into a caption track, repair timing/text, and export sidecars without touching video export.
- Burned-in captions reuse the title raster cache and the shared compositor path.
- Caption timeline edits are worker-authoritative, undoable, and snap correctly to existing timeline anchors.
- Malformed cues degrade gracefully into diagnostics and partial recovery instead of blocking the editor.
- Preview and export remain visually consistent for burned-in captions.
