# Tasks: Phase 36 — Voice Cleanup

## T1 — RNNoise WASM build and manifest (R1.1)

- [x] **T1.1** Write `scripts/build-rnnoise-wasm.mjs`: pins the WASM
  provenance selected in `design.md`, vendors `@jitsi/rnnoise-wasm@0.2.1` with
  a verified npm tarball SHA-256, extracts `dist/rnnoise.wasm`, writes
  `src/engine/voice-cleanup/rnnoise.wasm`,
  `src/engine/voice-cleanup/rnnoise-wasm-b64.ts` (base-64 export
  `RNNOISE_WASM_B64: string`), and
  `src/engine/voice-cleanup/rnnoise-wasm-manifest.json`
  (npm package/version, package tarball hash, source repository, license, simd,
  sizeBytes, checksum as `sha256-<hex>`), plus runtime copies under
  `public/rnnoise/`. Script is idempotent. Emscripten is permitted only as an
  upstream build detail, not as a repo-local requirement.
- [x] **T1.2** Add `"build:wasm:rnnoise": "node scripts/build-rnnoise-wasm.mjs"` to
  `package.json` scripts. The existing `"build:wasm"` script continues to
  handle only the resampler; the two scripts are independent.
- [x] **T1.3** Check in the compiled `rnnoise.wasm` (≈110 kB),
  `rnnoise-wasm-b64.ts`, and `rnnoise-wasm-manifest.json` under
  `src/engine/voice-cleanup/`. Add these paths to `.gitignore` exclusions so
  they are *not* ignored. Document in `scripts/build-rnnoise-wasm.mjs` how to
  reproduce the artifact.

## T2 — RNNoise processor and frame-adaptation ring (R1.2, R1.5)

- [x] **T2.1** `src/engine/voice-cleanup/rnnoise-processor.ts`:
  implement `loadRnnoise()` — fetches the public `rnnoise.wasm` runtime copy,
  verifies byte size and SHA-256 against the generated manifest via
  `crypto.subtle.digest`, throws a `RnnoiseLoadError` with a user-readable
  message on mismatch, instantiates the WASM module, returns
  `{ createInstance() }`. The module is loaded lazily (only when first called);
  a module-level cache prevents re-instantiation.
- [x] **T2.2** Implement `RnnoiseInstance` wrapper: calls
  `rnnoise_create()`, `rnnoise_process_frame(state, outPtr, inPtr)` using the
  WASM heap, `rnnoise_destroy()`. Manages two 480-float WASM heap regions
  (input/output) allocated once per instance.
- [x] **T2.3** Implement `RnnoiseRing` in the same file: maintains an
  internal input accumulator plus pre-primed output ring. `push(block)`:
  appends `block` to the accumulator, loops while ≥ 480 samples are available,
  calls `processFrame` on each complete RNNoise frame, appends denoised frames
  to the output ring, and returns exactly `block.length` samples. This prevents
  accumulator growth when input blocks exceed 480 samples (e.g. 1024-sample
  export blocks) while keeping AudioWorklet quanta rate-matched. `drain()`:
  zero-pads to 480, calls `processFrame`, and returns the remaining queued
  denoised samples.

## T3 — K-weighting filter (R2.1)

- [x] **T3.1** `src/engine/voice-cleanup/kweighting.ts`: implement
  `createKWeightState()` and `kWeightBlock(input, state)` using the exact
  BS.1770-4 biquad coefficients stated in design.md. Both stages are Direct
  Form I. State carries across successive calls (never reset between windows).
  Returns a new `Float32Array` (does not mutate input).

## T4 — EBU R128 analyser (R2.1, R2.2)

- [x] **T4.1** `src/engine/voice-cleanup/ebu-r128.ts`: implement
  `LoudnessAnalyser` class. `feedBlock(leftOrMono, right?)`:
  (a) applies K-weighting to each non-overlapping 100 ms block using
  `kWeightBlock` with per-channel state carried forward monotonically;
  (b) appends K-weighted samples to a 400 ms per-channel ring buffer;
  (c) once the ring is primed, computes per-channel mean-square over the full
  400 ms window;
  (d) computes window loudness `l_i = −0.691 + 10 * log10(sumChannelGain)`;
  (e) stores `l_i` in an internal array for gating.
  `integratedLoudness()`: applies absolute gate (−70 LUFS), computes ungated
  loudness, applies relative gate (ungated − 10 LU), returns doubly-gated
  integrated loudness; returns `−Infinity` if no windows survive both gates.
  `reset()`: clears accumulated windows and biquad state.
- [x] **T4.2** `normalisationGain(measuredLufs, targetLufs)`: returns
  `targetLufs − measuredLufs` clamped so the correction does not push the gain
  above +30 dB (prevents pathological corrections on near-silent signals).
  Returns `0` when `measuredLufs` is `−Infinity` or non-finite.

## T5 — Loudness analysis pass in the worker (R2.2, R2.6)

- [x] **T5.1** `src/engine/voice-cleanup/loudness-analysis.ts`: implement
  `analyseLoudness(options, onProgress, signal)`. Steps:
  (a) compute total blocks = `ceil(timelineDurationS / 0.1)` (100 ms blocks);
  (b) loop: call `mixAudioWindow(startS, 0.1)` for non-overlapping 100 ms
      blocks (`src/engine/export.ts`); K-weight each block continuously
      (biquad state carries forward monotonically); append K-weighted samples
      to a per-channel 400 ms ring buffer; after every 100 ms block, compute
      the mean square over the full ring and form the window loudness `l_i`;
      call `onProgress(i / total)`;
      check `signal.aborted` and throw `AbortError` if so;
  (c) return `{ measuredLufs, normalisationGainDb }`.
  Each audio sample is rendered and K-weighted exactly once (no 4× overhead).
  At most a 400 ms ring buffer per channel is in memory at any time.
- [x] **T5.2** Wire `analyseLoudness` into `src/engine/worker.ts` command
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

- [x] **T6.1** `src/engine/voice-cleanup/voice-cleanup-processor.ts`: implement
  `denoiseTrackPcm(trackId, monoPcm, state)` — applies `RnnoiseRing.push` to
  a single track's mono PCM in place. Called per-track BEFORE summation in
  `mixAudioWindow`. No-op if the track is not in `denoiserEnabledTracks`.
  Implement `applyMasterCleanupChain(pcm, channels, params, state, sampleRate)`
  for the summed stereo master buffer. Signal flow (post-summation only):
  (a) call `processGate` from `src/engine/live-audio/gate.ts`;
  (b) apply `normaliseGainDb` via `applyMasterAndClamp` (with gain factor
      `10^(normaliseGainDb/20)`);
  (c) call `processLimiter` from `src/engine/live-audio/limiter.ts`.
  Mutates `pcm` in place.
  **Critical**: the denoiser MUST NOT run on the summed master — RNNoise
  treats non-speech audio (music, SFX) as noise and would suppress it.
- [x] **T6.2** Integrate into `mixAudioWindow` in `src/engine/export.ts`:
  (a) before summation, call `denoiseTrackPcm` for each enabled track's mono
      contribution;
  (b) after summation and `applyMasterAndClamp`, call
      `applyMasterCleanupChain` with the project's `voiceCleanup` settings
      and a persistent `VoiceCleanupChainState` allocated once per export job.
  Chain state is re-created for each new export; it is not shared between jobs.

## T7 — Live monitor path: worklet denoiser (R1.2, R1.4, R4.1)

- [x] **T7.1** Extend `public/audio-playback.worklet.js` to instantiate the
  RNNoise WASM bytes passed through the worklet port on first use. Implement a
  per-track `RnnoiseRing` array within the worklet (using a worklet-local
  equivalent of `RnnoiseRing` written in plain JS, since the worklet cannot
  `import` TypeScript modules). The worklet sources the denoiser bypass bitmask
  from `SAB[35]` (tracks 0–15) and `SAB[36]` (tracks 16–31) using
  `Math.round(sab[35])` / `Math.round(sab[36])` and standard bitwise
  extraction (no `Uint32Array` bit-cast — avoids NaN canonicalization risk).
- [x] **T7.2** Implement the 10 ms bypass crossfade in the worklet: when the
  bypass bit for a track changes, linearly interpolate the gain from 0→1
  (unmute denoised path) or 1→0 (mute to bypass) over 480 samples.
- [x] **T7.3** Add SAB writes from the main UI thread to `SAB[35..37]` when
  `voice-cleanup-update-settings` is received/mirrored: pack
  `denoiserEnabledTracks` into bitmask format using audio-track order in the
  current snapshot and write `normaliseGainDb` to `SAB[37]`. The pipeline worker
  owns `ProjectDoc.voiceCleanup`; the main thread owns the meter SAB.

## T8 — ProjectDoc schema and persistence (R5.1–R5.4)

- [x] **T8.1** `src/engine/project.ts`: add `VoiceCleanupSettings` interface
  and `DEFAULT_VOICE_CLEANUP_SETTINGS` exported const with defaults from R5.2.
  Add optional `voiceCleanup?: VoiceCleanupSettings` to `ProjectDoc`. Bump
  `PROJECT_SCHEMA_VERSION` to the next unused version after v11.
- [x] **T8.2** Extend `parseProjectDoc` / `migrateProjectDoc` to validate the
  `voiceCleanup` field using `isRecord`, `finiteNumber`, etc. Any missing or
  invalid sub-field falls back to its default. Version migration: if
  `schemaVersion < new_version`, set `voiceCleanup` to
  `DEFAULT_VOICE_CLEANUP_SETTINGS` when the field is absent.

## T9 — Protocol types (R1.3, R2, R3, R5)

- [x] **T9.1** `src/protocol.ts`: add `VoiceCleanupSettings` interface (as
  described in design.md), the four `WorkerCommand` variants
  (`voice-cleanup-analyse-loudness`, `voice-cleanup-cancel-analysis`,
  `voice-cleanup-apply-normalisation`, `voice-cleanup-update-settings`), and
  the four `WorkerStateMessage` variants
  (`voice-cleanup-analysis-progress`, `voice-cleanup-analysis-result`,
  `voice-cleanup-analysis-cancelled`, `voice-cleanup-analysis-error`).
  All types are structured-clone-safe (no `Float32Array` in command payloads;
  use plain number arrays if bulk PCM transfer is needed).

## T10 — UI: Voice Cleanup panel (R6)

- [x] **T10.1** `src/ui/VoiceCleanupPanel.tsx`: implement the four-section
  panel (Denoiser, Loudness Normalisation, Gate, Limiter) as described in R6.2.
  Read project state from the existing project store. Dispatch
  `voice-cleanup-update-settings` on parameter changes.
- [x] **T10.2** Implement the "Analyse & Normalise" flow: disable button
  while analysis is in progress or timeline is empty; show progress fraction;
  display `measuredLufs` and proposed `normalisationGainDb` as a confirmation
  step before dispatching `voice-cleanup-apply-normalisation`. Add a
  "Cancel analysis" button shown during analysis.
- [x] **T10.3** Display the worklet latency budget table (read-only):
  quantum 2.67 ms + denoiser ring 10 ms + limiter lookahead 5 ms = 17.67 ms.
  Recompute the ms values from `AudioContext.sampleRate` when it differs from
  48 kHz.
- [x] **T10.4** Accessibility: all controls reachable via Tab; sliders use
  arrow-key step; ARIA live region announces analysis completion and
  "Normalisation applied (+X.X dB)". No media objects or WebGPU handles.
  `onCleanup` for all subscriptions.

## T11 — Unit tests (R7.1)

- [x] **T11.1** `src/engine/voice-cleanup/kweighting.test.ts`: (a) apply K-weighting
  to a 1 kHz sine at 48 kHz, assert the output level is within ±0.5 dB of the
  analytically computed gain for the published transfer function;
  (b) apply K-weighting to a 100 Hz sine, assert it is attenuated relative to
  1 kHz (RLB high-pass effect); (c) state carries across two successive calls
  (split the block at an arbitrary sample boundary and compare with a
  single-block result).
- [x] **T11.2** `src/engine/voice-cleanup/ebu-r128.test.ts`:
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
- [x] **T11.3** `src/engine/voice-cleanup/rnnoise-ring.test.ts`:
  (a) Push 10 × 128-sample blocks with a known monotonically increasing sample
  pattern; every `push(128)` returns 128 samples and the first 480 output
  samples are the pre-primed latency compensation silence;
  (b) assert echoed samples appear in order after the 480-sample latency is
  consumed;
  (c) large-block test: push a single 1024-sample block; assert output is
  exactly 1024 samples and no accumulator growth occurs;
  (d) underrun budget test: mock `RnnoiseInstance.processFrame` to do nothing;
  push 128 samples, measure wall clock with `performance.now()` stubs; assert
  total processing budget < 2 ms.
- [x] **T11.4** `src/engine/voice-cleanup/voice-cleanup-integration.test.ts`:
  (a) Mock `mixAudioWindow` to return a 400 ms stereo buffer containing a
  −23 LUFS 997 Hz sine; call `analyseLoudness` with 1 s timeline duration;
  assert `measuredLufs` within ±0.5 LU of −23;
  (b) assert `normalisationGainDb = targetLufs − measuredLufs` within ±0.01 dB
  for target −14 LUFS;
  (c) abort signal mid-analysis: assert the promise rejects with `AbortError`
  and `onProgress` is not called after abort.
- [x] **T11.5** Protocol type-guard tests (co-locate with `src/protocol.ts` test
  file or add to the voice-cleanup integration test): assert that
  `voice-cleanup-analyse-loudness`, `voice-cleanup-analysis-result`, and
  `voice-cleanup-update-settings` are structured-clone-safe (no non-serialisable
  values). No large media fixtures; all tests run in the Node environment.

## T12 — Diagnostics integration (R4.2)

- [x] **T12.1** Add a "Voice Cleanup" section to the Phase 25 diagnostics
  snapshot via `src/engine/diagnostics.ts`: `finding()` rows for
  WASM denoiser status (loaded / not loaded / error), last checksum
  verification result, normalisation status (gain applied in dB or "none"),
  and the worklet latency budget in ms. Follow the existing `finding()` and
  `publishFinding()` patterns.

## T13 — Docs and quality gate (R7.3, R7.4)

- [x] **T13.1** `docs/USER-GUIDE.md`: add a "Voice Cleanup" section covering:
  (a) the denoiser — per-track enable, the distinction from Phase 28 WebNN
  cleanup ("Phase 28 produces a permanent cleaned-audio asset per clip;
  Phase 36 denoises the monitor and export buses in real time"), bypass A/B;
  (b) loudness normalisation — selecting a target (−14 / −16 / −23 / custom),
  running the analysis, applying and resetting the correction;
  (c) gate — when to use it and recommended starting values for voice-over
  work (`thresholdDb = −40`, `holdMs = 20`, `releaseMs = 50`);
  (d) limiter — the true-peak ceiling and why −1 dBTP is the default.
- [x] **T13.2** Verify `npm run build` is green (strict TypeScript; no new
  `any` except where the WASM `exports` object requires it and is immediately
  typed with an `as`-cast at a narrow boundary).
- [x] **T13.3** Verify `npm test` is green and test count is greater than
  before this phase was implemented.
