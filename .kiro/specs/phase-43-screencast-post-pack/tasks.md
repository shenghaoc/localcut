# Tasks: Phase 43 — Screencast Post Pack

## T1 — Protocol and timeline model extensions (R4.1, R5.1, R6.1)

- [ ] **T1.1** `src/protocol.ts`: add `'callout'` to `ClipKindSnapshot` union;
  add optional `callout?: CalloutPayload` and `paddedBackground?:
  PaddedBackgroundParams` to `TimelineClipSnapshot`; add `add-callout` and
  `set-callout` command variants (kebab-case, structured-clone-safe) following
  the `add-title`/`set-title` pattern.
- [ ] **T1.2** `src/engine/timeline.ts`: extend `ClipKind` to `'video' | 'title'
  | 'callout'`; add `isCalloutClip(clip: TimelineClip): boolean`; add
  `addCalloutClip(state, payload)` placing a source-less clip with
  `kind: 'callout'`, `sourceId: ''`, `callout: payload` on a new or existing
  overlay video track (reuse the `addTitleClip` placement logic); handle
  `add-callout` and `set-callout` commands in the worker dispatch loop
  (`src/engine/worker.ts`).
- [ ] **T1.3** `src/engine/project.ts`: add `SessionEventLogRef` interface;
  add `sessionEventLogs?: SessionEventLogRef[]` to `ProjectDoc`; add
  `callout?: CalloutPayload` and `paddedBackground?: PaddedBackgroundParams`
  to the internal `TimelineClip` and to the serialise/parse path in
  `serializeProject` / `parseProjectDoc`; bump `PROJECT_SCHEMA_VERSION` to the
  next unused integer (v11 is claimed by Phase 46 PR #63 — write the next
  available value); extend the `switch (schemaVersion)` upgrade ladder so
  older documents parse cleanly (all new fields are optional).

## T2 — DOM event log (R2)

- [ ] **T2.1** `src/engine/event-log.ts` (new): implement `DomEventLogEntry`,
  `DomEventLog`, `SessionEventLogRef` interfaces; implement
  `normalizeDomEventLogEntry` (clamp x/y to 0–1, require finite `t`, require
  valid `kind`), `parseDomEventLog`, and `serializeDomEventLog`; add a comment
  block explaining the reserved `kind: 'key'` channel for Phase 44.
- [ ] **T2.2** `src/engine/event-log.ts`: implement `CaptureSessionEventLogger`
  class — `install()` adds a capture-phase `click` listener on `window`, a
  passive `wheel` listener on `window`, and a passive `scroll` listener on
  `document`; `remove()` removes all three listeners (idempotent). The click
  handler records `{t, kind:'click', x: e.clientX / innerWidth, y:
  e.clientY / innerHeight}`. Wheel-originated entries record `deltaY`; plain
  scroll entries omit it. Scroll coordinates come from the scroll event target
  when it is a scrollable `HTMLElement` (`scrollLeft / max(1, scrollWidth -
  clientWidth)`, `scrollTop / max(1, scrollHeight - clientHeight)`), otherwise
  from the document scroller (`window.scrollX / max(1, scrollWidth -
  window.innerWidth)`, `window.scrollY / max(1, scrollHeight -
  window.innerHeight)`). Clamp all values and treat missing scrollers or
  non-finite divisions as `0`; `flush(sessionDir)` writes `events.json` via
  `sessionDir.getFileHandle('events.json', {create:true})` →
  `createWritable()` → write JSON string → close.
- [ ] **T2.3** Integrate `CaptureSessionEventLogger` into the Phase 41 capture
  session startup/stop path in `src/engine/capture/capture-session.ts` (or
  wherever Phase 41 manages session lifecycle on the main thread). Install only
  when the session's primary screen source has `kind === 'screen'` AND the
  `CaptureSourceDescriptor` indicates an own-tab (`preferCurrentTab: true`)
  session. Remove listeners at session stop before writing tracks. Call
  `flush(sessionDir)` after the tracks are finalised, before the
  `capture-landed` message.
- [ ] **T2.4** At landing, extend Phase 41's landing path to read
  `events.json` from the session directory if present, parse it via
  `parseDomEventLog`, and store a `SessionEventLogRef` in the project:
  `{ sessionId, sourceId: <primaryScreenSourceId>,
  opfsPath: 'capture/<sessionId>/events.json' }`. Write to
  `ProjectDoc.sessionEventLogs`. If the file is missing or unparseable, skip
  silently (no error thrown).
- [ ] **T2.5** Extend crash-recovery import path (`src/engine/capture/` recovery
  handler): after landing the tracks, attempt the same `events.json` read. If
  present and valid, add the `SessionEventLogRef`. If absent or corrupt,
  continue without it.

## T3 — Auto-zoom clustering (R3)

- [ ] **T3.1** `src/engine/auto-zoom.ts` (new): implement `AutoZoomParams`,
  `DEFAULT_AUTO_ZOOM_PARAMS`, `EventCluster`, `ZoomProposal` interfaces;
  implement `clusterEvents(entries, params, clipStartUs)` using the
  sort-then-linear-sweep algorithm described in the design: sort by `t`; sweep
  maintaining an open cluster; close and open on distance or time threshold
  breach; generate `ZoomProposal` per cluster; merge overlapping proposals;
  assign stable IDs with a synchronous FNV-1a-derived hash over
  `clusterStartUs + ':' + centroidX.toFixed(4) + ':' +
  centroidY.toFixed(4)`, truncated to 16 hex chars. Do not use
  `crypto.subtle.digest` here because `clusterEvents` is synchronous and runs
  inside the 1-hour log performance budget.
- [ ] **T3.2** `src/engine/auto-zoom.ts`: export `applyProposal(proposal:
  ZoomProposal, params: AutoZoomParams): ClipKeyframesSnapshot` — converts a
  proposal to the exact `ClipKeyframesSnapshot` structure expected by the
  `set-keyframes` command, using `x`, `y`, `scale` keyframe tracks with
  `easing: 'ease'` for ramp keyframes and `easing: 'linear'` for hold
  keyframes.

## T4 — Callout data types and rasteriser (R4.2–R4.4)

- [ ] **T4.1** `src/engine/callout.ts` (new): implement `CalloutKind`,
  `CalloutArrowGeometry`, `CalloutBoxGeometry`, `CalloutStepGeometry`,
  `CalloutRegionGeometry`, `CalloutGeometry`, `CalloutStyle`, `CalloutPayload`
  interfaces with the defaults specified in the design (`color: '#FFD700'`,
  `strokeWidth: 3`, `fillOpacity: 0`, `fontSize: 28`, `arrowheadSize: 14`,
  `blurRadius: 12`, `darkenStrength: 0.7`); implement `normalizeCalloutPayload`,
  `parseCalloutPayload`, and `calloutContentHash` (hash over
  `JSON.stringify(normalizeCalloutPayload(payload))` via the repo's synchronous
  `hashString` SHA-256 helper, hex, first 32 chars).
- [ ] **T4.2** `src/engine/callout.ts`: implement `rasterizeCallout(ctx, w, h,
  payload)` for the three Canvas2D kinds:
  - `arrow`: `moveTo(x1*w, y1*h)` → `lineTo(x2*w, y2*h)`, stroke with
    `style.color` at `style.strokeWidth`; compute arrowhead triangle from
    direction vector; fill arrowhead.
  - `box`: `roundRect(x*w, y*h, bw*w, bh*h, cornerRadius=4)`, stroke +
    optional fill at `fillOpacity`.
  - `step`: `arc(cx*w, cy*h, r*min(w,h))` circle, fill `style.color`; centre
    the `style.number` string in contrasting white text at `style.fontSize`px.
  Returns without drawing for `spotlight`/`blur`.
- [ ] **T4.3** `src/engine/callout-textures.ts` (new): implement
  `CalloutTextureCache` — same structure as `TitleTextureCache` in
  `src/engine/titles.ts`: an LRU `Map<string, {view: GPUTextureView; texture:
  GPUTexture; hash: string}>` keyed by `clipId`; `get()` checks the cached
  hash, rasterises if stale via an `OffscreenCanvas` + `rasterizeCallout` +
  `copyExternalImageToTexture`, returns the `GPUTextureView`; `invalidate()`
  destroys the cached texture; `dispose()` destroys all textures.

## T5 — Spotlight and blur WGSL passes (R4.4, R4.5)

- [ ] **T5.1** `src/engine/shaders/spotlight.wgsl` and
  `src/engine/shaders/spotlight.f16.wgsl` (new): implement the darken-outside-
  ellipse compute shader per the design spec (uniform: `cx, cy, rx, ry,
  darkenStrength, _pad`; workgroup 8×8; reads input binding 0, writes output
  binding 1). The f16 variant uses `rgba16float` storage textures.
- [ ] **T5.2** `src/engine/shaders/blur-region.wgsl` and
  `src/engine/shaders/blur-region.f16.wgsl` (new): implement the two-pass
  separable Gaussian within-rect shader per the design spec. Horizontal pass
  and vertical pass are two separate `@compute` entry points in the same
  shader file; both read/write a temp texture allocated by the caller.
- [ ] **T5.3** `src/engine/effects.ts`: register `'spotlight'` and
  `'blur-region'` in `EFFECT_REGISTRY` alongside the existing entries,
  following the existing `CompiledEffect` pattern; import the new WGSL files
  with `?raw`; implement `isSpotlightActive` and `isBlurRegionActive` helpers
  (keyed to `calloutKind === 'spotlight'` / `'blur'` on the clip's callout
  payload); update `EffectChainRunner.runEffects` to invoke the new passes when
  a callout clip of the appropriate kind is composited.
- [ ] **T5.4** `src/engine/gpu.ts`: extend the compositor's per-layer handling
  so that a `FrameCompositeLayer` or `TextureCompositeLayer` with an associated
  spotlight/blur callout clip invokes the corresponding WGSL pass before the
  layer is composited over the background. The effect must execute within the
  existing single `GPUCommandEncoder` (no additional `queue.submit`). Allocate
  the two-pass blur temp textures from a small frame-scoped pool; keep them
  alive until the submitted GPU work completes, then return them to the pool.

## T6 — Padded-background shader and renderer (R5)

- [ ] **T6.1** `src/engine/shaders/padded-background.wgsl` and
  `src/engine/shaders/padded-background.f16.wgsl` (new): implement the single
  combined compute pass per the design spec (uniform: inset rect, cornerRadius,
  shadowOpacity, shadowOffsetYN, bgKind, solidColor, gradient stops up to 5,
  gradAngleCos/Sin, gradStopCount; bindings: input source frame texture, shadow
  texture, optional wallpaper texture, output texture); implement the SDF
  rounded-rect clip mask and anti-aliased boundary (smoothstep over 1 px).
- [ ] **T6.2** `src/engine/padded-background.ts` (new): implement
  `PaddedBackgroundParams`, `DEFAULT_PADDED_BACKGROUND`, `GradientStop`,
  `normalizePaddedBackground`, `parsePaddedBackground`, and `shadowCacheKey`;
  implement `PaddedBackgroundRenderer` with `getShadowTexture` (pre-blurs an
  SDF rounded-rect into a 1-channel f16 texture; caches by `shadowCacheKey` +
  output dimensions; regenerates only when the key changes) and a wallpaper
  texture cache keyed by `sourceId` + output dimensions + wallpaper params.
  Resolve the first frame from `MediaInputHandle.thumbnailAt(0)` only on a
  cache miss or source/parameter change; return null on miss with a
  `console.warn`.
- [ ] **T6.3** `src/engine/gpu.ts`: when a `FrameCompositeLayer` has
  `paddedBackground` present, dispatch the `padded-background.wgsl` pass (or
  `.f16` variant based on capability tier) before compositing the layer, within
  the existing single `GPUCommandEncoder`. The `PaddedBackgroundRenderer` is
  owned by the `GPUPresenter` or equivalent long-lived GPU object and disposed
  with it.

## T7 — Zoom preset panel (R1)

- [ ] **T7.1** `src/ui/ZoomPresetPanel.tsx` (new): SolidJS component rendered
  in the clip Inspector for video clips (including capture clips). Shows five
  preset buttons (zoom-in-centre, zoom-in-region, zoom-out, pan-left-right,
  pan-right-left) plus editable fields: target scale (default 1.6), entry ramp
  ms (400), hold ms (1500), exit ramp ms (400), x (0), y (0). On preset button
  click, populate the editable fields with the preset's defaults; user may
  adjust before applying.
- [ ] **T7.2** `src/ui/ZoomPresetPanel.tsx`: Apply button dispatches
  `set-keyframes` with the computed `ClipKeyframesSnapshot` (scale, x, y tracks
  with four keyframes: entry-start, entry-end, exit-start, exit-end). Before
  dispatching, check whether the target clip already has keyframes in the
  affected time range; if yes, show a SolidJS dialog warning (R1.5) with
  Confirm/Cancel before proceeding. The Apply action is a single undoable
  operation (uses the existing undo/redo flow through the worker).
- [ ] **T7.3** `src/ui/ZoomPresetPanel.tsx`: The `zoom-in-region` preset
  replaces the preview interaction with a drag-to-set-region mode (an absolute-
  positioned transparent overlay over `PreviewCanvas` that maps the drag rect's
  centre to normalised x/y). Escape or click-outside cancels the region pick.
  Keyboard accessible: the overlay has `role="application"` and traps focus
  while active.

## T8 — Auto-zoom panel (R3)

- [ ] **T8.1** `src/ui/AutoZoomPanel.tsx` (new): SolidJS component rendered in
  the clip Inspector when the clip's `sourceId` has an associated
  `SessionEventLogRef` in `ProjectDoc.sessionEventLogs`. On panel open (or
  source change), asynchronously reads `events.json` from OPFS via
  `navigator.storage.getDirectory()` → navigate to the session path → read the
  file; shows a spinner during load. On load failure or missing file, shows the
  "No event log available" placeholder (R3.5).
- [ ] **T8.2** `src/ui/AutoZoomPanel.tsx`: parameter fields for all
  `AutoZoomParams` constants with their defaults (R3.1); Re-cluster button runs
  `clusterEvents` synchronously with the loaded entries and current params,
  updating the proposal list signal. Proposals render in a scrollable list with
  timestamp (`t` formatted as `HH:MM:SS.mmm`), centroid (`x%×y%`), and Apply /
  Skip buttons.
- [ ] **T8.3** `src/ui/AutoZoomPanel.tsx`: Apply button calls `applyProposal`
  to get `ClipKeyframesSnapshot` and dispatches `set-keyframes`; marks the
  proposal status `'applied'`. Skip marks status `'skipped'` (grays the entry).
  A skipped proposal can be re-enabled (sets status back to `'pending'`). No
  "apply all" button without a confirmation dialog. Each apply is individually
  undoable.

## T9 — Callout tool and Inspector (R4.7, R4.8)

- [ ] **T9.1** `src/ui/CalloutTool.tsx` (new): toolbar button that, when
  active, opens a floating kind picker (`arrow`, `box`, `step`, `spotlight`,
  `blur`) and switches the preview interaction mode to a placement overlay
  (absolute-positioned, `pointer-events: auto`) over `PreviewCanvas`. Arrow:
  click-drag start/end. Box: drag rect. Step: click for centre (radius = 0.05
  default). Spotlight/blur: drag rect. On release, normalise the drawn geometry
  to 0–1 viewport, dispatch `add-callout`. Escape or second toolbar-button
  click deactivates the tool.
- [ ] **T9.2** `src/ui/CalloutTool.tsx`: kind picker is `role="listbox"`,
  focus-trapped while visible; placement overlay has `aria-label="Draw callout"`
  and `role="application"`; all interactive elements are keyboard-reachable.
- [ ] **T9.3** Callout clip Inspector section: add a `CalloutInspectorSection`
  sub-component (can live in `src/ui/Inspector.tsx` or a new
  `src/ui/CalloutInspector.tsx`) that renders style controls (colour picker,
  stroke width, fill opacity, font size for step, arrowhead size for arrow,
  blur radius for blur, darken strength for spotlight) and dispatches
  `set-callout` on change (80 ms debounce, same as existing title/effect
  controls). Changes trigger `calloutContentHash` invalidation in the worker's
  `CalloutTextureCache`.

## T10 — Padded-background panel (R5.7)

- [ ] **T10.1** `src/ui/PaddedBackgroundPanel.tsx` (new): SolidJS component in
  the clip Inspector for video clips. A toggle checkbox "Padded Background"
  enables/disables the feature (writes/removes `paddedBackground` on the clip
  via a new `set-padded-background` command, or reuse an existing generic
  `set-clip-sidecar` pattern — follow the existing command style in
  `src/protocol.ts`).
- [ ] **T10.2** `src/ui/PaddedBackgroundPanel.tsx`: when enabled, shows:
  background kind radio group (solid / gradient / wallpaper); solid → colour
  picker; gradient → up to 5 stop rows (colour + position), angle slider;
  wallpaper → media-bin source picker (filtered to image/video sources); inset
  margin slider (0–0.4, step 0.01); corner radius slider (0–64 px); shadow
  opacity slider (0–1); shadow radius slider (0–64 px); shadow offset Y
  (−32–32 px). All sliders use the existing slider component pattern with ARIA
  labels. Changes dispatch the update command with 80 ms debounce.
- [ ] **T10.3** `src/protocol.ts` + `src/engine/worker.ts`: add
  `set-padded-background { trackId; clipId; params: PaddedBackgroundParams |
  null }` command (null removes the sidecar); handle in the worker dispatch
  loop by mutating the clip's `paddedBackground` field and emitting a
  `timeline-state` snapshot.

## T11 — Unit tests (R9.1)

- [ ] **T11.1** `src/engine/event-log.test.ts` (new): test cases —
  `normalizeDomEventLogEntry` clamps x/y to 0–1; rejects non-finite `t`;
  rejects invalid `kind`; accepts `kind: 'scroll'` with `deltaY`;
  `parseDomEventLog` accepts a valid schema-v1 object; rejects missing
  `eventLogSchemaVersion`; rejects wrong version; reserved `key` channel in raw
  JSON is preserved in `events` array after parse (forward-compatibility);
  `flush()` with a mocked `FileSystemDirectoryHandle` resolves and the written
  string parses to a valid `DomEventLog`.
- [ ] **T11.2** `src/engine/auto-zoom.test.ts` (new): test cases —
  `clusterEvents([], ...)` → `[]`; single entry → one proposal with correct
  timing (`zoomInAtUs === entry.t − leadInMs * 1000`); two entries inside
  2 s / 15 % threshold → one cluster; two entries at exactly 2 s + 1 µs apart
  → two clusters; two entries at 16 % distance → two clusters; overlapping
  proposals (zoomOut of proposal A > zoomIn of proposal B by > 50 ms) → merged
  into one; determinism check (identical output on second call with same input);
  performance bound (generate 216 000 synthetic click entries uniformly
  distributed over 3600 s, measure the monotonic timer before/after `clusterEvents`;
  assert `elapsed < 100`).
- [ ] **T11.3** `src/engine/callout.test.ts` (new): test cases —
  `calloutContentHash` changes when `style.color` changes; changes when
  `style.strokeWidth` changes; changes when `geometry.x1` changes (arrow);
  does not change on identical inputs; `parseCalloutPayload` accepts valid
  payloads for all five kinds; rejects missing `calloutKind`; rejects unknown
  `calloutKind`; rejects geometry missing required field; `normalizeCalloutPayload`
  fills `style` defaults; round-trip: `parseCalloutPayload(JSON.parse(
  JSON.stringify(normalizeCalloutPayload(payload))))` equals `payload` for all
  five kinds.
- [ ] **T11.4** `src/engine/padded-background.test.ts` (new): test cases —
  `normalizePaddedBackground` fills all defaults; `parsePaddedBackground`
  accepts a valid gradient params object; rejects missing `background`;
  `shadowCacheKey` returns different strings for `shadowRadius: 24` vs `32`
  and for `cornerRadius: 16` vs `0`; round-trip `parsePaddedBackground(
  JSON.parse(JSON.stringify(normalizePaddedBackground({}))))` equals
  `DEFAULT_PADDED_BACKGROUND`; wallpaper texture lookup with a missing
  `sourceId` returns `null` and calls `console.warn` (spy), while repeated
  lookups for the same `sourceId` and output dimensions reuse the cached
  texture.
- [ ] **T11.5** `src/engine/project.test.ts` (extend): project doc with `callout`
  on a clip survives `serializeProject` → `parseProjectDoc` with bit-identical
  `callout`; project doc with `paddedBackground` survives round-trip; project
  doc with `sessionEventLogs` survives round-trip; project doc without any of
  the three fields (schema v10) parses cleanly at the new schema version with
  all three absent; `isCalloutClip` returns true only for `kind === 'callout'`
  clips.
- [ ] **T11.6** Protocol type guard tests: `ClipKindSnapshot` rejects unknown
  strings and accepts `'callout'`; `CalloutPayload` type guard accepts/rejects
  correctly for all five kinds; `PaddedBackgroundParams` type guard accepts
  solid/gradient/wallpaper background kinds; `SessionEventLogRef` type guard
  requires all three fields.

## T12 — Capability gating (R7)

- [ ] **T12.1** `src/ui/Inspector.tsx` (or wherever the Inspector sections are
  rendered): gate the Zoom Preset, Auto-Zoom, Callout, and Padded Background
  Inspector sections behind `CapabilityTierV2 === 'core-webgpu'`. When the tier
  is lower, render a disabled placeholder `<div>` with
  `title="Requires WebGPU (accelerated tier)"` and `aria-disabled="true"`.
- [ ] **T12.2** `src/ui/CalloutTool.tsx`: disable the toolbar callout tool
  button with the same tooltip on lower tiers. The button must remain in the
  DOM (not hidden) so keyboard users can discover the tooltip.
- [ ] **T12.3** `src/engine/shaders/blur-region.wgsl` / caller: clamp effective
  blur radius to 24 px (from the default 12 or user-set value) when
  `CapabilityProbeResult` indicates `maxComputeWorkgroupSizeX < 64`; emit the
  diagnostic finding `'blur-region.radius-capped'` via the `finding()` helper
  in `src/engine/diagnostics.ts`; surface a `"(capped)"` label beside the
  radius slider in `CalloutInspector.tsx`.

## T13 — Docs and quality gate (R9.3, R9.4)

- [ ] **T13.1** `docs/USER-GUIDE.md`: add a "Screencast Post Pack" section
  after the existing Titles section, summarising all four features and linking
  to `docs/SCREENCAST-GUIDE.md`. State plainly: "Auto-Zoom requires recording
  with the Own Tab option — event logs are not available for window or display
  captures."
- [ ] **T13.2** `docs/SCREENCAST-GUIDE.md` (new): step-by-step walkthroughs for
  each feature — (a) Zoom-n-pan presets: open a clip, Inspector → Zoom Preset,
  pick preset, adjust params, Apply, edit resulting keyframes; (b) Auto-zoom:
  record with Own Tab, land, open Auto-Zoom panel, review proposals, Apply /
  Skip, undo; (c) Callout clips: activate Callout tool, pick kind, draw on
  preview, adjust style in Inspector; (d) Padded background: Inspector →
  Padded Background, toggle on, choose gradient or wallpaper, adjust params.
  Include screenshots of each panel (placeholders are acceptable for the spec).
- [ ] **T13.3** `docs/VERIFY_DEPLOYMENT.md`: add Phase 43 smoke-test checklist
  items per the Validation section of the design doc (five manual checks).
- [ ] **T13.4** `npm run build` succeeds with strict TypeScript and no type
  errors. `npm test` is green. Test count grows by at least 40 cases (verify
  with `npm test -- --reporter=verbose | grep -c '✓'` or equivalent).
