# Design: Phase 42 — Recorder UX

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Phase 42 builds the complete recording user experience on top of the Phase 41 capture
engine. It owns `src/ui/RecordPanel.tsx` outright (Phase 41's T10 planned that file
but did not implement it; Phase 42 supersedes it). The scope: a 3-2-1 countdown before
arming encoders; pause/resume with a mathematically defined gap-collapsing landing
formula; mid-session source switching; webcam PiP layout presets applied at landing via
P12 transforms; a `RecorderControlStrip` rendered into a Document Picture-in-Picture
window when available and into a floating in-page strip otherwise; own-tab Region
Capture and Element Capture behind capability gates; and a "Retake" flow that replaces
a landed clip in place.

## Depends on Phase 41 (PR #64)

The contracts this spec relies on:

- `capture-start` / `capture-stop` / `capture-add-source` / `capture-remove-source`
  commands and `capture-status` / `capture-error` / `capture-landed` / `capture-pause`
  / `capture-resume` messages in `src/protocol.ts`.
- `CaptureManifestRecord` (header / epoch / chunk / source-ended / finalize) in
  `src/engine/capture/chunk-manifest.ts` — Phase 42 extends this union with
  `pause`, `resume`, `source-added`, and `source-region-applied` records.
- `CaptureSourceSnapshot`, `CaptureSourceKind`, `CaptureStopReason`, `CaptureErrorCode`
  types in `src/protocol.ts`.
- The OPFS layout (`opfs:/capture/<sessionId>/manifest.ndjson` +
  `video-<sourceId>.mp4` / `audio-<sourceId>.mp4`) and the per-chunk write ordering
  contract (data → flush → manifest append → flush) in the writer worker.
- Landing via `capture-landed` driving the P9 undoable operation: one new P11 media
  asset and one new timeline track per source.
- `src/engine/capture/capture-session.ts` session orchestrator: Phase 42 adds
  `capture-pause` / `capture-resume` command handlers and the new manifest extension
  records there.
- `src/engine/encoder-budget.ts` `acquire`/`EncoderLease` — reused for retake budget
  gating.

Phase 42 does NOT own Phase 41's acquisition logic, track-pipeline.ts, writer-worker.ts,
fragmented-writer.ts, quota.ts, or crash recovery. It does own all UI and any new
manifest record kinds. Interfaces are kept loose enough to survive minor drift in Phase
41's open tasks.

## Non-goals

- **Global OS hotkeys** — no OS hooks exist in the browser; Pause/Resume/Stop are
  in-page and Document-PiP controls only.
- **Audio monitoring UI** — beyond the Phase 16 master bus meters that already exist.
  No new audio monitoring controls; P41 mutes self-monitor audio for feedback safety.
- **Live compositing during recording** — the webcam PiP preset is applied at landing,
  not composited live (see §Webcam PiP design rationale).
- **Multi-session recording** — one capture session at a time, gated by the encoder
  budget.
- **Non-Chromium recording tiers** — Phase 41 gates recording to Chromium; Phase 42
  inherits that gate. Safari and Firefox see the Record panel disabled with per-probe
  reasons.
- **Scene mixing / replay buffer / streaming** — those are Phases 43/45/46/47.
- **Audio-monitor UI** — the existing P16 meters are the audio-monitoring surface;
  Phase 42 adds nothing there.

## Why Document PiP rather than a floating overlay

Document Picture-in-Picture (`documentPictureInPicture.requestWindow()`) renders an
actual browsing context in a separate window. Unlike a floating CSS overlay, it stays
on screen while the user switches tabs (the recording target), which is precisely the
scenario for own-tab demo recording. A CSS-overlay strip stays in the tab and
disappears when the user switches away — defeating the purpose. Document PiP is
Chromium-only as of June 2026; Safari 27 and Firefox do not have it and likely will
not in the near term, so the in-page floating strip fallback is mandatory and
fully-featured, not a stub.

The `RecorderControlStrip` is a separate, self-contained SolidJS component for a
concrete reason: it must be rendered into two different DOM trees (the PiP window's
document and the main document). SolidJS's `render()` handles multiple roots; the
shared signal store is threaded through context. If only one component existed
(`RecordPanel`), rendering it into the PiP window would drag in all the source-picker
and settings UI — far too wide for a 320 × 80 px strip.

## Pause/resume gap-collapsing: design rationale

The core problem: pause gaps must not appear on the timeline as blank video or silence,
but the raw sample timestamps in the fMP4 files span the gap (timestamps are monotonic,
recording whether the source was paused). Landing must therefore subtract gap durations.

**Why "collapse at landing, not at record time":** the MSTP timestamp is the ground
truth for AV sync. Re-stamping frames during encoding would require knowing, at encode
time, whether a future pause might extend the gap — not possible. Keeping raw
timestamps throughout the pipeline preserves all the Phase 41 alignment invariants
(R8.1–R8.4) and lets the writer-worker remain stateless about pause state. The landing
formula is a single post-hoc subtraction per sample; it is pure math with no I/O side
effects and is unit-testable with synthetic manifests.

**Formula (authoritative):** let the manifest contain `n` pause/resume pairs
`{ pause[i].atUs, resume[i].atUs }` for `i = 0 … n−1`, ordered by timestamp. For a
sample at raw timestamp `ts`:

```
cumulativeGapBefore(ts) = Σ (resume[i].atUs − pause[i].atUs)
                          for all i where resume[i].atUs ≤ ts

adjustedUs(ts) = ts − cumulativeGapBefore(ts)
```

If the session ended while paused (no paired resume for the last pause), that pause is
NOT counted in `cumulativeGapBefore` for any timestamp (there is no gap to subtract —
the session simply stopped; the last segment ends at `pause[n].atUs`). Clip placement
on the timeline uses `adjustedUs(firstSampleTs) − epochUs`.

**Zero-drift property:** because every gap subtraction is derived from the manifest's
monotonic µs timestamps (not wall-clock deltas or frame count estimates), the error is
at most floating-point rounding. The unit test (R10.2) asserts ≤ 1 µs total error
across a 3-pause synthetic manifest.

**Seam markers:** a `TimelineMarker` at each seam (`adjustedUs(resume[i].atUs)`,
label `"Resume i+1"`) lets the editor find pause points. Reuse
`TimelineMarkerSnapshot { id, time, label }` and the `add-timeline-marker` command
exactly as Phase 10 defined them — no type extension needed.

## Webcam PiP layout presets: design rationale

Phase 41's rule is "sources are never premixed in the recording pipeline." Recording
the composited output would burn the layout into the media — no post-edit flexibility.
Instead, Phase 42 applies P12 per-clip transforms to the webcam clip at landing. This
keeps the recorded files independent and editable while giving users a one-click layout.

Live preview of the layout: the monitor clone's `<video>` element receives inline CSS
transform/size/position that mirrors the preset. This is pure CSS on the main thread —
no compositing, no VideoFrame, no GPU work. The CSS layout on the monitor tile is
cosmetic only; the recorded files remain raw.

The P12 `TransformParamsSnapshot` has center-offset `x`/`y` plus `scale`/`fit`; it
does not have `width` or `height` fields. The webcam preset therefore first derives a
normalised target rectangle from corner + size + margin, then converts that rectangle
to the existing center-offset transform model:

```
webcamW = sizePercent(size) * 1.0           // S=0.20, M=0.30, L=0.40 of canvas width
webcamH = webcamW * (canvasWidth / canvasHeight) * (sourceHeight / sourceWidth)
marginX = margin / canvasPixelWidth
marginY = margin / canvasPixelHeight

bottom-right:   x = 1 − marginX − webcamW,  y = 1 − marginY − webcamH
bottom-left:    x = marginX,                 y = 1 − marginY − webcamH
top-right:      x = 1 − marginX − webcamW,  y = marginY
top-left:       x = marginX,                 y = marginY

centerX = x + webcamW / 2
centerY = y + webcamH / 2
transform.x = centerX − 0.5
transform.y = centerY − 0.5
transform.scale = webcamW / computeFitRect(source, canvas, 'fit').width
transform.fit = 'fit'
```

The screen track uses `FitMode = 'letterbox'` (existing, no change). Both are written
into the timeline clip's `transform` field during the single undoable landing operation.

## Architecture: what runs where

```
main thread                             pipeline worker
──────────────────────────────          ──────────────────────────────────────────────
RecordPanel.tsx                         capture-session.ts (Phase 41 orchestrator)
  signals: countdownS, sessionState,     ├── capture-pause handler
    pausedTimeUs, elapsedTimeUs,         │     suspend MSTP reader loops
    sources[], webcamPreset,             │     append { kind:'pause'; atUs } to manifest
    documentPipActive                    ├── capture-resume handler
  ├── CountdownOverlay (local)           │     resume MSTP reader loops, new epoch
  ├── RecorderControlStrip               │     append { kind:'resume'; atUs }
  │     (in PiP window or in-page)      ├── capture-add-source (mid-session)
  └── Inspector Retake button            │     append { kind:'source-added'; ... }
        (in src/ui/Inspector.tsx)        └── landing (extended)
                                               gap-collapsing formula
                                               seam markers via add-timeline-marker
                                               webcam P12 transforms
                                               retake clip replacement

capture-fixtures.ts (test support, Phase 41) — used by Phase 42 unit tests too
```

**What crosses the boundary:**
- `capture-pause` / `capture-resume` commands: main → worker (no payload, timing
  is derived from the first/last encoded frame timestamp in the worker).
- `capture-status` messages continue unchanged (Phase 41 type); Phase 42 reads
  `state: 'paused'` from them.
- `capture-landed` message: unchanged (Phase 41 type); landing extensions are
  worker-side logic.
- `capture-add-source` command: unchanged (Phase 41 type); mid-session use is the
  Phase 42 contribution.

**Document PiP boundary:** `documentPictureInPicture.requestWindow()` is a main-thread
API. The PiP window's document and SolidJS root live entirely on the main thread.
`RecorderControlStrip` communicates via the same SolidJS store as `RecordPanel` —
no `postMessage` between PiP window and main document is needed (same JS realm).

## Components

### `src/ui/RecordPanel.tsx` (new, Phase 42 owns)

Replaces Phase 41's T10 stub. Full panel with:

```typescript
// Top-level local signals / store — no media objects, only data
interface RecordPanelState {
  session: 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping';
  countdownRemaining: number;          // 3 → 0 during countdown
  elapsedUs: number;                   // total recorded duration (paused time excluded)
  pausedUs: number;                    // cumulative paused time in current session
  bytesWritten: number;
  remainingSeconds: number | null;
  sources: CaptureSourceStatusSnapshot[];
  webcamPreset: WebcamPipPreset;
  documentPipActive: boolean;
  retakeClipId: string | null;         // non-null when in retake mode
}
```

Emits to worker via `worker.postMessage`: `capture-start`, `capture-stop`,
`capture-pause`, `capture-resume`, `capture-add-source`, `capture-remove-source`.
Reads `capture-status`, `capture-error`, `capture-landed` from worker state. Uses
`onCleanup` for PiP window `pagehide` listener, PiP SolidJS root disposal, and countdown timer.

### `src/ui/RecorderControlStrip.tsx` (new)

Minimal SolidJS component rendering into either a Document PiP window or the main DOM.
Receives state via SolidJS context (no props drilling, no `postMessage`):

```typescript
interface ControlStripProps {
  session: 'idle' | 'recording' | 'paused' | 'stopping';
  elapsedUs: number;
  pausedUs: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}
```

`data-testid="recorder-control-strip-pip"` when in Document PiP window;
`data-testid="recorder-control-strip-inpage"` when rendered as in-page fallback.

### `src/engine/capture/capture-session.ts` (extended, Phase 42 additions)

New command handlers and manifest extensions:

```typescript
// New manifest record kinds (version-tolerant — parser skips unknown kinds)
type PauseRecord         = { kind: 'pause'; atUs: number };
type ResumeRecord        = { kind: 'resume'; atUs: number };
type SourceAddedRecord   = { kind: 'source-added'; source: CaptureSourceSnapshot; atUs: number };
type SourceRegionRecord  = { kind: 'source-region-applied'; sourceId: string;
                             mode: 'crop' | 'element'; atUs: number };
```

These are added to the `CaptureManifestRecord` discriminated union in
`src/engine/capture/chunk-manifest.ts`.

Landing extension (pure function, testable):

```typescript
// src/engine/capture/pause-resume.ts (new file)
interface PauseResumePair { pauseAtUs: number; resumeAtUs: number }

function computeGapCollapsedUs(
  rawTs: number,
  pairs: readonly PauseResumePair[]
): number;
// Returns rawTs − Σ(resumeAtUs − pauseAtUs) for all pairs where resumeAtUs ≤ rawTs.
// Pairs with no resume (session stopped while paused) must be excluded by the caller.

function extractPauseResumePairs(
  records: readonly CaptureManifestRecord[]
): PauseResumePair[];
// Pairs consecutive pause/resume records; unpaired final pause is excluded.

function seamMarkerPositionsUs(
  pairs: readonly PauseResumePair[]
): { positionUs: number; label: string }[];
// Returns adjustedUs(resumeAtUs) for each pair, with labels "Resume 1", "Resume 2", ...
```

### `src/protocol.ts` (extended)

New worker commands:

```typescript
| { type: 'capture-pause' }
| { type: 'capture-resume' }
```

New `capture-start` optional field (retake):

```typescript
// Extends existing capture-start command (backward-compatible optional field):
// { type: 'capture-start'; settings: CaptureSettingsSnapshot; retakeClipId?: string }
```

`CapabilityProbeResult` extended (optional `capture` group alongside existing
`livePublish` group):

```typescript
interface CaptureUxProbeResult {
  documentPip: FeatureSupport;    // 'documentPictureInPicture' in window
  cropTarget: FeatureSupport;     // 'CropTarget' in globalThis
  elementCapture: FeatureSupport; // 'RestrictionTarget' in globalThis
}
// Added to CapabilityProbeResult:
captureUx?: CaptureUxProbeResult;
```

The `captureUx` group is optional so that code compiled without Phase 42 does not
break (backward-compatible schema extension).

`capture-status` `state` union is extended to include `'paused'`:

```typescript
// Existing Phase 41 type extended (additive, backward-compatible):
// state: 'idle' | 'armed' | 'recording' | 'paused' | 'stopping'
```

### `src/engine/capture/webcam-preset.ts` (new)

Pure transform derivation, fully unit-testable:

```typescript
export type WebcamPipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type WebcamPipSize   = 'S' | 'M' | 'L';

export interface WebcamPipPreset {
  corner:  WebcamPipCorner;
  size:    WebcamPipSize;
  marginPx: number;   // 0–64, step 4
}

export const DEFAULT_WEBCAM_PRESET: WebcamPipPreset = {
  corner: 'bottom-right',
  size:   'M',
  marginPx: 16,
};

/**
 * Derives a P12 transform for the webcam clip.
 * canvasW/H: pixel dimensions of the export canvas.
 * sourceW/H: webcam source pixel dimensions (for aspect ratio).
 * Returns the center-offset x/y, scale, and fit fields used by TransformParamsSnapshot.
 */
export function deriveWebcamTransform(
  preset: WebcamPipPreset,
  canvasW: number,
  canvasH: number,
  sourceW: number,
  sourceH: number
): Pick<TransformParamsSnapshot, 'x' | 'y' | 'scale' | 'fit'>;
```

### `src/engine/persistence.ts` (extended)

```typescript
export const CAPTURE_SETTINGS_STORE = 'capture-settings';
// Added to the IndexedDB `localcut-projects` v2 store list.
// Holds: CaptureUxSettings { countdownS: 0|3|5; webcamPreset: WebcamPipPreset }
// Default on read failure: { countdownS: 3, webcamPreset: DEFAULT_WEBCAM_PRESET }

export async function saveCaptureSettings(s: CaptureUxSettings): Promise<void>;
export async function loadCaptureSettings(): Promise<CaptureUxSettings>;
```

### `src/engine/capability-probe-v2.ts` (extended)

Three new probes in a `captureUxProbe()` helper, following the existing
`FeatureSupport` pattern (errors → `'unknown'`):

```typescript
async function captureUxProbe(): Promise<CaptureUxProbeResult>;
```

Called from the main probe function and merged into `CapabilityProbeResult.captureUx`.

### `src/ui/Inspector.tsx` (extended)

A **Retake** button is added to the clip inspector when the selected clip's
`TimelineClipSnapshot` has a `captureSessionId` field (set at landing by Phase 41 /
Phase 42 landing logic). The button is disabled with a reason when another session is
active or budget is exhausted:

```typescript
// Field added to TimelineClipSnapshot in src/protocol.ts (optional, backward-compatible):
// captureSessionId?: string;
```

### `src/engine/capture/retake.ts` (new)

Pure landing logic for retake — no I/O:

```typescript
/**
 * Produces the updated TimelineClipSnapshot that replaces the original clip
 * after a retake. Preserves id, transform, keyframes; updates sourceId,
 * duration, inPoint, outPoint.
 */
export function applyRetakeToClip(
  original: TimelineClipSnapshot,
  newSourceId: string,
  newDurationS: number
): TimelineClipSnapshot;
```

## `window.__localcutCapabilityOverrides` dev hook

In `src/engine/capability-probe-v2.ts`, after the probe completes, if
`import.meta.env.DEV === true`:

```typescript
const overrides = (globalThis as Record<string, unknown>).__localcutCapabilityOverrides;
if (overrides && typeof overrides === 'object') {
  Object.assign(result, overrides);
}
```

Vite tree-shakes this block out of production builds because `import.meta.env.DEV`
resolves to `false` at build time. The override is shallow — it replaces top-level
`CapabilityProbeResult` fields; to override a nested group, the caller provides the
full nested object (e.g. `{ captureUx: { documentPip: 'unsupported', cropTarget:
'unsupported', elementCapture: 'unsupported' } }`).

## Persistence: schema and bundle isolation

`CAPTURE_SETTINGS_STORE` lives in the existing `localcut-projects` IndexedDB database
(no schema version bump needed — the store is added lazily in `onupgradeneeded` for
version 2, the current version, following the pattern `PUBLISH_SETTINGS_STORE` used).
Capture settings are never in `ProjectDoc` and are therefore structurally absent from
Phase 23 bundle serialization input. No `PROJECT_SCHEMA_VERSION` bump is required.

The `captureSessionId` field on `TimelineClipSnapshot` (used for retake detection) is
stored inside `ProjectDoc.timeline` via the existing clip serialization path. It is
inert for any tool that does not know Phase 42 (the import path ignores unknown clip
fields via the hand-rolled `isRecord` validation pattern).

## Third-party additions

**No new runtime dependencies.** Document PiP, CropTarget, and RestrictionTarget are
native browser APIs. SolidJS's `render()` into a PiP window document is supported
without additional packages. The Playwright test suite (`@playwright/test`) is already
a devDependency at version 1.60.0 (added by Phase 47) — no version change needed.

## Validation

- **Unit (Vitest, Node, co-located):**
  - `pause-resume.test.ts`: gap-collapsing formula with 3-pause synthetic manifest
    (zero-drift assertion ≤ 1 µs), paused-then-stopped case, seam marker positions,
    state machine transitions.
  - `manifest-extensions.test.ts`: forward-compat parsing of unknown `kind` (no
    throw, skip); parsing of `'pause'`, `'resume'`, `'source-added'`,
    `'source-region-applied'`; torn-tail tolerance unchanged.
  - `webcam-preset.test.ts`: all 4 × 3 corner/size combos within bounds, margin
    clamping, aspect ratio preservation, S/M/L percentages.
  - `retake.test.ts`: clip replacement preserves `id`/`transform`/`keyframes`;
    duration/inPoint/outPoint updated; old source remains.
  - Extended settings persistence test: `CAPTURE_SETTINGS_STORE` absent from
    bundle serializer input.
- **Playwright (`tests/e2e/recorder-ux.spec.ts`, new file):**
  - Record → pause → resume → stop → timeline with fake device flags.
  - Document PiP fallback path via `window.__localcutCapabilityOverrides` init
    script.
  - Both tests in serial (one Chromium worker), added to the existing `test:e2e`
    script. No separate CI job is needed — these tests do not require a MediaMTX
    container and can run with the existing Vite dev server.
- **Manual smoke:** Chromium desktop — 3-2-1 countdown, pause mid-screen-record,
  resume, stop; verify seam marker on timeline; verify webcam PiP corner preset
  applied to landed clip transform; verify PiP window appears and Pause/Stop work
  from it; verify Retake replaces clip and undo restores it.
