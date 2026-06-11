# Design: Phase 36 — Voice Cleanup

> Status: **Proposed** — spec only, not yet implemented.

## Goal

Give everyday creators three audio-quality tools that work in every browser
without WebNN, without a cloud service, and without an explicit "process clip"
workflow: (a) an RNNoise-class WASM denoiser that runs live on the monitor
AudioWorklet and in the offline export render chain; (b) EBU R128
integrated-loudness analysis and a one-click normalisation pass; (c) a noise
gate and brickwall limiter on the Phase 16 master bus. Settings persist through
the project document and travel in bundles.

## Non-goals

- **ML speech enhancement beyond RNNoise-class** — no deep-learning
  enhancement, spectral masking models, or similar ML inference beyond
  RNNoise's GRU-based suppressor.
- **Stem/source separation or de-reverb** — the denoiser targets broadband
  stationary noise, not room acoustics or musical instrument isolation.
- **Modification of Phase 28 (WebNN RNNoise)** — Phase 28 stays the
  optional/experimental per-clip path producing undoable cleaned-audio assets.
  Phase 36 is the always-available everyday path on the monitor and export
  buses. The two features are complementary; they share the RNNoise algorithm
  but use independent code paths.
- **Per-frame loudness automation** — normalisation is a single integrated-pass
  makeup gain, not dynamic range compression or limiter metering beyond the
  insert described in R3.
- **Phase 46 re-implementation** — the gate and limiter DSP functions live in
  `src/engine/live-audio/gate.ts` and `src/engine/live-audio/limiter.ts`
  (Phase 46, PR #63). Phase 36 reuses them without modification.

## Positioning: Phase 28 vs Phase 36

This distinction must be communicated clearly in the UI and docs:

| | Phase 28 (WebNN RNNoise) | Phase 36 (WASM RNNoise) |
|---|---|---|
| Requires WebNN | Yes | No |
| Runs in | Dedicated cleanup worker | AudioWorklet (live) + pipeline worker (export) |
| Produces | Undoable cleaned-audio asset per clip | Real-time monitor + export bus processing |
| User workflow | Load model → Preview → Apply | Enable toggle per track |
| Processing scope | Selected clip | All enabled tracks simultaneously |

## Why compile xiph/rnnoise ourselves

Two options were evaluated:

1. **`@jitsi/rnnoise-wasm`** — an npm package containing a pre-built WASM
   artifact of RNNoise, previously published by Jitsi/8x8.
2. **In-repo Emscripten build of `xiph/rnnoise`** — our own pinned build
   script (`scripts/build-rnnoise-wasm.mjs`) targeting the upstream C source.

Option 1 is disqualified because the `@jitsi/rnnoise-wasm` package has
received no npm releases since 2022, has no active maintainer with
organisational backing (Jitsi's priorities have shifted), and ships no typed
wrapper — violating the AGENTS.md criteria for third-party runtime additions
(active development, organisational backing). A package whose last publish
predates our Safari WebGPU support cannot be considered maintained.

Option 2 is chosen. The build script pins the Emscripten version (e.g.,
3.1.x, same major as the one tested), compiles rnnoise with SIMD-128 enabled
(`-msimd128`), outputs a plain WASM module with the minimal C API
(`rnnoise_create`, `rnnoise_process_frame`, `rnnoise_destroy`), and produces:

- `src/engine/voice-cleanup/rnnoise.wasm` — checked into the repo (≈50 kB),
  same pattern as `src/engine/resampler-simd.wasm`.
- `src/engine/voice-cleanup/rnnoise-wasm-b64.ts` — base-64 encoded, imported
  by the runtime module without a separate fetch, same pattern as
  `src/engine/resampler-simd-wasm-b64.ts`.
- `src/engine/voice-cleanup/rnnoise-wasm-manifest.json` — declares the
  Emscripten version, `xiph/rnnoise` commit hash, SIMD flag, exact byte size,
  and `sha256-<hex>` checksum; validated at load time.

This gives us full control over compilation flags, SIMD enablement, and
licensing. RNNoise is BSD-3-Clause (Xiph.Org Foundation), compatible with
the project's licensing approach.

## EBU R128 / ITU-R BS.1770-4 algorithm

### K-weighting filter (48 kHz coefficients)

K-weighting applies two biquad filters in series to each channel before
mean-square computation:

**Stage 1 — Pre-filter (high-shelf):**
```
H1(z): b0 = 1.53512485958697, b1 = −2.69169618940638, b2 = 1.19839281085285
       a0 = 1.0,              a1 = −1.69065929318241, a2 = 0.73248077421585
```

**Stage 2 — RLB high-pass:**
```
H2(z): b0 = 1.0,  b1 = −2.0, b2 = 1.0
       a0 = 1.0,  a1 = −1.99004745483398, a2 = 0.99007225036616
```

These are the published BS.1770-4 coefficients for 48 kHz, reproduced here for
reference. The implementation in `src/engine/voice-cleanup/kweighting.ts`
hard-codes these values as `const`; no run-time computation of poles/zeros.

### Gated loudness algorithm

1. Apply K-weighting to each channel independently, carrying biquad state
   across successive windows (never reset between windows).
2. Compute mean square of each K-weighted channel over each 400 ms window.
3. Form the multichannel loudness of window `i`:
   `l_i = −0.691 + 10 * log10(Σ_c G_c * mean_square_c_i)`
   where `G_c` is the channel weight (1.0 for L/R/C, 1.41 for Ls/Rs; for
   stereo: 1.0 for both).
4. **Absolute gate:** discard windows where `l_i < −70` LUFS.
5. **Relative gate:** compute ungated loudness `L_KG` from surviving windows;
   discard windows where `l_i < (L_KG − 10)` LU.
6. **Integrated loudness:** recompute mean from doubly-gated windows.

The analysis pass streams the master mix via `mixAudioWindow` in
`src/engine/export.ts` (the same function used by the export path), advancing
the read position by 100 ms per step (400 ms window, 75 % overlap). At most
two consecutive windows are in memory at once.

## Architecture

```
                        Main thread (SolidJS UI)
  ┌───────────────────────────────────────────────────────────┐
  │  VoiceCleanupPanel.tsx                                    │
  │    ├─ per-track denoiser toggles                          │
  │    ├─ loudness target + analyse/reset buttons             │
  │    ├─ gate / limiter controls                             │
  │    └─ latency budget table (read-only)                    │
  │                                                           │
  │  AudioEngine (src/ui/audio-engine.ts)                     │
  │    └─ AudioWorklet: audio-playback.worklet.js             │
  │         ├─ reads SAB[34..35] denoiser bypass bitmask      │
  │         ├─ RNNoise WASM (voice-cleanup wasm, loaded once) │
  │         ├─ 480-sample ring per active track               │
  │         └─ existing gate/limiter (SAB[17..22, 30..33])    │
  └──────────────────────┬────────────────────────────────────┘
                         │ postMessage / SAB
  ┌──────────────────────▼────────────────────────────────────┐
  │  Pipeline worker (src/engine/worker.ts)                   │
  │                                                           │
  │  "analyse-loudness" command                               │
  │    └─ LoudnessAnalyser: streams mixAudioWindow in 400 ms  │
  │       windows, K-weights, gates, → integrated LUFS        │
  │       → posts "loudness-analysis-progress" + result       │
  │                                                           │
  │  Export render chain (mixAudioWindow + export.ts)         │
  │    └─ per-track denoiser (RnnoiseProcessor, 480-sample    │
  │       ring/drain, same WASM module inlined as b64)        │
  │       → applyMixStage (existing P16)                      │
  │       → gate insert (P46 processGate)                     │
  │       → normalisation gain (applyMasterAndClamp extended) │
  │       → limiter insert (P46 processLimiter)               │
  └───────────────────────────────────────────────────────────┘
```

Key architectural boundaries:

- **Main thread stays interactive.** The loudness analysis runs in the pipeline
  worker. The WASM denoiser DSP runs in the AudioWorklet (monitor path) and
  the pipeline worker (export path). No DSP on main.
- **No CPU pixel round-trips.** The voice-cleanup chain is audio-only and does
  not touch the GPU video pipeline.
- **Phase 46 DSP functions are reused as-is.** `processGate` and
  `processLimiter` from `src/engine/live-audio/gate.ts` and
  `src/engine/live-audio/limiter.ts` are called directly by Phase 36 code.
  State dependency on PR #63: if the file paths drift, the dependency is on
  the exported pure function signatures, not the file names.

## Worklet latency budget

At 48 kHz / 128-sample quantum, with all inserts active:

| Stage | Samples | ms (48 kHz) |
|---|---|---|
| AudioWorklet quantum | 128 | 2.67 |
| Denoiser ring (collect 480) | 480 | 10.00 |
| Limiter lookahead (Phase 46) | 240 | 5.00 |
| Gate | 0 | 0.00 |
| **Total (active)** | **848** | **≈ 17.67** |

This budget is for the monitor path. When all inserts are bypassed the total
is 0 ms (pass-through). The table is displayed in the Voice Cleanup panel and
also reported in the diagnostics snapshot. Values scale inversely with
`AudioContext.sampleRate` (the denoiser resamples to/from 48 kHz as needed;
see R1.2).

## Components

### `src/engine/voice-cleanup/rnnoise-wasm-manifest.json`

```json
{
  "emscriptenVersion": "3.1.x",
  "rnnoiseCommit": "<sha>",
  "simd": true,
  "sizeBytes": 0,
  "checksum": "sha256-<hex>"
}
```

`sizeBytes` and `checksum` are filled in by `scripts/build-rnnoise-wasm.mjs`
after compilation.

### `src/engine/voice-cleanup/rnnoise-wasm-b64.ts`

Auto-generated by the build script. Exports `RNNOISE_WASM_B64: string`.
Consumed by `src/engine/voice-cleanup/rnnoise-processor.ts`.

### `src/engine/voice-cleanup/rnnoise-processor.ts`

```typescript
/** Loads and wraps the RNNoise WASM module for use in the worker and worklet. */

interface RnnoiseInstance {
  /** Process one 480-sample mono frame. Returns VAD probability (unused). */
  processFrame(input: Float32Array, output: Float32Array): number;
  destroy(): void;
}

/** Load the WASM module from the checked-in base-64, verify checksum. */
export async function loadRnnoise(): Promise<{ createInstance(): RnnoiseInstance }>;

/**
 * Frame-adaptation ring: buffers 128-sample chunks until 480 are available,
 * then calls processFrame and emits 480 samples. Stateful.
 */
export class RnnoiseRing {
  constructor(instance: RnnoiseInstance);
  /** Push a 128-sample mono block; returns denoised samples (may be empty
   *  or 480 samples). Caller must not modify returned buffer. */
  push(input: Float32Array): Float32Array;
  /** Drain remaining buffered samples (call at end of stream). */
  drain(): Float32Array;
}
```

The WASM memory layout follows the RNNoise C API:
`rnnoise_create() → DenoiseState*`;
`rnnoise_process_frame(state, out, in)` operates on 480 `float` samples
in the WASM heap. `RnnoiseRing` manages the 480-sample input accumulator and
the 480-sample output window, holding a partial buffer of at most 479 samples
between calls.

### `src/engine/voice-cleanup/kweighting.ts`

```typescript
/** BS.1770-4 K-weighting biquad chain for one channel. */
export interface KWeightState {
  x1: number; x2: number; y1: number; y2: number; // stage 1
  x1b: number; x2b: number; y1b: number; y2b: number; // stage 2
}
export function createKWeightState(): KWeightState;
/** Apply K-weighting to a mono block. Mutates state (carries across blocks). */
export function kWeightBlock(input: Float32Array, state: KWeightState): Float32Array;
```

### `src/engine/voice-cleanup/ebu-r128.ts`

```typescript
/** Stateful EBU R128 integrated loudness analyser. */
export class LoudnessAnalyser {
  private readonly sampleRate: number;
  constructor(sampleRate: number);

  /** Feed one 400 ms stereo (or mono) window. Advances window index.
   *  Returns nothing; call integratedLoudness() after all windows. */
  feedWindow(leftOrMono: Float32Array, right?: Float32Array): void;

  /** Compute gated integrated loudness (LUFS) from all fed windows. */
  integratedLoudness(): number;

  reset(): void;
}

/** Compute makeup gain in dB to reach targetLufs from measuredLufs. */
export function normalisationGain(measuredLufs: number, targetLufs: number): number;
```

### `src/engine/voice-cleanup/voice-cleanup-processor.ts`

Pipeline-worker-side denoiser processor for export. Called by `mixAudioWindow`
after the per-track `applyMixStage` and before gate/limiter inserts.

```typescript
export interface VoiceCleanupChainState {
  denoiserRings: Map<string, RnnoiseRing>; // keyed by trackId
  gateState: GateState;                    // Phase 46 GateState
  limiterState: LimiterState;              // Phase 46 LimiterState
}

export function createVoiceCleanupChainState(): VoiceCleanupChainState;

/**
 * Apply the full voice-cleanup insert chain to a stereo interleaved buffer:
 * denoiser (per enabled track) → gate → normalisation gain → limiter.
 * Mutates `pcm` in place.
 */
export function applyVoiceCleanupChain(
  pcm: Float32Array,
  channels: number,
  params: VoiceCleanupChainParams,
  state: VoiceCleanupChainState,
  sampleRate: number,
): void;

export interface VoiceCleanupChainParams {
  denoiserEnabledTracks: string[];
  normaliseGainDb: number;
  limiterCeilingDbtp: number;
  gateParams: GateParams;          // Phase 46 type
  limiterParams: LimiterParams;    // Phase 46 type
}
```

### `src/engine/voice-cleanup/loudness-analysis.ts`

```typescript
/** Runs the full EBU R128 analysis pass on the current project mix.
 *  Calls mixAudioWindow for successive 400 ms windows.
 *  Reports progress via onProgress callback.
 *  Returns measured integrated loudness and computed normalisation gain. */
export async function analyseLoudness(
  options: LoudnessAnalysisOptions,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ measuredLufs: number; normalisationGainDb: number }>;
```

### `src/protocol.ts` (extended)

New commands and state messages following existing kebab-case, domain-verb naming:

```typescript
// Commands (WorkerCommand additions)
| { type: 'voice-cleanup-analyse-loudness'; targetLufs: number }
| { type: 'voice-cleanup-cancel-analysis' }
| { type: 'voice-cleanup-apply-normalisation'; normalisationGainDb: number }
| { type: 'voice-cleanup-update-settings'; settings: VoiceCleanupSettings }

// State messages (WorkerStateMessage additions)
| { type: 'voice-cleanup-analysis-progress'; fraction: number; currentWindowS: number }
| { type: 'voice-cleanup-analysis-result'; measuredLufs: number; normalisationGainDb: number }
| { type: 'voice-cleanup-analysis-cancelled' }
| { type: 'voice-cleanup-analysis-error'; message: string }
```

`VoiceCleanupSettings` (matches the `ProjectDoc` field):

```typescript
interface VoiceCleanupSettings {
  denoiserEnabledTracks: string[];
  normalisationTargetLufs: number;
  normaliseGainDb: number;
  limiterCeilingDbtp: number;
  gateParams: GateParams;      // Phase 46 type (bypass + threshold/range/attack/hold/release)
  limiterParams: LimiterParams; // Phase 46 type (bypass + ceiling/attack/release)
}
```

### `src/engine/project.ts` (extended)

```typescript
// Added to ProjectDoc:
voiceCleanup?: VoiceCleanupSettings;
```

Schema version bumped to the next unused version after v11 (claimed by
Phase 46 PR #63). Write "bump `PROJECT_SCHEMA_VERSION` to the next unused
version" in the implementation task; do not hardcode a number.

The `parseProjectDoc` / `migrateProjectDoc` functions in
`src/engine/project.ts` add a validation pass for `voiceCleanup` using the
existing `isRecord` / `finiteNumber` / `requiredString` helpers. A missing or
invalid `voiceCleanup` field falls back to `DEFAULT_VOICE_CLEANUP_SETTINGS`
(an exported const with the defaults from R5.2).

### `src/ui/VoiceCleanupPanel.tsx`

Four-section panel (see R6.2). Communicates with the worker via the protocol
messages above. Reads gate/limiter SAB meter slots from the Phase 46 extended
SAB layout for live input/output peak display (reuses the existing meter-read
path in `src/ui/audio-engine.ts`). No media objects or WebGPU handles.
`onCleanup` for every listener.

## SAB layout for denoiser bypass (Phase 46 extension)

The Phase 46 SAB layout reserves `SAB[34]` for the denoiser bypass flag and
`SAB[35..47]` for future denoiser parameters. Phase 36 uses `SAB[34]` as a
packed bitmask (tracks 0–31) and `SAB[35]` as a second bitmask (tracks 32–63).
A `Float32` bit-cast is used: `new Uint32Array(sab.buffer, 34*4, 1)[0]` reads
the integer bitmask. The AudioWorklet denoiser checks the bit at position
`trackIndex % 32` in the appropriate word to determine bypass state per track.
This does not add or remove SAB slots — it uses the pre-reserved space.

## Persistence and schema

`voiceCleanup` is a field in `ProjectDoc` parsed during load. Missing field →
use `DEFAULT_VOICE_CLEANUP_SETTINGS`. Extra unknown sub-fields are tolerated
(forward compatibility). No bundle format changes: `project.json` already
carries the whole `ProjectDoc`.

Schema bump wording: bump `PROJECT_SCHEMA_VERSION` to the next unused version
after v11. Migration function: if `schemaVersion < new_version`, default
`voiceCleanup` to `DEFAULT_VOICE_CLEANUP_SETTINGS`.

## Dependencies

- **Phase 16 (merged):** `applyMasterAndClamp` and `applyMixStage` from
  `src/engine/audio-mix.ts`; master bus and AudioWorklet in
  `src/ui/audio-engine.ts`.
- **Phase 46 (open PR #63):** pure-DSP functions `processGate` /
  `processLimiter` from `src/engine/live-audio/gate.ts` /
  `src/engine/live-audio/limiter.ts`; SAB slot reservations at indices 17–22
  (gate), 30–33 (limiter), 34–35 (denoiser bypass). The contract this spec
  relies on: exported pure functions `processGate(input, state, params,
  sampleRate)` and `processLimiter(input, state, params, sampleRate)` and the
  SAB slot layout. If PR #63's file paths change before merge, Phase 36 adapts
  to wherever those functions land; the SAB slot indices are fixed by the
  Phase 46 published layout and must not move.
- **Phase 23 (merged):** bundles travel `ProjectDoc` automatically; no extra
  work needed.
- **Phase 9 (merged):** `voiceCleanup` mutations (normalisation apply/reset)
  go through the worker-owned snapshot undo/redo stack.
- **Phase 6/17 (merged):** `mixAudioWindow` in `src/engine/export.ts` is the
  analysis pass's source of audio; the export render chain inserts the
  voice-cleanup processor after `applyMixStage`.

## Third-party additions

- **No new runtime npm dependencies.** The RNNoise WASM artifact is built from
  upstream C source using Emscripten and checked in, following the existing
  `build:wasm` script pattern. The build script is a devDependency concern
  (Emscripten is a build-time tool, not a runtime package); it does not appear
  in `package.json` at runtime.

## Validation

| Scenario | Expected |
|---|---|
| App startup — denoiser off | WASM not loaded; no fetch; startup bundle unchanged |
| Enable denoiser on a track | WASM loads (once), checksum verified; monitor audio denoised; export denoised |
| Analyse loudness — −23 LUFS sine | Measured LUFS within ±0.5 LU of −23; gain correction equals target − measured within ±0.01 dB |
| Apply normalisation → undo | `normaliseGainDb` set then cleared by undo; export gain correction reverted |
| Bypass denoiser A/B toggle | 10 ms crossfade; no click; bypass reflected in SAB bitmask |
| Gate: signal below threshold | Gain reduction applied; insert input/output meters show reduction |
| Limiter: peak above ceiling | Peak clamped to ceiling; 5 ms lookahead delay heard on monitor |
| WASM checksum mismatch | Hard user-visible error in panel; denoiser disabled; pipeline unaffected |
| Browser without WASM SIMD | SIMD fallback (Emscripten non-SIMD path); note in diagnostics |
| Phase 28 WebNN cleanup active | Both paths coexist; Phase 36 acts on the already-cleaned audio from Phase 28 |
| `npm run build` + `npm test` | Both green; test count grows |
