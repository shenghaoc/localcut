# Requirements: Phase 34 -- Beat Detection and Beat-Synced Editing

LocalCut gains offline beat analysis for any user-supplied audio source: a
WASM-accelerated spectral-flux onset detector and tempo estimator runs in the
pipeline worker, caches its results keyed by the P23 SHA-256 fingerprint, and
exposes beat times as a derived ruler overlay. Timeline UX adds beat markers
on the ruler, a snap-to-beat toggle in the existing snapping system, an
"auto-cut selected clips to beats" command, and a global beat-offset nudge.
The feature targets the mid-tier creator who wants to cut video to a music
track without leaving the browser.

Non-goals are stated explicitly in `design.md`. Every acceptance criterion
below is testable in isolation; where numbers appear they are not suggestions.

---

## R1 -- Offline beat analysis

- **R1.1** Analysis is triggered by the worker command
  `{ type: 'analyze-beats'; sourceId: string }`. The worker replies with zero
  or more `{ type: 'beat-analysis-progress'; sourceId; fraction: number }`
  messages (0 <= fraction <= 1, emitted at most once per 0.5 s of audio
  processed) and exactly one terminal message: either
  `{ type: 'beat-analysis-result'; sourceId; tempoBpm: number; beatTimesMs: number[]; analyserVersion: number }`
  or `{ type: 'beat-analysis-error'; sourceId; message: string }`. Sending
  `{ type: 'cancel-beat-analysis'; sourceId }` while analysis is in progress
  causes the worker to stop processing and emit no further messages for that
  `sourceId` (no terminal message is sent on explicit cancel).

- **R1.2** Analysis reads audio through `SequentialAudioSource.pcmWindowAt`
  in streaming windows so that no more than **30 seconds of PCM** is resident
  in the worker at any moment. At 48 kHz mono the per-window maximum is
  `frameCount = 48_000 x 10` (10 s); at most 3 windows overlap in flight
  during pipeline overlap.

- **R1.3** The DSP pipeline is fully deterministic: for the same input bytes
  the WASM path always produces the same `beatTimesMs` array on the same
  platform, and the JS fallback path always produces the same array on its
  own; the two paths may produce different beat times from each other (WASM
  and JS reference implementations use the same algorithm but differ in
  floating-point ordering). Determinism is tested with golden-fixture vectors
  separately for each path -- the spec does not claim cross-path bit-exactness.
  No `Math.random`, no `Date.now`, no `performance.now` is used inside the
  analyser.

- **R1.4** The concrete DSP pipeline (all parameters are fixed, not
  configurable at runtime):
  - Mono mixdown at 48 kHz via `pcmWindowAt` (1 channel, `targetSampleRate = 48_000`).
  - STFT: Hann window of **1024 samples**, hop of **512 samples**.
  - Spectral flux: half-wave-rectified, log-compressed per-bin magnitude
    difference `max(0, log(1 + |X[k]|) - log(1 + |X_prev[k]|))`, summed
    over all bins.
  - Onset peak-picking: moving-mean threshold with a **state window of 16
    frames**, a **multiplier of 1.3**, and a **minimum inter-onset gap of
    0.25 s**; a candidate frame is accepted as an onset if its flux exceeds
    `max(alpha x moving_mean, 0.01)` (where `alpha` = 1.3 is the multiplier).
  - Tempo: autocorrelation of the onset-strength envelope over **60-200 BPM**
    (lag range 0.3-1.0 s), with parabolic interpolation around the peak lag
    to obtain sub-frame tempo; the winning BPM is the one with highest
    autocorrelation magnitude after normalizing by lag length.
  - Beat grid: the best-tempo period `T` is phase-aligned to the onset
    envelope by sliding a phase `phi in [0, T)` in steps of `T / 128` and
    choosing the `phi` that maximises `Sigma onset_strength(phi + n x T)` over all
    onset frames; the beat grid is `{ phi + n x T | n >= 0, phi + n x T <= duration }`.

- **R1.5** Analysis of a **5-minute 48 kHz stereo track** (mono-mixed for
  analysis) completes in **less than the audio duration** on the baseline
  capability tier (no hardware decode acceleration). This is the
  faster-than-realtime acceptance gate.

- **R1.6** `tempoBpm` in the result is a finite positive number in the range
  [1, 400]. `beatTimesMs` is sorted ascending; each value is a non-negative
  finite integer (milliseconds, rounded). `analyserVersion` is the integer
  constant `1`.

---

## R2 -- Result caching and bundle integration

- **R2.1** After a successful analysis the worker serialises the result as
  versioned compact JSON (`{ beatAnalysisVersion: 1; tempoBpm; beatTimesMs }`,
  `beatTimesMs` delta-encoded as an integer array where element 0 is an
  absolute ms value and each subsequent element is the delta from the previous
  value in ms, stored as `number[]`) and writes it to OPFS at the path
  `beats/<sha256-16-prefix>.beats.json` where `sha256-16-prefix` is the first
  16 hex characters of the source's SHA-256 fingerprint digest.

- **R2.2** When `analyze-beats` arrives and a valid cached file exists at the
  OPFS path for that source's fingerprint, the worker reads and returns the
  cached result immediately (no DSP, no progress messages; one
  `beat-analysis-result` reply).

- **R2.3** The `BundleAssetKind` union in
  `src/engine/project-bundle/types.ts` is extended with the literal `'beats'`.
  The `BundleCacheManifest` interface gains the optional field
  `beats?: { sourceId: string; assetId: string }[]`. Beat cache files are
  included in the bundle `cache/` directory under the existing `cacheManifest`
  mechanism, one asset per source that has been analysed. On bundle import the
  beat cache files are restored to OPFS so a round-tripped project does not
  need to re-analyse.

- **R2.4** If the source has no SHA-256 fingerprint (fingerprint is absent
  from its `SourceDescriptor`) analysis proceeds but the result is not cached
  to OPFS and is not included in a bundle.

---

## R3 -- Marker integration (derived view)

- **R3.1** Beat times are **not** written into `ProjectDoc.markers`. They are
  a derived view computed from the analysis artifact. A new optional field
  on `ProjectDoc` stores beat-display state:

  ```
  beatSettings?: {
    enabledSourceIds: string[];   // sources whose beat grids are shown
    globalOffsetMs: number;       // signed offset applied to all beat times, default 0
  }
  ```

  This field is serialised into `ProjectDoc` and therefore rides `project.json`
  in bundles automatically (no schema bump is needed for this addition -- the
  field is optional and absent from older documents; the deserialiser defaults
  it to `{ enabledSourceIds: [], globalOffsetMs: 0 }`).

- **R3.2** The ruler renders beat times for each enabled source as a distinct
  visual layer below the regular marker lane. Beat tick marks use a fixed
  accent colour (`#b06cff`) distinct from regular markers (`#ff9500`) and from
  the playhead. The downbeat (beat index 0 of the grid) may use the same tick
  height as regular markers; all other beats use half the marker tick height.

- **R3.3** Beat markers carry a `kind: 'beat'` discriminant in the UI data
  model for the ruler and snap system. They are never passed to the worker as
  `add-marker` commands and never appear in `ProjectDoc.markers`.

- **R3.4** A global beat-offset nudge control (range -500 ms to +500 ms, step
  1 ms, default 0) shifts all displayed beat times by `globalOffsetMs`. The
  control is located in the Media Bin's per-source details popover alongside
  the existing source health information, or as a panel below the ruler -- the
  design section specifies exact placement. The value is persisted in
  `ProjectDoc.beatSettings.globalOffsetMs`.

---

## R4 -- Snap-to-beat

- **R4.1** `SnapTargetKind` in `src/ui/timeline-interaction.ts` gains the
  literal `'beat'`. The function `buildSnapTargets` gains an optional third
  parameter `beatTimes: readonly number[]` (seconds); when provided, each beat
  time is pushed as a `{ kind: 'beat'; time; id: 'beat-N'; label: 'Beat N' }`
  target.

- **R4.2** A snap-to-beat toggle (keyboard shortcut **B**, also available in
  the snapping toolbar alongside the existing snap-to-markers control)
  enables or disables beat times in the snap target set. When disabled, no
  `'beat'` targets are produced regardless of whether beat data is available.
  The toggle state is UI-local (not persisted across sessions).

- **R4.3** The existing `resolveSnap` function in `timeline-interaction.ts` is
  unchanged; beat targets participate in the same distance-threshold
  competition as all other snap candidates.

---

## R5 -- Auto-cut command

- **R5.1** The worker command
  `{ type: 'beat-auto-cut'; mode: 'split' | 'align'; clipRefs: { trackId: string; clipId: string }[] }`
  applies beat-synced edits to the selected clips. It is undoable (one history
  entry, coalesced as `'beat-auto-cut'`).

- **R5.2** **Split mode:** for each clip, all beat times (after global offset)
  that fall strictly inside the clip's `[start, start + duration)` span are
  collected and sorted. The clip is split at each such beat time in order.
  Segments shorter than **0.2 s** are not created: if a beat time would produce
  a segment (from the previous beat or clip start) shorter than 0.2 s, that
  beat time is skipped. If no beat falls inside a clip's span, that clip is
  unchanged.

- **R5.3** **Align mode:** each selected clip's `start` is moved to the
  nearest beat time. Clips are processed in chronological order (sorted
  ascending by their current `start` time) so that overlap-skip decisions
  are deterministic -- the earlier clip always takes priority. Tie-breaking:
  when a clip start is equidistant from two beats, snap to the earlier beat.
  The move is clamped to `[0, inf)`. No clip is moved if no beat time is
  available for any enabled source. If two selected clips on the same track
  would overlap after alignment, the later clip's alignment is skipped (the
  clip stays at its original position) and a diagnostic warning is emitted.

- **R5.4** The command is only available (enabled in the UI) when at least one
  clip is selected and at least one source has an analysis result available.
  The UI shows a disabled state with a tooltip explaining the reason when
  neither condition is met.

---

## R6 -- Capability gating

- **R6.1** Beat analysis requires only `SequentialAudioSource` (available at
  the baseline tier -- no WebGPU, no WebCodecs, no SAB required). It is
  available on all tiers that can import audio. The UI surfaces beat controls
  without capability gating beyond audio-import availability.

- **R6.2** WASM SIMD detection follows the same layered approach as
  `WasmAudioResampler`: `typeof WebAssembly` -> `WebAssembly.validate(simdProbe)`
  -> `WebAssembly.compile(beatWasmBinary)`. Any failure at any step falls back
  transparently to the JS reference implementation. The analyser reports
  `usedWasm: boolean` in its result (internal field, not included in the
  cached JSON or the protocol message).

- **R6.3** A running beat analysis does not block playback, export, or any
  other worker operation. The analyser yields the worker event loop between
  each STFT window (via a minimal async boundary, e.g. a `setImmediate`-style
  `await new Promise(r => setTimeout(r, 0))`).

---

## R7 -- Tests and documentation

- **R7.1** Unit tests (Vitest, Node environment, co-located under
  `src/engine/`) cover:
  - `beat-analysis.test.ts`: Hann window coefficients at indices 0, 256, 512;
    spectral flux half-wave rectification on synthetic bins; onset peak-picking
    with known flux envelope (accepts peaks above threshold, rejects below, and
    enforces min gap); autocorrelation tempo estimate on a synthetic 120 BPM
    onset envelope (result within +/-0.5 BPM); beat-grid phase alignment on a
    synthetic lattice; delta-encoding round-trip; determinism across two
    calls on the same synthetic PCM (bit-exact, same path); OPFS cache
    read/write round-trip with mocked OPFS handle.
  - `beat-analysis-wasm.test.ts`: WASM path produces non-NaN results on a
    2-second synthetic sine-wave PCM; fallback activates when WASM binary is
    replaced with invalid bytes; JS and WASM paths agree on BPM within +/-2 BPM
    on a 120 BPM synthetic onset fixture.
  - `beat-auto-cut.test.ts`: split mode produces correct segments on a
    synthetic clip with known beat times, enforces the 0.2 s minimum guard,
    skips clips with no beats inside; align mode snaps to nearest beat with
    correct tie-breaking, clamps to 0, skips overlapping clips; command is a
    single undo entry.
  - `timeline-interaction.test.ts` (extended, not a new file): `buildSnapTargets`
    with beat times produces `'beat'` targets; they compete correctly in
    `resolveSnap` against other candidate kinds.

- **R7.2** No large audio fixtures are checked in. All DSP tests use synthetic
  PCM generated inline (e.g. a 1024-sample Hann window, a 2 s 440 Hz sine at
  48 kHz, or a hand-crafted onset-strength array).

- **R7.3** `docs/USER-GUIDE.md` gains a **Beat Detection** section covering:
  how to trigger analysis, what the progress indicator means, the WASM vs JS
  fallback note (WASM is faster; JS is always the safety net), how to enable
  beat-grid display per source, the global offset nudge, snap-to-beat toggle,
  and the auto-cut command modes. `npm run build` and `npm test` stay green
  and the test count grows.
