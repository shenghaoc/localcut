# Requirements: Phase 36 — Voice Cleanup

Phase 36 adds three everyday audio-quality tools to LocalCut Studio without
requiring WebNN or any cloud service: (a) a WASM-based RNNoise denoiser that
runs on the live monitor path (AudioWorklet) and in the offline render chain
with bypass A/B, (b) EBU R128 integrated-loudness analysis and normalisation
on the Phase 16 master bus with platform-targeted presets, and (c) gate and
limiter bus inserts on the master bus drawn from the Phase 46 (PR #63) DSP
modules. Settings persist in `ProjectDoc` and travel in project bundles.

**Positioning:** Phase 28 (merged) provides an optional/experimental
WebNN-based RNNoise path that produces undoable cleaned-audio assets
per-clip. Phase 36 adds a *complementary* everyday path: a WASM denoiser
that runs without WebNN, requires no explicit user action beyond toggling it,
and operates on the live monitor bus as well as the export render chain. The
two features coexist. Phase 36 does not modify Phase 28 code.

## R1 — WASM RNNoise denoiser

- **R1.1** The denoiser is compiled from the upstream
  [xiph/rnnoise](https://github.com/xiph/rnnoise) C sources using a pinned
  Emscripten build script (`scripts/build-rnnoise-wasm.mjs`) committed to the
  repo. The resulting artifact (`src/engine/voice-cleanup/rnnoise.wasm`) and its
  base-64 wrapper (`src/engine/voice-cleanup/rnnoise-wasm-b64.ts`) are checked
  in, consistent with the PR #57 resampler pattern. A SHA-256 checksum of the
  `.wasm` binary is stored in
  `src/engine/voice-cleanup/rnnoise-wasm-manifest.json` and verified at load
  time via `crypto.subtle.digest`. Mismatch is a hard, user-visible error; no
  silent retry.
- **R1.2** The WASM module processes audio at 48 kHz mono in 480-sample
  (10 ms) frames, matching the RNNoise C API contract. The denoiser adapts to
  the 128-sample AudioWorklet quantum via an internal ring buffer: samples are
  collected until 480 are available, then one RNNoise frame is processed and
  480 denoised samples emitted. This adds a fixed latency of 480 samples
  (10 ms at 48 kHz) per processing pass.
- **R1.3** The denoiser is enabled per-track: a list of track IDs with
  denoiser enabled is stored in `ProjectDoc.voiceCleanup.denoiserEnabledTracks`
  (an array of strings). An empty array means the denoiser is off for all
  tracks. Enabling on a track applies denoising to that track's audio both in
  the live monitor path and in the export render chain, so the export matches
  what the user heard during editing.
- **R1.4** A/B bypass: the worklet provides a per-track bypass toggle that
  crossfades between the live (denoised) and dry paths over 10 ms (480 samples
  at 48 kHz) to prevent clicks. The bypass state is written into the Phase 46
  SAB layout's reserved denoiser slots as two 16-bit float-safe integers
  (max value 65,535 each) to avoid IEEE 754 NaN canonicalization risks:
  `SAB[34]` stores the bypass bitmask for tracks 0–15,
  `SAB[35]` stores the bypass bitmask for tracks 16–31.
  The AudioWorklet reads `Math.round(sab[34])` / `Math.round(sab[35])` and
  extracts bits using standard bitwise operations. This supports up to 32
  tracks without precision loss or NaN corruption.
- **R1.5** The WASM module is loaded lazily — only when the first track with
  denoising enabled enters the render path. It is not loaded at startup and
  does not appear in the initial module graph. Load time is reported in the
  diagnostics subsystem.
- **R1.6** When the WASM fails to load or the browser's WebAssembly support is
  absent, the denoiser falls back to a pass-through and the UI shows
  "Denoiser unavailable" with the reason. The rest of the audio pipeline is
  unaffected.
- **R1.7** The denoiser runs in the pipeline worker's render chain for export
  (offline processing using the same 480-sample ring/drain logic), never on
  the main thread. The AudioWorklet hosts the denoiser for the live monitor
  path. These are the only two locations where denoiser DSP executes.

## R2 — EBU R128 loudness normalisation

- **R2.1** An offline loudness analysis pass computes the integrated loudness
  of the project's master mix (post-effects, post-cleanup, post-master-gain)
  according to ITU-R BS.1770-4 / EBU R128:
  - K-weighting pre-filter (stage 1: high-shelf, stage 2: RLB high-pass);
    filter coefficients for 48 kHz are stated in design.md and constant;
  - 400 ms measurement blocks with 75 % overlap (100 ms hop);
  - absolute gate: blocks below −70 LUFS excluded;
  - relative gate: blocks below (ungated loudness − 10 LU) excluded;
  - integrated loudness in LUFS from surviving blocks.
- **R2.2** The analysis pass reads the master mix by calling `mixAudioWindow`
  (from `src/engine/export.ts`) for successive non-overlapping 100 ms blocks,
  advancing by 100 ms each step, until the full timeline duration is consumed.
  K-weighting is applied continuously to each block (biquad state carries
  forward monotonically, never reset). The K-weighted samples are buffered in
  a per-channel 400 ms ring buffer; the mean square is computed over the full
  ring after every 100 ms block is appended, forming the 400 ms sliding
  measurement window with 75% overlap. Each audio sample is rendered and
  K-weighted exactly once. At most a 400 ms ring buffer per channel is in
  memory at any time.
- **R2.3** Normalisation applies a single static makeup-gain correction
  `(targetLUFS − measuredLUFS)` in dB to the master bus. The correction is
  stored as `ProjectDoc.voiceCleanup.normaliseGainDb` (a finite number,
  default `0`). The master bus's existing `applyMasterAndClamp` (from
  `src/engine/audio-mix.ts`) applies this correction multiplicatively on top
  of the user's master-gain fader, so the fader remains the user-visible
  control and the normalisation correction is transparent.
- **R2.4** Selectable loudness targets are: −14 LUFS (streaming default,
  e.g. Spotify/Apple Music), −16 LUFS (voice/podcast), −23 LUFS (EBU
  broadcast), and custom within [−36, −6] LUFS. The selected target is stored
  as `ProjectDoc.voiceCleanup.normalisationTargetLufs` (number, default −14).
- **R2.5** True-peak ceiling: after the gain correction is applied, a
  hard-brickwall limiter insert (the Phase 46 `LimiterParams`-compatible
  insert from `src/engine/live-audio/limiter.ts`) on the master bus enforces a
  true-peak ceiling of −1 dBTP by default. The ceiling is configurable within
  [−9, −0.1] dBTP and stored as
  `ProjectDoc.voiceCleanup.limiterCeilingDbtp` (number, default −1).
- **R2.6** The loudness analysis command is triggered by the user from the
  Voice Cleanup panel. Progress is reported as a fraction (0.0–1.0). The
  analysis runs in the pipeline worker, not on the main thread. On completion
  the worker posts the measured integrated loudness, the computed gain
  correction, and the resulting normalised loudness to the UI. The user
  confirms before the gain correction is applied to `ProjectDoc`.
- **R2.7** Normalisation is undoable: applying the gain correction is a
  `ProjectDoc` mutation that flows through the Phase 9 worker-owned undo/redo
  stack. A "Reset normalisation" action sets `normaliseGainDb` back to `0`.

## R3 — Gate and limiter bus inserts

- **R3.1** A noise gate and a brickwall lookahead limiter are available as
  master-bus inserts. They reuse the pure-DSP functions from Phase 46 (PR #63):
  `src/engine/live-audio/gate.ts` (`GateParams`) and
  `src/engine/live-audio/limiter.ts` (`LimiterParams`). Phase 36 does not
  re-implement these modules; it only wires them into the master bus insert
  chain described below. If PR #63 is not yet merged when Phase 36 is
  implemented, the dependency is on the pure-function signatures
  `processGate(input, state, params, sampleRate)` and
  `processLimiter(input, state, params, sampleRate)` — not on the file paths.
- **R3.2** The master bus insert order (signal flow) is:
  `[Gate] → [EBU R128 gain correction] → [True-peak Limiter]`.
  Both gate and limiter can be independently bypassed. Bypass crossfades over
  5 ms (240 samples at 48 kHz) to avoid clicks, consistent with Phase 46.
- **R3.3** Gate defaults: `thresholdDb = −40`, `rangeDb = −80`,
  `attackMs = 0.1`, `holdMs = 20`, `releaseMs = 50`, `bypass = true`
  (off by default). Limiter defaults: `ceilingDb` matches
  `ProjectDoc.voiceCleanup.limiterCeilingDbtp` (default −1),
  `attackUs = 100`, `releaseMs = 50`, `bypass = false` (always active when
  normalisation is enabled; always bypassable by the user).
- **R3.4** Insert parameters and bypass states are stored in
  `ProjectDoc.voiceCleanup.gateParams` (`GateParams`) and
  `ProjectDoc.voiceCleanup.limiterParams` (`LimiterParams`). Changes to
  insert parameters are applied immediately to the live monitor path via the
  SAB extended layout (Phase 46 `SAB[17..33]`) and to the export render chain
  via the `ProjectDoc` fields.
- **R3.5** The inserts operate in the pipeline worker's `mixAudioWindow` path
  for export and in the AudioWorklet's existing live-chain pass (Phase 46
  SAB-driven inserts) for the monitor path. The Phase 36 gate and limiter
  occupy the same SAB slots already reserved in the Phase 46 layout
  (`SAB[17..22]` for gate, `SAB[30..33]` for limiter); no new SAB slots are
  allocated for these inserts.

## R4 — Worklet latency budget

- **R4.1** The total latency from audio input to monitor output with all
  inserts active at a 128-sample quantum at 48 kHz is:
  - Quantum: 128 samples = 2.67 ms
  - Denoiser ring (480-sample collection): 480 samples = 10 ms
  - Limiter lookahead (Phase 46 value): 240 samples = 5 ms
  - Gate: 0 ms (no lookahead)
  - **Total: ≈ 17.67 ms** (displayed in the Voice Cleanup panel)
  This is monitoring-path latency only; export is not real-time and is not
  affected.
- **R4.2** The worklet latency budget table is displayed as a read-only
  diagnostic row in the Voice Cleanup panel. Values are computed from
  `AudioContext.sampleRate` (may differ from 48 kHz on some platforms; the
  denoiser resamples to 48 kHz as needed).

## R5 — Persistence and project bundles

- **R5.1** All Voice Cleanup settings are stored under a new `voiceCleanup`
  field in `ProjectDoc` (type `VoiceCleanupSettings`). The field is optional
  for backward compatibility; absent means "all defaults". `ProjectDoc` schema
  version must be bumped to the next unused version after v11 (which is
  claimed by Phase 46 PR #63). The exact version number is filled in at
  implementation time.
- **R5.2** The `VoiceCleanupSettings` interface contains:
  ```typescript
  interface VoiceCleanupSettings {
    denoiserEnabledTracks: string[];          // track IDs; default []
    normalisationTargetLufs: number;          // default −14
    normaliseGainDb: number;                  // computed, default 0
    limiterCeilingDbtp: number;               // default −1
    gateParams: GateParams;                   // Phase 46 type, with bypass
    limiterParams: LimiterParams;             // Phase 46 type, with bypass
  }
  ```
- **R5.3** Because `voiceCleanup` lives in `ProjectDoc`, it is automatically
  included in Phase 23 project bundles via `project.json` at no extra cost.
  No bundle format changes are needed.
- **R5.4** The `ProjectDoc` validation function in `src/engine/project.ts` is
  extended to parse and validate the `voiceCleanup` field using the existing
  hand-rolled validation pattern (`isRecord`, `finiteNumber`, etc.). Invalid
  or absent sub-fields fall back to the defaults listed in R5.2 without
  throwing — forward-compatible loading.

## R6 — UI: Voice Cleanup panel

- **R6.1** A new `VoiceCleanupPanel.tsx` component in `src/ui/` groups all
  voice-cleanup controls. It is reachable from the main mixer/inspector area
  and follows the dark professional-tool UI aesthetic and accessibility
  standards from the steering documents.
- **R6.2** The panel contains four sections:
  (a) **Denoiser**: per-track enable toggles (listed by track name), A/B bypass
      toggle, load status / latency budget table;
  (b) **Loudness Normalisation**: target selector (−14 / −16 / −23 / custom),
      custom LUFS input (range [−36, −6]), "Analyse & Normalise" button with
      progress indicator, measured loudness and applied correction readout,
      "Reset" button;
  (c) **Gate**: bypass toggle, threshold, range, attack/hold/release controls;
  (d) **Limiter**: bypass toggle, ceiling (dBTP), attack, release controls.
- **R6.3** "Analyse & Normalise" is disabled while an analysis is in progress
  or while the project timeline is empty. Progress is shown as a fraction with
  the current window time. Completion shows the measured LUFS and proposed
  correction before applying; cancellation is supported.
- **R6.4** The panel follows ARIA keyboard navigation: all controls are
  reachable via Tab, sliders use arrow keys, and the ARIA live region announces
  analysis completion and correction applied.
- **R6.5** No media objects or WebGPU handles appear in `VoiceCleanupPanel.tsx`;
  `onCleanup` is used for every listener/subscription.

## R7 — Tests and docs

- **R7.1** Unit tests (Vitest, Node environment) in co-located test files cover:
  - `src/engine/voice-cleanup/kweighting.test.ts`: K-weighting filter
    coefficient response at 1 kHz and 10 kHz, spot-checked against the
    BS.1770-4 published transfer functions; filter state carries across
    successive 400 ms blocks.
  - `src/engine/voice-cleanup/ebu-r128.test.ts`: gated integrated loudness
    of a 997 Hz full-scale sine wave at 48 kHz (analytically expected: −3.01
    LUFS after K-weighting for a full-scale sine; the test uses a known-gain
    signal to verify the exact value within ±0.1 LU); gated integrated
    loudness of silence (result: −∞ or no blocks pass the absolute gate);
    gated integrated loudness on a mixed-level signal that exercises the
    relative gate (blocks below the threshold are excluded); the ±0.5 LU
    acceptance criterion is verified on a −23 LUFS calibration fixture
    (997 Hz sine scaled to known RMS).
  - `src/engine/voice-cleanup/rnnoise-ring.test.ts`: the 480-sample
    frame-adaptation ring (input 128-sample buffers, output 480-sample frames);
    no sample drops or duplicates across 10 successive 128-sample pushes
    (verified by sample-count accounting); correct drain behaviour when the
    ring holds a partial frame at stream end.
  - `src/engine/voice-cleanup/voice-cleanup-integration.test.ts`: mock
    `mixAudioWindow` returning a known PCM signal; analysis produces the
    expected integrated loudness within ±0.5 LU of the analytically computed
    value; normalisation gain correction equals `(target − measured)` within
    ±0.01 dB.
  - An underrun simulation test in `rnnoise-ring.test.ts`: a budget-time mock
    (injected clock) confirms that a denoiser processing call at 128-sample
    quantum completes within 2 ms wall-clock budget (verified using
    `performance.now()` stubs) so the worklet does not cause audio glitches.
- **R7.2** No Playwright tests are added for this phase; all coverage is Vitest.
  Existing test count must not decrease.
- **R7.3** `docs/USER-GUIDE.md` is updated with a "Voice Cleanup" section
  covering: denoiser enable/disable per track and the positioning relative to
  the Phase 28 WebNN cleanup; loudness normalisation targets and the Analyse
  workflow; gate and limiter controls with recommended starting points for
  voice-over work.
- **R7.4** `npm run build` stays green (strict TypeScript). `npm test` stays
  green and the test count grows.
