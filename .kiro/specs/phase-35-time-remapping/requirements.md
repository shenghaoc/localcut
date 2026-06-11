# Requirements: Phase 35 — Time Remapping

Per-clip speed ramps let creators slow down, speed up, or smoothly accelerate
through any segment of a clip without rendering to a new file. The speed curve
is authored in the Inspector as a bezier keyframe track — reusing Phase 15's
keyframe editor — and evaluated at preview and export via a shared
`src/engine/time-remap.ts` module so both paths produce bit-identical output
mapping. Audio follows the remap via WSOLA time-stretch in the pipeline worker,
with a pitch-preserve toggle. Phase 19 proxy and render-cache keys are extended
to include remap parameters so edits invalidate only the affected clip. Export
(Phases 17/24) requires no structural changes beyond calling the shared mapping
module.

## R1 — Speed curve model

- **R1.1** Each clip optionally carries a `timeRemap` sidecar in `ProjectDoc`
  containing an array of bezier keyframes over clip-local output time (in
  seconds, 0 = clip start in output, clamped to `[0, clip.duration]`) and a
  `pitchPreserve: boolean` flag. Absence of the sidecar means constant 1× speed
  (identity pass-through with zero processing overhead).
- **R1.2** Each keyframe stores `{ outTimeS: number; speed: number; easing:
  'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }`. Speed values
  are clamped to `[0.25, 4.0]` on write; out-of-range inputs are rejected by
  the worker with a `time-remap-error` message. Keyframes are sorted by
  `outTimeS` and the array must have no duplicate `outTimeS` values (within
  `1e-4 s` tolerance); the worker enforces this invariant on every
  `set-time-remap` command.
- **R1.3** Between keyframes the speed value is interpolated using bezier easing
  on the speed axis (matching the Phase 15 `sampleClipParamsAt` easing
  semantics). A `hold` easing keeps the speed of the preceding keyframe
  constant until the next keyframe; `linear` interpolates speed linearly.
- **R1.4** The speed curve is strictly positive at all output times — clamping
  speed to `[0.25, 4.0]` guarantees this. This ensures source time is a
  monotone-increasing function of output time, so the decoder always reads
  forward and reverse playback is not required. Reverse playback is explicitly
  excluded from v1 (see Non-goals in `design.md`).

## R2 — Time-mapping math and LUT

- **R2.1** The mapping from output time `t_out` to source time `t_src` is the
  cumulative integral of the speed curve: `t_src(t_out) = ∫₀^t_out speed(u) du`.
  This integral is pre-sampled into a monotone piecewise-linear LUT at a fixed
  step of `1/120 s` (the LUT step) by `src/engine/time-remap.ts` and rebuilt
  on every remap edit. O(1) per-frame lookup is achieved by binary-searching the
  LUT for the enclosing interval and linearly interpolating. The LUT is computed
  deterministically from the keyframe array and the clip duration; the same
  function is called by preview (worker render loop) and export
  (`src/engine/export.ts`), guaranteeing preview/export parity.
- **R2.2** At each output video frame time `t_out`, the source timestamp
  selected for decode is `t_src = remapOutputToSource(t_out)` where
  `remapOutputToSource` is exported from `src/engine/time-remap.ts`. The source
  timestamp is passed to `frameAt` and `resolveSourceTimestamp` as a real
  adapter timestamp in seconds (µs precision preserved), never as a frame index.
  This is the PR #49 VFR lesson: all mapping operates on real timestamps.
- **R2.3** The remapped frame chosen for output time `t_out` is the latest
  source frame whose presentation timestamp satisfies `pts ≤ t_src(t_out)`.
  This is the same floor-rounding rule that `SequentialFrameSource` uses for
  VFR content (PR #49). A/V sync within one frame at ramp boundaries is
  guaranteed when audio is computed from the same `t_src` value as video.
- **R2.4** The `buildRemapLUT(keyframes, clipDurationS)` function and the
  `remapOutputToSource(lut, tOutS)` lookup function are pure — no side effects,
  no I/O — so they can be unit-tested in the Node environment without browser
  APIs. Both are exported from `src/engine/time-remap.ts`.

## R3 — Clip duration semantics

- **R3.1** The clip's output duration changes when the remap is set: the new
  duration equals the output time at which `t_src` reaches the original clip's
  source in/out range. Specifically: if the source in-point is `inPointS` and
  source out-point is `inPointS + originalSourceDurationS`, the output clip
  duration is `t_out` such that `t_src(t_out) = originalSourceDurationS`.
  `buildRemapLUT` returns `{ lut, outputDurationS }`.
- **R3.2** When a remap changes a clip's output duration, the clip's `start`
  position in the timeline is unchanged; the clip's end moves (i.e. it grows or
  shrinks from the right). Neighbour clips are not automatically rippled — the
  same behaviour as trim. Overlaps that result from a duration extension are
  prevented by capping the remap's effective `outputDurationS` to the time until
  the next clip on the same track, mirroring the trim-overlap guard. The worker
  enforces this cap and reports `time-remap-capped` if the curve is trimmed.
- **R3.3** Every remap edit is undoable via the existing snapshot undo/redo
  history (`src/engine/worker.ts` snapshot mechanism). The undo snapshot
  captures the full `timeRemap` sidecar for the affected clip. Redo restores it.
- **R3.4** When a remap is cleared (via `clear-time-remap`), the clip's duration
  reverts to the original source duration minus the in/out trim, identical to
  how it appeared before any remap was set. If this would overlap a neighbour
  clip, the duration is capped the same way as R3.2.

## R4 — Audio: WSOLA time-stretch

- **R4.1** When `timeRemap` is present and `pitchPreserve === true`, audio is
  time-stretched via a WSOLA implementation (`src/engine/wsola.ts`) running in
  the pipeline worker. WSOLA parameters: analysis window `~30 ms` (1440 samples
  at 48 kHz), overlap 50% (720 samples), search radius `±10 ms` (±480 samples)
  using normalized cross-correlation. These values are constants in `wsola.ts`
  and named `WSOLA_WINDOW_SAMPLES`, `WSOLA_OVERLAP_SAMPLES`,
  `WSOLA_SEARCH_RADIUS_SAMPLES`.
- **R4.2** When `pitchPreserve === false`, audio is time-stretched by plain
  resampling (pitch follows speed): the `pcmWindowAt` call passes
  `targetSampleRate = sourceSampleRate / speed` so the existing
  `WasmAudioResampler` path handles it with no additional allocations.
- **R4.3** The per-frame audio fetch path in the render loop and export loop
  uses `pcmWindowAt(t_src, frameSamples, channels, targetRate)` where `t_src`
  is derived from the same LUT as video for that output frame. No unbounded
  audio buffers are held — each call fetches exactly the samples needed for the
  current output frame. The WSOLA instance holds at most a bounded look-back of
  `WSOLA_WINDOW_SAMPLES + WSOLA_SEARCH_RADIUS_SAMPLES` samples from the prior
  call (one overlap buffer per channel, allocated once at instantiation).
- **R4.4** The `WsolaStretcher` class in `src/engine/wsola.ts` is stateful per
  clip instance (maintains the overlap buffer). It exposes:
  `stretch(input: Float32Array, speedRatio: number, outputFrames: number):
  Float32Array`. Instances are created lazily per clip in the render loop and
  reused across consecutive frames of the same clip; they are discarded on seek,
  clip change, or remap edit.
- **R4.5** WSOLA operates entirely in the worker — no audio data crosses
  main/worker boundary during playback. The existing `AudioWorklet` graph and
  SAB clock are untouched.

## R5 — Phase 19 cache invalidation

- **R5.1** The `ClipDependencyKey` interface in `src/engine/cache-types.ts`
  gains a new optional field `timeRemapHash?: string`. When a clip has
  `timeRemap` set, `timeRemapHash` is the SHA-256 hex digest of the
  JSON-serialised remap keyframes array (same serialisation used for storage).
  When absent (identity speed), the field is omitted, preserving backward
  compatibility with existing cache entries.
- **R5.2** Editing a remap (any `set-time-remap` or `clear-time-remap` command)
  causes the affected clip's `timeRemapHash` to change (or be removed),
  producing a different `RenderCacheKey` hash. The cache invalidation in
  `src/engine/cache-invalidation.ts` must treat a `timeRemapHash` change as an
  edit to the clip range (same scope as a keyframe add/move/delete: invalidate
  the full clip range). Only the affected clip's cache entries are invalidated;
  other clips on the same or different tracks are not touched.
- **R5.3** Proxy assets are keyed by `settingsHash` in `ProxyAsset`. Remap
  parameters do not affect the proxy (proxies are decoded at source speed; remap
  is applied at display time). Therefore `timeRemapHash` is not part of the
  proxy `settingsHash`. Proxy assets remain valid across remap edits.

## R6 — Protocol commands and snapshot

- **R6.1** Two new commands are added to `src/protocol.ts` under
  `WorkerCommand`:
  - `{ type: 'set-time-remap'; trackId: string; clipId: string; remap:
    TimeRemapSnapshot }` — sets or replaces the remap for the given clip.
  - `{ type: 'clear-time-remap'; trackId: string; clipId: string }` — removes
    the remap, restoring identity speed.
- **R6.2** `TimeRemapSnapshot` is defined in `src/protocol.ts`:
  ```
  interface TimeRemapKeyframeSnapshot {
    outTimeS: number;
    speed: number;
    easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
  }
  interface TimeRemapSnapshot {
    keyframes: TimeRemapKeyframeSnapshot[];
    pitchPreserve: boolean;
  }
  ```
- **R6.3** `TimelineClipSnapshot` in `src/protocol.ts` gains an optional
  `timeRemap?: TimeRemapSnapshot` field. This field is included in every
  snapshot posted to the UI so the Inspector can display the current remap
  state and computed output duration.
- **R6.4** A new worker state message `{ type: 'time-remap-error'; trackId:
  string; clipId: string; reason: 'speed-out-of-range' | 'duplicate-keyframe'
  | 'remap-capped' }` is added for validation failures. `remap-capped` uses
  reason `'remap-capped'` and does not block the command — the cap is applied
  and the message is informational.
- **R6.5** A new worker state message `{ type: 'time-remap-updated'; trackId:
  string; clipId: string; outputDurationS: number }` is sent after a successful
  remap edit, so the UI can update the clip duration display without waiting for
  a full timeline snapshot.

## R7 — ProjectDoc persistence

- **R7.1** `TimelineClipSnapshot.timeRemap` is persisted as part of the clip in
  `project.json` inside project bundles and IndexedDB autosaves. No separate
  sidecar file is needed — the remap data is small (a handful of keyframe
  objects) and travels with the project document.
- **R7.2** The `ProjectDoc` schema version is bumped to the next unused version
  number (after checking `src/engine/project.ts` — v10 is current, v11 is
  claimed by Phase 46 PR #63; use the next available). Bumping follows the
  existing hand-rolled validation pattern: `parseTimeRemap(raw)` returns `null`
  on malformed input; absent/null is treated as identity (no remap). Older
  schema versions with no `timeRemap` field are loaded successfully with the
  identity default.
- **R7.3** `serializeProject` and `deserializeProject` in
  `src/engine/project.ts` are extended to handle `timeRemap` on each clip.
  `parseTimeRemap` validates: `keyframes` is an array, each element has finite
  `outTimeS`, `speed` in `[0.25, 4.0]`, and a valid easing string; `pitchPreserve`
  is boolean. Any field failing validation causes the clip's remap to be silently
  dropped (treated as identity) and logged to the diagnostics ring.

## R8 — UI: curve editor in the Inspector

- **R8.1** When a video clip is selected, the Inspector shows a "Speed" section.
  At constant 1× (no remap), it shows a single speed input field and an "Add
  Ramp" button. Clicking "Add Ramp" sets an initial remap with two keyframes:
  `{ outTimeS: 0, speed: 1 }` and `{ outTimeS: clip.duration, speed: 1 }`,
  opening the bezier curve editor.
- **R8.2** The curve editor is a reuse of the Phase 15 keyframe editor
  componentry (`src/ui/KeyframeEditor.tsx` or equivalent). The X-axis is
  clip-local output time (0 to current `outputDurationS`); the Y-axis is speed
  (0.25 to 4.0, displayed with a log-scale grid at 0.25×, 0.5×, 1×, 2×, 4×).
  Bezier handles control the easing between keyframes.
- **R8.3** The Inspector shows the computed output clip duration (in
  `HH:MM:SS:FF` timecode at the project frame rate) live as the user drags
  keyframes, derived from `outputDurationS` in the `time-remap-updated`
  message. No A/B audition is required.
- **R8.4** A "Pitch Preserve" toggle (checkbox) is shown in the Speed section.
  Its default state is `true`. Toggling it sends `set-time-remap` with the
  updated `pitchPreserve` value; no remap rebuild is required (the LUT is
  unchanged).
- **R8.5** A "Clear Ramp" button sends `clear-time-remap` and collapses the
  curve editor back to the single speed input. The UI shows "1×" as the speed
  value when no ramp is set.
- **R8.6** The Speed section follows the UI standards steering (dark
  professional-tool aesthetic, keyboard accessible, ARIA labels on all
  controls). No media objects or WebGPU handles are imported into
  `src/ui/`. `onCleanup` is used for any reactive subscriptions.

## R9 — Export parity

- **R9.1** The export loop in `src/engine/export.ts` calls `remapOutputToSource`
  from `src/engine/time-remap.ts` for every video frame in a remapped clip,
  passing the resulting `t_src` to `resolveSourceTimestamp`. No additional
  export-specific mapping logic is introduced — the shared LUT module is the
  single source of truth.
- **R9.2** The compatibility export path in
  `src/engine/compatibility/compat-export.ts` applies the same
  `remapOutputToSource` call for remapped clips.
- **R9.3** The render queue (Phase 24) and export presets (Phase 17) require no
  structural changes. Jobs that span remapped clips automatically include the
  full output duration of each remapped clip in their time range.
- **R9.4** The OTIO exporter (Phase 48, `src/engine/otio-export.ts`) must emit
  the remapped output duration for each remapped clip and include ramp metadata
  in the `metadata.localcut` namespace. This is the extent of Phase 48
  integration required; OTIO native speed ramps are out of scope.

## R10 — Bounded memory

- **R10.1** The LUT for a single clip is bounded: at `1/120 s` step and a
  maximum clip duration of 6 hours (21 600 s), the LUT is at most 2 592 001
  `Float64` entries (two arrays: `outTimes` and `srcTimes`), approximately
  40 MiB. In practice clips are seconds to minutes; for a 10-minute clip at
  4× max speed the LUT is ≤ 72 001 entries (~1.1 MiB). LUTs are rebuilt
  lazily on demand and discarded when the remap is cleared or the clip is
  removed.
- **R10.2** The WSOLA stretcher holds at most
  `(WSOLA_WINDOW_SAMPLES + WSOLA_SEARCH_RADIUS_SAMPLES) * channels * 4` bytes
  per active clip (≤ 46 080 bytes for stereo at 48 kHz). Instances are created
  per active clip in the render loop and released on clip exit, seek, or remap
  edit. No unbounded audio buffer growth is possible.
- **R10.3** No `VideoFrame` is held beyond the current render tick for remap
  purposes. Remapping changes which source timestamp is decoded; the decode,
  close, and GPU upload pattern is unchanged from the existing accelerated path.

## R11 — Tests and docs

- **R11.1** Vitest unit tests (Node environment, co-located) covering:
  - `src/engine/time-remap.test.ts`: `buildRemapLUT` (identity curve, single
    ramp, multi-keyframe curve, speed clamping, hold easing, output duration
    calculation); `remapOutputToSource` (monotone output, boundary values,
    midpoint accuracy within 1 ms).
  - `src/engine/wsola.test.ts`: `WsolaStretcher.stretch` at 0.5×, 1×, 2× speed
    with a synthetic 440 Hz sine, verifying output frame count and no unbounded
    allocation; `pitchPreserve: false` path via resampler stub.
  - `src/engine/time-remap-project.test.ts`: `parseTimeRemap` round-trip
    (valid, malformed speed, missing field, empty keyframes); schema
    serialise/deserialise of a clip with `timeRemap`; `clear-time-remap` restores
    original duration.
  - `src/engine/cache-key.test.ts` (extended): `ClipDependencyKey` with
    `timeRemapHash` produces a different key hash; absent `timeRemapHash` is
    stable.
- **R11.2** The Vitest test count must not decrease for any existing test suite.
  `npm run build` and `npm test` must remain green.
- **R11.3** `docs/USER-GUIDE.md` is updated with a "Speed Ramps" section
  describing how to add, edit, and clear a ramp, the pitch-preserve toggle, and
  the output duration display. `docs/TIME-REMAPPING.md` is created with a
  technical reference covering: the speed curve model, supported easing types,
  speed range limits, the relationship between speed and output duration, and
  the WSOLA audio behaviour.
