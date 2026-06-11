# Design: Phase 34 -- Beat Detection and Beat-Synced Editing

> Status: **Proposed** -- spec only, not yet implemented.

## Goal

Give LocalCut users a one-click path from "import music track" to "clips
snapped to every beat" without leaving the browser. The analyser runs entirely
in the pipeline worker, streams audio through the existing
`SequentialAudioSource.pcmWindowAt` API, caches its results in OPFS keyed by
the P23 SHA-256 fingerprint, and surfaces beat times as a ruler overlay and
snap-candidate source. No server, no model download, no third-party ML library.

## Why spectral flux + autocorrelation (and not an ML onset detector)

LibROSA's beat tracker, Essentia, or a WebNN GRU model would give better
accuracy on complex musical textures, but they each require either a large
binary (Essentia WASM is ~10 MB) or a separate model download with a
user-permission prompt (WebNN weights, Phase 27 pattern). For the mid-tier
creator cutting a music video, the accuracy of a classical spectral-flux onset
detector is sufficient, the binary is small enough to inline as base64, and
the algorithm is fully deterministic -- two runs on the same file produce the
same edit. The DSP is also explainable: if a user asks "why did it miss that
beat?" the answer is "the spectral flux didn't peak there" rather than "the
model was uncertain".

Autocorrelation over the onset envelope is the standard classical tempo
estimator (used in Librosa's legacy `beat_track`). Parabolic interpolation
gives sub-frame resolution without a second-pass grid search. Phase alignment
by exhaustive scan over `T / 128` steps costs O(128 x N_onsets) per tempo
candidate and is negligible compared to the FFT inner loop.

## Non-goals

- **Bundled music or sound library** -- licensing and storage are out of scope;
  analysis applies only to user-supplied audio.
- **Genre / downbeat / time-signature ML classification** -- the grid is a
  uniform-tempo lattice; users nudge via the global offset control.
- **Live-input beat tracking** -- real-time analysis on microphone or screen
  capture is a separate phase.
- **Multiple tempo segments** -- a single tempo is estimated for the whole
  track; tempo-change detection is not implemented.
- **Manual beat-marker editing** -- beat times are derived; users cannot drag
  individual beat markers. Regular `ProjectDoc.markers` remain the editable
  layer.

## Architecture

```
main thread                          pipeline worker
+----------------------+             +-------------------------------------+
| BeatPanel.tsx        |             | BeatAnalyser (beat-analysis.ts)     |
|  + trigger analysis  |-analyze-->   |  + streams PCM via                  |
|  + progress bar      |  beats      |  |   SequentialAudioSource           |
|  + enable/disable    |<--result-    |  |   .pcmWindowAt(10 s windows)      |
|  + offset nudge      |  /error     |  + STFT (Hann 1024 / hop 512)       |
|                      |             |  + spectral-flux onset detection     |
| Timeline ruler       |             |  + autocorrelation tempo             |
|  + beat tick overlay |<-----------  |  + phase-aligned beat grid          |
|                      |  derived    |  + WasmBeatAnalyser (SIMD inner loop)|
| SnapTargets          |  from       |                                      |
|  + beat kind         |  cached     | BeatCache (beat-cache.ts)            |
|                      |  analysis   |  + OPFS: beats/<prefix>.beats.json   |
| Auto-cut command     |             |  + BundleCacheManifest.beats[]       |
|  + beat-auto-cut-->   |-command-->   |                                      |
|                      |             | worker.ts (beat command routing)     |
+----------------------+             +-------------------------------------+
```

The analyser never touches the GPU path and never runs on the main thread --
hard gates 1 and 2 are satisfied by construction.

## DSP pipeline (all parameters fixed)

### Stage 1 -- Mono mixdown

`pcmWindowAt(time, frameCount = 480_000, channels = 1, targetSampleRate = 48_000)`
is called repeatedly with hop `stepFrames = 480_000 - 512` so that STFT frames
at the window boundary are computed correctly. At most 3 such windows overlap
in flight (prior, current, next). After each window the analyser does one
`await new Promise<void>(r => setTimeout(r, 0))` to yield the worker event
loop (R6.3).

Actually, the streaming loop is simpler: the analyser requests windows of
exactly `frameCount = 480_000` (10 s) with a stride of `480_000` samples
(non-overlapping in terms of PCM fetching). Within each 10 s PCM block, it
runs the full STFT / flux loop hopping 512 samples at a time, carrying the
last 1024 - 512 = 512 samples (one hop's worth of overlap) from the previous
block into the next via a 512-sample carry buffer. This keeps PCM residency
<= 10 s at any moment.

### Stage 2 -- STFT

- Hann window: `w[n] = 0.5 x (1 - cos(2pi n / (N - 1)))`, N = 1024.
- DFT of each windowed frame: 513 real-valued magnitude bins (0 ... N/2).
- FFT implementation: a pure-JS radix-2 Cooley-Tukey FFT is the JS reference;
  the WASM module vectorises the inner butterfly loop with `f32x4` SIMD.

### Stage 3 -- Spectral flux

```
flux[t] = Sigma_k  max(0,  log(1 + |X_t[k]|) - log(1 + |X_{t-1}[k]|))
```

Per-bin half-wave rectification followed by log compression. The magnitude
difference is computed in the log domain: `log(1+|X_t|) - log(1+|X_{t-1}|)`.
Negative values are clamped to 0 (half-wave rectification). Sum over all 513
bins to get one scalar per hop.

### Stage 4 -- Onset peak-picking

Parameters: state window W = 16 frames, multiplier alpha = 1.3, min gap G = 0.25 s
(= ceil(0.25 x 48000 / 512) = 24 frames).

```
moving_mean[t] = mean(flux[t-W ... t])
threshold[t]   = max(alpha x moving_mean[t], 0.01)
onset[t]       = flux[t] > threshold[t]
                 AND flux[t] is local maximum in [t-2, t+2]
                 AND t - last_onset_frame >= G_frames
```

Local-maximum check prevents multiple triggers on the same onset peak.

### Stage 5 -- Tempo via autocorrelation

The onset-strength signal `flux[t]` is autocorrelated at lags corresponding
to BPM in [60, 200]:

```
lag_samples(bpm) = round(60 x 48000 / (512 x bpm))
```

Lags span approximately [14, 47] frames. For each candidate lag `l`:

```
acf[l] = Sigma_{t=0}^{T-l-1} flux[t] x flux[t+l]
```

Normalized by `(T - l)` to avoid favouring short lags. The lag with maximum
normalized ACF gives the coarse BPM. Parabolic interpolation on the
neighbouring lags refines the BPM estimate:

```
peak_l = argmax(acf)
delta   = 0.5 x (acf[peak_l-1] - acf[peak_l+1])
              / (acf[peak_l-1] - 2xacf[peak_l] + acf[peak_l+1])
refined_lag = peak_l + delta
tempoBpm    = 60 x 48000 / (512 x refined_lag)
```

### Stage 6 -- Beat-grid phase alignment

Period `T_frames = 60 x 48000 / (512 x tempoBpm)` frames.
Scan `phi in [0, T_frames)` in steps of `T_frames / 128`:

```
score(phi) = Sigma_n  flux[round(phi + n x T_frames)]  for all valid n
```

Choose `phi*` = argmax score. Beat times in seconds:

```
beat_time_s[n] = (phi* + n x T_frames) x 512 / 48000
```

for all n where beat_time_s[n] <= audio duration.

## WASM module

### Files

| File | Role |
|---|---|
| `src/engine/beat-analysis-simd.wat` | WAT source -- FFT + flux inner loops, f32x4 SIMD |
| `src/engine/beat-analysis-simd.wasm` | Compiled binary (output of `build:wasm:beat`) |
| `src/engine/beat-analysis-simd-wasm-b64.ts` | Base64-inlined binary for bundling |
| `scripts/build-wasm-beat.mjs` | WAT->WASM build script (same pattern as `scripts/build-wasm.mjs`) |

### build:wasm:beat script

`scripts/build-wasm-beat.mjs` mirrors `scripts/build-wasm.mjs` exactly:
reads `src/engine/beat-analysis-simd.wat`, compiles via `wabt.parseWat(...,
{ simd: true })`, writes the `.wasm` binary and the base64 TypeScript
constant `BEAT_ANALYSIS_WASM_B64` to the `-wasm-b64.ts` file. The
`package.json` gains the script `"build:wasm:beat": "node scripts/build-wasm-beat.mjs"`.

### WASM scope

The WASM module exposes two functions:

```wat
(func $hann_fft_flux (param $in_ptr i32) (param $prev_mag_ptr i32)
                     (param $out_mag_ptr i32) (param $flux_out_ptr i32))
```

`$in_ptr`: 1024 f32 samples (windowed input -- the JS side applies the Hann
window before calling WASM or the WASM applies it internally from a
pre-computed table in linear memory). `$prev_mag_ptr`: 513 f32 magnitudes
from the prior frame (read-only). `$out_mag_ptr`: 513 f32 magnitudes for this
frame (write). `$flux_out_ptr`: one f32 scalar (the flux value). The DFT is
a radix-2 FFT on 1024 complex samples (imaginary part = 0 for real input);
the SIMD butterfly loop uses `f32x4.mul` + `f32x4.add`. Memory is allocated
as a single WASM page (64 KiB) that holds the Hann table, twiddle-factor
table, working area, and I/O pointers.

### Transparent fallback

`WasmBeatAnalyser` (in `src/engine/beat-analysis-wasm.ts`) mirrors the
`WasmAudioResampler` pattern:

```typescript
export class WasmBeatAnalyser {
  private static module: WebAssembly.Module | null = null;
  readonly usedWasm: boolean;

  static async init(): Promise<void> { /* compile once, cache in static field */ }

  /** Process one 1024-sample windowed frame; returns [magnitudes, flux] */
  processFrame(samples: Float32Array, prevMagnitudes: Float32Array): { magnitudes: Float32Array; flux: number };
}
```

Detection: `typeof WebAssembly` -> `WebAssembly.validate(simdProbeBytes)` ->
`WebAssembly.compile(beatWasmBinary)`. Any failure -> JS fallback (`JsBeatAnalyser`
in `src/engine/beat-analysis.ts`). A `usedFallback` boolean prevents mid-stream
hot-swap.

## Components

### `src/engine/beat-analysis.ts`

JS reference implementation and orchestrator. Public surface:

```typescript
export interface BeatAnalysisResult {
  tempoBpm: number;
  beatTimesMs: number[];     // sorted, non-negative integers
  analyserVersion: 1;
}

export interface BeatAnalysisOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Streams PCM from audioSource, returns the full analysis result. */
export async function analyseBeatTimes(
  audioSource: SequentialAudioSource,
  durationSeconds: number,
  options?: BeatAnalysisOptions
): Promise<BeatAnalysisResult>

/** Encode beatTimesMs to delta array for compact JSON storage. */
export function encodeDeltaBeatTimes(beatTimesMs: readonly number[]): number[];

/** Decode delta array back to sorted absolute ms array. */
export function decodeDeltaBeatTimes(delta: readonly number[]): number[];

// Internal DSP helpers, exported for unit tests:
export function hannWindow(N: number): Float32Array;
export function spectralFlux(magnitudes: Float32Array, prevMagnitudes: Float32Array): number;
export function pickOnsets(flux: readonly number[], hopSeconds: number, W?: number, alpha?: number, minGapS?: number): number[];
export function estimateTempo(onsetsStrength: readonly number[], hopSeconds: number): number;
export function alignBeatGrid(tempoBpm: number, onsetsStrength: readonly number[], hopSeconds: number, durationS: number): number[];
```

`analyseBeatTimes` keeps <= 30 s of PCM resident (R1.2): it requests
`pcmWindowAt(time, 480_000, 1, 48_000)` (10 s windows) sequentially, retaining
only a 512-sample carry buffer across window boundaries. Progress callbacks are
emitted after each 10 s window.

### `src/engine/beat-analysis-wasm.ts`

`WasmBeatAnalyser` class (described above). Loaded lazily; the JS
`analyseBeatTimes` instantiates `WasmBeatAnalyser`, calls `init()`, then
uses `processFrame` in its STFT loop.

### `src/engine/beat-analysis-simd.wat`

Hand-written WAT; exposes `hann_fft_flux` as described. SIMD strategy:
butterfly operations on four complex-number pairs per `v128` lane (real and
imaginary f32 interleaved). Hann window is applied by reading from a
pre-computed f32 table in linear memory. Magnitude computation uses `f32x4`
with a horizontal reduce. Flux accumulation is a scalar f32 loop after the
magnitude difference because the bin loop is branch-heavy (half-wave clamp);
SIMD here gives marginal benefit.

### `src/engine/beat-cache.ts`

OPFS read/write helpers. Public surface:

```typescript
export interface CachedBeatAnalysis {
  beatAnalysisVersion: 1;
  tempoBpm: number;
  beatTimesMs: number[];   // delta-encoded
}

/** Returns the OPFS path for a given SHA-256 hex digest. */
export function beatCachePath(sha256Digest: string): string;
// -> "beats/<first-16-hex>.beats.json"

export async function readBeatCache(
  sha256Digest: string
): Promise<BeatAnalysisResult | null>;

export async function writeBeatCache(
  sha256Digest: string,
  result: BeatAnalysisResult
): Promise<void>;
```

These functions use the OPFS root via `navigator.storage.getDirectory()` and
create the `beats/` subdirectory on first write. They are called only from
the worker.

### `src/engine/worker.ts` (extended)

New command handlers in the `message` event switch:

- `'analyze-beats'`: looks up the `MediaInputHandle` for `sourceId`, reads
  the source's SHA-256 fingerprint from its `SourceDescriptor`, tries
  `readBeatCache` (cache hit -> immediate result reply), else calls
  `analyseBeatTimes` with progress/abort forwarding, then `writeBeatCache`
  on success, then posts `beat-analysis-result`.
- `'cancel-beat-analysis'`: calls `abort()` on the `AbortController` created
  when analysis started; the analyser checks `signal.aborted` after each
  window and returns early if set.
- `'beat-auto-cut'`: applies split or align edits using timeline mutation
  functions from `src/engine/timeline.ts`, wrapped in `commitTimelineMutation`
  for undo.

A `Map<string, AbortController>` keyed by `sourceId` tracks in-flight analyses
so `cancel-beat-analysis` can reach the right controller.

### `src/protocol.ts` (extended)

Following existing kebab-case command / state message patterns:

```typescript
// Commands (added to WorkerCommand union)
| { type: 'analyze-beats'; sourceId: string }
| { type: 'cancel-beat-analysis'; sourceId: string }
| { type: 'beat-auto-cut'; mode: 'split' | 'align'; clipRefs: { trackId: string; clipId: string }[] }

// State messages (added to WorkerStateMessage union)
| { type: 'beat-analysis-progress'; sourceId: string; fraction: number }
| { type: 'beat-analysis-result';   sourceId: string; tempoBpm: number;
    beatTimesMs: number[]; analyserVersion: number }
| { type: 'beat-analysis-error';    sourceId: string; message: string }
```

### `src/ui/timeline-interaction.ts` (extended)

```typescript
// Extend the union:
export type SnapTargetKind = 'zero' | 'playhead' | 'marker' | 'clip-start' | 'clip-end' | 'beat';

// Extend buildSnapTargets signature:
export function buildSnapTargets(
  timeline: readonly TimelineTrackSnapshot[],
  markers: readonly TimelineMarkerSnapshot[],
  beatTimesSeconds?: readonly number[]   // optional; omitting is identical to []
): SnapTarget[];
```

The existing `resolveSnap` function is unchanged. Beat targets get
`id: 'beat-${n}'` and `label: 'Beat ${n + 1}'` where n is the beat index.

### `src/ui/Timeline.tsx` (extended)

The ruler SVG/canvas gains a beat-tick layer rendered from the active beat
grid (beat times in seconds, shifted by `globalOffsetMs / 1000`). Beat ticks
use colour `#b06cff`. Beat index 0 uses the same height as a regular marker
tick; beats 1...N use half that height. The layer is rendered only when at least
one source is in `beatSettings.enabledSourceIds` and the analysis result is
available in a SolidJS store.

### `src/ui/BeatPanel.tsx` (new)

A collapsible panel accessible from the Media Bin's per-source details section
(beside existing source health). Per-source controls:

- Analyse / re-analyse button with a progress bar (driven by
  `beat-analysis-progress` messages).
- Enable/disable beat-grid display toggle.
- Result summary: detected tempo (e.g. "120 BPM"), beat count.
- Global offset nudge: a numeric input or range slider (-500 ... +500 ms, step 1).

A single global "Auto-cut selected clips" section (not per-source) shows the
Split / Align mode selector and the action button, gated per R5.4.

### `src/engine/project.ts` (extended)

`ProjectDoc` gains:

```typescript
beatSettings?: {
  enabledSourceIds: string[];
  globalOffsetMs: number;
};
```

The deserialiser (`parseProjectDoc`) defaults `beatSettings` to
`{ enabledSourceIds: [], globalOffsetMs: 0 }` when the field is absent (no
schema bump; the field is additive and optional).

### `src/engine/project-bundle/types.ts` (extended)

```typescript
export type BundleAssetKind = 'media' | 'lut' | 'caption' | 'thumbnail' | 'waveform' | 'proxy' | 'beats';

// BundleCacheManifest gains:
beats?: { sourceId: string; assetId: string }[];
```

The bundle export logic writes beat cache files under `cache/beats/` inside
the bundle directory, following the same pattern as waveform and proxy cache
assets.

## Persistence and schema notes

`beatSettings` is an optional field added to `ProjectDoc`. The current
`PROJECT_SCHEMA_VERSION` is 10; v11 is claimed by the open Phase 46 PR (#63).
This phase does **not** bump `PROJECT_SCHEMA_VERSION` because the new field
is purely optional and backward-compatible: older readers that do not know
about `beatSettings` ignore it (JavaScript's structural typing; the field is
never a required key in any union discriminant). If a schema bump is needed in
a future conflict resolution, write "bump `PROJECT_SCHEMA_VERSION` to the next
unused version" and add a migration in `parseProjectDoc`.

Beat analysis artifacts live in OPFS (`beats/*.beats.json`), not in
`ProjectDoc`. They are included in bundles via `BundleCacheManifest.beats` so
a round-tripped project does not need to re-analyse (R2.3). The cache is
keyed by the source's SHA-256 fingerprint prefix so stale entries are harmless
(a differently-fingerprinted source generates a new file).

## Snap-to-beat toggle UI placement

The snap toolbar (visible in `src/ui/Timeline.tsx` adjacent to the zoom
controls) already has a snap toggle button. A second toggle button labelled
"Beat" (keyboard shortcut **B**, matching the existing pattern of single-key
shortcuts for timeline toggles) is added to the right of the existing snapping
controls. Its state is a SolidJS `createSignal<boolean>` scoped to the
`Timeline` component -- not persisted, resets on page load.

## Auto-cut placement and tie-breaking rationale

**Split mode minimum guard (0.2 s):** 0.2 s at 25 fps = 5 frames minimum. A
segment shorter than this is unlikely to be intentional and would create
uneditable slivers that cannot be selected or trimmed. The guard skips the
offending beat rather than merging segments to keep the algorithm simple and
predictable.

**Align mode tie-breaking (earlier beat):** when a clip start is exactly
between two beats, snapping to the earlier beat is the musically correct
default because it preserves the clip's position relative to the bar rather
than shifting it forward.

**Align mode overlap skip:** if two clips on the same track would overlap
after alignment, the later clip's move is abandoned and a warning is pushed to
the Phase 25 diagnostics ring (`finding('beat-align-overlap-skipped',
'unsupported', ...)`) so the user can see what was skipped without a blocking
dialog.

## Third-party additions

No new runtime dependencies. The beat analyser reuses:
- `SequentialAudioSource.pcmWindowAt` (Phase 5 audio engine).
- `wabt` (already a devDependency via `build:wasm`).
- OPFS access (Phase 19 pattern).
- `BundleCacheManifest` (Phase 23 pattern).

## Validation

- **Unit (Vitest, Node, co-located):** see R7.1 for enumerated test files and
  cases. All tests use synthetic PCM generated inline; no binary fixtures are
  checked in.
- **Manual smoke:** import a music track (MP3 or AAC in an MP4 wrapper), click
  Analyse, wait for completion, confirm beat ticks appear on the ruler at
  visually plausible positions for the track's tempo, enable snap-to-beat and
  drag a clip edge to confirm it locks to a beat, run auto-cut in split mode
  and confirm splits at beat boundaries, import the project as a bundle and
  confirm analysis is not re-run (cached result loaded from bundle).
- **Faster-than-realtime gate (R1.5):** time the analyser on a 5-minute
  48 kHz stereo track (after mono mixdown, 14 400 000 samples / 28 125 STFT
  frames). Log the wall-clock time in the manual smoke notes; no automated
  CI timing gate (environment-dependent).
