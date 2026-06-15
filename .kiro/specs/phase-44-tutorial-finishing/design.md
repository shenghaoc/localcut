# Design: Phase 44 — Tutorial Finishing

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Equip LocalCut Studio with four editing aids that are disproportionately
valuable for screencasters and tutorial producers: deterministic silence
detection that proposes non-destructive cuts; a keystroke overlay built from
the Phase 43 own-tab event log; YouTube chapter export derived from existing
timeline markers; and a Screencast caption style preset. All four are
client-compute-only and compose entirely from existing infrastructure —
`SequentialAudioSource.pcmWindowAt`, Phase 14 title raster, Phase 20 ripple
delete, Phase 10 markers, Phase 22 caption presets.

## Non-goals

- **ASR / speech recognition** — ML-based transcript or filler-word removal
  belongs in its own phase after the WebNN pipeline matures (Phase 28+).
- **Filler-word removal** — depends on ASR; deferred.
- **LMS/SCORM packaging** — a separate export concern outside this phase.
- **Real-time silence gating during recording** — Phase 44 analyses already-
  captured audio; it does not gate the live recording pipeline.
- **MP4 chapter atoms** — Mediabunny ^1.46 exposes no chapter metadata API
  (no `chapters`, `metadata`, or `udta` surface on `Output` or
  `Mp4OutputFormat`). The sidecar strategy is the v1 production path. If
  Mediabunny adds a chapter API in a future release, the implementer should
  add: `output.setChapters(entries.map(e => ({ timeMs: e.time * 1000, title:
  e.label })))` (or the actual API shape when verified), enable the VLC
  acceptance criterion, and remove the sidecar fallback note.
- **Keystroke recording during export** — only capture-session event logs are
  processed; the overlay is generated at import time, not live.
- **Any network traffic, accounts, or telemetry.**

## Why these four features together

They share a thin implementation surface (audio DSP, event log read, marker
read, caption preset) and a common audience (tutorial producers). Bundling
them into a single phase amortises the review cost without creating
architectural coupling between the features.

## Architecture

```
Main thread                              Pipeline worker
┌─────────────────────────────────┐      ┌─────────────────────────────────────┐
│ SilenceReviewPanel.tsx          │      │ silence-detector.ts                 │
│  ├ trigger button               │      │  ├ pcmWindowAt per track             │
│  ├ progress bar                 │◄────►│  ├ RMS windows (20 ms / 10 ms hop)  │
│  ├ region list (signal)         │      │  ├ hysteresis state machine          │
│  └ Apply / Skip / Apply All     │      │  └ SilenceRegion[]                   │
│       │ ripple-delete command   │      └─────────────────────────────────────┘
│       ▼ (Phase 9 undo)         │
│ worker.ts dispatch              │      Capture session (Phase 43 import)
│                                 │      ┌─────────────────────────────────────┐
│ CaptureImportDialog.tsx         │      │ event-log.ts (extended)             │
│  └ "Generate keystroke overlay" │      │  CaptureEventLogEntry |             │
│       │ generate-key-overlay    │◄────►│    { kind:'key'; combo; t }         │
│       ▼                         │      └─────────────────────────────────────┘
│ title-clip generation (P14)     │
│  └ TitleTextureCache             │
│                                 │      src/engine/chapters.ts
│ ExportDialog.tsx (extended)     │      ┌─────────────────────────────────────┐
│  └ "Export Chapters"            │◄────►│  generateChapterText(markers)       │
│       │ clipboard / file save   │      │  validateChapters(entries)          │
│                                 │      │  generateChaptersJson(entries)      │
│ CaptionStylePicker (extended)   │      └─────────────────────────────────────┘
│  └ 'screencast' preset row      │
└─────────────────────────────────┘
```

All analysis that can block runs in the pipeline worker
(`silence-detector.ts`) or is purely functional (chapters, event-log parsing)
and executes on main without sustained loops. Hard gate 1 (interactive main
thread) is satisfied: the RMS loop runs in the worker. Hard gate 2 (no CPU
pixel round-trips in the accelerated path) is satisfied: the keystroke overlay
uses the existing Phase 14 GPU raster path.

## Components

### `src/engine/silence-detector.ts` (new)

Pure TypeScript module run inside the pipeline worker. Stateless exported
function; no class needed.

```typescript
export interface SilenceDetectionParams {
  openThreshold: number;   // dBFS, default −42
  closeThreshold: number;  // dBFS, default −36; must be ≥ openThreshold
  minSilence: number;      // seconds, default 0.6
  keepPadding: number;     // seconds each side, default 0.15
  minKeptSegment: number;  // seconds, default 0.3
  sampleRate: number;      // always 48000
  windowSamples: number;   // always 960 (20 ms at 48 kHz)
  hopSamples: number;      // always 480 (10 ms)
}

export interface SilenceRegion {
  startS: number;
  endS: number;
  peakDb: number; // highest RMS dB within the region; always ≤ openThreshold
}

/** Pure, deterministic. Accepts pre-mixed mono PCM at 48 kHz. */
export function detectSilence(
  pcm: Float32Array,        // interleaved mono (single channel)
  params: SilenceDetectionParams,
): SilenceRegion[]
```

**Algorithm (fully specified — no judgment calls):**

1. Slide over `pcm` with `windowSamples = 960` and `hopSamples = 480`.
2. For each window compute RMS: `sqrt(sum(x² for x in window) / windowSamples)`.
   Convert to dB: `20 * Math.log10(Math.max(rms, 1e-9))`.
3. Hysteresis state machine per window: state is `OPEN` (in silence) or
   `CLOSED` (in speech/content). Start in `CLOSED`.
   - `CLOSED → OPEN` when the window dB < `openThreshold`. Record `openStart`
     = start of this window. Accumulate duration of below-threshold windows.
   - `OPEN → CLOSED` when the window dB ≥ `closeThreshold`. If the duration
     since `openStart` ≥ `minSilence`, emit a candidate region `[openStart,
     closeEnd]` where `closeEnd` is the start of this (above-threshold) window.
     Otherwise discard. Reset `openStart`.
4. At end of PCM: if state is `OPEN` and accumulated duration ≥ `minSilence`,
   emit candidate `[openStart, pcmDuration]`.
5. Apply keep-padding: contract each candidate — new `startS = candidate.startS
   + keepPadding`, new `endS = candidate.endS - keepPadding`. Discard if
   `endS ≤ startS`.
6. Enforce minimum kept segment: scan adjacent pairs of regions. If the gap
   between `regions[i].endS` and `regions[i+1].startS` < `minKeptSegment`,
   merge the two regions into one spanning from `regions[i].startS` to
   `regions[i+1].endS`, taking the higher `peakDb`. Repeat until stable.
7. Compute `peakDb` per emitted region: the maximum dB observed in any window
   that falls within `[candidate.startS, candidate.endS]` (pre-padding
   contraction boundaries).

The function is pure: no side effects, no async. The worker feeds it batches
of PCM from `SequentialAudioSource.pcmWindowAt` calls (step-through the full
track range), concatenating Float32Array chunks. All tracks requested are
mono-mixed (sum channels, divide by channel count) then concatenated over
timeline time — gaps are silence-filled by `pcmWindowAt` per the existing
contract.

### `src/engine/worker.ts` (extended)

New message handlers added to the existing command dispatch. Pattern mirrors
`extract-clip-audio` / `request-thumbnails`.

```typescript
// in WorkerCommand (src/protocol.ts)
| { type: 'detect-silence'; requestId: string; trackIds: string[];
    params: SilenceDetectionParams }
| { type: 'cancel-silence-detection'; requestId: string }

// in WorkerStateMessage (src/protocol.ts)
| { type: 'silence-progress'; requestId: string; progressFraction: number }
| { type: 'silence-result'; requestId: string; regions: SilenceRegion[] }
| { type: 'silence-error'; requestId: string; message: string }
```

Cancellation: the handler stores the `requestId` of the in-flight analysis in
a `Set<string>`; it checks the set on each `pcmWindowAt` iteration; on
`cancel-silence-detection` it removes the id and the next check exits the
loop cleanly. No `terminate()` or separate worker is used — silence detection
shares the pipeline worker and is interruptible at each hop.

Progress is emitted after each track is processed: `progressFraction = (i +
1) / trackCount` where `i` is the zero-indexed track index. This gives coarse
but honest progress.

### `src/protocol.ts` (extended)

Following the existing kebab-case `{domain}-{verb}` pattern:

```typescript
// Commands (added to WorkerCommand union)
interface DetectSilenceCommand {
  type: 'detect-silence';
  requestId: string;
  trackIds: string[];
  params: SilenceDetectionParams;
}
interface CancelSilenceDetectionCommand {
  type: 'cancel-silence-detection';
  requestId: string;
}

// State messages (added to WorkerStateMessage union)
interface SilenceProgressMessage {
  type: 'silence-progress';
  requestId: string;
  progressFraction: number; // [0, 1]
}
interface SilenceResultMessage {
  type: 'silence-result';
  requestId: string;
  regions: SilenceRegion[];
}
interface SilenceErrorMessage {
  type: 'silence-error';
  requestId: string;
  message: string;
}
```

`SilenceDetectionParams` and `SilenceRegion` are also exported from
`src/protocol.ts` (imported into both the worker and the UI).

### `src/ui/SilenceReviewPanel.tsx` (new)

A SolidJS panel (non-modal; rendered in the Inspector column) with the
following public API:

```typescript
interface SilenceReviewPanelProps {
  trackIds: string[];   // currently selected audio track IDs
  worker: Worker;       // the pipeline worker (same ref used elsewhere in App.tsx)
  onApplyRegion: (region: SilenceRegion) => void;
  onApplyAll: (regions: SilenceRegion[]) => void;
}
```

Internal signals:
- `regions: Signal<SilenceRegion[]>` — current proposal list.
- `skipped: Signal<Set<number>>` — indices of skipped rows.
- `detecting: Signal<boolean>` — true while analysis is in-progress.
- `progress: Signal<number>` — 0–1 progress fraction.
- `error: Signal<string | null>`.

**`onApplyRegion`** is called by the parent (`App.tsx`) which dispatches a
`ripple-delete` command for the timeline clips within the region boundaries
(computing intersection with clip list). One `ripple-delete` per region →
one Phase 9 undo step.

**Parameter tuning controls** (collapsible): sliders for the five
`SilenceDetectionParams` fields with their ranges and defaults. Changes require
re-running detection.

**Close guard**: before unmounting, if `regions().length > 0` and any remain
un-reviewed (neither Applied nor Skipped), show a SolidJS `onCleanup`-safe
confirm dialog.

No media objects or GPU handles leak into this component (`onCleanup` cancels
any in-flight detection via `cancel-silence-detection`).

### `src/engine/capture/event-log.ts` (extended)

The `CaptureEventLogEntry` discriminated union gains the `key` variant.
**Schema (locked):**

```typescript
// Added to CaptureEventLogEntry union
| { kind: 'key'; combo: string; t: number }
```

`combo` canonical form: modifiers sorted alphabetically (`Alt`, `Ctrl`,
`Meta`, `Shift`), joined with `+`, then the key name from
`KeyboardEvent.key` with one normalisation: `' '` (space character) is
replaced with `'Space'`. Example: `'Ctrl+Shift+Z'`, `'Meta+S'`, `'F5'`,
`'Escape'`.

**Recording gate** (implemented wherever the capture session installs its
`keydown` listener — Phase 43's own-tab capture code):
- Event is from an `<input>`, `<textarea>`, `[contenteditable]`, or
  `<select>` element, or any element with `type="password"` → discard.
- Key is a single printable character (i.e. `event.key.length === 1`) AND
  no non-Shift modifier is held (i.e. `!ctrlKey && !altKey && !metaKey`)
  → discard. **Shift alone does not unlock recording** — capitalised text
  entry (e.g. `Shift+a` → `'A'`) must stay private. Only Ctrl/Alt/Meta
  (with or without Shift) qualify a single-character key as a shortcut.
- Otherwise → record if "Record shortcuts" opt-in is active.

This gate is defined precisely in Phase 44 because Phase 43 reserves the
channel. Phase 43 implementers must apply it.

**Exported helpers (new):**

```typescript
/** Returns true when the event should be captured per the gate above. */
export function shouldRecordKey(event: KeyboardEvent): boolean

/** Formats a KeyboardEvent into a canonical combo string. */
export function formatKeyCombo(event: KeyboardEvent): string
```

### `src/engine/capture/key-overlay-generator.ts` (new)

Pure function: takes a sorted `CaptureEventLogEntry[]` (kind `'key'` only),
the capture session start time and total duration, and returns an array of
`TitleClip`-compatible objects (type alias defined in this file, matches
the shape the timeline worker accepts for a `add-title-clip`-style insertion).

```typescript
interface KeyOverlayClip {
  text: string;       // combo or merged combos joined with ' · '
  startS: number;     // session-relative seconds
  durationS: number;  // always 1.2 unless truncated by next clip
  style: Partial<TitleStyle>; // keycap style from KEYCAP_STYLE constant
}

/** Merge threshold: events within this gap (s) are joined into one clip. */
export const KEY_MERGE_THRESHOLD_S = 0.3;

/** Default overlay clip display duration. */
export const KEY_OVERLAY_DURATION_S = 1.2;

/** Hard cap on the number of combos joined into one merged clip — protects
 * the overlay from continuous typing degenerating into one massive group. */
export const KEY_MERGE_MAX_COMBOS = 4;

/** Hard cap on the span from the first merged combo to the last (s) — even
 * when each adjacent gap is below {@link KEY_MERGE_THRESHOLD_S}, a long
 * run of shortcuts splits at this boundary so the overlay text stays
 * readable and aligned with the source action. */
export const KEY_MERGE_MAX_SPAN_S = 1.0;

/** Keycap TitleStyle override applied to all generated clips. */
export const KEYCAP_STYLE: Partial<TitleStyle> = {
  fontFamily: "'Courier New', Courier, monospace",
  fontSizePx: 36,
  color: '#FFFFFF',
  backgroundColor: '#1A1A1A',
  backgroundOpacity: 0.9,
  outlineColor: '#FFFFFF',
  outlineWidthPx: 2,
  shadowBlurPx: 0,
  shadowOffsetXPx: 0,
  shadowOffsetYPx: 0,
  align: 'center',
};

export function generateKeyOverlayClips(
  entries: readonly CaptureEventLogEntry[],
  sessionOffsetS: number, // offset from project start to align session timestamps
): KeyOverlayClip[]
```

The generated clips are passed to a new worker command
`generate-key-overlay` (see protocol extension below) which creates title
clips on the "Keystrokes" overlay track. If the "Keystrokes" track does not
exist, the worker creates it as the topmost video track.

**Protocol extension:**

```typescript
// WorkerCommand addition
| { type: 'generate-key-overlay'; clips: KeyOverlayClip[];
    sessionOffsetS: number }
```

No new state message is needed; the existing `timeline-state` update
after the clips are applied is sufficient.

### `src/engine/chapters.ts` (new)

Pure module; no browser APIs.

```typescript
export interface ChapterEntry {
  time: number;  // seconds
  label: string; // non-empty
}

export type ChapterValidationResult =
  | { valid: true; text: string; entries: ChapterEntry[] }
  | { valid: false; reason: string };

/**
 * Accepts ProjectDoc.markers (TimelineMarker[]).
 * Filters to non-empty labels, sorts by time, auto-inserts Intro at 00:00 if
 * absent, then validates and formats.
 */
export function generateChapterText(
  markers: readonly { time: number; label: string }[],
  totalDurationS: number,
): ChapterValidationResult

/**
 * Returns a JSON string (pretty-printed) of ChapterEntry[].
 * Precondition: entries have already been validated.
 */
export function generateChaptersJson(entries: ChapterEntry[]): string

/** Formats seconds as HH:MM:SS (no fractional seconds — YouTube drops them). */
export function formatChapterTimestamp(s: number): string
```

**Validation rules (in order):**

1. Filter `markers` to those with `label.trim().length > 0`.
2. Sort ascending by `time`.
3. If no entry has `time === 0`, prepend `{ time: 0, label: 'Intro' }`.
4. Drop any entry where `time > totalDurationS` (a marker past the program
   end can never appear as a YouTube chapter; emitting it would create a
   chapter the viewer cannot reach).
5. Check `entries.length >= 3`; if not, return `{ valid: false, reason:
   'YouTube requires at least 3 chapters. Add more markers.' }`.
6. Check each adjacent pair satisfies `entries[i+1].time - entries[i].time >=
   10`; if any pair fails, return `{ valid: false, reason: 'Chapters must be
   at least 10 seconds apart. Chapter "X" is too close to the previous.' }`
   naming the offending chapter.
7. Check `totalDurationS - entries[entries.length - 1].time >= 10`; if the
   final chapter sits within 10 s of the program end, return `{ valid: false,
   reason: 'The last chapter must leave at least 10 seconds before the end
   of the video. Move "X" earlier or extend the program.' }` naming the
   offending chapter (YouTube hides chapters whose runtime is shorter than
   10 s).
8. Produce text: one line per entry, `${formatChapterTimestamp(time)} ${label}`
   joined by `'\n'`.

`formatChapterTimestamp`: `Math.floor(s / 3600)` padded to 2 digits, `':'`,
`Math.floor((s % 3600) / 60)` padded to 2, `':'`, `Math.floor(s % 60)`
padded to 2. Integer arithmetic only (no floating-point rounding of labels).

### `src/ui/ExportDialog.tsx` (extended)

A new **Chapters** tab (or collapsible section) in the Export dialog showing:
- The computed chapter list (live preview from current markers).
- The validation result (success or error message with guidance).
- A **Copy to Clipboard** button.
- A **Save .chapters.txt** button (writes `<stem>.chapters.txt` via File
  System Access API with blob-download fallback, then writes
  `<stem>.chapters.json` alongside).

The section is always visible; if fewer than 3 valid-labeled markers exist, it
shows the validation error and guidance rather than hiding itself.

### `src/engine/captions/types.ts` (extended)

`CaptionPresetId` gains `'screencast'`:

```typescript
export type CaptionPresetId = 'subtitle' | 'lower-third' | 'note' | 'screencast';
```

`CAPTION_PRESETS` gains the `screencast` entry:

```typescript
screencast: {
  label: 'Screencast',
  style: {
    fontFamily: "'Courier New', Courier, monospace",
    fontSizePx: 52,
    color: '#FFFFFF',
    backgroundColor: '#1A1A1A',
    backgroundOpacity: 0.8,
    outlineColor: '#FFFFFF',
    outlineWidthPx: 0,
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowOffsetXPx: 0,
    shadowOffsetYPx: 0,
    align: 'center',
  },
  anchor: 'bottom-center',
  maxWidthPercent: 64,
  lineWrap: 'greedy',
},
```

No schema version bump: unknown `presetId` values already fall through to the
`'subtitle'` default in `normalizeCaptionStyle`. Existing documents are
unaffected.

### `src/presets/captions/screencast.json` (new)

Reference file for documentation and future import paths. Not loaded at
runtime. Content mirrors the CAPTION_PRESETS entry above in JSON form plus
a `captionStyleSchemaVersion: 1` field (for compatibility with Phase 30,
which defines that schema version).

## Persistence and schema

- **Silence proposals** — ephemeral signal in `SilenceReviewPanel.tsx`. Not
  persisted. Not added to `ProjectDoc`.
- **Keystroke overlay clips** — ordinary title clips on the "Keystrokes" track.
  Serialised via the standard `ProjectDoc.timeline` path. No new fields.
- **Chapter export** — derived on demand from `ProjectDoc.markers`. No new
  fields.
- **Screencast preset** — registered in TypeScript; no new `ProjectDoc` field.
- **Schema version** — no bump required for any of the above. The next
  unused version remains reserved per the facts file note (v11 is claimed by
  Phase 46 PR #63).

## Dependencies on in-progress specs

- **Phase 43 (own-tab capture engine)** — Phase 44 defines the `key` variant
  of `CaptureEventLogEntry` and the two helpers (`shouldRecordKey`,
  `formatKeyCombo`). Phase 43 implements the `keydown` listener that calls
  them. The contract this spec relies on is: (a) Phase 43 provides a
  `CaptureEventLogEntry` discriminated union in
  `src/engine/capture/event-log.ts`; (b) Phase 43 exposes the capture
  session's event log as a readable array or async iterable from the stored
  session manifest; (c) the "Record shortcuts" opt-in flag is a boolean field
  on the capture session config object. If Phase 43 drifts, the key-overlay
  feature degrades gracefully: if `event-log.ts` does not yet exist, the
  "Generate keystroke overlay" action remains disabled.
- **Phase 30 (caption style presets JSON schema)** — the
  `captionStyleSchemaVersion: 1` field in `screencast.json` is stated by name
  here. If Phase 30 changes that field name or version number before Phase 44
  merges, update the JSON file accordingly; the runtime `CAPTION_PRESETS`
  object is unaffected.

## Third-party additions

No new runtime dependencies. All algorithms use TypeScript arithmetic over
`Float32Array` (silence detector), string manipulation (chapter formatter,
combo formatter), and the existing Phase 14 canvas raster (overlay clips).

## Validation

### Unit (Vitest, Node environment, co-located)

- **`src/engine/silence-detector.test.ts`** — synthetic PCM: 1 s speech +
  0.8 s silence + 1 s speech; confirm one region detected with correct
  boundaries after padding; test with `minKeptSegment` causing merge of two
  adjacent regions; test cancellation path (mock signal); test parameter
  boundary at exactly `minSilence`; determinism assertion (two identical runs
  produce byte-identical results).
- **`src/engine/chapters.test.ts`** — auto-Intro insertion when first marker
  is not at 0; validator rejects 2-chapter list; validator rejects 10 s
  spacing violation (names the offending chapter); accepts valid 3-chapter
  list; `formatChapterTimestamp` at 0 s, 59 s, 60 s, 3600 s, 7261 s;
  JSON round-trip.
- **`src/engine/capture/event-log.test.ts`** — `shouldRecordKey` passes
  modifier+key, passes F-keys/Escape/Enter/Tab; rejects bare `'a'`; rejects
  from `<input>` target; `formatKeyCombo` produces sorted modifier order;
  `generateKeyOverlayClips` merges events < 300 ms apart (combo joined with
  ` · `); does not merge events ≥ 300 ms apart; handles empty input.
- **`src/engine/captions/types.test.ts`** (new or extended) — `'screencast'`
  round-trips through `normalizeCaptionStyle`; `'unknown-preset'` falls back
  to `'subtitle'` defaults.

### Manual smoke

1. Import a screencast recording (MP4) with clearly audible silent gaps.
   Open Silence Review Panel; confirm regions appear; apply two; undo both;
   confirm timeline restored exactly.
2. Import an own-tab capture session with "Record shortcuts" enabled;
   trigger "Generate keystroke overlay"; confirm Keystrokes track created;
   play back and verify clips render at correct times.
3. Add ≥ 3 markers with non-empty labels, first at 0 s, spacing ≥ 10 s;
   open Export → Chapters; copy to clipboard; paste into a text editor;
   verify format matches `HH:MM:SS label` per line.
4. Add a caption track; select "Screencast" from the style picker; confirm
   monospace pill appearance in the canvas preview.
