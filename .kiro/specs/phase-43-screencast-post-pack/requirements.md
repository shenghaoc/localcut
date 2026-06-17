# Requirements: Phase 43 — Screencast Post Pack

Phase 43 layers four screencast-production tools on top of the existing
editing and compositing infrastructure — all running entirely client-side with
zero new server dependencies. The feature set targets tutorial and software
walkthrough creators who record their screen and need to polish footage without
leaving LocalCut:

1. **Zoom-n-pan presets** that produce real, fully editable P15 transform
   keyframes so the user can adjust every zoom point after the fact.
2. **DOM event log + auto-zoom proposals** — during an own-tab capture session
   (Phase 41 path), capture-phase listeners record timestamped click/scroll
   events as a sidecar; deterministic clustering then proposes keyframe pairs
   the user can apply or skip from a reviewable panel.
3. **Callout clips** — arrow, box, step-number, spotlight, and blur-region
   overlays built as source-less clips on the P14 title pattern; spotlight and
   blur-region are WGSL effect passes inside the single submission.
4. **Padded-background compositor preset** — wallpaper or gradient behind the
   capture, rounded corners, drop shadow, and inset margin, fully within the
   accelerated tier at 1080p.

Every feature is gated by the Phase 8 / Phase 26 capability probes. Missing
capability means a reduced-tier explanation in the UI, never a crash or silent
wrong result. Cursor-driven features (item 2) exist only on the own-tab event
log path; arbitrary screen capture bakes the cursor into pixels with no API
exposing coordinates, and an experimental GPU template-match cursor tracker is
explicitly deferred to a future phase.

---

## R1 — Zoom-n-pan preset keyframes

- **R1.1** The Inspector "Zoom-n-Pan" preset panel offers the following
  named presets as one-click starting points: `zoom-in-centre` (scale 1 → 1.6,
  x/y = 0), `zoom-in-region` (scale 1 → 1.6, x/y user-picked via a viewport
  drag), `zoom-out` (scale 1.6 → 1, x/y → 0), `pan-left-right`
  (scale 1.6, x sweeps −0.2 → +0.2), `pan-right-left` (x sweeps +0.2 → −0.2).
  All numeric values are user-tunable before the preset is applied.
- **R1.2** Applying a preset writes **ordinary P15 transform keyframes** via
  the existing `set-keyframes` command on the capture clip. The resulting
  keyframe tracks are visually and functionally identical to keyframes the user
  drew by hand: they appear in the keyframe editor, respond to the same edit
  gestures (drag, delete, retime, change easing), and are serialised through
  the existing keyframe schema.
- **R1.3** Preset parameters: zoom entry duration 400 ms ease-in-out, hold
  duration 1500 ms, zoom exit duration 400 ms ease-in-out. The user can change
  these before applying; the defaults are stated in the UI. Applying is a
  single undoable action (P9 undo/redo).
- **R1.4** The preset panel is available on any `TimelineClip` with a video
  source (both ordinary imports and Phase 41 capture clips). It is absent on
  audio-only clips, title clips, and callout clips.
- **R1.5** Applying a preset never silently overwrites existing keyframes at
  the same parameter keys. If keyframes already exist in the target time range,
  the panel warns "Existing keyframes will be merged — existing values outside
  this range are preserved" before writing.

## R2 — DOM event log (own-tab capture path)

- **R2.1** During an own-tab (`getDisplayMedia`, `preferCurrentTab: true`)
  Phase 41 recording session, the capture session manager installs event
  listeners at session start (before the first video frame is encoded) and
  removes them at session stop:
  - `click` (pointerup captures are too late; use the click event)
  - `wheel` (passive, on `window`, used only for `deltaY`)
  - `scroll` (passive, on `document`, used for final scroll position)
  The listeners are present only while a recording session is active. No
  listeners are installed for arbitrary screen/window/display captures.
- **R2.2** Each event is recorded as an entry in a versioned in-memory log with
  the following schema:

  ```typescript
  interface DomEventLogEntry {
    t: number;        // µs on the Phase 41 capture clock (same epoch as track timestamps)
    kind: 'click' | 'scroll';
    x: number;        // normalised viewport or scrollable-target position, 0–1
    y: number;        // normalised viewport or scrollable-target position, 0–1
    deltaY?: number;  // wheel-originated scroll entries only
  }
  ```

  Scroll position normalisation must inspect the event target: when the target
  is a scrollable `HTMLElement`, use `scrollLeft / max(1, scrollWidth -
  clientWidth)` and `scrollTop / max(1, scrollHeight - clientHeight)`;
  otherwise use the document scroller with `window.scrollX / max(1, scrollWidth
  - window.innerWidth)` and `window.scrollY / max(1, scrollHeight -
  window.innerHeight)`. All divisions must be guarded so `null` scrollers and
  non-finite values clamp to `0`.

  No element references, no text content, no key states, no URLs, no user
  identifiers. The channel `kind: 'key'` is reserved for a future Phase 44
  opt-in shortcut-key channel and must be documented as reserved in the schema.
- **R2.3** The log is serialised to JSON at session stop and written as
  `events.json` in the Phase 41 OPFS session directory
  (`opfs:/capture/<sessionId>/events.json`), co-located with `manifest.ndjson`.
  Format:

  ```typescript
  interface DomEventLog {
    eventLogSchemaVersion: 1;
    sessionId: string;           // matches the Phase 41 sessionId
    events: DomEventLogEntry[];
    // NOTE: 'key' channel reserved for Phase 44 opt-in shortcut-keys extension
  }
  ```

- **R2.4** At session landing (when Phase 41 lands tracks into the project),
  `events.json` is read from OPFS and a `DomEventLogRef` sidecar is stored in
  `ProjectDoc.sessionEventLogs` (a new field; see design for exact type). The
  sidecar keyed to the landed `sourceId` of the primary screen capture track.
  If `events.json` is absent (non-own-tab session, crash recovery without the
  file, or the user declines), the field is simply absent for that source — no
  error.
- **R2.5** Crash recovery (orphan session import): if `events.json` exists in
  the orphaned session directory, it is imported alongside the tracks using the
  same path. If it is corrupt or missing, recovery continues without it.
- **R2.6** The event log is never included in Phase 23 project bundles (it is
  informational/sidecar data keyed to an OPFS session, not a media asset). A
  test asserts the bundle serialiser receives no event log data.

## R3 — Auto-zoom proposals

- **R3.1** After a screen capture clip with an associated `DomEventLogRef` is
  placed in the timeline, the "Auto-Zoom" panel (accessible from the clip
  Inspector) analyses the event log and generates a proposal list using the
  following deterministic algorithm:
  - Events within a 2-second window and 15 % normalised-viewport-distance of
    each other form a cluster.
  - Each cluster produces one zoom proposal: a zoom-in keyframe pair (scale
    1 → 1.6, position centred on the cluster centroid) placed at
    `clusterStart − 200 ms`, with a 400 ms ease-in-out entry, followed by a
    zoom-out keyframe pair (scale 1.6 → 1, position → 0) placed 1500 ms after
    the last event in the cluster.
  - Overlapping proposals are merged: if two proposal intervals overlap by more
    than 50 ms, the earlier one's zoom-out is retimed to the merged boundary.
  - All clustering constants (2 s window, 15 % distance, −200 ms lead-in,
    400 ms ramp, 1500 ms hold, 50 % overlap merge threshold) are surfaced as
    user-tunable fields in the panel with those defaults.
- **R3.2** Proposals appear in a scrollable list panel. Each entry shows:
  timeline timestamp, centroid position as a percentage (e.g. "37 % × 62 %"),
  and two buttons: **Apply** and **Skip**. The user must act on each proposal
  individually; there is no "apply all" without a confirmation warning.
- **R3.3** Applying a proposal writes ordinary P15 transform keyframes via
  `set-keyframes` on the capture clip — identical to a manual zoom preset
  (R1.2). The operation is a single undoable action. Skipping a proposal marks
  it visually as skipped (grayed out) but does not delete it; the user can
  re-enable a skipped proposal.
- **R3.4** The algorithm runs synchronously on the main thread only at panel
  open and on parameter change (re-cluster button). The event log has at most
  one entry per rendered frame (60 Hz × session duration); for sessions up to
  4 hours the log has at most ~864 000 entries. Clustering must complete in
  under 100 ms for a 1-hour session log (≈ 216 000 entries). A test verifies
  this bound with a synthetic log.
- **R3.5** If the clip has no associated event log, the Auto-Zoom panel shows
  "No event log available for this clip. Event logs are recorded only for
  own-tab captures."

## R4 — Callout clips

- **R4.1** A **callout** is a source-less clip with `kind: 'callout'` (a new
  `ClipKindSnapshot` value) and a typed payload `callout` in
  `TimelineClipSnapshot`. Callout clips live on video tracks alongside title
  clips and are handled by the same split/trim/move/delete operations.
  Serialisation is through `TimelineClipSnapshot` and therefore through
  `ProjectDoc` and Phase 23 bundles automatically.
- **R4.2** Five callout kinds are supported:

  | Kind | Render path |
  | --- | --- |
  | `arrow` | P14 Canvas2D raster (SVG-like path, arrowhead) |
  | `box` | P14 Canvas2D raster (rounded-rect stroke + optional fill) |
  | `step` | P14 Canvas2D raster (circle + number, styled text) |
  | `spotlight` | WGSL effect pass (darken outside an ellipse) |
  | `blur` | WGSL effect pass (separable Gaussian within a masked rect) |

- **R4.3** Arrow, box, and step callouts rasterise through the P14
  `rasterizeTitleToCanvas` / `copyExternalImageToTexture` path: on each style
  or parameter change the worker re-rasterises to an `OffscreenCanvas` and
  uploads the result as a `GPUTexture` cached by `(clipId, calloutContentHash)`.
  The cached texture enters the compositor as a `TextureCompositeLayer` inside
  the single `queue.submit`. No Canvas2D access occurs on the per-frame hot path.
- **R4.4** Spotlight and blur-region callouts are WGSL compute passes
  registered in the effect chain (`src/engine/effects.ts` registry), each
  taking the current composited texture as input and writing an output texture
  within the single submission:
  - `spotlight`: uniform carries ellipse centre (normalised 0–1), radius (x,
    y normalised), and a `darkenStrength` ∈ [0, 1] (default 0.7). Outside the
    ellipse, each pixel's RGB is multiplied by `1 − darkenStrength`.
  - `blur`: uniform carries rect (x, y, w, h normalised) and a Gaussian radius
    in pixels (default 12). Two-pass separable Gaussian (horizontal + vertical)
    within the rect; outside pixels are unchanged. Maximum radius 48 px.
    The implementation uses temporary textures within the pass; they remain
    live until the submitted GPU work has completed, then return to the
    frame-scoped pool.
- **R4.5** The ellipse/rect parameters for spotlight and blur callouts are
  stored as P15 keyframe-capable transform parameters on the callout clip so
  the user can animate the region over time. Specifically, `x`, `y`, `scale`
  on the clip's `TransformParams` define the region centre and size (scale maps
  to a uniform ellipse/rect size relative to the output; the exact mapping is
  documented in `src/engine/callout.ts`). This reuses the existing P15
  infrastructure without inventing a new keyframe schema.
- **R4.6** The callout payload in `TimelineClipSnapshot`:

  ```typescript
  type CalloutKind = 'arrow' | 'box' | 'step' | 'spotlight' | 'blur';

  interface CalloutPayload {
    calloutKind: CalloutKind;
    /** Arrow: start/end normalised; Box: rect normalised; Step: centre + number. */
    geometry: CalloutGeometry;
    style: CalloutStyle;
  }
  ```

  `CalloutGeometry` and `CalloutStyle` are defined in `src/engine/callout.ts`
  (see design for exact fields). Absent on non-callout clips.
- **R4.7** The UI provides a callout tool in the toolbar that, on activation,
  shows a kind picker, then switches the preview to a drag-to-place mode where
  the user draws the geometry (arrow: click-drag for start/end; box: drag rect;
  step: click for centre; spotlight/blur: drag region). Placing inserts the
  callout clip at the playhead on a new overlay track.
- **R4.8** Callout clips are styled consistently with the UI standards: dark
  professional palette defaults (`#FFD700` accent for arrows/step, semi-opaque
  white for box), all style parameters overridable in the Inspector. No
  external image assets are required for callout rendering.
- **R4.9** Callouts serialise through `ProjectDoc` and Phase 23 project bundles
  without any additional bundle asset (the payload is pure data, not media).
  A round-trip test verifies: create callout clip → serialise → deserialise →
  callout payload is bit-identical.

## R5 — Padded-background compositor preset

- **R5.1** The padded-background preset is applied per-clip via a
  `paddedBackground` sidecar field on a `TimelineClipSnapshot`. When present,
  the compositor renders: first a background layer (solid colour or
  gradient or wallpaper image from the media bin), then the capture clip scaled
  by an inset margin with a rounded-corner mask and a drop shadow, all within
  the single `queue.submit`.
- **R5.2** Preset parameters with their defaults:

  | Parameter | Default | Range |
  | --- | --- | --- |
  | `insetMargin` (fraction of output height) | 0.08 | 0–0.4 |
  | `cornerRadius` (px at 1080p) | 16 | 0–64 |
  | `shadowOpacity` | 0.45 | 0–1 |
  | `shadowRadius` (px at 1080p) | 24 | 0–64 |
  | `shadowOffsetY` (px at 1080p) | 8 | −32–32 |
  | `background` | `{ kind: 'gradient', stops: [{color:'#1a1a2e',pos:0},{color:'#16213e',pos:1}] }` | see R5.3 |

- **R5.3** Background kinds: `solid` (single CSS hex colour), `gradient`
  (linear gradient with 2–5 colour stops and an angle, default horizontal),
  and `wallpaper` (a `sourceId` reference to a still image or video frame in
  the media bin, scaled to fill). The wallpaper reference is a
  `SourceDescriptor` `sourceId`; the compositor resolves the first frame via
  the existing `MediaInputHandle` machinery.
- **R5.4** WGSL implementation: a single combined pass in `src/engine/shaders/padded-background.wgsl` (+ `.f16` variant) that:
  1. Computes the background colour (solid/gradient lookup from a uniform
     colour table, or samples the wallpaper texture if bound).
  2. Applies a pre-blurred shadow quad using an SDF rounded-rect at the
     inset frame position (the shadow is pre-computed into a 1-channel `f16`
     texture cached per `(shadowRadius, cornerRadius)` tuple; this avoids a
     live Gaussian per frame).
  3. Applies an SDF rounded-rect clip mask to the capture frame scaled to the
     inset region; blends result over the background using straight-alpha
     compositing.
  All three steps are encoded as a single compute dispatched within the
  existing single-submission constraint (hard gate 4).
- **R5.5** Performance requirement: padded-background preset must render at
  full 1080p60 on the accelerated tier (WebGPU `core-webgpu` capability) with
  no frame drops, measured in a manual smoke test on a mid-tier (≤ 2020) GPU.
  The shadow texture cache ensures the shadow pre-blur does not run per frame.
- **R5.6** The padded-background sidecar is included in `ProjectDoc` and Phase
  23 bundles automatically (it is a plain JSON field on `TimelineClipSnapshot`).
  Wallpaper `sourceId` references are validated against `ProjectDoc.sources` on
  deserialisation; an unresolvable reference falls back to the default gradient
  (no crash) and surfaces a console warning.
- **R5.7** The Inspector shows a "Padded Background" section (toggle on/off)
  with live controls for all parameters in R5.2. Enabling writes the sidecar
  field; disabling removes it. Changes are undoable.

## R6 — Schema, persistence, and bundles

- **R6.1** `ProjectDoc` gains two new optional fields:
  - `sessionEventLogs?: SessionEventLogRef[]` — one entry per landed screen
    capture source that has an event log.
  - The `TimelineClipSnapshot.callout?: CalloutPayload` field (R4.6).
  - The `TimelineClipSnapshot.paddedBackground?: PaddedBackgroundParams` field
    (R5.1).
  These additions require a `PROJECT_SCHEMA_VERSION` bump to the next unused
  version (v11 is claimed by the open Phase 46 PR #63; do not hardcode a
  number — write "bump `PROJECT_SCHEMA_VERSION` to the next unused integer").
- **R6.2** Older project documents that lack these fields deserialise cleanly
  (all three are optional). The validation code follows the existing
  `isRecord`/`requiredString`/`finiteNumber` hand-rolled pattern — no Zod.
- **R6.3** Event log data is never included in Phase 23 project bundles and
  never serialised into `ProjectDoc` itself; only the `SessionEventLogRef`
  (OPFS path and source key) is stored. Bundles contain only the
  `project.json` representation, which is the ref, not the raw log.

## R7 — Capability gating

- **R7.1** All four features are available only when `CapabilityTierV2 ===
  'core-webgpu'`. On lower tiers, the Inspector sections and toolbar items are
  hidden with a `title` tooltip "Requires WebGPU (accelerated tier)".
- **R7.2** DOM event log capture is additionally gated at the call site of
  `getDisplayMedia` — specifically, the `preferCurrentTab: true` constraint
  path. If the captured source is not an own-tab (detected from the Phase 41
  source kind metadata), the event log listeners are not installed and the
  `events.json` is not written. No explicit browser capability probe is needed
  for listener installation itself, since it is always available.
- **R7.3** Blur callouts degrade gracefully when the WebGPU device reports
  `maxComputeWorkgroupSizeX < 64`: the radius is clamped to 24 px with a
  visible "(capped)" label in the Inspector. This follows the existing
  `CapabilityProbeResult` diagnostics pattern.

## R8 — Non-goals

- OS-level keystroke capture or cross-application cursor effects.
- A GPU template-match cursor tracker (deferred; see design for rationale).
- Cursor highlight, cursor zoom-follow, or any other cursor-driven effect on
  arbitrary (non-own-tab) screen captures.
- Phase 44 shortcut-key channel (reserved in the schema, not implemented here).
- Background removal, chroma key, or green-screen effects.
- Animated GIF or video wallpaper backgrounds (wallpaper is first-frame only).

## R9 — Tests and docs

- **R9.1** Vitest unit tests (Node environment, co-located, no large media
  fixtures) covering:
  - `src/engine/callout.test.ts`: `calloutContentHash` invalidates on every
    style and geometry field; `parseCalloutPayload` accepts valid and rejects
    invalid payloads; round-trip serialise → deserialise is bit-identical.
  - `src/engine/event-log.test.ts`: event normalisation (clamp x/y to 0–1,
    require finite `t`, require valid `kind`); schema serialise/deserialise
    including the reserved `key` channel being preserved on round-trip;
    `events.json` write path verified with a mocked OPFS handle.
  - `src/engine/auto-zoom.test.ts`: cluster formation across a range of
    synthetic logs (zero events, single event, two events inside/outside the
    2 s / 15 % thresholds, overlapping proposals merge, empty result for
    spread-out events); proposal generation output is deterministic given the
    same input; performance bound — clustering 216 000 synthetic entries
    completes under 100 ms (Vitest performance test).
  - `src/engine/padded-background.test.ts`: `PaddedBackgroundParams`
    round-trip; shadow cache key derivation; wallpaper sourceId validation
    (present → pass, absent → fallback gradient with console warning).
  - `src/engine/project.test.ts` extension: projects with `callout`,
    `paddedBackground`, and `sessionEventLogs` fields round-trip through
    `serializeProject` / `parseProjectDoc` without data loss; older docs
    (fields absent) parse cleanly.
  - Protocol type-guard tests for `CalloutPayload`, `PaddedBackgroundParams`,
    `SessionEventLogRef`, and the new `ClipKindSnapshot: 'callout'` value.
- **R9.2** Manual smoke tests (checklist in `docs/VERIFY_DEPLOYMENT.md`):
  - Apply a zoom-in-region preset → verify keyframes appear in editor →
    scrub through → export → confirm zoomed output.
  - Record an own-tab session → land → open Auto-Zoom panel → apply two
    proposals → scrub → export.
  - Place an arrow callout and a blur callout over a clip → export → confirm
    both appear in the output file.
  - Enable padded-background → set wallpaper → export at 1080p → confirm
    rounded corners, shadow, and wallpaper appear.
- **R9.3** `docs/USER-GUIDE.md` gains a "Screencast Post Pack" section
  covering zoom-n-pan presets, auto-zoom, callouts, and padded background, with
  the own-tab requirement for event-log features stated plainly. A new
  `docs/SCREENCAST-GUIDE.md` page provides step-by-step walkthroughs. Both are
  linked from the in-app Help panel.
- **R9.4** `npm run build` succeeds (strict TypeScript). `npm test` is green
  and the test count grows by at least 40 cases.
