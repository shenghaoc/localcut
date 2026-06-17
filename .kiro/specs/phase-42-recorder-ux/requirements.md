# Requirements: Phase 42 — Recorder UX

Phase 42 owns the complete recorder user interface that Phase 41's capture engine
exposes to the user. Phase 41 (PR #64) provides the recording substrate — the
protocol commands, OPFS chunk pipeline, manifest engine, and landing logic. Phase 42
provides everything the user sees and interacts with: the Record panel itself
(`src/ui/RecordPanel.tsx`, definitively owned here so Phase 41's T10 is superseded),
the control strip hosted in a Document Picture-in-Picture window, the countdown overlay,
pause/resume with precisely defined timestamp-gap semantics, mid-session source
switching, webcam PiP layout presets, Region Capture and Element Capture for own-tab
demo recording, and the retake flow. Every Phase 42 feature is gated by the Phase 26
capability probes; missing capabilities degrade gracefully to a reduced tier — the app
never crashes.

**Depends on Phase 41 (PR #64).** The contracts this spec relies on:
`capture-start` / `capture-stop` / `capture-add-source` / `capture-remove-source`
commands and `capture-status` / `capture-error` / `capture-landed` state messages in
`src/protocol.ts`; `CaptureManifestRecord` epoch/chunk/source-ended/finalize records in
`src/engine/capture/chunk-manifest.ts`; the `CaptureSourceSnapshot`, `CaptureSourceKind`,
and `CaptureSessionLifecycle` types; the capture-session start/stop/landing logic in
`src/engine/capture/capture-session.ts`. Phase 42 extends these contracts with new
manifest record kinds (pause/resume/source-added) — the extensions are
version-tolerant and backward-compatible.

## R1 — Record Panel ownership

- **R1.1** `src/ui/RecordPanel.tsx` is created and owned by Phase 42. Phase 41's T10
  is superseded: if a partial RecordPanel.tsx from Phase 41 exists at implementation
  time, Phase 42 replaces it entirely. The file must never be co-authored in a way that
  leaves the session-acquisition UI in Phase 41 and the countdown/pause/resume UI in
  Phase 42 as separate files.
- **R1.2** The panel includes all Phase 41 acquisition controls (Add screen, camera
  picker, mic picker, capability-gated system/tab-audio toggle) plus the Phase 42
  features (countdown config, Pause/Resume, retake, webcam PiP preset picker, Region/
  Element Capture option in the source picker). It sends all its commands over the
  existing Phase 41 protocol (`capture-add-source`, `capture-start`, `capture-stop`,
  `capture-remove-source`) plus the new Phase 42 protocol extensions defined in R3 and R5.
- **R1.3** The panel is gated on `recordingAvailable` (Phase 41 `CapabilityProbeResult`
  derivation). When `recordingAvailable` is false, the panel is visible but disabled
  with per-missing-probe reasons and action links (Phase 26 pattern), never hidden.
- **R1.4** All panel controls are keyboard-operable, ARIA-labeled, and focus-managed per
  the accessibility steering. The recording state is announced via an ARIA live region
  so screen readers convey state changes without visual-only indicators.

## R2 — Countdown

- **R2.1** Before a recording session arms its encoders, a fullscreen countdown overlay
  is shown. The default countdown duration is **3 seconds**; the user may configure it
  to **0 s** (disabled), **3 s**, or **5 s** in the Record panel settings. The setting
  persists in the `CAPTURE_SETTINGS_STORE` app-scoped IndexedDB store defined in R9.
- **R2.2** The countdown overlay displays the current count (3 → 2 → 1 → recording
  starts) as a large centred numeral, with a background scrim that does not occlude the
  self-monitor tiles. When the count reaches 0, the overlay dismisses and the
  `capture-start` command is sent to the worker. No `VideoFrame` or `AudioData` is
  produced or discarded during the countdown — encoders are not armed until after the
  countdown completes (so the recording begins at the moment the user expects, with no
  discarded frames).
- **R2.3** The overlay announces each count value via an ARIA live region with
  `aria-live="assertive"` so screen-reader users hear the countdown without requiring
  focus inside the overlay.
- **R2.4** If the user clicks Cancel during the countdown, the overlay dismisses and no
  `capture-start` command is issued; the panel returns to the idle state. Cancel is
  keyboard-reachable (Escape key).
- **R2.5** When countdown is set to 0 s, clicking Start immediately issues
  `capture-start` without any overlay or delay.

## R3 — Pause/Resume with defined gap semantics

- **R3.1** While a recording session is active (`capture-status` state `'recording'`),
  a **Pause** button is available. Pressing Pause sends a `capture-pause` command to the
  pipeline worker. The worker stops feeding frames into encoders for all active sources
  (by suspending the MSTP reader loop) and appends a manifest record:
  `{ kind: 'pause'; atUs: number }` where `atUs` is the µs timestamp of the last
  successfully encoded frame. The `capture-status` state transitions to `'paused'`.
- **R3.2** While paused, a **Resume** button replaces Pause. Pressing Resume sends a
  `capture-resume` command. The worker resumes the MSTP reader loops, starts a new chunk
  epoch (same mechanism as Phase 41's `epoch` record), and appends a manifest record:
  `{ kind: 'resume'; atUs: number }` where `atUs` is the µs timestamp of the first
  successfully encoded frame after resumption. The `capture-status` state transitions
  back to `'recording'`.
- **R3.3** **Landing formula (gap collapsing):** pause gaps are collapsed on landing so
  segments butt together on the timeline with no silence or blank frames. The landing
  math in `src/engine/capture/capture-session.ts` computes, for each sample timestamp
  `ts`, the adjusted placement time as:
  ```
  adjustedUs(ts) = ts − sum of all gap durations before ts
  gapDuration(i) = resume[i].atUs − pause[i].atUs   (for each pause/resume pair i)
  ```
  Timestamps inside each segment stay raw (µs since session start) throughout the
  pipeline; collapsing is applied only at the landing stage. This means no drift
  accumulates — each gap subtraction is derived from the manifest's monotonic
  timestamps, not from wall-clock deltas. A unit test with synthetic manifests
  (R10.2) asserts zero drift across at least 3 pause/resume cycles.
- **R3.4** At each seam between segments, a `TimelineMarker` is placed on the project
  timeline at the collapsed seam position. Markers are labelled `"Resume 1"`,
  `"Resume 2"`, etc., sequentially from the first resume. The marker is created via the
  existing `add-timeline-marker` command using the `TimelineMarkerSnapshot` type
  (`{ id, time, label }`) as part of the same undoable landing operation defined in
  Phase 41 R8.5.
- **R3.5** The elapsed-time display in the panel shows only the total recorded duration
  (pause time excluded). Paused time is shown separately as a smaller label
  ("Paused 12 s"). Both are updated on every `capture-status` message.
- **R3.6** If a source ends (browser "Stop sharing") while the session is paused, the
  `source-ended` manifest record is written immediately. On resume, that source does not
  restart (consistent with Phase 41 R6.6 per-source end semantics).
- **R3.7** Stopping while paused is valid: Stop sends `capture-stop`; the last segment
  ends at `pause[n].atUs`; the landing formula treats the final pause as having no
  paired resume (the gap extends to the stop time and is simply omitted from the
  timeline, not filled with silence).

## R4 — Mid-session source switching

- **R4.1** While recording (state `'recording'` or `'paused'`), the user may add a
  new source using the existing Add screen / camera / mic controls in the panel. Adding
  a new source sends `capture-add-source` with the new track. The session worker
  appends a new Phase 42 manifest record: `{ kind: 'source-added'; source:
  CaptureSourceSnapshot; atUs: number }` where `atUs` is the epoch-relative timestamp
  of the first encoded frame from the new source. This record is version-tolerant:
  readers that do not recognise `'source-added'` must skip it without error (the parser
  in `chunk-manifest.ts` must be updated to tolerate unknown `kind` values).
- **R4.2** Removing a source mid-session sends `capture-remove-source`; the existing
  Phase 41 `source-ended` manifest record handles this. No new manifest record is
  needed for removal.
- **R4.3** At landing, each source's track file is placed starting at
  `firstSampleTs − epochUs` as defined by Phase 41 R8.1. A source added mid-session
  starts at its own first-sample offset; it is not padded or pre-filled to the session
  start. The timeline clip for a late-starting source begins where the source actually
  starts.
- **R4.4** The panel's per-source chip list updates reactively: a newly added source
  appears immediately with its label and drop counter; a removed source chip shows a
  "ended" badge. Adding a source while paused is permitted; that source's MSTP reader
  does not begin until the next `capture-resume` command is processed.

## R5 — Webcam PiP layout presets

- **R5.1** When a webcam source is present in the session, the Record panel shows a
  **Webcam Layout** section with four corner-position presets (top-left, top-right,
  bottom-left, bottom-right), three size presets (S = 20% of canvas width, M = 30%,
  L = 40%), and a margin control (default 16 px, range 0–64 px, step 4 px). The
  selection is stored in `CAPTURE_SETTINGS_STORE` and persists across sessions.
- **R5.2** The layout preset is applied **at landing only**, not during live recording.
  Live recording keeps webcam and screen as separate tracks per Phase 41's no-premix
  rule (design.md §OPFS layout). The live self-monitor tile shows a CSS-positioned
  self-view overlay (the monitor clone's `<video>`) with the chosen layout applied as
  inline CSS transforms — this gives the user a preview of the layout without any
  compositing in the recording pipeline.
- **R5.3** At landing, the webcam clip's `transform` fields are set to the P12 values
  that implement the chosen preset. The transform is applied to the webcam clip on the
  dedicated webcam timeline track. The screen track clip is untouched. Specifically:
  the P12 `TransformParamsSnapshot` fields `x`, `y`, `scale`, and `fit` are derived
  from the preset corner + size + margin selection. Size is defined as a percentage of
  canvas width; height preserves source aspect ratio by factoring in the canvas aspect
  ratio; margin is normalised separately for the horizontal and vertical axes. The
  screen track clip uses `FitMode = 'letterbox'`. These values are written directly into
  the `TimelineClipSnapshot.transform` field during the landing operation.
- **R5.4** The webcam layout section is hidden (not merely disabled) when no webcam
  source (`CaptureSourceKind === 'webcam'`) has been added to the session.

## R6 — Document Picture-in-Picture control strip

- **R6.1** Phase 42 adds a `documentPip: FeatureSupport` probe to `CapabilityProbeResult`
  in `src/protocol.ts` and `src/engine/capability-probe-v2.ts`. The probe checks
  `'documentPictureInPicture' in window` and is Chromium-only as of June 2026; Safari
  and Firefox report `'unsupported'` and receive the in-page fallback automatically
  (R6.4). The probe is in the optional `captureUx` group alongside the Phase 41 probes
  (not a hard gate — `recordingAvailable` is unchanged by its absence).
- **R6.2** `src/ui/RecorderControlStrip.tsx` is a standalone SolidJS component that
  renders the essential recording controls: Pause/Resume, Stop, elapsed time, and
  paused-time indicator. It holds no media objects, issues no `postMessage` calls
  directly — it communicates via the same signal-based store the full RecordPanel
  uses.
- **R6.3** When the user starts a recording and `documentPip === 'supported'`, the app
  calls `documentPictureInPicture.requestWindow({ width: 320, height: 80 })` and
  renders `RecorderControlStrip` into the returned window's document using SolidJS's
  `render()` call with the shared signal store passed as context. The PiP window
  follows the browser's Document PiP lifecycle: it closes on tab close, on session
  stop, and when the user dismisses it. The app must handle premature PiP window close
  (the `pagehide` event on the PiP window) gracefully — the session continues; the
  controls revert to the in-page fallback strip.
- **R6.4** When `documentPip !== 'supported'` (or when the PiP window fails to open),
  `RecorderControlStrip` is rendered as a floating in-page strip positioned
  bottom-centre of the viewport using `position: fixed`. The in-page fallback is the
  primary, always-tested path. The Document PiP path is an enhancement.
- **R6.5** The `documentPip` probe is surfaced in the Phase 25 diagnostics panel as a
  capability chip with label "Document PiP" and category `'capability'`. No
  reduced-tier action is required when it is unsupported — the fallback always works.
- **R6.6** In dev builds, `window.__localcutCapabilityOverrides` (type
  `Partial<CapabilityProbeResult>`) is read after the real probe completes and merged
  (shallow `Object.assign`) into the result. This hook is read only when
  `import.meta.env.DEV === true` and is used exclusively for tests (R10.4). It is
  not compiled into production builds.

## R7 — Region Capture and Element Capture (experimental)

- **R7.1** Phase 42 adds two new `FeatureSupport` probes to the `capture` probe group in
  `CapabilityProbeResult`: `cropTarget: FeatureSupport` (checks
  `'CropTarget' in globalThis`) and `elementCapture: FeatureSupport` (checks
  `'RestrictionTarget' in globalThis`). Both are Chromium-only as of June 2026.
- **R7.2** When `cropTarget === 'supported'`, the source picker in the Record panel
  shows an **"Own tab (Region)"** option labelled **"Experimental"**. Selecting it
  prompts the user to click a DOM element in the current tab; the picked element's
  `CropTarget.fromElement(el)` result is applied to the screen source's video track via
  `track.cropTo(cropTarget)`. The source then records only the cropped region.
- **R7.3** When `elementCapture === 'supported'`, the **"Own tab (Element)"** option is
  shown below Region, also labelled **"Experimental"**. It uses
  `RestrictionTarget.fromElement(el)` + `track.restrictTo(restrictionTarget)` so
  occluding windows are excluded from the capture (the element is captured
  occlusion-free). If `cropTarget` is supported but `elementCapture` is not, only
  Region is shown.
- **R7.4** Both Region and Element Capture require the user to already have a
  `getDisplayMedia` tab source active on the current tab. If no tab source is active,
  the options are shown disabled with the reason "Add a Tab source first". The picker
  never triggers a new `getDisplayMedia` call — it modifies an existing track.
- **R7.5** Applying a crop or restriction appends a Phase 42 manifest extension record
  `{ kind: 'source-region-applied'; sourceId: string; mode: 'crop' | 'element';
  atUs: number }` so crash recovery and landing can document the capture mode in the
  source metadata. The record is version-tolerant (unknown `kind` values are skipped).
- **R7.6** At landing, the clip metadata for a region-captured or element-captured
  source includes `captureMode: 'region' | 'element' | 'full'` in its source
  descriptor. This is informational only — no crop is baked into the media file.
- **R7.7** When `cropTarget === 'unsupported'` and `elementCapture === 'unsupported'`,
  neither option appears in the source picker — these are genuinely Chromium-only
  features, not a reduced-tier path.

## R8 — Retake flow

- **R8.1** After a recording lands on the timeline (Phase 41 R8.2), selecting a clip
  that originated from a capture session shows a **Retake** button in the Inspector
  (alongside the standard clip controls). A clip is identified as capturable by the
  presence of a `captureSessionId` field on its `TimelineClipSnapshot`.
- **R8.2** Pressing Retake arms a new capture session bound to the original clip's slot:
  the same source kinds as the original session are pre-selected (from the
  `CaptureSourceSnapshot` stored in the landing metadata), and the panel enters the
  countdown state as defined in R2. The bound slot is communicated via the
  `capture-start` command's `retakeClipId?: string` extension field.
- **R8.3** When the retake session stops and lands, the replacement clip's content
  replaces the original clip **in place** on the timeline: the original clip's `id`
  is preserved; its source (`sourceId`) is updated to the new media asset; its
  `duration` is adjusted to match the new recording's duration; its `inPoint` and
  `outPoint` are reset to `0` and the new duration; and any existing P12/P15
  `transform` and `keyframes` on the clip are preserved unchanged.
- **R8.4** The original clip's source asset (the old recording) stays in the media bin
  as an unreferenced source — it is not deleted. The user can re-import it from the
  bin if needed.
- **R8.5** The entire retake — clip content replacement plus any seam markers from
  pause/resume — is one undoable operation via the existing P9 snapshot history. Undo
  restores the original clip content (original `sourceId`, duration, inPoint, outPoint)
  and removes the seam markers added by the retake.
- **R8.6** The Retake button is unavailable while another recording session is active
  (encoder budget gate) or while the clip is playing in the timeline. The Inspector
  shows the reason ("Recording in progress" / "Budget allows one session").

## R9 — Settings persistence

- **R9.1** A new app-scoped IndexedDB store `CAPTURE_SETTINGS_STORE` is added to
  `src/engine/persistence.ts` (outside `ProjectDoc`, following the Phase 47 precedent
  of `PUBLISH_SETTINGS_STORE`). No project schema bump is needed.
- **R9.2** The store holds: countdown duration (`0 | 3 | 5`, default `3`); webcam PiP
  position (corner enum, default `'bottom-right'`); webcam PiP size (`'S' | 'M' | 'L'`,
  default `'M'`); webcam PiP margin (number, default `16`). All fields have validated
  defaults applied on load failure.
- **R9.3** Capture settings — including webcam layout presets — are never included in
  Phase 23 project bundles or `ProjectDoc` autosaves. A test asserts this.

## R10 — Tests, CI, and docs

- **R10.1** All unit tests use Vitest in the Node environment. No large media fixtures.
  Streams, encoders, sync handles, and manifest parsers are mocked using the
  `src/engine/capture/capture-fixtures.ts` mock infrastructure from Phase 41.
- **R10.2** `src/engine/capture/pause-resume.test.ts` covers: (a) landing formula with
  a synthetic manifest containing exactly 3 pause/resume pairs — asserts that the
  adjusted placement of every sample timestamp equals the raw timestamp minus the sum
  of prior gap durations, with zero drift (floating-point epsilon ≤ 1 µs); (b) a
  paused-then-stopped session (no final resume) — the final segment ends at the pause
  point and no trailing gap is added; (c) seam marker positions match the collapsed
  seam timestamps; (d) the `capture-pause` → `'paused'` and `capture-resume` →
  `'recording'` state transitions in the capture-session state machine.
- **R10.3** `src/engine/capture/chunk-manifest.test.ts` is extended (or a new test file
  `src/engine/capture/manifest-extensions.test.ts` is created) to cover: forward-
  compatibility parsing of unknown `kind` values (must not throw, must skip); parsing
  of `'pause'`, `'resume'`, `'source-added'`, and `'source-region-applied'` records;
  torn-tail tolerance is unchanged.
- **R10.4** `tests/e2e/recorder-ux.spec.ts` (Playwright, extending the existing setup):
  (a) **Record → pause → resume → stop → timeline**: launch with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --auto-select-desktop-capture-source`; start a camera + screen recording; pause;
  resume; stop; assert two new timeline tracks are created and a "Resume 1" marker
  exists at the expected seam position (within 1 s of the calculated position); (b)
  **Document PiP fallback path**: inject
  `window.__localcutCapabilityOverrides = { captureUx: { documentPip: 'unsupported' } }`
  before starting the app (via Playwright's `page.addInitScript`) — only valid in dev
  builds where the override hook is compiled in (R6.6); start a recording; assert the
  floating in-page strip is visible (selector `[data-testid="recorder-control-strip-inpage"]`)
  and contains the Pause and Stop buttons; pause and stop via the strip; assert normal
  landing.
- **R10.5** `src/engine/capture/webcam-preset.test.ts` covers: P12 transform value
  derivation for each corner × size combination, asserting that the resulting
  center-offset `x`/`y` plus `scale`/`fit` place the clip within canvas bounds with the
  configured margin; margin clamping (0, 64, out-of-range inputs); the S/M/L size
  percentages (20 / 30 / 40 % of canvas width with aspect ratio preserved).
- **R10.6** `src/engine/capture/retake.test.ts` covers: retake landing replaces clip
  `sourceId` and adjusts `duration`/`inPoint`/`outPoint` while preserving `id`,
  `transform`, and `keyframes`; undo restores the original clip content exactly; the
  old source asset remains in the media bin after retake.
- **R10.7** `docs/USER-GUIDE.md` gains a "Recording" section covering: countdown
  configuration, pause/resume and what the seam markers mean, webcam PiP layout
  presets (with a note that it applies at landing, not live), Document PiP availability
  (Chromium only, in-page fallback on other browsers), Region/Element Capture
  (Experimental, Chromium only), and the Retake flow. A `docs/RECORDING.md` page is
  created with full detail; `docs/USER-GUIDE.md` links to it.
- **R10.8** `npm run build` succeeds with strict TypeScript. `npm test` is green and
  the test count grows.
