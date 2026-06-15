# Requirements: Phase 44 — Tutorial Finishing

Phase 44 adds four tightly scoped tools that polish screencast and tutorial
output from within LocalCut Studio. None require ML or server compute: silence
detection is a pure-DSP analyser; keystroke overlay is built from an event log
fed by the Phase 43 capture session; YouTube chapters are derived from existing
`TimelineMarker`s; and the Screencast caption preset is a one-line style
registration. Every feature runs entirely client-side. The phase does not
introduce AI speech recognition, filler-word removal, or LMS/SCORM packaging
— those are explicitly non-goals.

## R1 — Silence / Dead-Air Detection

- **R1.1** A new pipeline-worker module (`src/engine/silence-detector.ts`)
  analyses the audio of the selected tracks using `pcmWindowAt` on each
  track's mixed mono signal (sum of all source channels divided by channel
  count, resampled to 48 000 Hz). Analysis runs in the pipeline worker; no
  main-thread audio processing.
- **R1.2** The RMS energy is computed per 20 ms window (960 samples at 48 kHz)
  with a 10 ms hop (480 samples). Hysteresis is applied via two thresholds:
  a region OPENS when the RMS falls below `openThreshold` (default −42 dBFS)
  and remains open for at least `minSilence` consecutive seconds (default
  0.6 s); a region CLOSES when the RMS rises above `closeThreshold` (default
  −36 dBFS). dBFS conversion: `20 × log10(max(rms, 1e-9))`. Regions shorter
  than `minSilence` are discarded after hysteresis.
- **R1.3** A 150 ms keep-padding is preserved on both sides of every detected
  silent region (inward contraction of the region boundaries). Any region
  reduced to ≤ 0 s by padding is discarded. Any kept segment shorter than
  0.3 s (the minimum-kept-segment floor) that would result between two applied
  cuts is also discarded — the two bounding silence regions are merged into
  one so that the sub-floor kept segment is removed alongside the surrounding
  silence (avoiding a visibly choppy cut).
- **R1.4** All detection parameters are user-tunable with the defaults from
  R1.2–R1.3: `openThreshold` (range −60 to −20 dBFS, default −42),
  `closeThreshold` (range −60 to −20 dBFS, default −36, must be ≥
  `openThreshold`), `minSilence` (0.1 to 10.0 s, default 0.6), `keepPadding`
  (0 to 1.0 s, default 0.15), `minKeptSegment` (0.1 to 2.0 s, default 0.3).
- **R1.5** The worker accepts command `{ type: 'detect-silence'; requestId:
  string; trackIds: string[]; params: SilenceDetectionParams }`. It emits
  zero or more `{ type: 'silence-progress'; requestId: string; progressFraction:
  number }` messages followed by exactly one `{ type: 'silence-result';
  requestId: string; regions: SilenceRegion[] }` or `{ type:
  'silence-error'; requestId: string; message: string }`. A `{ type:
  'cancel-silence-detection'; requestId: string }` command aborts an
  in-progress analysis and emits no further messages for that `requestId`.
- **R1.6** `SilenceRegion` is `{ startS: number; endS: number; peakDb: number
  }` where `peakDb` is the highest RMS dB value observed within the silent
  region (for display; always ≤ `openThreshold`).
- **R1.7** Analysis is deterministic: the same audio content + same params
  always produces the same region list. This is a hard acceptance criterion
  verifiable by replaying identical PCM windows in a unit test with zero
  tolerance on region boundaries.

## R2 — Proposed Cut List Review Panel

- **R2.1** A `SilenceReviewPanel` component (`src/ui/SilenceReviewPanel.tsx`)
  displays the proposed cut list. The panel opens from a button in the audio
  track header or the Edit menu (not a modal; it slides into the Inspector
  region). It shows per-region rows: start time (HH:MM:SS.mmm), end time,
  duration, peak dB, and two buttons: **Apply** (removes the region via ripple
  delete) and **Skip** (marks the row as skipped, visually dimmed). An **Apply
  All** button applies all non-skipped regions in one batch.
- **R2.2** Applying a region performs a ripple delete using the existing
  `ripple-delete` worker command (`src/protocol.ts`), passing the clips that
  fall within the silent region boundaries (split-trim to boundaries first if
  necessary). Each applied region is a single undo step in the existing Phase 9
  snapshot history. The detection itself does NOT add to undo history; only
  apply actions do.
- **R2.3** Proposals are ephemeral UI state: they live in a SolidJS signal
  local to the panel and are NOT persisted in `ProjectDoc` or any IndexedDB
  store. Regenerating (re-running detection) replaces the list. Closing the
  panel discards proposals — the user is warned before closing if any regions
  remain un-reviewed.
- **R2.4** The panel shows a progress bar during detection (fed by
  `silence-progress` messages) and a spinner on the trigger button. If
  detection fails, the error message is shown inline with a retry button; no
  crash.
- **R2.5** Silence detection is only available when the selected tracks have
  at least one audio source. When no audio tracks are selected, the trigger
  button is disabled with a tooltip explaining why.

## R3 — Keystroke Overlay

- **R3.1** Phase 43's event-log channel (the `{kind: 'key'; combo: string; t:
  number}` entries defined in `CaptureEventLogEntry` in
  `src/engine/capture/event-log.ts`) records ONLY non-text shortcuts. The
  recording gate: a combo is recorded if and only if it contains at least one
  modifier key (`Meta`, `Ctrl`, `Alt`, `Shift`) or the bare key is one of
  `F1`–`F12`, `Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`,
  `ArrowRight`. Single printable characters without modifiers are never
  recorded. Key events from `<input>`, `<textarea>`, `[contenteditable]`, and
  `<select>` elements, and from password fields, are never recorded regardless
  of the combo. Recording only happens when the user has enabled "Record
  shortcuts" for an own-tab capture session (Phase 43 opt-in flag).
- **R3.2** The `CaptureEventLogEntry` discriminated union in
  `src/engine/capture/event-log.ts` gains the `key` variant:

  ```typescript
  | { kind: 'key'; combo: string; t: number }
  ```

  `combo` is the canonical string form: modifiers in alphabetical sort order
  (`Alt`, `Ctrl`, `Meta`, `Shift`) joined by `+`, then the key name from
  `KeyboardEvent.key` (normalised: `' '` → `'Space'`). Example:
  `'Ctrl+Shift+Z'`, `'Meta+S'`, `'F5'`, `'Escape'`.
- **R3.3** Phase 44 reads the captured key-event log during an own-tab
  capture import (or from a stored capture session replay buffer) and
  generates title-like overlay clips using the Phase 14 raster path
  (`TitleTextureCache`, `rasterizeTitleToCanvas`). Each key clip renders as a
  rounded-rect pill (border-radius 8 px raster-space, monospace font stack
  `'Courier New', Courier, monospace`, white `#FFFFFF` text, background
  `#1A1A1A` at 90 % opacity, 2 px white outline, font size 36 px). Clip
  default duration is 1.2 s. When two or more key events are < 300 ms apart,
  their combos are joined with ` · ` (space, middle dot U+00B7, space) into a
  single clip starting at the first event's time. The clip duration remains
  1.2 s from the first event.
- **R3.4** Generated clips land on a dedicated overlay track named "Keystrokes"
  created (if absent) at the top of the track list. The track is an ordinary
  timeline track holding title-kind clips. Clips serialise via the standard
  `ProjectDoc` timeline; no new schema fields are required.
- **R3.5** The "Generate keystroke overlay" action is surfaced in the Edit
  menu and in the Capture import dialog (Phase 43 integration). It is disabled
  when no own-tab capture session with key-event log entries is available. No
  overlay clips are generated automatically without user action.

## R4 — YouTube Chapter Export

- **R4.1** The chapter source is `ProjectDoc.markers` filtered to markers
  with a non-empty `label` field (all markers satisfying that predicate, no
  special prefix required — simplest honest rule). Markers are sorted by `time`
  ascending before processing.
- **R4.2** A **YouTube chapter text** generator produces a plain-text string
  in YouTube's required format: one line per chapter, `HH:MM:SS label` (or
  `M:SS` for times < 1 hour — YouTube accepts both; this spec uses `HH:MM:SS`
  for all times for simplicity and consistency). Rules enforced:
  - The first chapter must be at time 0.000 s. If no marker exists at 0 s, an
    "Intro" chapter is auto-inserted at 00:00:00.
  - There must be at least 3 chapters total (including the auto-inserted Intro
    if added).
  - Each chapter must be at least 10 s after the previous chapter.
  - Chapters must be strictly ascending in time.
  If the marker list (after auto-Intro insertion) does not satisfy the 3-chapter
  minimum or 10 s spacing rules, the generator returns a typed validation error
  (`{ valid: false; reason: string }`) rather than producing invalid text;
  the UI shows the reason and a hint for fixing it.
- **R4.3** Chapter text can be copied to the clipboard or saved as
  `<project-name>.chapters.txt` via File System Access API (blob-download
  fallback). The export is triggered from a **"Export Chapters"** button in the
  Markers section of the Export dialog or from a dedicated "Export → Chapters"
  menu item.
- **R4.4** A `<output-stem>.chapters.json` sidecar (UTF-8 JSON array of
  `{ time: number; label: string }`) is also written alongside the chapter
  text file when the user saves to the file system. Both files are generated
  from the same sorted marker list.
- **R4.5** MP4 container chapter metadata: Mediabunny ^1.46 exposes no chapter
  metadata API (confirmed: no `chapters`, `metadata`, or `udta` surface in the
  Mediabunny `Output` or `Mp4OutputFormat` API — see `src/engine/export.ts`).
  The sidecar strategy is therefore the v1 production path. `design.md`
  documents what must be revisited if Mediabunny adds a chapter API. The
  acceptance criterion "chapters visible in VLC" is conditional: it applies
  only if the implementer finds a Mediabunny chapter API during implementation;
  otherwise it is deferred and the sidecar file is the deliverable.
- **R4.6** The generated chapter text is validated against YouTube's format
  rules (R4.2) before being offered to the user. The validator is a pure
  function that accepts a `ChapterEntry[]` and returns `{ valid: true; text:
  string } | { valid: false; reason: string }`.

## R5 — Screencast Caption Preset

- **R5.1** A new caption style preset named `'screencast'` is added to
  `CAPTION_PRESETS` in `src/engine/captions/types.ts` with the following
  properties (all values are final — not tunable defaults):
  - `label`: `'Screencast'`
  - `style.fontFamily`: `'Courier New', Courier, monospace` (expressed as a
    CSS font-family string stored in the `fontFamily` field of `TitleStyle`)
  - `style.fontSizePx`: `52`
  - `style.color`: `'#FFFFFF'`
  - `style.backgroundColor`: `'#1A1A1A'`
  - `style.backgroundOpacity`: `0.8` (80 %, equivalent to `CC` in hex)
  - `style.outlineColor`: `'#FFFFFF'`
  - `style.outlineWidthPx`: `0` (pill shape comes from background, not outline)
  - `style.shadowBlurPx`: `0`
  - `style.shadowOffsetXPx`: `0`
  - `style.shadowOffsetYPx`: `0`
  - `style.align`: `'center'`
  - `anchor`: `'bottom-center'`
  - `maxWidthPercent`: `64`
  - `lineWrap`: `'greedy'`
- **R5.2** `CaptionPresetId` in `src/engine/captions/types.ts` is extended to
  include `'screencast'` as a valid literal. Existing documents referencing
  unknown preset IDs fall back to the `'subtitle'` preset via the existing
  `normalizeCaptionStyle` path — no schema version bump is required.
- **R5.3** The `'Screencast'` preset appears in the caption style picker UI
  (`src/ui/CaptionStylePicker.tsx` or equivalent caption track inspector
  component) labelled `'Screencast'` alongside the existing presets.
- **R5.4** A reference preset file `src/presets/captions/screencast.json` is
  written containing the canonical preset values (for documentation and as a
  future import reference). The file is not loaded at runtime — the source of
  truth is the TypeScript `CAPTION_PRESETS` object.

## R6 — Tests, Docs, and Quality Gate

- **R6.1** Unit tests (Vitest, Node environment, co-located with source) cover:
  - `silence-detector.test.ts`: deterministic region detection on synthetic
    PCM (sine burst + flat silence + burst); padding application; merge of
    adjacent regions that would produce a sub-`minKeptSegment` kept segment;
    parameter boundary values; cancellation path.
  - `chapter-export.test.ts`: auto-Intro insertion; validator rejects < 3
    chapters; validator rejects < 10 s spacing; ascending sort; `HH:MM:SS`
    formatting for times over 1 hour; round-trip through JSON sidecar.
  - `capture-event-log.test.ts` (new or extended): key-combo recording gate
    (modifier combos recorded, bare printable not recorded, form-field
    suppression); combo canonical form; merge of events < 300 ms apart.
  - `silence-detector.test.ts` determinism assertion: run detection twice on
    the same synthetic PCM, assert `JSON.stringify(result1) ===
    JSON.stringify(result2)`.
  - `caption-presets.test.ts` (new or extended): `'screencast'` preset
    round-trips through `normalizeCaptionStyle`; unknown preset IDs fall
    back to `'subtitle'`.
- **R6.2** No large media fixtures; all audio is generated synthetically in
  tests (Float32Array of computed samples). No Playwright tests in this phase.
- **R6.3** `docs/USER-GUIDE.md` is updated with:
  - Silence detection: how to select tracks, tune parameters, review and apply
    proposals, and undo applied cuts.
  - Keystroke overlay: opt-in requirement, how to generate, how to edit or
    delete clips on the Keystrokes track.
  - YouTube chapters: how to add markers, the auto-Intro rule, the 3-chapter /
    10-second spacing rules, and how to export the sidecar files.
  - Screencast caption preset: a brief mention in the captions section.
- **R6.4** `npm run build` succeeds with zero TypeScript errors. `npm test`
  is green and the test count grows by at least the cases described in R6.1.
