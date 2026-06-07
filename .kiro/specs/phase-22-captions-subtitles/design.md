# Design: Phase 22 — Captions + Subtitle Tracks

> Status: **Planned** — structured timed text with sidecar import/export and optional burn-in through the existing title/compositor path.

## Goal

Add professional caption/subtitle support without weakening the accelerated architecture. Captions are first-class timed-text tracks in the authoritative worker timeline. Sidecar import/export stays text-and-timing only. Burn-in captions reuse the Phase 14 title raster cache and the Phase 12/14 compositor path so preview and export stay visually identical.

## Non-goals

- A separate per-frame subtitle renderer on main or in the compositor hot path.
- Embedding subtitle streams into container mux output in this phase.
- Server-side transcription, translation, or cloud caption services.
- Blocking the editor on malformed caption files.

## Core types

```typescript
export interface CaptionStyle {
  presetId?: string | null;
  overrides?: Partial<TitleStyle>;
  anchor:
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
    | 'top-center'
    | 'custom';
  insetPx?: { x: number; y: number };
  maxWidthPercent: number;
  lineWrap: 'balanced' | 'greedy';
}

export interface CaptionSegment {
  id: string;
  start: number;
  duration: number;
  text: string;
  style?: CaptionStyle | null;
}

export interface CaptionTrack {
  id: string;
  kind: 'caption';
  name: string;
  language?: string | null;
  segments: readonly CaptionSegment[];
  defaultStyle: CaptionStyle;
  burnedIn: boolean;
  visible: boolean;
}

export interface CaptionImportResult {
  track: CaptionTrack;
  diagnostics: readonly CaptionDiagnostic[];
  format: 'srt' | 'webvtt';
  recovered: boolean;
}

export interface CaptionExportSettings {
  trackId: string;
  formats: readonly ('srt' | 'webvtt')[];
  range:
    | { mode: 'full-track' }
    | { mode: 'timeline-range'; startS: number; endS: number };
  fileStem: string;
}
```

`CaptionStyle` extends the title style model by reference, not duplication: the concrete renderable style is resolved as `titlePreset -> caption track default overrides -> segment overrides`.

## Architecture

### Worker-authoritative timeline state

- `src/engine/timeline.ts` gains caption-track data structures and pure operations for segment insert/split/merge/trim/retime/delete.
- `src/engine/worker.ts` remains the single authority for committed caption edits, import results, and sidecar exports.
- Caption track snapshots flow through `src/protocol.ts` with the rest of the timeline state.

### Main-thread transcript state

The transcript panel owns only transient UI state:

- focused segment id
- local text draft before commit
- selection range / multi-select set
- parser diagnostic filter visibility
- pending drag/resize preview state

It never becomes the source of truth for segment timing. Commits use typed worker commands on blur, Enter, drag-end, explicit apply, or debounced text save.

### Parser and serializer modules

New engine modules:

| Module | Responsibility |
|--------|----------------|
| `src/engine/captions/types.ts` | shared caption types and diagnostics |
| `src/engine/captions/srt.ts` | parse/serialize SRT |
| `src/engine/captions/webvtt.ts` | parse/serialize WebVTT |
| `src/engine/captions/import.ts` | format sniffing, recovery, track creation |
| `src/engine/captions/export.ts` | sidecar range filtering and file generation |
| `src/engine/captions/render.ts` | caption-to-title raster bridge/cache helpers |

Parsers return structured results:

```typescript
export interface CaptionDiagnostic {
  code:
    | 'invalid-index'
    | 'invalid-timecode'
    | 'negative-duration'
    | 'overlap'
    | 'unsupported-setting'
    | 'empty-cue';
  severity: 'info' | 'warning' | 'error';
  cueIndex?: number;
  line?: number;
  message: string;
}
```

Recovery rules:

- invalid numbering is tolerated and normalized
- malformed cue times drop or clamp the cue and log a diagnostic
- unsupported WebVTT cue settings are preserved only when they map to known style fields; otherwise they are ignored with a diagnostic
- overlapping or negative-duration cues are normalized or skipped based on whether a safe repair exists

## Burn-in reuse of the title pipeline

### Render path

```
caption import / edit / playhead change to new active segment
  → resolve active CaptionSegment + effective CaptionStyle
  → build TitleRasterInput-compatible payload
  → reuse Phase 14 rasterizeTitle(...) and GPU texture cache
  → composite cached texture in preview/export like a title layer
```

The caption system does not own a second renderer. It adapts caption content into the existing title raster path:

- multi-line caption text becomes the title text payload
- `CaptionStyle` resolves into `TitleStyle`
- caption anchor/max-width map onto the same transform/layout inputs used by title overlays

### Cache behavior

The cached key must cover:

- track id
- active segment id
- segment text
- resolved style fields
- layout inputs that affect raster output

Raster work is event-driven:

- import
- text/style edit
- track preset change
- playhead crossing into a different active segment

No per-frame Canvas2D or CPU readback is added to preview or export.

## Timeline and snapping model

Caption tracks use time-based segment editing aligned with existing timeline grammar.

### Operations

| Operation | Semantics |
|----------|-----------|
| `splitCaptionSegment` | split one segment at playhead or pointer time |
| `mergeCaptionSegments` | merge adjacent selected segments, joining text with a separator policy |
| `trimCaptionSegment` | adjust in/out edge with duration clamp |
| `moveCaptionSegment` | retime whole segment |
| `setCaptionText` | update text only |
| `setCaptionStyle` | update track default or segment override |
| `deleteCaptionSegments` | remove selected segments |

### Snapping sources

Caption segment moves and trims snap to:

- playhead
- timeline markers
- selected clip boundaries
- visible clip boundaries on unlocked tracks
- neighboring caption segment starts/ends on the same track
- active selection edges for multi-segment retimes

The snapping engine should reuse Phase 10 time snapping primitives; caption tracks contribute additional candidate edges rather than inventing a parallel snapping system.

## Import flow

```
UI file pick / drag-drop
  → worker import-captions { file, targetTrackId? }
  → sniff format by extension + header
  → parse with SRT/WebVTT parser
  → normalize segment ordering/timing
  → create CaptionTrack or append into existing caption track
  → emit CaptionImportResult + timeline-state update
```

Malformed inputs do not fail the entire job unless no recoverable cues remain. In that case the user gets diagnostics and no track mutation.

## Sidecar export flow

```
UI export-captions { settings }
  → worker resolves track + range
  → filter/rebase segments for requested span
  → serialize to SRT and/or WebVTT text
  → return downloadable sidecar payloads
```

This path does not enter `src/engine/export.ts`, does not decode media, and does not require video re-export.

## Preview/export parity

Burned-in captions are resolved inside the same compositor path used for preview and export:

- preview: active caption texture is included in the layer resolve
- export: the same layer resolution feeds encoded frames

There is no separate subtitle preview-only overlay for burned-in captions. A DOM-only transcript highlight is allowed, but visible burned-in text must come from the compositor path.

## UI surfaces

| Surface | Work |
|--------|------|
| `src/ui/TranscriptPanel.tsx` | transcript list, text editing, diagnostics, timing fields |
| `src/ui/Timeline.tsx` / caption lane component | caption segments in the timeline with trim/move/snap affordances |
| `src/ui/Inspector.tsx` | caption track preset selection, burn-in toggle, style overrides |
| `src/ui/ExportDialog.tsx` or caption export dialog | sidecar export controls |

Accessibility expectations:

- transcript rows are keyboard-focusable and editable without pointer-only affordances
- time fields use clear labels and tabular numeric display
- parser diagnostics are visible text, not color-only state

## Protocol sketch

```typescript
// commands
| { type: 'import-captions'; file: File; targetTrackId?: string }
| { type: 'export-captions'; settings: CaptionExportSettings }
| { type: 'split-caption-segment'; trackId: string; segmentId: string; time: number }
| { type: 'merge-caption-segments'; trackId: string; segmentIds: readonly string[] }
| { type: 'trim-caption-segment'; trackId: string; segmentId: string; edge: 'start' | 'end'; time: number }
| { type: 'move-caption-segments'; trackId: string; segmentIds: readonly string[]; deltaS: number }
| { type: 'set-caption-text'; trackId: string; segmentId: string; text: string }
| { type: 'set-caption-style'; trackId: string; segmentId?: string; style: CaptionStyle }
| { type: 'set-caption-burn-in'; trackId: string; burnedIn: boolean }

// state
| { type: 'caption-import-result'; result: CaptionImportResult }
| { type: 'caption-export-result'; files: readonly CaptionSidecarFile[] }
```

## Project persistence

- Caption tracks persist inside the project document with additive schema defaults.
- Sidecar source files are not required after import; the normalized structured segments are the project source of truth.
- Phase 23 project bundles may optionally include exported sidecars later, but Phase 22 does not depend on bundle work.

## Validation

- Unit tests for SRT and WebVTT parse/serialize plus malformed recovery.
- Timeline/model tests for split/merge/trim/retime and snapping candidate generation.
- Integration test for import → edit → sidecar export.
- Integration test that preview and export resolve the same burned-in caption payload for the same frame range.

## Acceptance Criteria

- Captions behave as structured timed-text tracks, not ad hoc overlays.
- Burn-in captions use the existing title raster/compositor path and do not add hot-path CPU raster work.
- Sidecar export is independent from video export.
- Recoverable parser failures stay localized to diagnostics and skipped/repaired cues.
- The worker remains authoritative for committed caption timing and text state.
