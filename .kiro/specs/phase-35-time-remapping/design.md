# Design: Phase 35 — Time Remapping

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Allow per-clip keyframed speed curves (0.25×–4×) with Hermite smoothstep easing, evaluated
through a shared LUT module that is identical between preview and export. Audio
follows the remap via WSOLA time-stretch in the worker. Phase 19 proxy and
render-cache keys are extended with a `timeRemapHash` field so cache
invalidation is surgical. No new third-party runtime libraries are required.

## Why a LUT (not on-the-fly integral evaluation)

The cumulative integral of an eased speed curve has no closed form in general.
Options considered:

1. **On-the-fly numerical integration per frame** — works for simple curves,
   but introduces floating-point drift over long clips when accumulated frame by
   frame; also complicates seeking (a seek to output time `t` requires integrating
   from 0 to `t`, an O(n) operation in the number of prior frames).

2. **Pre-sampled monotone LUT** — integrate once at `1/120 s` steps using
   Simpson's rule across each eased segment; store as two parallel
   `Float64Array`s (`outTimeS`, `srcTimeS`). Per-frame lookup is O(log n) via
   binary search (with a cached last-position hint making it O(1) in the common
   sequential case). Deterministic: same input → same output, bit-for-bit
   identical in preview and export. LUT is rebuilt synchronously on remap edit
   (≪ 1 ms for clips under 30 minutes at 120 Hz sampling).

**Decision: option 2 (LUT).** Correct for seeking, deterministic, O(1)
per-frame in the sequential case, and simple to unit-test (pure functions with
no browser dependencies).

## Why WSOLA (not phase vocoder)

Three algorithms were evaluated for pitch-preserving time-stretch:

1. **Phase vocoder** — high quality for tonal signals; produces phasiness
   ("choir effect") on speech and transients; requires an FFT library; complex
   state management across frames.

2. **WSOLA (Waveform Similarity Overlap-Add)** — no phasiness on speech
   (percept is closer to tape varispeed than a vocoder); CPU cost is a
   normalised cross-correlation on short windows (O(W·R) per frame where W is
   window size and R is search radius, ≈ 700 000 multiply-adds per frame at
   48 kHz — well within budget); stateful but trivially serialisable (one
   overlap buffer per channel); streaming-friendly over `pcmWindowAt` windows.

3. **PSOLA** — pitch-mark detection is unreliable on non-voiced audio; not
   suitable for general-purpose use.

**Decision: WSOLA.** No phasiness on speech, lower CPU than phase vocoder, no
FFT dependency, streaming-friendly. The implementation is a self-contained
`src/engine/wsola.ts` (< 200 lines) with no new npm dependencies.

## Non-goals

- **Reverse playback** — excluded from v1. The speed curve is clamped to
  `[0.25, 4.0]` (strictly positive), which means `t_src` is always
  monotone-increasing. Reverse playback would require a negative speed range,
  which breaks the forward-only decode invariant and requires the frame source
  to support backward seeks — a substantially more complex change deferred to a
  later phase.
- **Optical-flow frame interpolation** — smooth slow-motion below 0.25× (e.g.
  0.05× super slow-mo) requires interpolating frames that don't exist in the
  source. This is an ML/GPU-heavy feature deferred to a dedicated phase.
- **Pitch-shifting as a creative audio effect** — the pitch-preserve toggle
  only controls whether pitch follows speed (off) or stays constant (on). There
  is no independent pitch-shift control; that belongs in the audio effects chain.
- **Retime curves for image stills or title clips** — remap applies to source
  video clips only. Still images and title clips have no source timeline; the
  UI hides the Speed section for those clip kinds.
- **Variable-speed proxies** — proxies are always generated at source speed;
  remap is applied at display/export time against the original or proxy frames.
  This is the correct P19 design: proxies are source derivatives, not
  remap-baked derivatives.
- **Remap on audio-only clips** — the time-remap model is meaningful primarily
  for video (frame selection). Audio-only clips support pitch-preserve varispeed
  but not the speed curve UI, which assumes a video timeline. The Speed section
  is hidden for audio-only clips in the Inspector.

## Architecture: data flow

```
  Inspector (main thread)
  ┌────────────────────────────────────────────┐
  │ KeyframeEditor (P15 reuse) — speed Y axis  │
  │  drag → set-time-remap {trackId, clipId,   │
  │          remap: TimeRemapSnapshot}          │
  └───────────────────────┬────────────────────┘
                          │ postMessage
                          ▼
          Pipeline worker (src/engine/worker.ts)
  ┌────────────────────────────────────────────┐
  │ receive set-time-remap                     │
  │  → validate (speed range, duplicates)      │
  │  → buildRemapLUT(keyframes, srcDurationS)  │
  │     returns { lut, outputDurationS }        │
  │  → update clip.timeRemap + clip.duration   │
  │  → cap to neighbour (R3.2)                 │
  │  → snapshot → undo history                 │
  │  → post time-remap-updated {outputDurS}    │
  │  → post timeline-snapshot                  │
  │                                            │
  │  Render loop / export loop                 │
  │   for each output frame at t_out:          │
  │    t_src = remapOutputToSource(lut, t_out) │
  │    → resolveSourceTimestamp(clip, t_src)   │
  │    → frameAt(adapterTimestampS)  [video]   │
  │    → pcmWindowAt(t_src, …)       [audio]   │
  │       if pitchPreserve: WSOLA.stretch()    │
  │       else: WasmAudioResampler path        │
  └────────────────────────────────────────────┘
                          │
                          ▼
  Phase 19 cache layer (src/engine/cache-types.ts)
  ┌────────────────────────────────────────────┐
  │ ClipDependencyKey.timeRemapHash            │
  │  = SHA-256 hex of remap JSON               │
  │  → different hash ⟹ cache miss for clip   │
  └────────────────────────────────────────────┘
```

## Components

### `src/engine/time-remap.ts` (new)

Shared pure module — imported by `worker.ts`, `export.ts`,
`compatibility/compat-export.ts`. No browser globals; unit-testable in Node.

```typescript
/** One keyframe in the speed curve (output time → speed at that point). */
export interface RemapKeyframe {
  outTimeS: number;
  speed: number;
  easing: 'linear' | 'ease' | 'hold';
}

/** Pre-sampled monotone piecewise-linear LUT. */
export interface RemapLUT {
  /** Output times in seconds (monotone, length = N). */
  readonly outTimesS: Float64Array;
  /** Corresponding source times in seconds (monotone, length = N). */
  readonly srcTimesS: Float64Array;
  /** Computed output clip duration (seconds). */
  readonly outputDurationS: number;
}

/**
 * Build the remap LUT from a speed-curve keyframe array.
 *
 * @param keyframes Sorted by outTimeS, speed ∈ [0.25, 4.0], no duplicates.
 * @param sourceDurationS Available source duration (in-to-out), seconds.
 * @param stepS  LUT sample step in seconds (default 1/120).
 */
export function buildRemapLUT(
  keyframes: readonly RemapKeyframe[],
  sourceDurationS: number,
  stepS?: number
): RemapLUT;

/**
 * Map an output time to a source time using the pre-built LUT.
 * O(log N) binary search; O(1) with a sequential hint.
 *
 * Returns a source time in [0, sourceDurationS], clamped at boundaries.
 */
export function remapOutputToSource(lut: RemapLUT, outTimeS: number): number;

/**
 * Convenience: build an identity LUT (speed always 1×).
 * Returns null to signal "no remap" — callers skip the mapping entirely.
 */
export function identityRemap(): null;

/** Speed range constants. */
export const REMAP_SPEED_MIN = 0.25;
export const REMAP_SPEED_MAX = 4.0;
/** LUT sample step (seconds). */
export const REMAP_LUT_STEP_S = 1 / 120;
```

Implementation notes:

- `buildRemapLUT` integrates the speed curve using composite Simpson's rule
  across each step interval (uses the Hermite smoothstep easing to evaluate speed at the
  interval endpoints and midpoint). For `hold` easing the speed is constant
  from the current keyframe until the next, so the integral over `[t_a, t_b]`
  is `speed_a * (t_b - t_a)`.
- The LUT terminates when `srcTimeS` reaches `sourceDurationS`; the final
  `outputDurationS` is the `outTimeS` at that point (interpolated linearly
  between the last two LUT entries).
- Easing types are `'linear'`, `'ease'`, and `'hold'` — the same set supported by
  `sampleClipParamsAt` in `src/engine/keyframes.ts`. The `'ease'` easing applies
  the Hermite smoothstep `t² * (3 - 2t)` from `easeAmount` in `keyframes.ts`,
  reused directly to ensure identical easing between the two systems.

### `src/engine/wsola.ts` (new)

WSOLA time-stretcher. Runs in the pipeline worker; no browser globals.

```typescript
export const WSOLA_WINDOW_SAMPLES = 1440;   // ~30 ms @ 48 kHz
export const WSOLA_OVERLAP_SAMPLES = 720;   // 50% overlap
export const WSOLA_SEARCH_RADIUS_SAMPLES = 480; // ±10 ms @ 48 kHz

export class WsolaStretcher {
  constructor(channels: number);

  /**
   * Produce `outputFrames` samples stretched from `input` at the given speed.
   *
   * @param input  Interleaved PCM (Float32Array), at least
   *               WSOLA_WINDOW_SAMPLES * channels samples.
   * @param speedRatio  Current speed (> 0). Used to advance the analysis pointer.
   * @param outputFrames  Number of output sample frames to produce.
   * @returns Interleaved Float32Array of length outputFrames * channels.
   */
  stretch(input: Float32Array, speedRatio: number, outputFrames: number): Float32Array;

  /** Reset internal state (call on seek or clip change). */
  reset(): void;
}
```

Memory: the overlap buffer is `Float32Array` of length
`WSOLA_OVERLAP_SAMPLES * channels`, allocated once in the constructor and reused
across `stretch` calls. The cross-correlation search allocates a single
`Float32Array` of length `WSOLA_SEARCH_RADIUS_SAMPLES * 2 + 1` per call,
reused from a per-instance scratch buffer. Total heap per instance:
`(WSOLA_OVERLAP_SAMPLES + 2 * WSOLA_SEARCH_RADIUS_SAMPLES + 1) * channels * 4`
bytes ≤ 23 040 bytes for stereo.

### `src/protocol.ts` (extended)

New types and commands added following the existing kebab-case, discriminated-
union pattern:

```typescript
export interface TimeRemapKeyframeSnapshot {
  outTimeS: number;
  speed: number;
  easing: 'linear' | 'ease' | 'hold';
}

export interface TimeRemapSnapshot {
  keyframes: TimeRemapKeyframeSnapshot[];
  pitchPreserve: boolean;
}

// Added to WorkerCommand union:
| { type: 'set-time-remap'; trackId: string; clipId: string; remap: TimeRemapSnapshot }
| { type: 'clear-time-remap'; trackId: string; clipId: string }

// Added to WorkerStateMessage union:
| { type: 'time-remap-updated'; trackId: string; clipId: string; outputDurationS: number }
| { type: 'time-remap-error'; trackId: string; clipId: string;
    reason: 'speed-out-of-range' | 'duplicate-keyframe' | 'remap-capped' }
```

`TimelineClipSnapshot` gains `timeRemap?: TimeRemapSnapshot` (optional,
backward-compatible).

### `src/engine/project.ts` (extended)

- `TimelineClip` (internal type, defined in `src/engine/timeline.ts`) gains
  `timeRemap?: TimeRemapSnapshot`.
- `serializeClip` emits `timeRemap` when present.
- `parseClipTimeRemap(raw: unknown): TimeRemapSnapshot | null` validates using
  the existing `isRecord` / `finiteNumber` / `requiredString` pattern:
  - `keyframes` must be an array; each element must have finite `outTimeS`,
    `speed` in `[0.25, 4.0]`, and `easing` in the allowed set.
  - `pitchPreserve` must be a boolean.
  - Any failure returns `null` (treated as identity remap).
- `deserializeProject` calls `parseClipTimeRemap` for each clip; null result
  is logged to the diagnostics ring (`'time-remap-parse-failed'`) and the clip
  is loaded without remap.
- `PROJECT_SCHEMA_VERSION` (currently 15) is bumped to the next unused integer.
  Do **not** hardcode; write "bump to next unused" and let the implementer
  increment after confirming no in-flight PRs claim the same version.

### `src/engine/cache-types.ts` (extended)

```typescript
export interface ClipDependencyKey {
  // ... existing fields unchanged ...
  readonly timeRemapHash?: string;  // NEW: SHA-256 hex of remap JSON; absent = identity
}
```

The `CacheDependencyIndex` gains `byTimeRemapHash` for surgical invalidation,
following the existing `byKeyframeHash` pattern.

### `src/engine/cache-key.ts` (extended)

- `buildClipDependencyKey` accepts an optional `timeRemapHash` parameter and
  populates the new field when non-null.
- `canonicalRenderCacheKey` already sorts `clipDependencies` by `clipId`; no
  additional sorting is required for the new field.
- `hashTimeRemap(remap: TimeRemapSnapshot): string` computes
  `SHA-256(JSON.stringify(canonicalTimeRemap(remap)))` where
  `canonicalTimeRemap` sorts keyframes by `outTimeS` before stringifying to
  ensure determinism. Uses `crypto.subtle.digestSync` pattern consistent with
  `fingerprint.ts`, falling back to a pure-JS SHA-256 in the Node test
  environment.

### `src/engine/cache-invalidation.ts` (extended)

The existing `invalidateForClipEdit(clipId)` helper is extended to check
`byTimeRemapHash` and invalidate any entries referencing the old hash. This is
the same scope as `byKeyframeHash` invalidation — the full affected clip range.

### `src/engine/worker.ts` (extended)

- The `switch (cmd.type)` in the worker message listener gains cases for
  `set-time-remap` and `clear-time-remap`.
- `set-time-remap` handler:
  1. Validates speed range and duplicate keyframes; sends `time-remap-error` on
     failure and returns.
  2. Calls `buildRemapLUT(remap.keyframes, clip.inPointDurationS)`.
  3. Caps `outputDurationS` to the time to the next clip on the track; sends
     `time-remap-error { reason: 'remap-capped' }` if capped (informational).
  4. Updates `clip.timeRemap` and `clip.duration` in the authoritative timeline.
  5. Pushes an undo snapshot.
  6. Posts `time-remap-updated` and a timeline snapshot to the UI.
- The render loop's frame scheduling function gains a `remapSourceTime` step:
  before calling `resolveSourceTimestamp`, if `clip.timeRemap` is set, compute
  `t_src = remapOutputToSource(lut, clipLocalOutputTime)` and substitute it for
  the naive `clipLocalOutputTime + clip.inPoint`.
- WSOLA instance map: `Map<string, WsolaStretcher>` keyed by `clipId` in the
  render loop. Entries are deleted on clip exit, seek, remap edit, or
  `clear-time-remap`.

### `src/engine/export.ts` (extended)

- The video frame loop's `sourceTimestamp` computation is wrapped with the same
  `remapOutputToSource` call used in the preview render loop.
- The audio loop's `pcmWindowAt` call already takes `adapterTimestampS` derived
  from `resolveSourceTimestamp`; with remap, `adapterTimestampS` comes from
  `remapOutputToSource` instead of the clip's direct in-point offset.
- For `pitchPreserve: true`, a new `WsolaStretcher` instance is created at the
  start of each remapped clip's export segment and discarded at the end; no
  state crosses clip boundaries in export (sequential, non-real-time).
- For `pitchPreserve: false`, the existing `WasmAudioResampler` path in
  `pcmWindowAt` handles the speed-shifted sample rate; no new code is required.

### `src/engine/compatibility/compat-export.ts` (extended)

Applies the same `remapOutputToSource` call in the compatibility export video
frame loop, parallel to the changes in `export.ts`.

### `src/ui/TimeRemapEditor.tsx` (new)

Inspector Speed section component. Composed from the Phase 15 keyframe editor
with a speed-axis configuration. Exported for use in the clip Inspector panel.

```typescript
interface TimeRemapEditorProps {
  clip: TimelineClipSnapshot;
  projectFps: number;
  onSetRemap: (remap: TimeRemapSnapshot) => void;
  onClearRemap: () => void;
}

export function TimeRemapEditor(props: TimeRemapEditorProps): JSX.Element;
```

- Reads `clip.timeRemap` from the snapshot signal; re-renders reactively.
- Y-axis: 0.25×–4× with grid lines at 0.25×, 0.5×, 1×, 2×, 4×. Log-scale
  visual spacing (rendered as a linear grid with labelled snap lines).
- "Add Ramp" button: visible only when `clip.timeRemap` is absent.
- "Clear Ramp" button: visible only when `clip.timeRemap` is present.
- "Pitch Preserve" checkbox: always visible when Speed section is open.
- Output duration badge: formatted with `formatTimecode(outputDurationS, fps)`.
- `onCleanup` unsubscribes from any reactive effects.
- No WebGPU handles, `VideoFrame`, or worker objects referenced.

### `src/ui/Inspector.tsx` (extended)

The existing Inspector panel gains a "Speed" section rendered when the selected
clip is a video clip (not a title, not an audio-only clip). Renders
`<TimeRemapEditor>` with the current clip snapshot. Sends `set-time-remap` /
`clear-time-remap` commands via the existing `postCommand` helper.

## Protocol command handler flow (worker)

```
receive: set-time-remap { trackId, clipId, remap }
  |
  ├─ validate speed range [0.25, 4.0] for each keyframe
  |   └─ fail → post time-remap-error { reason: 'speed-out-of-range' }; return
  |
  ├─ validate no duplicate outTimeS (within 1e-4 s)
  |   └─ fail → post time-remap-error { reason: 'duplicate-keyframe' }; return
  |
  ├─ find clip in timeline; compute clip source in/out duration
  |
  ├─ buildRemapLUT(remap.keyframes, inOutDurationS)
  |   → { lut, outputDurationS }
  |
  ├─ compute maxAllowedDurationS (time to next clip on track)
  ├─ if outputDurationS > maxAllowedDurationS:
  |    cap outputDurationS = maxAllowedDurationS
  |    post time-remap-error { reason: 'remap-capped' }  [informational]
  |
  ├─ update clip.timeRemap = remap
  ├─ update clip.duration = outputDurationS
  ├─ delete wsola instance for clipId (stale on remap edit)
  ├─ push undo snapshot
  ├─ post time-remap-updated { trackId, clipId, outputDurationS }
  └─ post timeline-snapshot
```

## VFR correctness (PR #49 lessons applied)

The VFR bug (PR #49, B3 in the bugfix spec) was caused by computing frame
advancement from a nominal `1/fps` interval rather than the frame's actual
presentation timestamp. Phase 35 avoids the same class of error by:

1. **All mapping is on real timestamps.** `remapOutputToSource` returns a
   floating-point source time in seconds, not a frame index. This value is
   passed directly to `resolveSourceTimestamp` which computes `adapterTimestampS`
   — a real µs-precision timestamp fed to `frameAt`. No frame index arithmetic.

2. **Floor rounding at frame boundaries.** `frameAt` on a
   `SequentialFrameSource` returns the latest frame whose `pts ≤ adapterTimestampS`
   (the PR #49 fix). For VFR content, this naturally handles short frames:
   if the remapped source time falls inside a VFR frame's duration, that frame
   is returned, exactly as without remap.

3. **A/V sync at ramp boundaries.** Audio and video both derive their source
   time from `remapOutputToSource(lut, t_out)` for the same `t_out`. The
   `pcmWindowAt` call fetches audio starting at that same source time. The
   synchronisation error at a ramp boundary is at most the LUT step error
   (≤ `1/120 s ≈ 8.3 ms`) plus the VFR frame jitter — well within the
   one-frame (≤ 33 ms at 30 fps) acceptance criterion.

## Persistence and schema notes

`timeRemap` on a clip is persisted inside `project.json` (no sidecar file).
Because `TimelineClipSnapshot` already carries `keyframes` and `lut` as
optional fields, the pattern is established. The schema version bump follows the
hand-rolled validation approach in `src/engine/project.ts`: absent field = no
remap (backward compatible with projects written at the old version).

The current `PROJECT_SCHEMA_VERSION` in `src/engine/project.ts` is 15. The
implementer must bump to the next unused version after confirming no in-flight
PRs claim the same number.

## Third-party additions

No new runtime npm dependencies. `wsola.ts` and `time-remap.ts` are
self-contained TypeScript modules. The WSOLA algorithm requires only basic array
arithmetic; no FFT library is needed. All dependencies are from the existing
`src/engine/audio-resampler-wasm.ts` (used for the non-pitch-preserve path) and
`src/engine/keyframes.ts` (Hermite smoothstep easing reuse) which are already in the
dependency graph.

## Validation

**Unit (Vitest, Node environment, co-located, no media fixtures):**

- `src/engine/time-remap.test.ts` — `buildRemapLUT` and `remapOutputToSource`
  (identity curve correctness, monotone guarantee, boundary clamping, hold
  easing, output duration accuracy to ≤ 1 ms, multi-keyframe integral
  correctness).
- `src/engine/wsola.test.ts` — `WsolaStretcher` at 0.5×, 1×, 2× with
  synthetic sine; output frame count; no allocation growth across sequential
  calls; `reset()` clears state.
- `src/engine/time-remap-project.test.ts` — `parseClipTimeRemap` round-trip;
  malformed input returns `null`; `set-time-remap` command updates clip duration
  in the worker model; `clear-time-remap` restores original duration; undo
  snapshot captures remap.
- `src/engine/cache-key.test.ts` (extended) — `ClipDependencyKey` with
  `timeRemapHash` produces a different key hash; absent `timeRemapHash` matches
  pre-Phase 35 entries.

**Integration (manual, no large CI fixtures):**

- Import a VFR MOV; set a 0.5× ramp over the middle third; confirm A/V sync at
  both ramp entry and exit boundary (play through, inspect frame-level
  correspondence in the browser's frame timing).
- Export to MP4; confirm the export duration matches the predicted `outputDurationS`.
- Apply a 2× ramp; toggle Pitch Preserve off/on; confirm audio pitch differs
  between the two modes audibly.
- Undo a ramp edit; confirm the clip returns to original duration and the ramp
  editor shows the previous state.
- Set a ramp that would extend the clip past its neighbour; confirm the cap is
  applied and the `remap-capped` message appears in the diagnostics.

**Quality gate:** `vp run build` green (strict TypeScript), `vp test run` green,
test count grows.
