# Tasks: Phase 42 — Recorder UX

## T1 — Protocol extensions (R3, R4, R6, R7, R8)

- [ ] **T1.1** Add `capture-pause` and `capture-resume` commands to the `WorkerCommand`
  union in `src/protocol.ts` (no payload for either; timing is derived worker-side
  from the first/last encoded frame timestamp).
- [ ] **T1.2** Extend the `capture-start` command type in `src/protocol.ts` with an
  optional `retakeClipId?: string` field (backward-compatible; undefined means normal
  session start).
- [ ] **T1.3** Add `CaptureUxProbeResult` interface and optional `captureUx?:
  CaptureUxProbeResult` field to `CapabilityProbeResult` in `src/protocol.ts`:
  `{ documentPip: FeatureSupport; cropTarget: FeatureSupport;
  elementCapture: FeatureSupport }`.
- [ ] **T1.4** Extend the `capture-status` state union in `src/protocol.ts` to include
  `'paused'` alongside the Phase 41 states (`'idle' | 'armed' | 'recording' |
  'paused' | 'stopping'`).
- [ ] **T1.5** Add optional `captureSessionId?: string` field to
  `TimelineClipSnapshot` in `src/protocol.ts` (inert for tools that do not know
  Phase 42; ignored by existing import/serialization validators).

## T2 — Manifest record extensions (R3, R4, R7)

- [ ] **T2.1** Add four new record kinds to the `CaptureManifestRecord` discriminated
  union in `src/engine/capture/chunk-manifest.ts`:
  ```typescript
  | { kind: 'pause';               atUs: number }
  | { kind: 'resume';              atUs: number }
  | { kind: 'source-added';        source: CaptureSourceSnapshot; atUs: number }
  | { kind: 'source-region-applied'; sourceId: string; mode: 'crop' | 'element'; atUs: number }
  ```
- [ ] **T2.2** Update the NDJSON parser in `chunk-manifest.ts` to recognise the four
  new record kinds and to silently skip any `kind` value it does not recognise (forward
  compatibility). The parser must not throw on unknown kinds — it must continue parsing
  the remaining lines. Add a test case in T7.1 for this.
- [ ] **T2.3** Add `appendPauseRecord(atUs: number)` and `appendResumeRecord(atUs:
  number)` helpers to the manifest API in `chunk-manifest.ts` following the same
  pattern as the existing `appendChunkRecord` / `appendSourceEndedRecord` helpers.

## T3 — Capability probes (R6, R7)

- [ ] **T3.1** Create a `captureUxProbe()` async function in
  `src/engine/capability-probe-v2.ts` that returns `CaptureUxProbeResult`:
  probe `documentPip` via `'documentPictureInPicture' in window`; probe `cropTarget`
  via `'CropTarget' in globalThis`; probe `elementCapture` via `'RestrictionTarget' in
  globalThis`. Map probe errors to `'unknown'` (same pattern as existing probes).
- [ ] **T3.2** Call `captureUxProbe()` from the main probe function and assign the
  result to `result.captureUx` in `src/engine/capability-probe-v2.ts`.
- [ ] **T3.3** Surface `captureUx.documentPip`, `captureUx.cropTarget`, and
  `captureUx.elementCapture` as three rows in `src/ui/CapabilityMatrixPanel.tsx`
  labelled "Document PiP", "Region Capture (Experimental)", and "Element Capture
  (Experimental)" respectively, using the existing chip + note format. None of these
  rows drives a reduced-tier action — they are informational.
- [ ] **T3.4** Implement the `window.__localcutCapabilityOverrides` dev hook at the
  bottom of the probe function in `src/engine/capability-probe-v2.ts`:
  ```typescript
  if (import.meta.env.DEV) {
    const overrides = (globalThis as Record<string, unknown>).__localcutCapabilityOverrides;
    if (overrides && typeof overrides === 'object') {
      Object.assign(result, overrides);
    }
  }
  ```
  This block is Vite-eliminated in production builds (`import.meta.env.DEV === false`).

## T4 — Settings persistence (R9)

- [ ] **T4.1** Add `CAPTURE_SETTINGS_STORE = 'capture-settings'` to
  `src/engine/persistence.ts`; register it in the `onupgradeneeded` handler for the
  existing v2 schema of `localcut-projects` (same pattern as `PUBLISH_SETTINGS_STORE`
  added by Phase 47 — no version bump, just a new store name in the existing upgrade
  block).
- [ ] **T4.2** Define `CaptureUxSettings` interface in `src/engine/persistence.ts`:
  ```typescript
  interface CaptureUxSettings {
    countdownS: 0 | 3 | 5;       // default 3
    webcamPreset: WebcamPipPreset; // default DEFAULT_WEBCAM_PRESET from webcam-preset.ts
  }
  ```
- [ ] **T4.3** Implement `saveCaptureSettings(s: CaptureUxSettings): Promise<void>` and
  `loadCaptureSettings(): Promise<CaptureUxSettings>` in `src/engine/persistence.ts`;
  `loadCaptureSettings` returns the default on any read failure (missing store, parse
  error).
- [ ] **T4.4** Write a test case in the existing persistence/bundle-isolation test
  (or a new `src/engine/capture/settings-isolation.test.ts`) asserting that
  `CAPTURE_SETTINGS_STORE` content is not reachable from the Phase 23 bundle
  serializer's input — same structure as the Phase 47 `PUBLISH_SETTINGS_STORE`
  isolation test.

## T5 — Webcam PiP transform derivation (R5)

- [ ] **T5.1** Create `src/engine/capture/webcam-preset.ts` with:
  - `WebcamPipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`
  - `WebcamPipSize = 'S' | 'M' | 'L'`
  - `WebcamPipPreset { corner: WebcamPipCorner; size: WebcamPipSize; marginPx: number }`
  - `DEFAULT_WEBCAM_PRESET: WebcamPipPreset` (`corner: 'bottom-right'`, `size: 'M'`,
    `marginPx: 16`)
  - `deriveWebcamTransform(preset, canvasW, canvasH, sourceW, sourceH)` returning
    `{ x: number; y: number; width: number; height: number }` (normalised 0–1) per the
    formula in design.md §Webcam PiP. Size percentages: S = 0.20, M = 0.30, L = 0.40 of
    canvas width; height preserves source aspect ratio. `marginPx` is clamped to [0, 64]
    before normalisation.
- [ ] **T5.2** Call `deriveWebcamTransform` in the landing path inside
  `src/engine/capture/capture-session.ts`: after landing the webcam source's clip, set
  `clip.transform` to the derived values. The canvas W/H come from `ExportSettings`
  (the current project's width/height); the source W/H come from the webcam source's
  `CaptureSourceSnapshot.encoderConfig` resolution. If `ExportSettings` is absent,
  fall back to 1920 × 1080.

## T6 — Pause/resume engine (R3)

- [ ] **T6.1** Create `src/engine/capture/pause-resume.ts` with three exported pure
  functions:
  - `extractPauseResumePairs(records: readonly CaptureManifestRecord[]): PauseResumePair[]`
    — pairs consecutive `pause`/`resume` records in manifest order; a final unpaired
    `pause` record is excluded from the output.
  - `computeGapCollapsedUs(rawTs: number, pairs: readonly PauseResumePair[]): number`
    — returns `rawTs − Σ(pair.resumeAtUs − pair.pauseAtUs)` for all pairs where
    `pair.resumeAtUs ≤ rawTs`. Integer arithmetic only (µs are integers in the
    manifest); no floating-point accumulation.
  - `seamMarkerPositionsUs(pairs: readonly PauseResumePair[]): { positionUs: number; label: string }[]`
    — returns `{ positionUs: computeGapCollapsedUs(pair.resumeAtUs, allPriorPairs),
    label: "Resume N" }` for each pair (N is 1-based index).
- [ ] **T6.2** Add `capture-pause` command handler to `src/engine/capture/capture-session.ts`:
  suspend the MSTP reader loops for all active sources (via their `AbortController`
  signals — pause should abort the reader and let it restart on resume); call
  `appendPauseRecord(lastEncodedFrameTs)` on the manifest; transition session state to
  `'paused'`; emit `capture-status` with `state: 'paused'`.
- [ ] **T6.3** Add `capture-resume` command handler: restart the MSTP reader loops
  (construct new `AbortController`, re-create reader from `MediaStreamTrack`); call the
  Phase 41 epoch mechanism to start a new chunk epoch; call `appendResumeRecord(firstEncodedFrameTs)`
  after the first frame encodes; transition state to `'recording'`; emit `capture-status`.
- [ ] **T6.4** Extend the landing function in `capture-session.ts`: after all clips are
  created, call `extractPauseResumePairs`, apply `computeGapCollapsedUs` to each
  clip's first-sample timestamp to get the adjusted placement offset, and call
  `seamMarkerPositionsUs` to create `TimelineMarkerSnapshot` objects which are added
  to `ProjectDoc.markers` via the `add-timeline-marker` command batch — all as part of
  the single undoable landing operation (R3.4).
- [ ] **T6.5** Extend the retake landing path: when `retakeClipId` is set on the
  arriving `capture-start`, store the target clip id. On `capture-landed`, call
  `applyRetakeToClip` (T11.1) to produce the replacement clip snapshot; replace the
  original clip in the timeline (same `id`); keep the old source in the media bin
  (do not remove it from `ProjectDoc.sources`). The whole replacement is one undoable
  operation.

## T7 — Unit tests: manifest extensions and pause/resume (R10)

- [ ] **T7.1** Create `src/engine/capture/manifest-extensions.test.ts`:
  - Forward-compatibility: parse an NDJSON manifest containing an unknown
    `kind: 'future-record'` — assert the parser does not throw, skips the line, and
    returns all other records correctly.
  - Parse a manifest with `pause`, `resume`, `source-added`, and
    `source-region-applied` records — assert each field is correctly read.
  - Torn-tail tolerance: a manifest ending mid-JSON after a `pause` record — assert
    the torn line is discarded and prior records are parsed correctly.
- [ ] **T7.2** Create `src/engine/capture/pause-resume.test.ts`:
  - **Three-pause drift test:** construct a synthetic manifest with 3 pause/resume
    pairs (arbitrary µs timestamps); run `computeGapCollapsedUs` on 12 sample
    timestamps distributed across the 4 segments; assert that for each sample, the
    adjusted timestamp equals `rawTs − sum of all prior gap durations`, with integer
    arithmetic (no rounding error).
  - **Paused-then-stopped test:** manifest with 2 pause records and 1 resume record
    (second pause has no paired resume); assert `extractPauseResumePairs` returns only
    1 pair; assert the final segment clips end at the second `pause.atUs` with no extra
    gap subtracted.
  - **Seam marker positions test:** for 3 pairs, assert `seamMarkerPositionsUs` returns
    3 entries with labels "Resume 1", "Resume 2", "Resume 3" and `positionUs` values
    equal to the collapsed resume timestamps.
  - **State machine transition test:** mock `CaptureSession` command handlers;
    dispatch `capture-pause`; assert status emitted with `state: 'paused'`; dispatch
    `capture-resume`; assert status emitted with `state: 'recording'`.

## T8 — Unit tests: webcam preset and retake (R10)

- [ ] **T8.1** Create `src/engine/capture/webcam-preset.test.ts`:
  - For all 4 corners × 3 sizes (12 combinations), call `deriveWebcamTransform` with
    a 1920 × 1080 canvas and a 1280 × 720 source; assert `x`, `y`, `width`, `height`
    are all in [0, 1] and that the clip fits within the canvas (no overflow for any
    corner with `marginPx = 16`).
  - **Size percentages:** assert that for size `'S'`, `width ≈ 0.20`; for `'M'`,
    `width ≈ 0.30`; for `'L'`, `width ≈ 0.40` (tolerance ≤ 0.001).
  - **Aspect ratio:** assert `height / width ≈ 720 / 1280` (tolerance ≤ 0.001) for
    the 1280 × 720 source.
  - **Margin clamping:** `marginPx = -4` clamps to 0; `marginPx = 100` clamps to 64;
    assert the resulting transform differs from the unclamped case.
- [ ] **T8.2** Create `src/engine/capture/retake.test.ts`:
  - Build a `TimelineClipSnapshot` with `id`, `sourceId`, `duration`, `inPoint`,
    `outPoint`, `transform`, `keyframes`, and `captureSessionId` fields.
  - Call `applyRetakeToClip(original, newSourceId, newDuration)`; assert `id` is
    unchanged; `sourceId` is `newSourceId`; `duration` is `newDuration`; `inPoint`
    is 0; `outPoint` is `newDuration`; `transform` and `keyframes` are deeply equal
    to the originals.
  - Call undo scenario: simulate reverting to the original snapshot; assert that a
    reconstructed clip from the original data passes an equality check against the
    pre-retake state.

## T9 — CountdownOverlay component (R2)

- [ ] **T9.1** Implement `CountdownOverlay` as a local component inside
  `src/ui/RecordPanel.tsx` (not a separate file — it is only used here). It renders
  a fullscreen fixed-position `<div>` with a semi-transparent scrim, a centred
  large numeral showing `countdownRemaining`, a Cancel button, and an
  `aria-live="assertive"` region that announces each count value as text. No media
  objects; no `postMessage`; pure SolidJS signals.
- [ ] **T9.2** Drive the countdown from a `setInterval` in the RecordPanel: interval
  fires every 1 s, decrementing `countdownRemaining`. At 0, clear the interval and
  issue `capture-start`. Cancel clears the interval and returns to `'idle'`. Escape
  key fires Cancel. Use `onCleanup` to clear the interval if the component unmounts
  mid-countdown.
- [ ] **T9.3** When `countdownS === 0`, clicking Start skips the overlay entirely and
  calls `capture-start` immediately (no `setInterval`, no overlay shown).

## T10 — RecorderControlStrip component (R6)

- [ ] **T10.1** Create `src/ui/RecorderControlStrip.tsx`. Props: `session`,
  `elapsedUs`, `pausedUs`, `onPause`, `onResume`, `onStop`. Renders:
  elapsed time formatted as `MM:SS` (paused time as a secondary `MM:SS`), a
  Pause button (visible when `session === 'recording'`), a Resume button (visible
  when `session === 'paused'`), and a Stop button. Both buttons are keyboard-
  reachable, ARIA-labeled, and meet 3:1 contrast minimum. The root element carries
  `data-testid` set by a prop `testId: string` (caller passes `'recorder-control-strip-pip'`
  or `'recorder-control-strip-inpage'`).
- [ ] **T10.2** In `src/ui/RecordPanel.tsx`, when a recording session starts (state
  transitions to `'recording'`): if `captureUx.documentPip === 'supported'`, call
  `documentPictureInPicture.requestWindow({ width: 320, height: 80 })`, then use
  SolidJS `render()` to mount `RecorderControlStrip` into the returned window's
  document body. Set `documentPipActive` signal to `true`. If the call throws or the
  window is null, fall through to the in-page path.
- [ ] **T10.3** Register a `pagehide` listener on the PiP window in an `onCleanup`
  callback: when fired (user closed the PiP window), set `documentPipActive` to
  `false`; the in-page strip becomes visible automatically (it is always mounted, just
  hidden via CSS when `documentPipActive` is `true`).
- [ ] **T10.4** Render the in-page `RecorderControlStrip` unconditionally into the main
  document as a `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%)`
  strip. Hide it with `display: none` (not `visibility: hidden`) when the PiP window
  is active (`documentPipActive === true`) to avoid presenting duplicate controls.
- [ ] **T10.5** On session stop or `capture-landed`, dispose the PiP window SolidJS
  root (call the `dispose()` function returned by `render()`) and call
  `documentPictureInPicture.window?.close()` in the `onCleanup` path.

## T11 — Retake engine (R8)

- [ ] **T11.1** Create `src/engine/capture/retake.ts` exporting `applyRetakeToClip`:
  takes the original `TimelineClipSnapshot` and new `sourceId` + `durationS`; returns
  a new `TimelineClipSnapshot` with `id`, `transform`, `keyframes`, and all other
  fields preserved, and `sourceId`, `duration`, `inPoint` (0), `outPoint` (durationS)
  updated. Does no I/O; pure function.
- [ ] **T11.2** Extend `src/ui/Inspector.tsx`: when the selected clip's snapshot has a
  `captureSessionId` field, render a **Retake** button in the clip-properties section.
  The button is disabled (with reason text) when `session !== 'idle'` (recording in
  progress) or when `acquire('capture')` would return `'budget-exhausted'`. Clicking
  the enabled button calls a `onRetakeRequested(clipId)` callback passed from
  `App.tsx`, which sets the `retakeClipId` signal in RecordPanel and puts the panel
  into `'countdown'` state with the retake clip id.
- [ ] **T11.3** In `src/ui/App.tsx` (or wherever `Inspector` and `RecordPanel` are
  wired), connect `onRetakeRequested` from Inspector to RecordPanel's retake entry
  point. No media objects cross this boundary — only the `clipId: string`.

## T12 — RecordPanel and mid-session source switching (R1, R4, R5)

- [ ] **T12.1** Create `src/ui/RecordPanel.tsx` as the definitive Record panel (Phase
  42 owns this file). Include all Phase 41 acquisition controls: Add screen (one
  `getDisplayMedia` gesture each), camera picker, mic picker, capability-gated
  system/tab-audio toggle. Add Phase 42 controls: countdown-duration selector (0/3/5 s
  radio group), Pause/Resume, webcam layout preset section (hidden when no webcam
  source is present), Region/Element Capture options in the source picker (gated on
  `cropTarget` / `elementCapture` probes, labelled Experimental, own-tab only).
- [ ] **T12.2** Gate the panel on Phase 41's `recordingAvailable` derivation. When
  false, render the panel visible-but-disabled with per-missing-probe reasons and
  action links (Phase 26 pattern). Never hide the panel entirely.
- [ ] **T12.3** Mid-session source switching: the Add screen / camera / mic controls
  remain enabled while `session === 'recording' || session === 'paused'`. Adding a
  source mid-session sends `capture-add-source` with the new track. The source chip
  list is derived from `capture-status.sources` (reactive).
- [ ] **T12.4** Region/Element Capture flow: "Own tab (Region)" / "Own tab (Element)"
  options appear in the Add source section when the respective probes are `'supported'`.
  Both options are labelled **"Experimental"**. Selecting one prompts the user with a
  brief instruction ("Click the element to capture"), listens for a single `click`
  event on the document, calls `CropTarget.fromElement(el)` or
  `RestrictionTarget.fromElement(el)`, and applies it to the existing tab source track
  via `track.cropTo(cropTarget)` or `track.restrictTo(restrictionTarget)`. If no tab
  source is active, the options are rendered disabled with "Add a Tab source first".
  On success, appends a `source-region-applied` manifest record via the
  `capture-add-region` command (T1 command, or done inline in the session worker via
  a new dedicated command `{ type: 'capture-apply-region'; sourceId: string; mode:
  'crop' | 'element' }`).
- [ ] **T12.5** Webcam layout controls: four corner-position buttons (icon-labelled),
  S/M/L size radio buttons, margin number input (0–64 step 4). All changes are saved
  immediately to `CAPTURE_SETTINGS_STORE`. CSS self-monitor tile updates reactively to
  reflect the chosen preset via inline style (`position: absolute; width: ...; ...`).
- [ ] **T12.6** Accessibility pass: all controls keyboard-operable, ARIA-labeled,
  visible focus, no colour-only state indicators. The recording-active state is
  announced via ARIA live region. `onCleanup` for the PiP window, countdown interval,
  and any `document` event listeners.

## T13 — Playwright tests (R10)

- [ ] **T13.1** Create `tests/e2e/recorder-ux.spec.ts`. Configure `test.describe` in
  `serial` mode (one worker). Both tests reuse the Vite dev server started by the
  existing `playwright.config.ts` (`test:e2e` script).
- [ ] **T13.2** **Record → pause → resume → stop → timeline test:**
  Launch Chromium with browser args:
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --auto-select-desktop-capture-source`. These are added to the test's
  `browserContext` `launchOptions.args`. Navigate to `http://127.0.0.1:5173`. Open
  the Record panel. Add a camera and a screen source. Click Start (3 s countdown
  elapses or is skipped by setting `countdownS = 0` via the settings UI first). Wait
  for `data-testid="recorder-control-strip-inpage"` to be visible. Click Pause. Wait
  for `[aria-label="Paused"]` indicator. Click Resume. Wait 2 s. Click Stop. Wait for
  `capture-landed` (poll for two new tracks appearing in the Timeline DOM — selector
  `[data-testid="timeline-track"]` count ≥ 2). Assert a `[data-testid="timeline-marker"]`
  with label text "Resume 1" exists.
- [ ] **T13.3** **Document PiP fallback test:**
  Use `page.addInitScript` to inject
  `window.__localcutCapabilityOverrides = { captureUx: { documentPip: 'unsupported' } }`
  before navigation. Navigate and start a recording (camera only, fake device).
  Assert `[data-testid="recorder-control-strip-inpage"]` is visible and `display`
  is not `none`. Click Stop via the in-page strip. Assert normal landing (one new
  timeline track).

## T14 — Docs (R10)

- [ ] **T14.1** Create `docs/RECORDING.md` covering: countdown configuration (0/3/5 s),
  pause/resume (what the seam markers are, that gaps are collapsed on landing),
  webcam PiP layout presets (four corners, S/M/L sizes, margin; note that the preset
  applies at landing — the live monitor tile is a preview only), Document PiP
  (Chromium-only; in-page fallback on Safari/Firefox), Region Capture and Element
  Capture (Experimental; Chromium-only; own-tab only; difference between Region and
  Element), and the Retake flow (how to use it, that undo works, and that the old
  recording stays in the media bin).
- [ ] **T14.2** Update `docs/USER-GUIDE.md` to link to `docs/RECORDING.md` from the
  recording section. Update the recording capability summary table (Safari/Firefox
  recording unavailable with per-probe reasons; Document PiP, Region Capture, Element
  Capture labelled Chromium-only).
- [ ] **T14.3** `npm run build` succeeds with strict TypeScript. `npm test` is green
  and the test count is higher than before Phase 42. `npm run test:e2e` runs the two
  new Playwright tests without a container dependency (they use the fake device flags
  and the Vite dev server only).
