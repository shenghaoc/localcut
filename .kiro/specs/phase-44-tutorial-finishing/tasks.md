# Tasks: Phase 44 — Tutorial Finishing

## T1 — Silence detector: pure analysis function (R1)

- [ ] **T1.1** Create `src/engine/silence-detector.ts`. Export `SilenceDetectionParams`,
  `SilenceRegion`, and `detectSilence(pcm: Float32Array, params:
  SilenceDetectionParams): SilenceRegion[]` as specified in design.md. The
  function is pure TypeScript with no imports beyond standard math — no worker
  globals, no async.
- [ ] **T1.2** Implement the 7-step algorithm verbatim: (1) sliding-window RMS
  at 960-sample windows / 480-sample hops, (2) dB conversion with `1e-9`
  floor, (3) two-threshold hysteresis state machine (`openThreshold` opens,
  `closeThreshold` closes), (4) duration gate (discard if accumulated duration
  < `minSilence`), (5) keep-padding contraction (discard if result ≤ 0 s),
  (6) minimum-kept-segment merge pass (repeat until stable), (7) `peakDb` per
  final region.
- [ ] **T1.3** Export default parameter constants alongside the function:
  `SILENCE_DEFAULTS: SilenceDetectionParams` with values from R1.2–R1.3
  (`openThreshold: -42`, `closeThreshold: -36`, `minSilence: 0.6`,
  `keepPadding: 0.15`, `minKeptSegment: 0.3`, `sampleRate: 48000`,
  `windowSamples: 960`, `hopSamples: 480`).

## T2 — Protocol extension: silence detection messages (R1)

- [ ] **T2.1** Add to `src/protocol.ts` `WorkerCommand` union:
  `DetectSilenceCommand { type: 'detect-silence'; requestId: string;
  trackIds: string[]; params: SilenceDetectionParams }` and
  `CancelSilenceDetectionCommand { type: 'cancel-silence-detection'; requestId:
  string }`. Import `SilenceDetectionParams` and `SilenceRegion` from
  `../engine/silence-detector` (or re-export them from protocol.ts for
  consumers).
- [ ] **T2.2** Add to `src/protocol.ts` `WorkerStateMessage` union:
  `SilenceProgressMessage { type: 'silence-progress'; requestId: string;
  progressFraction: number }`, `SilenceResultMessage { type:
  'silence-result'; requestId: string; regions: SilenceRegion[] }`, and
  `SilenceErrorMessage { type: 'silence-error'; requestId: string; message:
  string }`.

## T3 — Worker: silence detection handler (R1)

- [ ] **T3.1** In `src/engine/worker.ts`, add a handler for
  `'detect-silence'`. For each `trackId` in `trackIds`: retrieve the
  `MediaInputHandle` from the worker's source registry, call `pcmWindowAt` in
  a loop to collect the full-duration mono PCM (sum channels, divide by
  channel count), concatenate into one `Float32Array`, then call
  `detectSilence`. Post `silence-progress` after each track. Post
  `silence-result` on completion.
- [ ] **T3.2** Add a `Set<string> inFlightSilenceRequests` in the worker
  module scope. On each `pcmWindowAt` iteration, check if the `requestId` is
  still in the set; exit the loop and post no further messages if it has been
  removed. On `'cancel-silence-detection'`, remove the `requestId` from the
  set — this is the only needed cancellation mechanism (no `terminate()`).
- [ ] **T3.3** Wrap the handler in a `try/catch`; post `silence-error` on any
  thrown exception (message is `error.message` or `'Unknown error'`; no stack
  trace in the payload).

## T4 — UI: Silence Review Panel (R2)

- [ ] **T4.1** Create `src/ui/SilenceReviewPanel.tsx`. Accepts
  `SilenceReviewPanelProps` as defined in design.md. Renders a non-modal panel
  (CSS class `silence-review-panel`) in the Inspector region with: parameter
  controls (collapsible fieldset), a "Detect" trigger button, progress bar
  (shown only while `detecting()`), error display with retry, and the region
  list table.
- [ ] **T4.2** Region list table columns: Start (formatted `HH:MM:SS.mmm`),
  End, Duration (s, 2 decimal places), Peak dB (1 decimal place, e.g.
  `−43.2 dB`), Apply button, Skip button. Skipped rows are dimmed (CSS opacity
  0.4). "Apply All" button at the bottom is disabled when all rows are either
  applied or skipped.
- [ ] **T4.3** Trigger "Detect": generate a unique `requestId` (e.g.
  `crypto.randomUUID()`), post `detect-silence` to the worker, set
  `detecting(true)`. Handle incoming `silence-progress` (update `progress`
  signal), `silence-result` (set `regions`, clear `detecting`), `silence-error`
  (set `error`, clear `detecting`). Use `onCleanup` to post
  `cancel-silence-detection` if the component unmounts while detecting.
- [ ] **T4.4** Apply single region: call `props.onApplyRegion(region)`. Mark
  the row as applied (add to an `applied: Set<number>` signal). Apply All:
  call `props.onApplyAll(nonSkippedRegions)` then mark all as applied.
- [ ] **T4.5** Close guard: if `regions().length > 0` and any rows are neither
  applied nor skipped, show a `window.confirm` before allowing the panel to
  close (controlled by the parent via a `show` prop or by unmounting).
- [ ] **T4.6** In `src/ui/App.tsx`, wire `onApplyRegion` and `onApplyAll` to
  dispatch `ripple-delete` commands for the clips within the region boundaries.
  Each `onApplyRegion` call dispatches exactly one `ripple-delete` (one Phase 9
  undo step). `onApplyAll` dispatches one `ripple-delete` per region
  sequentially. No media objects or GPU handles in the component.

## T5 — Keystroke overlay: event-log extension (R3)

- [ ] **T5.1** In `src/engine/capture/event-log.ts` (create the file if Phase 43
  has not yet landed it; add the type extension if it has), add the `key`
  variant to `CaptureEventLogEntry`:
  `| { kind: 'key'; combo: string; t: number }`.
- [ ] **T5.2** Export `shouldRecordKey(event: KeyboardEvent): boolean` from
  `event-log.ts`. Implementation: return `false` if the active element is
  `INPUT | TEXTAREA | SELECT` or has `contentEditable !== 'false'` or has
  `type === 'password'`; return `false` if no modifier keys held
  (`!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey`)
  AND `event.key.length === 1`; otherwise return `true`.
- [ ] **T5.3** Export `formatKeyCombo(event: KeyboardEvent): string` from
  `event-log.ts`. Implementation: collect active modifiers in array `['Alt',
  'Ctrl', 'Meta', 'Shift']` filtering by `event.altKey`, `event.ctrlKey`,
  `event.metaKey`, `event.shiftKey`; append `event.key === ' ' ? 'Space' :
  event.key`; join with `'+'`.

## T6 — Keystroke overlay: clip generator (R3)

- [ ] **T6.1** Create `src/engine/capture/key-overlay-generator.ts`. Export
  `KeyOverlayClip`, `KEY_MERGE_THRESHOLD_S = 0.3`,
  `KEY_OVERLAY_DURATION_S = 1.2`, `KEYCAP_STYLE: Partial<TitleStyle>` (values
  from design.md), and `generateKeyOverlayClips(entries, sessionOffsetS):
  KeyOverlayClip[]`.
- [ ] **T6.2** `generateKeyOverlayClips` algorithm: filter `entries` to
  `kind === 'key'`; sort by `t` ascending; group consecutive entries where
  `entries[i+1].t - entries[i].t < KEY_MERGE_THRESHOLD_S * 1000` (if `t` is
  in ms) or `< KEY_MERGE_THRESHOLD_S` (if `t` is in s — use whatever unit
  Phase 43 defines for `t`; document the assumption in a code comment); join
  group combos with `' · '`; clip `startS = group[0].t / unit + sessionOffsetS`;
  `durationS = KEY_OVERLAY_DURATION_S`; return array.
- [ ] **T6.3** Add `WorkerCommand` entry to `src/protocol.ts`:
  `{ type: 'generate-key-overlay'; clips: KeyOverlayClip[]; sessionOffsetS:
  number }`. In `src/engine/worker.ts`, add handler: find or create a track
  named `'Keystrokes'` (kind `'video'`) as the topmost track; for each
  `KeyOverlayClip`, create a title clip (using the same path as existing
  `add-title-clip` handling) with `text`, `startS`, `durationS`, `style`
  merged over `DEFAULT_TITLE_STYLE`; commit via `commitTimelineMutation`.
- [ ] **T6.4** In `src/ui/App.tsx` (or the Capture import dialog if Phase 43
  has landed it), add a "Generate keystroke overlay" action that: reads the
  event log from the capture session, calls `generateKeyOverlayClips`, and
  posts `generate-key-overlay` to the worker. The action is disabled when no
  key-event log entries are available.

## T7 — Chapter export (R4)

- [ ] **T7.1** Create `src/engine/chapters.ts`. Export `ChapterEntry`,
  `ChapterValidationResult`, `generateChapterText`, `generateChaptersJson`,
  and `formatChapterTimestamp` with exact signatures from design.md.
- [ ] **T7.2** `generateChapterText` implementation: filter markers to
  non-empty labels, sort by time, auto-insert Intro at time 0 if absent,
  validate count ≥ 3, validate spacing ≥ 10 s for every adjacent pair
  (return typed error on failure), format each entry as
  `${formatChapterTimestamp(time)} ${label}`, join with `'\n'`.
- [ ] **T7.3** `formatChapterTimestamp` implementation: integer arithmetic
  only — `HH` = `Math.floor(s / 3600)`, `MM` = `Math.floor((s % 3600) / 60)`,
  `SS` = `Math.floor(s % 60)`, each padded with `String.prototype.padStart(2,
  '0')`. No fractional seconds.
- [ ] **T7.4** Extend `src/ui/ExportDialog.tsx` with a Chapters tab or
  collapsible section. It reads `props.markers` (type
  `TimelineMarkerSnapshot[]`), calls `generateChapterText`, and renders: the
  chapter list (or validation error with guidance text), a **Copy to
  Clipboard** button (`navigator.clipboard.writeText`), and a **Save
  .chapters.txt** button. The Save button uses `showSaveFilePicker` with
  suggested name `<project-name>.chapters.txt` and blob-download fallback; on
  success, also writes `<project-name>.chapters.json` (from
  `generateChaptersJson`) to the same directory (or as a second download).

## T8 — Screencast caption preset (R5)

- [ ] **T8.1** In `src/engine/captions/types.ts`, extend `CaptionPresetId` to
  `'subtitle' | 'lower-third' | 'note' | 'screencast'`. Add the `screencast`
  entry to `CAPTION_PRESETS` with the exact values from design.md (label,
  style, anchor, maxWidthPercent, lineWrap). Do not modify `DEFAULT_CAPTION_STYLE`.
- [ ] **T8.2** Verify `normalizeCaptionStyle` handles the new preset ID without
  changes (it reads from `CAPTION_PRESETS` by key; adding the key is
  sufficient). Verify that an unknown `presetId` still falls back to
  `'subtitle'` (the existing guard).
- [ ] **T8.3** In the caption track inspector UI (whichever component renders
  the preset picker — find it via `grep -r 'CAPTION_PRESETS\|presetId'
  src/ui/`), confirm the `'screencast'` entry appears automatically (the
  picker iterates `CAPTION_PRESETS`). No UI code change needed if the picker
  already maps over the preset object; otherwise add it explicitly.
- [ ] **T8.4** Create `src/presets/captions/screencast.json` with the preset
  values as JSON plus `"captionStyleSchemaVersion": 1`. This file is for
  documentation only; do not import it in any runtime module.

## T9 — Unit tests (R6)

- [ ] **T9.1** `src/engine/silence-detector.test.ts`: generate synthetic PCM
  (`Float32Array`) — 1 s of amplitude 0.1 (speech), 0.8 s of amplitude 0.0005
  (silence at ~−66 dBFS), 1 s of amplitude 0.1 (speech) — at 48 000 Hz. Run
  `detectSilence` with default params. Assert: exactly 1 region returned;
  `startS` ≈ 1.0 + 0.15 (after padding), `endS` ≈ 1.8 − 0.15 (after
  padding), both within ±0.02 s; `peakDb` ≤ −36. Test merge: two 0.4 s
  silence regions separated by a 0.2 s speech segment → merged into one (since
  0.2 s < `minKeptSegment` 0.3 s). Test determinism: run twice on the same
  array, assert `JSON.stringify` output is identical. Test parameter validation:
  `closeThreshold = openThreshold − 1` (inverted) should either throw or return
  an empty array (document the chosen behaviour in the test description).
- [ ] **T9.2** `src/engine/chapters.test.ts`: (a) markers with no 0-second
  entry → auto-Intro inserted at 00:00:00; (b) two valid markers + Intro = 3
  chapters → passes; (c) only two unique labeled markers + Intro but second is
  < 10 s from Intro → `valid: false` with chapter name in reason; (d) marker
  list already has a 0-second entry → no duplicate Intro; (e)
  `formatChapterTimestamp(0)` → `'00:00:00'`; `(3661)` → `'01:01:01'`; (f)
  `generateChaptersJson` output parses as valid JSON array with correct fields.
- [ ] **T9.3** `src/engine/capture/event-log.test.ts` (create or extend):
  (a) `shouldRecordKey` — pass for `Ctrl+S` (with mocked ctrlKey+S target:
  document.body); fail for bare `'a'` key; fail when target is an INPUT
  element; pass for `'Escape'` with no modifiers; (b) `formatKeyCombo` —
  produces `'Ctrl+Shift+Z'` from event with ctrlKey+shiftKey+key`'z'`; produces
  `'Space'` for bare space; (c) `generateKeyOverlayClips` — two events 200 ms
  apart merge into one clip; two events 400 ms apart do not merge; empty input
  returns empty array.
- [ ] **T9.4** `src/engine/captions/types.test.ts` (create or extend): (a)
  `normalizeCaptionStyle({ presetId: 'screencast' })` returns a style object
  with `fontFamily` containing `'Courier New'`; (b)
  `normalizeCaptionStyle({ presetId: 'nonexistent-future-preset' as any })`
  returns defaults matching `'subtitle'` preset (no throw); (c) the
  `CAPTION_PRESETS.screencast.anchor` is `'bottom-center'`.

## T10 — Docs and quality gate (R6)

- [ ] **T10.1** Update `docs/USER-GUIDE.md`: add a **Silence Detection** section
  (how to select audio tracks, open the Silence Review Panel, tune parameters,
  review per-region Apply/Skip, Apply All, undo); add a **Keystroke Overlay**
  section (opt-in requirement in Phase 43 capture settings, "Generate keystroke
  overlay" action, editing clips on the Keystrokes track); extend the
  **Markers** section with a **YouTube Chapters** subsection (how to add
  markers, auto-Intro rule, 3-chapter minimum and 10-second spacing rules,
  Export → Chapters button, sidecar files produced, note on MP4 chapter
  metadata gap); extend the **Captions** section with a brief note that the
  "Screencast" preset is available for high-contrast monospace on-screen text.
- [ ] **T10.2** `npm run build` succeeds (strict TypeScript, zero errors). Fix
  any type errors introduced by the `CaptionPresetId` union extension before
  marking this done.
- [ ] **T10.3** `npm test` is green and the test count grows by at least the
  cases in T9.1–T9.4 (minimum 15 new test assertions across the four test
  files).
