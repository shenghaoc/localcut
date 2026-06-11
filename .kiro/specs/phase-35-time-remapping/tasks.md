# Tasks: Phase 35 — Time Remapping

## T1 — Core time-remap module (R1, R2, R10)

- [ ] **T1.1** Create `src/engine/time-remap.ts`: export `REMAP_SPEED_MIN = 0.25`,
  `REMAP_SPEED_MAX = 4.0`, `REMAP_LUT_STEP_S = 1/120`; define `RemapKeyframe`,
  `RemapLUT` interfaces; export `buildRemapLUT(keyframes, sourceDurationS,
  stepS?)` that integrates the speed curve using composite Simpson's rule across
  bezier-eased intervals (reusing the bezier easing formula from
  `src/engine/keyframes.ts`) into two `Float64Array`s (`outTimesS`, `srcTimesS`)
  and returns `{ outTimesS, srcTimesS, outputDurationS }`.
- [ ] **T1.2** Export `remapOutputToSource(lut: RemapLUT, outTimeS: number):
  number` in `src/engine/time-remap.ts`: binary-search `lut.outTimesS` for the
  enclosing interval; linearly interpolate `lut.srcTimesS`; clamp result to
  `[0, sourceDurationS]` at boundaries. Maintain a per-call sequential hint
  (`lastIdx`) to achieve O(1) in the sequential case.
- [ ] **T1.3** Implement `hold` easing in `buildRemapLUT`: between two keyframes
  where the first has `easing: 'hold'`, the speed is constant at `keyframes[i].speed`
  for the entire interval `[keyframes[i].outTimeS, keyframes[i+1].outTimeS]`,
  making `srcTimeS` a linear function of `outTimeS` in that segment.
- [ ] **T1.4** Export `identityRemap(): null` as a typed sentinel (no-op remap)
  from `src/engine/time-remap.ts`. Callers that receive `null` skip all remap
  lookup and use the clip's direct source offset, paying zero overhead for clips
  without a remap.

## T2 — WSOLA time-stretcher (R4, R10)

- [ ] **T2.1** Create `src/engine/wsola.ts`: export `WSOLA_WINDOW_SAMPLES = 1440`,
  `WSOLA_OVERLAP_SAMPLES = 720`, `WSOLA_SEARCH_RADIUS_SAMPLES = 480`; implement
  `WsolaStretcher` class with constructor `(channels: number)` that allocates a
  `Float32Array` overlap buffer of length `WSOLA_OVERLAP_SAMPLES * channels` and
  a scratch cross-correlation buffer of length `2 * WSOLA_SEARCH_RADIUS_SAMPLES + 1`.
- [ ] **T2.2** Implement `WsolaStretcher.stretch(input: Float32Array, speedRatio:
  number, outputFrames: number): Float32Array`: for each output block, find the
  best-matching analysis position by normalised cross-correlation within
  `WSOLA_SEARCH_RADIUS_SAMPLES`, overlap-add with the stored buffer, advance the
  analysis pointer by `outputFrames * speedRatio` samples. Return interleaved
  output of length `outputFrames * channels`.
- [ ] **T2.3** Implement `WsolaStretcher.reset()` in `src/engine/wsola.ts`: zero the
  overlap buffer and reset the analysis position. Call this on seek, clip change,
  or remap edit to prevent state bleed across discontinuous audio segments.
- [ ] **T2.4** Document in `wsola.ts` (inline JSDoc) that the `input` parameter must
  contain at least `WSOLA_WINDOW_SAMPLES * channels` samples to avoid an underflow;
  callers are responsible for providing sufficient look-back from `pcmWindowAt`.

## T3 — Protocol types (R6)

- [ ] **T3.1** Add `TimeRemapKeyframeSnapshot` and `TimeRemapSnapshot` interfaces to
  `src/protocol.ts` following the existing snapshot naming convention:
  `TimeRemapKeyframeSnapshot { outTimeS: number; speed: number; easing: 'linear' |
  'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }` and `TimeRemapSnapshot {
  keyframes: TimeRemapKeyframeSnapshot[]; pitchPreserve: boolean }`.
- [ ] **T3.2** Add `timeRemap?: TimeRemapSnapshot` to `TimelineClipSnapshot` in
  `src/protocol.ts` as an optional field (backward-compatible).
- [ ] **T3.3** Add `{ type: 'set-time-remap'; trackId: string; clipId: string; remap:
  TimeRemapSnapshot }` and `{ type: 'clear-time-remap'; trackId: string; clipId:
  string }` to the `WorkerCommand` union in `src/protocol.ts`.
- [ ] **T3.4** Add `{ type: 'time-remap-updated'; trackId: string; clipId: string;
  outputDurationS: number }` and `{ type: 'time-remap-error'; trackId: string;
  clipId: string; reason: 'speed-out-of-range' | 'duplicate-keyframe' |
  'remap-capped' }` to the `WorkerStateMessage` union in `src/protocol.ts`.

## T4 — Worker command handling (R1, R2, R3, R6)

- [ ] **T4.1** In `src/engine/worker.ts`, add a handler for `set-time-remap`:
  validate that every `remap.keyframes[i].speed` is in `[0.25, 4.0]`; post
  `time-remap-error { reason: 'speed-out-of-range' }` and return on failure.
  Validate no two keyframes share an `outTimeS` within `1e-4 s`; post
  `time-remap-error { reason: 'duplicate-keyframe' }` and return on failure.
- [ ] **T4.2** In the `set-time-remap` handler, resolve the clip's source
  in/out duration (`clip.inPointDurationS = clip.originalDuration - clip.inPoint`
  or equivalent field); call `buildRemapLUT(remap.keyframes, inOutDurationS)`;
  compute `maxAllowedDurationS` as the gap to the next clip on the same track
  (or the track end); cap `outputDurationS` to `maxAllowedDurationS`; post
  `time-remap-error { reason: 'remap-capped' }` if capped; update `clip.timeRemap`
  and `clip.duration = outputDurationS` in the authoritative `Timeline`.
- [ ] **T4.3** In the `set-time-remap` handler, delete the `WsolaStretcher`
  instance for the affected `clipId` from the render-loop WSOLA instance map
  (stale after remap changes); push an undo snapshot capturing the prior
  `{ timeRemap, duration }` of the clip; post `time-remap-updated { trackId,
  clipId, outputDurationS }` then post the full timeline snapshot.
- [ ] **T4.4** Add a handler for `clear-time-remap` in `src/engine/worker.ts`:
  set `clip.timeRemap = undefined`; restore `clip.duration` to
  `originalInOutDurationS` (capped to `maxAllowedDurationS` as in T4.2); delete
  the WSOLA instance; push undo snapshot; post `time-remap-updated { outputDurationS:
  restoredDurationS }` and the timeline snapshot.

## T5 — Render loop integration (R2, R3, R4)

- [ ] **T5.1** In the preview render loop in `src/engine/worker.ts`, for each video
  layer, compute `clipLocalOutTimeS = timelineTime - clip.start`; if `clip.timeRemap`
  is set, look up `t_src = remapOutputToSource(lut, clipLocalOutTimeS)` (using the
  LUT stored on the clip or rebuilt from `clip.timeRemap.keyframes`); substitute
  `t_src` as the source offset passed to `resolveSourceTimestamp`. All source
  timestamps remain real seconds (µs precision), never frame indices.
- [ ] **T5.2** In the render loop audio path in `src/engine/worker.ts`, derive
  the audio `adapterTimestampS` from the same `t_src` as video (R2.3, A/V sync).
  If `clip.timeRemap.pitchPreserve === true`, pass the raw PCM from `pcmAt` into
  `WsolaStretcher.stretch(pcm, currentSpeedRatio, outputFrameSamples)` before
  handing to the mix ring; cache the `WsolaStretcher` instance per `clipId` in a
  `Map<string, WsolaStretcher>` local to the render controller, resetting it on
  any seek. If `pitchPreserve === false`, pass `targetSampleRate = nativeSampleRate / speedRatio`
  to `pcmAt` so `WasmAudioResampler` handles the rate change directly.
- [ ] **T5.3** Store the LUT alongside the clip's remap in the worker's live
  timeline (a `Map<string, RemapLUT>` keyed by `clipId` rebuilt on every
  `set-time-remap` and cleared on `clear-time-remap`). Do not rebuild the LUT
  per-frame. On undo restoring a prior remap, rebuild the LUT from the restored
  `clip.timeRemap.keyframes`.

## T6 — Export loop integration (R9)

- [ ] **T6.1** In `src/engine/export.ts`, in the per-clip video frame loop,
  add a `remapOutputToSource` call (imported from `src/engine/time-remap.ts`)
  before the `resolveSourceTimestamp` call for any clip that has `timeRemap` set.
  The LUT is built once per clip at the start of its export segment and held for
  the duration of that segment.
- [ ] **T6.2** In the export audio loop in `src/engine/export.ts`, derive the
  audio source timestamp from the same remapped `t_src` used for video in that
  frame, maintaining A/V sync per R2.3. For `pitchPreserve: true`, create a
  `WsolaStretcher` at the start of the clip's export segment and discard it at
  the end (no state crosses clips in export). For `pitchPreserve: false`, pass
  the adjusted `targetSampleRate` to `pcmWindowAt` as in T5.2.
- [ ] **T6.3** Apply the same `remapOutputToSource` call in
  `src/engine/compatibility/compat-export.ts` for the compatibility export video
  frame loop, mirroring T6.1.

## T7 — Phase 19 cache integration (R5)

- [ ] **T7.1** Add `readonly timeRemapHash?: string` to `ClipDependencyKey` in
  `src/engine/cache-types.ts`. Document that the field is absent when the clip
  has no remap (identity speed) and present (SHA-256 hex of canonical remap JSON)
  when a remap is set.
- [ ] **T7.2** In `src/engine/cache-key.ts`, implement `hashTimeRemap(remap:
  TimeRemapSnapshot): string` that JSON-stringifies the remap with keyframes
  sorted by `outTimeS` (canonical order) and returns its SHA-256 hex digest using
  `crypto.subtle` (with a pure-JS SHA-256 fallback for the Node test environment).
  Populate `ClipDependencyKey.timeRemapHash` from `buildClipDependencyKey` when
  the clip has `timeRemap`.
- [ ] **T7.3** In `src/engine/cache-invalidation.ts`, extend the
  `invalidateForClipEdit(clipId)` helper to look up `byTimeRemapHash` in the
  dependency index and mark matching entries as `'stale'`. Add `byTimeRemapHash:
  Readonly<Record<string, readonly string[]>>` to `CacheDependencyIndex` in
  `src/engine/cache-types.ts`.

## T8 — Persistence (R7)

- [ ] **T8.1** In `src/engine/project.ts`, add `timeRemap?: TimeRemapSnapshot` to
  the internal `TimelineClip` type (parallel to `keyframes` and `lut`). In
  `serializeClip`, emit `timeRemap` when present. In `deserializeClip`, call
  `parseClipTimeRemap(raw.timeRemap)` — returns `TimeRemapSnapshot | null`; null
  is treated as no remap and logged as `'time-remap-parse-failed'` in the
  diagnostics ring.
- [ ] **T8.2** Implement `parseClipTimeRemap(raw: unknown): TimeRemapSnapshot | null`
  in `src/engine/project.ts` using `isRecord`, `finiteNumber`, and `requiredString`
  (existing helpers): validate `keyframes` is an array with each entry having a
  finite `outTimeS`, `speed` in `[0.25, 4.0]`, and `easing` in `{ 'linear',
  'ease-in', 'ease-out', 'ease-in-out', 'hold' }`; validate `pitchPreserve` is
  a boolean; return null on any validation failure.
- [ ] **T8.3** Bump `PROJECT_SCHEMA_VERSION` in `src/engine/project.ts` to the next
  unused integer (check current value and any open PRs — Phase 46 PR #63 claims
  v11; use the first unused value after all merged and in-flight claims).
  Older schema versions load successfully with `clip.timeRemap` absent (identity
  default). Update the version constant and all snapshot serializers that
  reference it.

## T9 — UI: TimeRemapEditor component (R8)

- [ ] **T9.1** Create `src/ui/TimeRemapEditor.tsx` implementing `TimeRemapEditorProps
  { clip: TimelineClipSnapshot; projectFps: number; onSetRemap: (remap:
  TimeRemapSnapshot) => void; onClearRemap: () => void }`. Render the Speed
  section with: "Add Ramp" button (when no `clip.timeRemap`); the curve editor
  reusing Phase 15 keyframe editor componentry with X-axis = output time,
  Y-axis = speed 0.25×–4× (when `clip.timeRemap` exists); "Clear Ramp" button;
  "Pitch Preserve" checkbox; output duration badge formatted as timecode.
- [ ] **T9.2** In `src/ui/TimeRemapEditor.tsx`, "Add Ramp" click constructs a
  `TimeRemapSnapshot` with two keyframes `[{ outTimeS: 0, speed: 1, easing:
  'linear' }, { outTimeS: clip.duration, speed: 1, easing: 'linear' }]` and
  `pitchPreserve: true` then calls `onSetRemap`. This sends `set-time-remap` to
  the worker via the parent.
- [ ] **T9.3** In `src/ui/TimeRemapEditor.tsx`, handle `time-remap-updated` messages
  by updating the output duration badge reactively. Use a SolidJS signal for
  `outputDurationS` initialised from the clip's `duration` field; update it on
  receipt of `time-remap-updated` for the matching `clipId`. Use `onCleanup` to
  unsubscribe the message listener.
- [ ] **T9.4** In `src/ui/TimeRemapEditor.tsx`, ensure all interactive controls
  have ARIA labels; the output duration badge has `role="status"`; the Speed
  section heading is a proper `<h3>` or uses `aria-labelledby`; keyboard
  navigation reaches the Add/Clear buttons and the Pitch Preserve checkbox.
  No WebGPU handles, `VideoFrame`, or `AudioData` objects are referenced.
- [ ] **T9.5** In `src/ui/Inspector.tsx`, render `<TimeRemapEditor>` in the clip
  Inspector for video clips (`clip.kind !== 'title'` and the clip's source has
  video). Wire `onSetRemap` to `postCommand({ type: 'set-time-remap', trackId,
  clipId, remap })` and `onClearRemap` to `postCommand({ type: 'clear-time-remap',
  trackId, clipId })`.

## T10 — Unit tests (R11)

- [ ] **T10.1** Create `src/engine/time-remap.test.ts` covering:
  - `buildRemapLUT` with no keyframes (identity: 1× speed, `outputDurationS =
    sourceDurationS`).
  - `buildRemapLUT` with a single constant 2× ramp: `outputDurationS` should be
    `sourceDurationS / 2` (within 1 ms tolerance).
  - `buildRemapLUT` with a 0.5× ramp: `outputDurationS ≈ 2 * sourceDurationS`
    (within 1 ms).
  - `buildRemapLUT` with `hold` easing: the source time advances linearly within
    the hold segment.
  - `remapOutputToSource` on an identity LUT returns `outTimeS` unchanged.
  - `remapOutputToSource` at `outTimeS = 0` returns 0; at `outTimeS =
    lut.outputDurationS` returns `sourceDurationS`.
  - `remapOutputToSource` is monotone: for a random sequence of increasing
    `outTimeS` values, the returned `srcTimeS` values are also increasing.
  - Clamping: `remapOutputToSource` at `outTimeS > outputDurationS` returns
    `sourceDurationS` (clamped).
- [ ] **T10.2** Create `src/engine/wsola.test.ts` covering:
  - `WsolaStretcher.stretch` at `speedRatio = 1.0`, 2 channels, 960 input/output
    frames: output length equals `outputFrames * channels`; no allocations beyond
    the pre-allocated scratch buffer (check that the same `Float32Array` instances
    are reused across calls using `Object.is`).
  - `stretch` at `speedRatio = 0.5`: output is time-stretched (length check only;
    no perceptual quality assertion in unit tests).
  - `stretch` at `speedRatio = 2.0`: advance pointer moves further; output length
    unchanged.
  - `reset()` clears the overlap buffer (check the buffer is all zeros after reset).
  - Sequential calls without reset produce continuity (no sudden level jump
    between call boundaries) on a synthetic constant-value signal.
- [ ] **T10.3** Create `src/engine/time-remap-project.test.ts` covering:
  - `parseClipTimeRemap` with a valid `TimeRemapSnapshot`: round-trip serialise
    and deserialise returns the original (deep equal).
  - `parseClipTimeRemap` with `speed: 0.1` (below minimum): returns `null`.
  - `parseClipTimeRemap` with a missing `pitchPreserve` field: returns `null`.
  - `parseClipTimeRemap` with an empty `keyframes` array: returns a valid snapshot
    with `keyframes: []`.
  - `serializeProject` / `deserializeProject` round-trip for a project with one
    clip carrying `timeRemap`: the deserialized clip has the same `timeRemap`
    (deep equal).
  - `clear-time-remap` command handler in a mocked worker restores `clip.duration`
    to the pre-remap value.
  - Undo after `set-time-remap` restores the previous `{ duration, timeRemap }`.
- [ ] **T10.4** Extend `src/engine/cache-key.test.ts`:
  - A `ClipDependencyKey` with `timeRemapHash: 'abc'` produces a different
    `renderCacheKeyHash` than the same key with `timeRemapHash: 'def'`.
  - A `ClipDependencyKey` without `timeRemapHash` produces the same hash as
    before Phase 35 (stable across the change).

## T11 — Docs (R11)

- [ ] **T11.1** Create `docs/TIME-REMAPPING.md` with: speed curve model overview,
  supported easing types (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold`)
  with descriptions, speed range limits (0.25×–4×), explanation of how output
  duration changes with the ramp, WSOLA pitch-preserve behaviour, and why reverse
  playback is not supported in v1.
- [ ] **T11.2** Update `docs/USER-GUIDE.md` to add a "Speed Ramps" subsection
  under the clip editing section: how to open the Speed section in the Inspector,
  how to add a ramp ("Add Ramp" button), how to drag keyframes to shape the
  speed curve, the Pitch Preserve toggle, how to clear a ramp, and how to read
  the output duration badge. Link to `docs/TIME-REMAPPING.md` for technical
  detail.
- [ ] **T11.3** Confirm `npm run build` completes with no TypeScript errors
  (strict mode) and `npm test` passes with a net-positive test count increase
  (at least the new tests in T10.1–T10.4 counted). No existing test suite may
  lose coverage or reduce its assertion count.
