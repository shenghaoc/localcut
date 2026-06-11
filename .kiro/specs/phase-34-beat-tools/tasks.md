# Tasks: Phase 34 -- Beat Detection and Beat-Synced Editing

## T1 -- WAT + build script (R1, R6)

- [ ] **T1.1** Create `scripts/build-wasm-beat.mjs`: mirrors `scripts/build-wasm.mjs`
  exactly -- reads `src/engine/beat-analysis-simd.wat`, compiles with
  `wabt.parseWat(..., { simd: true })`, writes
  `src/engine/beat-analysis-simd.wasm` and
  `src/engine/beat-analysis-simd-wasm-b64.ts` exporting
  `BEAT_ANALYSIS_WASM_B64`. Add `"build:wasm:beat": "node
  scripts/build-wasm-beat.mjs"` to `package.json`.

- [ ] **T1.2** Create `src/engine/beat-analysis-simd.wat`: a single-page WASM
  module (64 KiB) with a pre-computed Hann table, twiddle-factor table, and
  a 1024-point radix-2 FFT using `f32x4.mul` + `f32x4.add` SIMD butterfly
  loops. Exports one function `hann_fft_flux (in_ptr, prev_mag_ptr,
  out_mag_ptr, flux_out_ptr)` that applies the Hann window, runs the FFT,
  computes the 513 bin magnitudes, and writes the log-compressed half-wave-
  rectified flux scalar to `flux_out_ptr`.

- [ ] **T1.3** Run `npm run build:wasm:beat` to produce
  `src/engine/beat-analysis-simd.wasm` and
  `src/engine/beat-analysis-simd-wasm-b64.ts`; commit both generated files
  (same pattern as `resampler-simd.wasm` and `resampler-simd-wasm-b64.ts`).

## T2 -- JS reference implementation and WASM wrapper (R1, R6)

- [ ] **T2.1** Create `src/engine/beat-analysis.ts`. Export:
  - `hannWindow(N: number): Float32Array` -- exact coefficients per design.
  - `spectralFlux(magnitudes: Float32Array, prevMagnitudes: Float32Array): number`
    -- half-wave-rectified log-compressed sum over 513 bins.
  - `pickOnsets(fluxValues: readonly number[], hopSeconds: number, W?: number, alpha?: number, minGapS?: number): number[]`
    -- returns onset times in seconds; defaults W=16, alpha=1.3, minGapS=0.25.
  - `estimateTempo(onsetStrength: readonly number[], hopSeconds: number): number`
    -- ACF over lags for 60-200 BPM range, parabolic interpolation, returns BPM.
  - `alignBeatGrid(tempoBpm: number, onsetStrength: readonly number[], hopSeconds: number, durationS: number): number[]`
    -- phase scan T/128 steps; returns beat times in seconds.
  - `encodeDeltaBeatTimes(beatTimesMs: readonly number[]): number[]`
  - `decodeDeltaBeatTimes(delta: readonly number[]): number[]`
  - `analyseBeatTimes(audioSource: SequentialAudioSource, durationSeconds: number, options?: BeatAnalysisOptions): Promise<BeatAnalysisResult>`
    -- streaming 10 s windows, 512-sample carry buffer, yields event loop after
    each window via `await new Promise<void>(r => setTimeout(r, 0))`.

- [ ] **T2.2** Create `src/engine/beat-analysis-wasm.ts`. Export
  `WasmBeatAnalyser` class with:
  - `static async init(): Promise<void>` -- layered detection (typeof
    WebAssembly -> validate simd probe -> compile `BEAT_ANALYSIS_WASM_B64`);
    silently falls back to JS on any failure; result cached in static field.
  - `readonly usedWasm: boolean`
  - `processFrame(samples: Float32Array, prevMagnitudes: Float32Array): { magnitudes: Float32Array; flux: number }`
    -- delegates to WASM instance or JS fallback; never hot-swaps mid-stream.

- [ ] **T2.3** In `src/engine/beat-analysis.ts`, have `analyseBeatTimes`
  instantiate `WasmBeatAnalyser` and call its `processFrame` inside the STFT
  loop, falling back automatically when `init()` returns the JS path. The PCM
  streaming loop requests `pcmWindowAt(windowStart, 480_000, 1, 48_000)` and
  carries the last 512 samples across window boundaries. Check
  `options?.signal?.aborted` after each window and return early if set.

## T3 -- OPFS cache (R2)

- [ ] **T3.1** Create `src/engine/beat-cache.ts`. Export:
  - `beatCachePath(sha256Digest: string): string` -- returns
    `"beats/${sha256Digest.slice(0, 16)}.beats.json"`.
  - `readBeatCache(sha256Digest: string): Promise<BeatAnalysisResult | null>`
    -- opens OPFS `beats/<prefix>.beats.json`, parses JSON, validates
    `beatAnalysisVersion === 1`, decodes delta `beatTimesMs`; returns `null`
    on any error (missing file, corrupt JSON, wrong version).
  - `writeBeatCache(sha256Digest: string, result: BeatAnalysisResult): Promise<void>`
    -- creates `beats/` directory if absent, writes `{ beatAnalysisVersion: 1,
    tempoBpm, beatTimesMs: encodeDeltaBeatTimes(result.beatTimesMs) }` as
    formatted JSON via `createWritable()`.

- [ ] **T3.2** Extend `src/engine/project-bundle/types.ts`:
  - Add `'beats'` to the `BundleAssetKind` union.
  - Add `beats?: { sourceId: string; assetId: string }[]` to
    `BundleCacheManifest`.

- [ ] **T3.3** Extend the bundle export logic (in
  `src/engine/project-bundle/` -- locate the file that writes `cacheManifest`
  by grepping for `BundleCacheManifest`) to include beat cache files: for each
  source in `beatSettings.enabledSourceIds` that has a cached file in OPFS,
  read the file and write it into the bundle under
  `cache/beats/<prefix>.beats.json` as a `BundleAsset` with `kind: 'beats'`,
  appending an entry to `cacheManifest.beats`.

- [ ] **T3.4** Extend the bundle import logic to restore beat cache files: for
  each entry in `manifest.cacheManifest.beats`, read the asset bytes from the
  bundle and write them to OPFS via `writeBeatCache` using the source's
  fingerprint digest (looked up from the bundle's `sources` list).

## T4 -- Protocol extensions (R1, R5)

- [ ] **T4.1** Extend `src/protocol.ts` `WorkerCommand` union with:
  ```typescript
  | { type: 'analyze-beats'; sourceId: string }
  | { type: 'cancel-beat-analysis'; sourceId: string }
  | { type: 'beat-auto-cut'; mode: 'split' | 'align'; clipRefs: { trackId: string; clipId: string }[] }
  ```

- [ ] **T4.2** Extend `src/protocol.ts` `WorkerStateMessage` union with:
  ```typescript
  | { type: 'beat-analysis-progress'; sourceId: string; fraction: number }
  | { type: 'beat-analysis-result'; sourceId: string; tempoBpm: number; beatTimesMs: number[]; analyserVersion: number }
  | { type: 'beat-analysis-error'; sourceId: string; message: string }
  ```

## T5 -- Worker routing (R1, R5, R6)

- [ ] **T5.1** In `src/engine/worker.ts`, declare a
  `Map<string, AbortController>` named `beatAnalysisCancels` at worker scope
  to track in-flight analyses.

- [ ] **T5.2** Add a `'analyze-beats'` handler: look up the `MediaInputHandle`
  for `sourceId` (reject with `beat-analysis-error` if not found or has no
  `audioSource`). Check the source's SHA-256 fingerprint from its
  `SourceDescriptor`; if present, call `readBeatCache` -- on cache hit post
  `beat-analysis-result` immediately and return. Otherwise create an
  `AbortController`, store it in `beatAnalysisCancels`, call `analyseBeatTimes`
  with `onProgress` forwarding (posts `beat-analysis-progress` messages), on
  success call `writeBeatCache` if fingerprint present, post
  `beat-analysis-result`, delete the controller from the map. On error or
  abort signal, post `beat-analysis-error` (unless aborted -- then post
  nothing). Always delete the controller from the map on exit.

- [ ] **T5.3** Add a `'cancel-beat-analysis'` handler: call `.abort()` on the
  `AbortController` for `sourceId` if present; no reply message is sent.

- [ ] **T5.4** Add a `'beat-auto-cut'` handler implementing R5.1-R5.3:
  retrieve the active beat grid (from the most recent `beat-analysis-result`
  stored in a worker-scope `Map<string, BeatAnalysisResult>` called
  `beatResultCache`; populated by successful analysis and cache reads), apply
  `globalOffsetMs` from the worker's current project state, then:
  - **split mode**: for each `clipRef`, collect beat times inside the clip
    span, enforce the 0.2 s minimum guard (skip offending beats), call
    `splitClip` for each retained beat time in order.
  - **align mode**: for each `clipRef`, find nearest beat (earlier on tie),
    clamp to 0, check for same-track overlap with adjacent clips; if overlap
    detected, push a diagnostics finding and skip that clip's move.
  Wrap all mutations in one `commitTimelineMutation` call with
  `coalesceKey: 'beat-auto-cut'`.

## T6 -- ProjectDoc extension (R3)

- [ ] **T6.1** In `src/engine/project.ts`, add to `ProjectDoc`:
  ```typescript
  beatSettings?: {
    enabledSourceIds: string[];
    globalOffsetMs: number;
  };
  ```

- [ ] **T6.2** In the `parseProjectDoc` (or equivalent deserialiser) function,
  default `beatSettings` to `{ enabledSourceIds: [], globalOffsetMs: 0 }` when
  the field is absent. Validate that `globalOffsetMs` is a finite number in
  [-500, 500] and clamp if out of range; validate that `enabledSourceIds` is
  an array of strings.

- [ ] **T6.3** In `src/engine/worker.ts`, store `beatSettings` in a
  worker-scope variable and update it whenever the project state changes (load,
  restore, schema migration). Expose it to the auto-cut handler (T5.4) for
  `globalOffsetMs`.

## T7 -- Snap-to-beat (R4)

- [ ] **T7.1** In `src/ui/timeline-interaction.ts`, add `'beat'` to the
  `SnapTargetKind` union.

- [ ] **T7.2** Extend `buildSnapTargets` to accept an optional third parameter
  `beatTimesSeconds?: readonly number[]`. When provided and non-empty, push
  targets `{ kind: 'beat', time: t, id: 'beat-${n}', label: 'Beat ${n + 1}' }`
  for each beat time `t` in seconds. The existing two-parameter call sites
  remain valid (optional parameter).

- [ ] **T7.3** In `src/ui/Timeline.tsx`, add a `createSignal<boolean>(false)`
  named `snapToBeats`. Add a toggle button labelled "Beat" to the snap toolbar
  (same toolbar row as the existing snap toggle); wire keyboard shortcut **B**
  (key down, not in an input element) via the existing `keyboard.ts` dispatch
  mechanism or an inline `keydown` listener on the timeline container.

- [ ] **T7.4** Thread `snapToBeats()` into the `buildSnapTargets` call in
  `Timeline.tsx`: when `true`, pass the current active beat times (in seconds,
  adjusted by `globalOffsetMs / 1000`) as the third argument; when `false`,
  pass `undefined` or `[]`.

## T8 -- Ruler beat-tick layer (R3)

- [ ] **T8.1** In `src/ui/Timeline.tsx` (ruler rendering path), derive a
  `beatTickTimes` memo: the union of adjusted beat times across all sources
  in `beatSettings.enabledSourceIds` that have results in the main-thread
  `beatResultCache` signal. Adjust each beat time by `globalOffsetMs / 1000`.

- [ ] **T8.2** Render beat ticks as SVG `<line>` elements (or equivalent
  within the existing ruler implementation). Beat index 0 within a bar: same
  height as a regular marker tick. Beats 1...N: half height. Colour `#b06cff`.
  Ticks outside the visible time window are filtered out before rendering to
  avoid DOM bloat (only ticks within `[scrollLeft / pxPerSecond - 1,
  (scrollLeft + viewportWidth) / pxPerSecond + 1]` are rendered).

- [ ] **T8.3** In `src/ui/App.tsx`, add a `createSignal<Map<string,
  BeatAnalysisResult>>(new Map())` named `beatResults`. Update it when
  `beat-analysis-result` messages arrive from the worker. Pass it (or a
  derived accessor) down to `Timeline` and `BeatPanel` as props.

## T9 -- BeatPanel UI (R3, R5)

- [ ] **T9.1** Create `src/ui/BeatPanel.tsx`. Props:
  ```typescript
  interface BeatPanelProps {
    sources: () => readonly SourceDescriptorSnapshot[];
    beatResults: () => ReadonlyMap<string, BeatAnalysisResultSnapshot>;
    beatSettings: () => BeatSettingsSnapshot;
    onAnalyse: (sourceId: string) => void;
    onCancel: (sourceId: string) => void;
    onToggleSource: (sourceId: string, enabled: boolean) => void;
    onOffsetChange: (offsetMs: number) => void;
    onAutoCut: (mode: 'split' | 'align') => void;
    selectedClipCount: () => number;
  }
  ```
  Renders per-source rows (analyse button with progress bar, enable toggle,
  BPM + beat count summary). Renders one global section: offset nudge slider
  (-500...+500 ms, step 1) and auto-cut Split/Align buttons (disabled per R5.4).

- [ ] **T9.2** Add `BeatAnalysisResultSnapshot` to `src/protocol.ts`:
  ```typescript
  export interface BeatAnalysisResultSnapshot {
    tempoBpm: number;
    beatCount: number;   // beatTimesMs.length -- do not transfer the full array to UI
    analyserVersion: number;
  }
  ```
  The main thread stores beat times in full in the `beatResults` signal (needed
  for snap and ruler); the snapshot is only for display. The full `beatTimesMs`
  array is stored from the `beat-analysis-result` message.

- [ ] **T9.3** Wire `BeatPanel` into `src/ui/App.tsx`: mount it in the Media
  Bin sidebar or as a collapsible panel adjacent to source details. Connect
  its `onAnalyse` / `onCancel` to `postMessage` calls to the worker;
  `onToggleSource` / `onOffsetChange` update `beatSettings` in the project via
  a new worker command
  `{ type: 'set-beat-settings'; enabledSourceIds: string[]; globalOffsetMs: number }`.
  `onAutoCut` posts `beat-auto-cut`.

- [ ] **T9.4** Add `'set-beat-settings'` to the `WorkerCommand` union in
  `src/protocol.ts` and handle it in `src/engine/worker.ts`: update the
  worker-scope `beatSettings` variable and commit a project mutation so the
  field is persisted in the next autosave. This command does not create a
  history entry (not undoable).

- [ ] **T9.5** Accessibility: all controls in `BeatPanel` reachable by
  keyboard; progress bar uses `role="progressbar"` with `aria-valuenow`
  and `aria-valuemax`; toggle buttons use `aria-pressed`; auto-cut buttons
  use `aria-disabled` with a `title` tooltip explaining the disabled reason.

## T10 -- Unit tests (R7)

- [ ] **T10.1** Create `src/engine/beat-analysis.test.ts`. Cases:
  - `hannWindow(1024)`: index 0 = 0, index 512 = 1.0, index 1023 ~ 0 (within
    1e-6); window is symmetric (`w[n] === w[1023 - n]` for all n).
  - `spectralFlux`: returns 0 on identical prev/current magnitudes; returns
    positive value when current magnitudes increase; ignores negative
    differences (half-wave rectification).
  - `pickOnsets` on a hand-crafted 100-element flux array with two clear peaks
    at frames 10 and 40 (well above threshold, separated by 30 frames x
    512/48000 s > 0.25 s): returns exactly those two onset times; a third
    candidate at frame 42 (too close to frame 40) is rejected.
  - `estimateTempo` on a synthetic onset-strength array of 200 frames with
    impulses every 10 frames (10 x 512/48000 ~ 0.1067 s period ->
    ~ 562 ms period -> ... wait: at hopSeconds = 512/48000 ~ 0.01067 s/frame,
    120 BPM = 0.5 s per beat = 46.9 frames per beat; use impulses every 47
    frames instead): result within +/-0.5 BPM of 120.
  - `alignBeatGrid` on a 120 BPM grid over a 10 s signal: first beat time
    within one hop (0.01067 s) of the earliest onset; last beat time <= 10 s.
  - `encodeDeltaBeatTimes` / `decodeDeltaBeatTimes` round-trip on `[500, 1000,
    1500]` -> encoded `[500, 500, 500]` -> decoded `[500, 1000, 1500]`.
  - Determinism: call `analyseBeatTimes` twice on the same synthetic 2 s
    440 Hz sine PCM (via a mock `SequentialAudioSource` that returns the same
    buffer); both calls return bit-identical `beatTimesMs` arrays.
  - OPFS cache round-trip: mock `navigator.storage.getDirectory()` with an
    in-memory map; write a result, read it back; assert decoded values match.

- [ ] **T10.2** Create `src/engine/beat-analysis-wasm.test.ts`. Cases:
  - WASM path produces finite non-NaN `flux` on a 1024-sample 440 Hz sine
    frame (both magnitudes arrays pre-zeroed for prev).
  - JS fallback activates when `BEAT_ANALYSIS_WASM_B64` is replaced with a
    5-byte invalid base64 string; `usedWasm === false`.
  - JS and WASM paths agree on BPM within +/-2 BPM when run on the same
    synthetic 120 BPM onset fixture (generate a 3 s onset-strength array with
    impulses every 47 frames, feed to both paths independently).

- [ ] **T10.3** Create `src/engine/beat-auto-cut.test.ts`. Cases:
  - Split mode: a clip `[start=1s, duration=3s]` with beats at [1.3, 2.0, 2.7,
    3.5] s (all inside span) produces segments [1.0-1.3, 1.3-2.0, 2.0-2.7,
    2.7-3.5, 3.5-4.0] s. Min-guard: add a beat at 3.6 s (0.1 s gap from 3.5)
    -- it is skipped. No-beats case: clip unchanged.
  - Align mode: clip start at 1.05 s with nearest beat at 1.0 s -> moved to
    1.0 s; equidistant between 1.0 s and 2.0 s -> moved to 1.0 s (earlier
    wins). Clamped to 0 when nearest beat is negative (shouldn't happen with
    valid grids, but guard is tested). Overlap skip: two clips on the same
    track, both wanting to align to the same beat -> later clip is skipped, a
    diagnostics finding is recorded.
  - Undo: the mutation is committed as one history entry; `undo` restores the
    original clip positions.

- [ ] **T10.4** Extend `src/ui/timeline-interaction.test.ts` (existing file;
  do not create a new file). Add cases:
  - `buildSnapTargets` with `beatTimesSeconds = [1.0, 2.0]` includes two
    targets with `kind: 'beat'`.
  - `resolveSnap` at time 0.99 s with beat targets at 1.0 s and a clip-end at
    1.1 s: resolves to beat at 1.0 s (closer).
  - `buildSnapTargets` with `beatTimesSeconds = undefined` produces no beat
    targets (backward compatibility).

## T11 -- Docs + quality gate (R7)

- [ ] **T11.1** Add a **Beat Detection** section to `docs/USER-GUIDE.md`
  covering: triggering analysis from the Media Bin / Beat panel; what the
  progress bar represents; the WASM vs JS fallback note ("WASM is used when
  available for faster analysis; pure JavaScript is always the safety net,
  giving the same results on the same platform"); enabling the beat grid per
  source; the global offset nudge (positive shifts beats forward in time,
  negative shifts backward); the snap-to-beat toggle (keyboard shortcut B);
  auto-cut split vs align modes and the 0.2 s minimum segment guard; expected
  tempo range (60-200 BPM); note that beat times are not stored as editable
  markers and do not appear in the export markers range selector.

- [ ] **T11.2** Manual smoke test (record results in the PR description, not
  in a file): import a music track, trigger analysis, confirm beat ticks appear
  on the ruler at visually plausible positions, enable snap-to-beat and confirm
  clip-edge drag snaps to beats, run auto-cut split mode on a clip and inspect
  the resulting cuts, export and re-import as a bundle and confirm analysis is
  not re-run (cache loaded from bundle), test in Chrome and Firefox (Firefox
  will use JS fallback; confirm it still completes).

- [ ] **T11.3** `npm run build` green (strict TypeScript); `npm test` green;
  test count grows by at least the cases enumerated in T10.
