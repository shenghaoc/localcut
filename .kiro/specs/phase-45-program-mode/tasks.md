# Tasks: Phase 45 — Program Mode (Live Scenes)

## T1 — Protocol and model (R4, R7, R8)

- [ ] **T1.1** Add to `src/protocol.ts` `WorkerCommand` union: `program-start`
  (`config: ProgramSessionConfig`), `program-stop`, `program-scene-switch`
  (`sceneId: string; transitionMs: 0 | 200`), `program-update-scenes`
  (`scenes: SceneDefinition[]`).
- [ ] **T1.2** Add to `src/protocol.ts` `WorkerStateMessage` union:
  `program-status` (`state`, `elapsedUs`, `activeSceneId`, `sources:
  ProgramSourceStatusSnapshot[]`), `program-error` (`code: ProgramErrorCode;
  detail: string`), `program-landed` (`sessionId; isoTrackIds;
  layoutTrackId`).
- [ ] **T1.3** Define `ProgramErrorCode`, `ProgramSourceStatusSnapshot`,
  `ProgramSourceDescriptor`, `ProgramSessionConfig`, `ProgramLandedResult`
  in `src/protocol.ts`.
- [ ] **T1.4** Add `SceneDefinition`, `SceneLayer`, `SceneDoc` types to
  `src/protocol.ts` or `src/engine/program-scenes.ts` and re-export from
  protocol as needed; they must be structured-clone-safe (no `GPUTexture`
  references).

## T2 — Scene model and persistence (R4, R8)

- [ ] **T2.1** Create `src/engine/program-scenes.ts`: `SceneDefinition`,
  `SceneLayer`, `SceneDoc` interfaces; `validateSceneDoc(value: unknown):
  SceneDoc | null` (hand-rolled validation matching the project.ts pattern —
  no zod); `hotkeyConflict(scenes: SceneDefinition[]): string | null`
  returning the conflicting hotkey if two scenes share a non-null hotkey.
- [ ] **T2.2** `resolveSceneAt(scenes, sceneId, frames, stills, srcW, srcH):
  CompositeLayer[]` in `src/engine/program-scenes.ts`: builds a
  `FrameCompositeLayer` for each visible video-source layer (using the frame
  from the `frames` map; skips if null), a `TextureCompositeLayer` for each
  still/title layer (using the view from the `stills` map), sorted ascending
  by `zIndex`. Identity `ClipEffectParams` (no colour grading on live
  sources in v1).
- [ ] **T2.3** Extend `ProjectDoc` in `src/engine/project.ts` with
  `scenes?: SceneDoc | null`; bump `PROJECT_SCHEMA_VERSION` to the next
  unused integer after v11 (do not hardcode); update `parseProjectDoc` /
  `migrateProjectDoc` to accept older schemas (set `scenes: null`).
- [ ] **T2.4** Add `PROGRAM_SOURCE_BINDINGS_STORE` constant and bump
  `DB_VERSION` in `src/engine/persistence.ts`; implement
  `loadProgramSourceBindings(): Promise<ProgramSourceBinding[] | null>` and
  `saveProgramSourceBindings(bindings: ProgramSourceBinding[]): Promise<void>`
  following the `loadPublishSettings`/`savePublishSettings` pattern.
- [ ] **T2.5** Add `'layout'` to `TimelineTrack['type']` in
  `src/engine/timeline.ts`; add `LayoutClip` interface; add
  `resolveLayoutAt(timeline: Timeline, time: number): LayoutClip | null`;
  ensure `resolveAllAt` and `resolveAt` skip `'layout'` tracks.

## T3 — Capability gating (R1, R2)

- [ ] **T3.1** Extend `CapabilityProbeResult` in `src/protocol.ts` with
  `programMode: FeatureSupport`; implement the derivation in
  `src/engine/capability-probe-v2.ts`: `programMode = 'supported'` iff
  `recordingAvailable(probe)` (Phase 41 derivation) is true and
  `probe.webGPUCore !== 'unsupported'`.
- [ ] **T3.2** Add one `CapabilityMatrixPanel` row for "Program mode" in
  `src/engine/diagnostics.ts` using the existing `finding` pattern; action
  link: "Program mode requires a Chromium browser with WebGPU and
  WebCodecs".
- [ ] **T3.3** Unit-test `programMode` derivation in a new test file
  `src/engine/program-capability.test.ts`: accelerated tier with all Phase
  41 probes (`'supported'`), Safari-like fixture (MSTP `'unsupported'`
  → `programMode: 'unsupported'`), Firefox-like fixture (MSTP + WebCodecs
  encode `'unsupported'`), accelerated tier minus `opfsSyncAccessHandle`
  (`'unsupported'`).

## T4 — Encoder budget extension (R3)

- [ ] **T4.1** Add `'program-iso'` to the `EncoderConsumer` union in
  `src/engine/encoder-budget.ts`; no other changes to the module.
- [ ] **T4.2** Implement `acquireProgramLeases(budget: EncoderBudget, count:
  number): EncoderLease[] | 'budget-exhausted'` in
  `src/engine/program-session.ts`: acquire `count` leases of kind
  `'program-iso'` in a loop; on any `null` return release all already
  acquired leases and return `'budget-exhausted'`.
- [ ] **T4.3** Unit-test `acquireProgramLeases` in
  `src/engine/program-session.test.ts`: exact-count success (budget 2,
  request 2), exhaustion (budget 2, request 3 returns error and no leases
  held), simultaneous WHIP publish lease reduces available count, release
  is idempotent.

## T5 — Live compose tap (R6)

- [ ] **T5.1** Create `src/engine/live-compose-tap.ts`: `LiveComposeTap`
  interface and `createLiveComposeTap(compositor: ProgramCompositor):
  LiveComposeTap`. `onFrame(sourceId, frame)` calls
  `compositor.updateFrame(sourceId, frame)` then closes any previously held
  clone from that source if not yet consumed (latest-frame-wins per source).
  `dispose()` closes any held frames.
- [ ] **T5.2** Close-exactly-once: every `VideoFrame` handed to
  `LiveComposeTap` is closed by the tap — either forwarded to the compositor
  (closed there after `importExternalTexture`) or closed on drop. The tap
  never leaks a frame across `dispose()`.
- [ ] **T5.3** Frames from ALL active sources are kept warm regardless of
  visibility in the current scene. The compositor skips invisible layers
  when building `CompositeLayer[]`, but the tap retains the latest frame
  so that switching to a scene where the source IS visible has a warm
  frame available immediately (preserving the one-frame switch invariant
  for low-FPS captures like screen sharing).
- [ ] **T5.4** Unit-test in `src/engine/live-compose-tap.test.ts`: frame
  forwarded to compositor, older frame closed on replacement (latest-frame-
  wins), invisible source frame closed immediately, dispose closes held
  frames. Use a spy compositor and mock `VideoFrame` objects.

## T6 — Program compositor (R5, R6)

- [ ] **T6.1** Create `src/engine/program-compositor.ts`:
  `ProgramCompositorConfig`, `ProgramCompositor` interface, and
  `createProgramCompositor(config)`. Holds `currentSceneId: string`,
  `Map<sourceId, VideoFrame | null>` (most recent clone), and
  `Map<sourceId, GPUTextureView>` (stills/titles).
- [ ] **T6.2** `updateFrame(sourceId, frame)`: stores the frame; closes any
  previously held frame for that source (latest-frame-wins). Called by
  `LiveComposeTap`.
- [ ] **T6.3** `switchScene(sceneId, transitionMs)`: updates `currentSceneId`.
  If `transitionMs === 200`, records `transitionStart = performance.now()`
  and `outgoingSceneId`. No pipeline rebuild.
- [ ] **T6.4** `renderTick(encoder)`: calls `resolveSceneAt` for
  `currentSceneId` (applying the eased-opacity lerp during a 200 ms
  transition window if active), then calls `compositeLayers(encoder,
  layers)` from `src/engine/gpu.ts`. Frames are NOT closed inside
  `renderTick` — they are held open and reused on subsequent ticks until
  a newer frame arrives from the same source (via `updateFrame`) or until
  `dispose()`. Single `queue.submit` is owned by the outer render loop —
  `renderTick` must not call `submit`.
- [ ] **T6.5** Unit-test in `src/engine/program-compositor.test.ts`:
  `renderTick` builds layers from scene, `switchScene` does not rebuild any
  pipeline (spy on `compositeLayers` call count), eased-transition opacity
  interpolation (fake timers), held frames closed after `renderTick`,
  `dispose` closes all held frames. Count `queue.submit` calls: must be 0
  per tick (submit is the render-loop's responsibility).

## T7 — Session orchestrator (R3, R7, R8)

- [ ] **T7.1** Create `src/engine/program-session.ts`:
  `ProgramSessionConfig`, `ProgramSession`, `ProgramLandedResult`;
  `createProgramSession(config, budget, captureSession): ProgramSession`.
  Uses the Phase 41 `capture-session.ts` orchestrator for the N ISO track
  pipelines; adds the `ProgramCompositor` and `LiveComposeTap` on top.
- [ ] **T7.2** `createProgramSession` acquires all N video encoder leases via
  `acquireProgramLeases` before creating any pipeline. On `'budget-exhausted'`
  throws `ProgramBudgetError` (no partial session).
- [ ] **T7.3** `switchScene(sceneId)`: records `{ kind: 'scene-switch';
  sceneId; atUs }` in the session manifest (via `chunk-manifest.ts`
  append), then calls `compositor.switchScene(sceneId, transitionMs)`.
- [ ] **T7.4** `stop()`: finalize all ISO pipelines (Phase 41 path), write
  manifest `finalize` record, call `landProgramSession` to materialise the
  layout track, return `ProgramLandedResult`. Releases all encoder leases.
- [ ] **T7.5** Unit-test in `src/engine/program-session.test.ts`: session
  creation acquires N leases, budget-exhausted blocks before any pipeline
  starts, switchScene appends manifest record and updates compositor,
  stop finalizes and lands. All Phase 41 mocks reused (mock capture session,
  mock manifest writer).

## T8 — Manifest extension (R7)

- [ ] **T8.1** Extend `CaptureManifestRecord` in
  `src/engine/capture/chunk-manifest.ts` with
  `| { kind: 'scene-switch'; sceneId: string; atUs: number }`.
- [ ] **T8.2** Update `parseManifest` (or `parseManifestLines`) to skip
  records with unrecognised `kind` strings rather than aborting. Return
  `scene-switch` records in the result alongside other record kinds.
- [ ] **T8.3** Unit-test in `src/engine/capture/chunk-manifest.test.ts` (or
  the existing manifest test file): manifest with `scene-switch` records
  parsed correctly; manifest with unknown `kind` values skips them without
  error; torn tail after a `scene-switch` record is tolerated.

## T9 — Landing: layout track (R8)

- [ ] **T9.1** Create `src/engine/program-landing.ts`:
  `landProgramSession(manifest, config, epochUs, endUs, timeline): {
  isoTrackIds: string[]; layoutTrackId: string }`. Reads `scene-switch`
  records from the parsed manifest, builds contiguous `LayoutClip` segments,
  and calls the existing P11 track-add command path for each ISO track.
- [ ] **T9.2** Layout-track materialization: for each segment, create a
  `LayoutClip { kind: 'layout'; startTime; duration; sceneId;
  sceneSnapshot }` where `sceneSnapshot` is the `SceneDefinition` from the
  session config matching `sceneId`. `startTime` in seconds =
  `(atUs − epochUs) / 1_000_000`.
- [ ] **T9.3** Epoch alignment follows Phase 41 exactly:
  `placementOffset = (firstSampleTs − epochUs) / 1_000_000` per ISO track.
  No force-zeroing.
- [ ] **T9.4** The landing operation is wrapped as a single undoable operation
  via the Phase 9 command path so undo removes all ISO tracks, the layout
  track, and the media assets atomically.
- [ ] **T9.5** If the manifest contains no `scene-switch` records but did run
  with a defined `initialSceneId`, create a single full-duration
  `LayoutClip`. If `initialSceneId` is undefined or no scenes were defined,
  create no layout track.
- [ ] **T9.6** Unit-test in `src/engine/program-landing.test.ts`: 3 scene
  switches produce 4 contiguous `LayoutClip` segments with correct
  durations; no switches produce one full-duration clip; zero scenes
  produces no layout track; epoch offset applied correctly (44 ms camera
  lead preserved); undo removes all tracks atomically.

## T10 — Worker integration (R5, R6, R7)

- [ ] **T10.1** Handle `program-start` command in `src/engine/worker.ts`:
  validate config, call `createProgramSession`, post
  `program-status { state: 'armed' }`; on budget error post
  `program-error { code: 'budget-exhausted' }`.
- [ ] **T10.2** Handle `program-stop`: call `session.stop()`, post
  `program-status { state: 'stopping' }`, await landing, post
  `program-landed`.
- [ ] **T10.3** Handle `program-scene-switch`: call `session.switchScene`.
  Debounce to one switch per compositor tick (≈ 16 ms); rapid commands
  within one tick collapse to the last one.
- [ ] **T10.4** Handle `program-update-scenes`: update the compositor's
  scene definitions mid-session (for live scene editing before/after start).
  During a running session, only the compositor's scene map is updated; ISO
  pipelines are unaffected.
- [ ] **T10.5** Emit `program-status` updates on each compositor tick during a
  running session (piggyback the existing render-loop cadence; no extra
  timers). Include per-source `preEncodeDrops` from the Phase 41
  `TrackPipeline` state.

## T11 — Acquisition and UI wiring (R2, R9)

- [ ] **T11.1** Create `src/ui/ProgramPanel.tsx`: source acquisition controls
  (Add screen — one gesture per source; camera picker; mic picker; still
  import via File System Access); scene editor (add/rename/remove scenes,
  hotkey assignment, layer list with per-layer transform fields); Start/Stop
  button; encoder budget display (current usage / max); elapsed time and
  active scene indicator during a running session; per-source drop warnings.
- [ ] **T11.2** Scene editor: changes to `ProjectDoc.scenes` go through the
  `program-update-scenes` command when a session is running; otherwise
  update the project document directly via the existing persistence path.
- [ ] **T11.3** Monitor tiles: each acquired source renders a muted
  `<video srcObject>` clone tile. `onCleanup` stops the clone track and
  removes the `srcObject`. Transferred originals are sent via
  `program-start`.
- [ ] **T11.4** Gate the entire panel on `probe.programMode === 'supported'`;
  disabled state lists each missing probe with its action link per R1.1;
  never hide the entry point silently.
- [ ] **T11.5** Hotkey listener: `keydown` on the program monitor with
  keys `'1'`–`'9'` triggers `program-scene-switch` for the matching scene.
  Listener is active only when a session is running; removed via `onCleanup`.
- [ ] **T11.6** Accessibility pass per steering: keyboard operability, ARIA
  labels, ARIA live region for active scene name changes, visible focus,
  contrast; no media objects or GPU handles in `src/ui/`; `onCleanup` for
  all listeners.
- [ ] **T11.7** Create `src/ui/ProgramMonitor.tsx`: full-resolution preview of
  the composited program output during an active session; displays the same
  `OffscreenCanvas` output path as the existing preview canvas; no new GPU
  path.

## T12 — Re-export from landed project (R8)

- [ ] **T12.1** In `src/engine/worker.ts` render loop, call
  `resolveLayoutAt(timeline, time)` alongside `resolveAllAt`. When a
  `LayoutClip` is active, use its `sceneSnapshot` to determine layer
  transforms/visibility/z-order, but resolve the actual video frames from
  the ISO tracks via the standard `resolveAllAt` decode path. The layout
  track provides the compositor configuration; the ISO tracks provide the
  media. In v1, if a layout track exists it takes full priority over
  video tracks for compositing configuration during its span.
- [ ] **T12.2** Export path (`src/engine/export.ts`) must consult the layout
  track via `resolveLayoutAt` so the exported file matches the landed live
  mix. The same `compositeLayers` path — no fork for export vs preview.

## T13 — Unit tests: one-frame scene switch (R9)

- [ ] **T13.1** `src/engine/program-compositor.test.ts` (covered in T6.5) must
  include the acceptance-criterion test: start with scene A, call
  `switchScene('B')`, call `renderTick` once, assert: `compositeLayers`
  called once with scene-B layer descriptors; no encoder operations recorded;
  no texture allocations recorded. Spy on `compositeLayers` and the mock GPU
  device's `createTexture`.
- [ ] **T13.2** `src/engine/program-landing.test.ts` (covered in T9.6) must
  include the alignment test: with synthetic clocks (camera 1 first-sample
  at 0 µs, camera 2 at 44,000 µs), landed clips offset by 44 ms; mutual
  skew ≤ 2.67 ms (one audio quantum at 48 kHz); no force-zeroing.
- [ ] **T13.3** Budget gate test in `src/engine/program-session.test.ts`
  (covered in T4.3 / T7.5): 3 video sources, hardware budget 2 → error
  before any ISO pipeline created; assert `TrackPipeline` constructor called
  0 times.

## T14 — Integration test: Playwright (R10)

- [ ] **T14.1** Add a Playwright spec `tests/program-mode.spec.ts`: launch
  Chromium with `--use-fake-device-for-media-stream`; open the ProgramPanel;
  add 1 camera + 1 screen source; define 2 scenes; start the session; switch
  scene via hotkey `'2'`; wait 2 s; stop; assert `program-landed` event
  received; assert timeline has 2 ISO tracks + 1 layout track with ≥ 2
  `LayoutClip` segments.
- [ ] **T14.2** Playwright is used only for this UI-critical happy path; all
  other coverage stays in Vitest. The program-mode spec lives in
  `tests/program-mode.spec.ts` alongside the existing Phase 47 publish spec.

## T15 — Docs and verification (R10)

- [ ] **T15.1** Create `docs/PROGRAM-MODE.md`: adding sources (one-gesture-per-
  screen rule), composing scenes (layers, transforms, hotkeys), encoder
  budget and what the limit means, starting/stopping a session, re-editing
  the landed project, known browser support (Chromium-only v1 with reasons).
- [ ] **T15.2** Update `docs/USER-GUIDE.md`: add a "Program Mode" section
  linking to `docs/PROGRAM-MODE.md`; note that landed ISO tracks are
  independently editable.
- [ ] **T15.3** Manual smoke: 2-camera + 1-screen + mic session on Chromium;
  define 3 scenes; switch with hotkeys; stop; verify 4 ISO tracks + layout
  track land; re-export and confirm the output matches the live mix sequence;
  verify budget error on 3 video sources with hardware budget 2; verify
  Safari shows the disabled panel with per-probe reasons and no crash.
- [ ] **T15.4** `npm run build` and `npm test` green; test count grows.
