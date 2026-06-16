# Requirements: Phase 45 — Program Mode (Live Scenes)

Program mode drives the Phase 12 GPU compositor with live
`MediaStreamTrack` sources instead of timeline clips. The operator
composes named **scenes** — layout presets over live cameras, screen
captures, and stills — and switches between them with hotkeys. Every
source is independently ISO-encoded to OPFS using the Phase 41
crash-safe pipeline (one session, N source pipelines). Stopping the
session lands a fully re-editable multitrack project: one ISO video or
audio track per live source, plus a dedicated **layout track** that
replays the live mix through the same Phase 12 compositor. The
accelerated-tier acceptance bar: a 2-camera + 1-screen + mic session
switches scenes within one preview frame with no pipeline rebuild.

**Hard dependency:** Phase 41 (PR #64) — the session model, per-track
pipelines, writer worker, and crash-safe manifest are reused unchanged.
Program mode adds only the live-compose tap and the layout track on top.

## R1 — Capability Gating

- **R1.1** Program mode is enabled only when `CapabilityTierV2 ===
  'core-webgpu'` **and** all capture-critical probes from Phase 41
  report `supported` (`mediaStreamTrackProcessor`, `videoEncodeRealtime`,
  `opfsSyncAccessHandle`, `transferableMediaStreamTrack`). Absence of any
  one hides the program-mode entry point with a per-missing-probe reason
  from the Phase 26 diagnostics pattern; the shell never crashes.
- **R1.2** The capability probe gains a derived `programMode:
  FeatureSupport` field in `CapabilityProbeResult`, computed from the
  Phase 41 `recordingAvailable` derivation plus a WebGPU-in-worker check.
  The `CapabilityMatrixPanel` gains one row for "Program mode" with the
  standard chip + action-link format.
- **R1.3** Safari and Firefox receive the program-mode panel in a
  disabled state listing per-probe reasons. No crash and no reduced-tier
  fallback implementation are required in v1; the feature is
  accelerated-tier-only by design.
- **R1.4** When program mode is disabled, the rest of the editor —
  playback, export, recording — is unaffected.

## R2 — Source Acquisition (one gesture per screen source)

- **R2.1** Each screen/window/tab capture source requires exactly one
  `getDisplayMedia` picker gesture from the user before the session
  starts. The engine never silently enumerates or auto-selects display
  surfaces.
- **R2.2** Camera sources are acquired via `getUserMedia`. Device
  enumeration (labels) is performed only after a successful permission
  grant. Each camera is identified by `deviceId`.
- **R2.3** Microphone sources are acquired via `getUserMedia` and encoded
  to a separate audio ISO track. Audio monitoring during the session
  uses the existing Phase 16 monitor mix of armed mic sources; the
  operator hears the monitor mix, but the **landed audio is the ISO
  recording**, not the monitor mix output.
- **R2.4** Cross-origin page content cannot be composited directly (canvas
  tainting). Web content enters the compositor only via tab capture
  (`getDisplayMedia`) or same-origin Element Capture (`CropTarget`).
  The UI labels Element Capture as a Chromium-only option and disables
  it with a reason on unsupported browsers; the spec does not attempt to
  composite cross-origin `<iframe>` or `<video>` elements.
- **R2.5** Denial, picker cancellation, and `NotReadableError` each
  produce a distinct user-facing message and leave the program-mode
  session in a recoverable (not started) state.
- **R2.6** Each acquired track is cloned for the muted self-monitor
  `<video srcObject>` tile; the original is transferred to the pipeline
  worker. The monitor clone's `onended` event (not the transferred
  original's) drives the in-app remove-source path when the browser
  "Stop sharing" control is used.

## R3 — Encoder-Session Budget

- **R3.1** All N video ISO pipelines (one per video source) plus any
  simultaneously active export session are governed by the existing
  `src/engine/encoder-budget.ts` lease ledger. Program mode acquires N
  leases up front before starting any source pipeline.
- **R3.2** If N leases are not available (budget exhausted), starting
  the program-mode session is blocked with an explicit error message
  naming the budget limit (e.g. "hardware encoder budget allows 2
  concurrent sessions on this device — reduce the number of video
  sources or stop the active export"). No partial session is ever
  started; all leases are acquired atomically before any source begins.
- **R3.3** Audio-only sources (microphone) do not consume a video encoder
  lease; the budget counts video encode sessions only, consistent with
  the existing `EncoderConsumer` model.
- **R3.4** Leases are released on session stop or on per-source error
  (the Phase 41 per-source error policy applies unchanged). Release is
  idempotent; double-release is a no-op (the existing `EncoderLease`
  contract).
- **R3.5** The program-mode session coexists with WHIP publish (Phase
  47) under the same budget: the combined video encoder count across
  ISO sources plus active WHIP publish must not exceed the budget; the
  start-session dialog states current budget usage before the user
  commits.

## R4 — Scene Model

- **R4.1** A scene is a named layout preset: `{ id: string; name:
  string; hotkey: '1' | '2' | … | '9' | null; layers: SceneLayer[] }`.
  Each `SceneLayer` references a live source by `sourceRef: string`
  (matching the `sourceId` of an acquired source) and carries a full
  `TransformParams` (P12 fields: `x, y, scale, rotation, opacity,
  anchorX, anchorY, fit`) plus `visible: boolean` and `zIndex: number`.
- **R4.2** Scenes are versioned JSON stored in the project (`ProjectDoc`
  gains `scenes?: SceneDoc | null`, schema bumped to the next unused
  version — v11 is reserved by the open Phase 46 PR; this phase bumps
  to the next unused version after that). The `SceneDoc` type is `{
  sceneSchemaVersion: 1; scenes: SceneDefinition[] }`.
- **R4.3** `deviceId` bindings (which physical camera or microphone
  maps to a `sourceId`) are device-scoped and live in a new app-scoped
  IndexedDB store (`PROGRAM_SOURCE_BINDINGS_STORE` in
  `src/engine/persistence.ts`), **not** in `ProjectDoc`. Reason: device
  IDs are machine-local; embedding them in the project document would
  make bundles non-portable across machines.
- **R4.4** A project may define up to 9 scenes. Hotkeys `'1'`–`'9'`
  are optional (null = no hotkey binding). Two scenes may not share the
  same non-null hotkey within a project.
- **R4.5** Scenes are project-level configuration (they travel with the
  project bundle); source bindings are device-level (they do not).

## R5 — Scene Switching (one-frame guarantee)

- **R5.1** Switching scenes updates only the per-layer `transform /
  visibility` uniform values that the compositor reads for the **next
  frame**. No pipeline rebuild occurs, no texture is reallocated, no
  source encoder is touched. This is the invariant checked by the
  acceptance test (R9).
- **R5.2** The default scene transition is **instant** (the new layout
  takes effect on the very next compositor frame). An optional eased
  transition of **200 ms** is available; it linearly interpolates the
  `opacity` uniform of each layer between the outgoing and incoming
  layouts. No other interpolation modes are supported in v1.
- **R5.3** Hotkeys `'1'`–`'9'` trigger scene switches when the program
  monitor has keyboard focus. The switch is debounced to one per frame
  (≈ 16 ms at 60 fps); rapid key presses do not queue multiple
  in-flight transitions.
- **R5.4** Scene-switch commands sent from the UI to the pipeline worker
  follow the existing `WorkerCommand` protocol. The pipeline worker
  applies the switch to the compositor's layer state at the top of the
  next render loop iteration.

## R6 — Live Compose Tap

- **R6.1** Each video source's `MediaStreamTrackProcessor` readable feeds
  **both**: (a) the ISO encode pipeline (Phase 41, unchanged) and (b) the
  live-compose path. The frame is cloned once for ISO encode and the
  original is used for composition (or vice versa — see the ownership
  table in design.md). Each clone is closed exactly once; the
  close-exactly-once discipline matches Phase 27 / Phase 41 practice.
- **R6.2** The live compositor follows the Phase 12 layer model. Live
  source textures enter as `FrameCompositeLayer { kind: 'frame'; frame:
  VideoFrame; ... }` layers, fed via `importExternalTexture` per frame.
  Single `queue.submit` per frame is preserved (architectural hard gate).
- **R6.3** A still image source (a file the user imports before the
  session) enters the compositor as a `TextureCompositeLayer { kind:
  'texture'; ... }` whose `GPUTexture` is uploaded once and reused each
  frame. It does not require an MSTP pipeline or encoder lease.
- **R6.4** A text/title source reuses the Phase 14 `TitleTextureCache`
  to produce a `TextureCompositeLayer` with zero CPU pixel round-trips.
  Text content is edited before the session starts; live mid-session
  text editing is out of scope for v1.
- **R6.5** The compositor's program output (the composited frame after
  `queue.submit`) is available to the Phase 47 WHIP publish tap if a
  publish session is active. Program mode + WHIP publish coexistence is
  governed by the encoder budget (R3.5); no new compositor path is
  needed — the existing `PublishFrameTap` hooks onto the same output.
- **R6.6** No CPU pixel round-trip is introduced in the live compose
  path. Every `VideoFrame` received from an MSTP reader is passed to
  `importExternalTexture` in the pipeline worker; it never touches
  Canvas2D, `getImageData`, or CPU memory.
- **R6.7** Frames from ALL active sources are kept warm regardless of
  visibility in the current scene. The tap retains the latest frame per
  source; frames are NOT closed inside `renderTick` — they are held open
  and reused across ticks until replaced by a newer frame or until
  `dispose()`. This preserves the one-frame scene-switch invariant for
  low-FPS captures (e.g. screen sharing at 5 fps): switching to a scene
  that reveals a previously invisible source has a frame available
  immediately without waiting for the next MSTP read.

## R7 — ISO Recording (N Sources, One Session)

- **R7.1** The program-mode session is a Phase 41 capture session ×N
  sources under one session manifest. The manifest header's `sources`
  array carries one `CaptureSourceSnapshot` per live source. The
  `capture-session.ts` orchestrator, `track-pipeline.ts`,
  `fragmented-writer.ts`, and `writer-worker.ts` are reused unchanged.
- **R7.2** The session manifest is extended with a new record kind
  `{ kind: 'scene-switch'; sceneId: string; atUs: number }` recorded at
  the session-epoch-relative µs timestamp of each switch. This record is
  appended after the normal chunk/data flow, following the same
  write-ordering contract as Phase 41 (`data → data flush → manifest
  append → manifest flush`). Parsers that do not know this record kind
  must skip it (version-tolerant).
- **R7.3** OPFS layout: one session directory under `opfs:/capture/
  <sessionId>/`, exactly as in Phase 41. No new directory structure.
- **R7.4** Storage preflight (Phase 41 `quota.ts`) accounts for all N
  video sources and all audio sources when estimating required headroom.
- **R7.5** Crash recovery follows the Phase 41 path. A torn session
  manifest that includes `scene-switch` records with unknown fields is
  parsed tolerantly (skip unknown `kind`s); the track files land
  normally; the layout track is reconstructed from the parsed
  `scene-switch` records only.

## R8 — Landing: Multitrack Project

- **R8.1** On clean stop (or recovery import), each ISO track file lands
  as a Phase 11 media asset with a Phase 23 SHA-256 fingerprint and is
  placed on its own dedicated timeline track. Per-track epoch offsets
  follow Phase 41 exactly: `placement = firstSampleTs − epochUs`.
  Tracks are never force-zeroed; they are sample-aligned within one
  audio quantum.
- **R8.2** A dedicated **layout track** of type `'layout'` is added to
  the landed project's `Timeline`. The layout track consists of
  contiguous `LayoutClip` segments, each spanning the duration from one
  scene switch to the next (or to the session end). Each `LayoutClip`
  carries the full `SceneDefinition` (layers + transforms) active during
  that segment as P15-compatible keyframes at segment boundaries.
- **R8.3** Re-exporting the landed project runs the normal Phase 12
  compositor. The layout track provides the compositor configuration
  (layer transforms, visibility, z-order) via `resolveLayoutAt`, while
  the ISO tracks provide the actual video frames through the standard
  `resolveAllAt` decode path. The layout track's `sceneSnapshot` maps
  each layer's `sourceRef` to the corresponding ISO track's decoded
  frame. The live mix is fully re-editable: the user can trim, reorder,
  or retransform any segment after landing.
- **R8.4** The landing operation is one undoable operation via the
  existing Phase 9 command path. Undo removes all landed tracks and the
  layout track atomically.
- **R8.5** `ProjectDoc` bumps its schema version to the next unused
  integer after Phase 46's reservation (see R4.2). The migration path
  for older schemas leaves `scenes` undefined and creates no layout
  track.

## R9 — Acceptance Test

- **R9.1** A 2-camera + 1-screen + mic session on the accelerated tier
  must switch scenes within one preview frame (≤ 1 compositor tick,
  ≈ 16 ms at 60 fps) with no pipeline rebuild, no texture reallocation,
  and no encoder restart. This is verified by a Vitest unit test with
  mocked MSTP readers and a spy compositor that counts `queue.submit`
  calls and asserts the layer-uniform delta is applied within one tick.
- **R9.2** ISO tracks in the resulting project are sample-aligned: with
  synthetic capture clocks, landed clips are mutually offset within one
  audio quantum (128 frames at 48 kHz context rate; ≈ 2.67 ms). Verified
  by unit test inheriting Phase 41 alignment fixtures.
- **R9.3** Encoder-session count is gated by the hardware probe: a
  3-source session on a budget-2 device is blocked with an explicit
  error before any source starts, never after. Verified by unit test
  with a mocked budget ledger.

## R10 — Tests and Docs

- **R10.1** All unit tests use mocked MSTP readers, spy WebCodecs
  encoders, mocked `getDisplayMedia`/`getUserMedia`, and a mocked
  encoder-budget ledger. No real media hardware is accessed in CI; no
  large media fixtures.
- **R10.2** Required unit coverage: encoder budget acquisition and
  blocking (exact-count gate, partial-start prevention); scene-switch
  one-frame invariant (compositor-uniform path, no pipeline rebuild);
  layout-track landing (segment boundaries, keyframe records, epoch
  alignment); manifest `scene-switch` record append and tolerant parse;
  still-image and title-source texture-layer construction; `programMode`
  capability derivation across accelerated, Safari-like, and
  Firefox-like probe fixtures; PROGRAM_SOURCE_BINDINGS_STORE isolation
  (bundles and autosaves structurally exclude it).
- **R10.3** Playwright covers the UI-critical happy path: launch with
  fake-device flags, start a camera + screen program session with 2
  scenes defined, switch scene via hotkey, stop, and assert layout track
  plus ISO tracks land correctly on the timeline.
- **R10.4** `docs/USER-GUIDE.md` gains a "Program Mode" section covering:
  adding sources, composing scenes, hotkeys, the one-gesture-per-screen
  rule, what "ISO tracks" are, landing and re-editing the project, and
  the encoder budget message. A new `docs/PROGRAM-MODE.md` page provides
  full setup and workflow details; `docs/USER-GUIDE.md` links to it.
- **R10.5** `npm run build` and `npm test` stay green; test count must
  not decrease.
