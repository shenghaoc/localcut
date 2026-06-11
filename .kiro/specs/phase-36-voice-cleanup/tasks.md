# Tasks: Phase 36 — Voice Cleanup

## T1 — RNNoise WASM build and manifest (R1.1)

- [ ] **T1.1** Write `scripts/build-rnnoise-wasm.mjs`: pins Emscripten version
  (e.g. 3.1.x), clones or vendors the `xiph/rnnoise` C source at a pinned
  commit, compiles with `-msimd128`, exports only
  `rnnoise_create` / `rnnoise_process_frame` / `rnnoise_destroy`, writes
  `src/engine/voice-cleanup/rnnoise.wasm`,
  `src/engine/voice-cleanup/rnnoise-wasm-b64.ts` (base-64 export
  `RNNOISE_WASM_B64: string`), and
  `src/engine/voice-cleanup/rnnoise-wasm-manifest.json`
  (emscriptenVersion, rnnoiseCommit, simd, sizeBytes, checksum as
  `sha256-<hex>`). Script is idempotent.
- [ ] **T1.2** Add `"build:wasm:rnnoise": "node scripts/build-rnnoise-wasm.mjs"` to
  `package.json` scripts. The existing `"build:wasm"` script continues to
  handle only the resampler; the two scripts are independent.
- [ ] **T1.3** Check in the compiled `rnnoise.wasm` (≈50 kB),
  `rnnoise-wasm-b64.ts`, and `rnnoise-wasm-manifest.json` under
  `src/engine/voice-cleanup/`. Add these paths to `.gitignore` exclusions so
  they are *not* ignored. Document in `scripts/build-rnnoise-wasm.mjs` how to
  reproduce the artifact.

## T2 — RNNoise processor and frame-adaptation ring (R1.2, R1.5)

- [ ] **T2.1** `src/engine/voice-cleanup/rnnoise-processor.ts`:
  implement `loadRnnoise()` — decodes `RNNOISE_WASM_B64`, verifies byte size
  and SHA-256 against `rnnoise-wasm-manifest.json` via `crypto.subtle.digest`,
  throws a `RnnoiseLoadError` with a user-readable message on mismatch,
  instantiates the WASM module, returns `{ createInstance() }`. The module is
  loaded lazily (only when first called); a module-level cache prevents
  re-instantiation.
- [ ] **T2.2** Implement `RnnoiseInstance` wrapper: calls
  `rnnoise_create()`, `rnnoise_process_frame(state, outPtr, inPtr)` using the
  WASM heap, `rnnoise_destroy()`. Manages two 480-float WASM heap regions
  (input/output) allocated once per instance.
- [ ] **T2.3** Implement `RnnoiseRing` in the same file: maintains an
  internal `Float32Array` accumulator of up to 479 samples. `push(block)`:
  appends `block` to the accumulator; when ≥ 480 samples available, calls
  `processFrame` on the first 480 and returns the 480 denoised samples
  (remainder kept); returns an empty `Float32Array` if < 480 samples
  available. `drain()`: zero-pads to 480, calls `processFrame`, returns 480
  samples.

## T3 — K-weighting filter (R2.1)

- [ ] **T3.1** `src/engine/voice-cleanup/kweighting.ts`: implement
  `createKWeightState()` and `kWeightBlock(input, state)` using the exact
  BS.1770-4 biquad coefficients stated in design.md. Both stages are Direct
  Form I. State carries across successive calls (never reset between windows).
  Returns a new `Float32Array` (does not mutate input).

## T4 — EBU R128 analyser (R2.1, R2.2)

- [ ] **T4.1** `src/engine/voice-cleanup/ebu-r128.ts`: implement
  `LoudnessAnalyser` class. `feedWindow(leftOrMono, right?)`:
  (a) applies K-weighting to each channel using `kWeightBlock` with per-channel
  state carried across windows;
  (b) computes per-channel mean-square over the 400 ms window;
  (c) computes window loudness `l_i = −0.691 + 10 * log10(sumChannelGain)`;
  (d) stores `l_i` in an internal array for gating.
  `integratedLoudness()`: applies absolute gate (−70 LUFS), computes ungated
  loudness, applies relative gate (ungated − 10 LU), returns doubly-gated
  integrated loudness; returns `−Infinity` if no windows survive both gates.
  `reset()`: clears accumulated windows and biquad state.
- [ ] **T4.2** `normalisationGain(measuredLufs, targetLufs)`: returns
  `targetLufs − measuredLufs` clamped so the correction does not push the gain
  above +30 dB (prevents pathological corrections on near-silent signals).
  Returns `0` when `measuredLufs` is `−Infinity` or non-finite.

## T5 — Loudness analysis pass in the worker (R2.2, R2.6)

- [ ] **T5.1** `src/engine/voice-cleanup/loudness-analysis.ts`: implement
  `analyseLoudness(options, onProgress, signal)`. Steps:
  (a) compute total windows = `ceil(timelineDurationS / 0.1)` (100 ms hop);
  (b) loop: call `mixAudioWindow(startS, 0.4)` (`src/engine/export.ts`);
      feed result to `LoudnessAnalyser.feedWindow`; advance `startS` by 0.1 s;
      call `onProgress(i / total)`;
      check `signal.aborted` and throw `AbortError` if so;
  (c) return `{ measuredLufs, normalisationGainDb }`.
  Holds at most two 400 ms PCM windows in memory at once.
- [ ] **T5.2** Wire `analyseLoudness` into `src/engine/worker.ts` command
  handlers: `voice-cleanup-analyse-loudness` → start analysis with an internal
  `AbortController`; post `voice-cleanup-analysis-progress` per window;
  post `voice-cleanup-analysis-result` on completion;
  `voice-cleanup-cancel-analysis` → abort the controller, post
  `voice-cleanup-analysis-cancelled`.
  `voice-cleanup-apply-normalisation` → mutate `ProjectDoc.voiceCleanup.normaliseGainDb`
  and push to the undo/redo stack (Phase 9 `commitTimelineMutation` pattern).
  `voice-cleanup-update-settings` → update `ProjectDoc.voiceCleanup` and push
  to undo/redo.

## T6 — Voice cleanup export chain (R1.3, R1.7, R3.2)

- [ ] **T6.1** `src/engine/voice-cleanup/voice-cleanup-processor.ts`: implement
  `applyVoiceCleanupChain(pcm, channels, params, state, sampleRate)` as
  described in design.md. Signal flow:
  (a) for each enabled track: run `RnnoiseRing.push` on the track's mono
      contribution (requires mixing that track's contribution out of the
      interleaved PCM, denoising, and mixing back — or, if the export PCM is
      already summed, apply a single denoising pass on the stereo downmix);
  (b) call `processGate` from `src/engine/live-audio/gate.ts`;
  (c) apply `normaliseGainDb` via `applyMasterAndClamp` (with gain factor
      `10^(normaliseGainDb/20)`);
  (d) call `processLimiter` from `src/engine/live-audio/limiter.ts`.
  Mutates `pcm` in place.
- [ ] **T6.2** Integrate `applyVoiceCleanupChain` into `mixAudioWindow` in
  `src/engine/export.ts`: after `applyMasterAndClamp` applies the user's
  master gain, pass the buffer through `applyVoiceCleanupChain` with the
  project's `voiceCleanup` settings and a persistent `VoiceCleanupChainState`
  allocated once per export job. Chain state is re-created for each new
  export; it is not shared between jobs.

## T7 — Live monitor path: worklet denoiser (R1.2, R1.4, R4.1)

- [ ] **T7.1** Extend `public/audio-playback.worklet.js` to load the RNNoise
  WASM from the base-64 export (`RNNOISE_WASM_B64`) on first use. Implement a
  per-track `RnnoiseRing` array within the worklet (using a worklet-local
  equivalent of `RnnoiseRing` written in plain JS, since the worklet cannot
  `import` TypeScript modules). The worklet sources the denoiser bypass bitmask
  from `SAB[34]` (tracks 0–31) and `SAB[35]` (tracks 32–63) using
  `new Uint32Array(sab.buffer, 34 * 4, 1)[0]` bit extraction.
- [ ] **T7.2** Implement the 10 ms bypass crossfade in the worklet: when the
  bypass bit for a track changes, linearly interpolate the gain from 0→1
  (unmute denoised path) or 1→0 (mute to bypass) over 480 samples.
- [ ] **T7.3** Add SAB write from the pipeline worker to `SAB[34..35]` in
  `src/engine/worker.ts` when `voice-cleanup-update-settings` is received,
  packing `denoiserEnabledTracks` into bitmask format using track index in the
  snapshot's track order.

## T8 — ProjectDoc schema and persistence (R5.1–R5.4)

- [ ] **T8.1** `src/engine/project.ts`: add `VoiceCleanupSettings` interface
  and `DEFAULT_VOICE_CLEANUP_SETTINGS` exported const with defaults from R5.2.
  Add optional `voiceCleanup?: VoiceCleanupSettings` to `ProjectDoc`. Bump
  `PROJECT_SCHEMA_VERSION` to the next unused version after v11.
- [ ] **T8.2** Extend `parseProjectDoc` / `migrateProjectDoc` to validate the
  `voiceCleanup` field using `isRecord`, `finiteNumber`, etc. Any missing or
  invalid sub-field falls back to its default. Version migration: if
  `schemaVersion < new_version`, set `voiceCleanup` to
  `DEFAULT_VOICE_CLEANUP_SETTINGS` when the field is absent.

## T9 — Protocol types (R1.3, R2, R3, R5)

- [ ] **T9.1** `src/protocol.ts`: add `VoiceCleanupSettings` interface (as
  described in design.md), the four `WorkerCommand` variants
  (`voice-cleanup-analyse-loudness`, `voice-cleanup-cancel-analysis`,
  `voice-cleanup-apply-normalisation`, `voice-cleanup-update-settings`), and
  the four `WorkerStateMessage` variants
  (`voice-cleanup-analysis-progress`, `voice-cleanup-analysis-result`,
  `voice-cleanup-analysis-cancelled`, `voice-cleanup-analysis-error`).
  All types are structured-clone-safe (no `Float32Array` in command payloads;
  use plain number arrays if bulk PCM transfer is needed).

## T10 — UI: Voice Cleanup panel (R6)

- [ ] **T10.1** `src/ui/VoiceCleanupPanel.tsx`: implement the four-section
  panel (Denoiser, Loudness Normalisation, Gate, Limiter) as described in R6.2.
  Read project state from the existing project store. Dispatch
  `voice-cleanup-update-settings` on parameter changes.
- [ ] **T10.2** Implement the "Analyse & Normalise" flow: disable button
  while analysis is in progress or timeline is empty; show progress fraction;
  display `measuredLufs` and proposed `normalisationGainDb` as a confirmation
  step before dispatching `voice-cleanup-apply-normalisation`. Add a
  "Cancel analysis" button shown during analysis.
- [ ] **T10.3** Display the worklet latency budget table (read-only):
  quantum 2.67 ms + denoiser ring 10 ms + limiter lookahead 5 ms = 17.67 ms.
  Recompute the ms values from `AudioContext.sampleRate` when it differs from
  48 kHz.
- [ ] **T10.4** Accessibility: all controls reachable via Tab; sliders use
  arrow-key step; ARIA live region announces analysis completion and
  "Normalisation applied (+X.X dB)". No media objects or WebGPU handles.
  `onCleanup` for all subscriptions.

## T11 — Unit tests (R7.1)

- [ ] **T11.1** `src/engine/voice-cleanup/kweighting.test.ts`: (a) apply K-weighting
  to a 1 kHz sine at 48 kHz, assert the output level is within ±0.5 dB of the
  analytically computed gain for the published transfer function;
  (b) apply K-weighting to a 100 Hz sine, assert it is attenuated relative to
  1 kHz (RLB high-pass effect); (c) state carries across two successive calls
  (split the block at an arbitrary sample boundary and compare with a
  single-block result).
- [ ] **T11.2** `src/engine/voice-cleanup/ebu-r128.test.ts`:
  (a) Generate a 997 Hz sine at known RMS (e.g. amplitude 0.1, RMS =
  0.1 / √2 ≈ 0.0707; K-weighted level differs from raw level — use the exact
  expected LUFS computed analytically or pre-verified empirically and assert
  within ±0.1 LU);
  (b) silence → integrated loudness is `−Infinity` (no blocks survive absolute
  gate);
  (c) mixed-level signal: first half loud (passes absolute + relative gate),
  second half quiet (passes absolute but fails relative gate) — assert that
  quiet blocks are excluded;
  (d) a −23 LUFS calibration signal (997 Hz sine scaled so its loudness is
  analytically −23 LUFS after K-weighting; verify `integratedLoudness()`
  returns a value within ±0.5 LU);
  (e) `normalisationGain(−20, −14)` returns `6.0`; `normalisationGain(−Infinity, −14)`
  returns `0`.
- [ ] **T11.3** `src/engine/voice-cleanup/rnnoise-ring.test.ts`:
  (a) Push 10 × 128-sample blocks with a known monotonically increasing
  sample pattern; count total output samples = `floor(1280 / 480) * 480 = 960`;
  assert no sample is dropped or duplicated (input[i] appears in output in
  order);
  (b) drain after 10 pushes: output is 480 samples (one final frame after
  zero-padding); total output across push + drain = 1440 samples;
  (c) underrun budget test: mock `RnnoiseInstance.processFrame` to do nothing;
  push 128 samples, measure wall clock with `performance.now()` stubs; assert
  total processing budget < 2 ms.
- [ ] **T11.4** `src/engine/voice-cleanup/voice-cleanup-integration.test.ts`:
  (a) Mock `mixAudioWindow` to return a 400 ms stereo buffer containing a
  −23 LUFS 997 Hz sine; call `analyseLoudness` with 1 s timeline duration;
  assert `measuredLufs` within ±0.5 LU of −23;
  (b) assert `normalisationGainDb = targetLufs − measuredLufs` within ±0.01 dB
  for target −14 LUFS;
  (c) abort signal mid-analysis: assert the promise rejects with `AbortError`
  and `onProgress` is not called after abort.
- [ ] **T11.5** Protocol type-guard tests (co-locate with `src/protocol.ts` test
  file or add to the voice-cleanup integration test): assert that
  `voice-cleanup-analyse-loudness`, `voice-cleanup-analysis-result`, and
  `voice-cleanup-update-settings` are structured-clone-safe (no non-serialisable
  values). No large media fixtures; all tests run in the Node environment.

## T12 — Diagnostics integration (R4.2)

- [ ] **T12.1** Add a "Voice Cleanup" section to the Phase 25 diagnostics
  snapshot via `src/engine/diagnostics.ts`: `finding()` rows for
  WASM denoiser status (loaded / not loaded / error), last checksum
  verification result, normalisation status (gain applied in dB or "none"),
  and the worklet latency budget in ms. Follow the existing `finding()` and
  `publishFinding()` patterns.

## T13 — Docs and quality gate (R7.3, R7.4)

- [ ] **T13.1** `docs/USER-GUIDE.md`: add a "Voice Cleanup" section covering:
  (a) the denoiser — per-track enable, the distinction from Phase 28 WebNN
  cleanup ("Phase 28 produces a permanent cleaned-audio asset per clip;
  Phase 36 denoises the monitor and export buses in real time"), bypass A/B;
  (b) loudness normalisation — selecting a target (−14 / −16 / −23 / custom),
  running the analysis, applying and resetting the correction;
  (c) gate — when to use it and recommended starting values for voice-over
  work (`thresholdDb = −40`, `holdMs = 20`, `releaseMs = 50`);
  (d) limiter — the true-peak ceiling and why −1 dBTP is the default.
- [ ] **T13.2** Verify `npm run build` is green (strict TypeScript; no new
  `any` except where the WASM `exports` object requires it and is immediately
  typed with an `as`-cast at a narrow boundary).
- [ ] **T13.3** Verify `npm test` is green and test count is greater than
  before this phase was implemented.
