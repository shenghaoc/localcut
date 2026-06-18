# Tasks: Phase 28 — Local Audio Cleanup with WebNN RNNoise

> Current runtime note: PR #123 supersedes this historical WebNN/RNNoise task set
> for the shipped path. The current Audio Cleanup runtime is ORT DTLN, documented
> by `public/models/dtln-onnx/README.md` and the PR123 runtime-retirement spec.

> Status: **Active / foundation implemented.** Probe, manifest + checksummed weights asset, the dedicated lazy cleanup worker (TypeScript RNNoise DSP port + WebNN graph), the panel, undoable cleaned-audio routing through playback/export, docs, and the test suite are implemented. Open items: an Inspector/timeline badge for cleaned clips (the panel shows applied state), a dedicated DiagnosticsPanel section (status lives in the panel + capability matrix row), and the manual browser verification matrix (T10.3–T10.5). `npm run lint` / `npm run format:check` have pre-existing failures on files this phase does not touch; all Phase 28 files pass both.

## T1 — WebNN capability probe

- [x] **T1.1** Add `WebNNProbeResult` (with `FeatureSupport` per backend and `modelSupport`) to `src/protocol.ts`.
- [x] **T1.2** Create `src/engine/audio-cleanup/webnn-probe.ts`: `probeWebNN()` checks `navigator.ml` presence and per-backend `createContext({ deviceType })` for `cpu`/`gpu`/`npu`; discards any created context; maps every error to `'unknown'`; never throws.
- [x] **T1.3** `modelSupport` starts `'unknown'`; the cleanup worker's first explicit graph build reports `'supported'`/`'unsupported'` back through `cleanup-model-status` (controller upgrades the probe state).
- [x] **T1.4** The probe does not feed `deriveCapabilityTierV2` or any existing tier logic; it gates only the Audio Cleanup feature (guarded by `no-startup-load.test.ts`).
- [x] **T1.5** Add a "WebNN (audio cleanup)" row to `CapabilityMatrixPanel` using the standard chip + action-hint format.
- [x] **T1.6** Unit-test the probe with mocked `navigator.ml`: present/absent, per-backend success/failure mixes, throwing probe → `'unknown'` (R9.1).

## T2 — Model manifest and weights asset

- [x] **T2.1** Create `src/engine/audio-cleanup/model-manifest.ts`: `CleanupModelManifest` type and pure `validateManifest()` (specific rejection reasons; unknown fields tolerated).
- [x] **T2.2** Add the RNNoise weights and `manifest.json` under `public/models/rnnoise/`: 13 upstream `.npy` tensors packed byte-exact into `weights.bin` (352,968 bytes) with per-tensor offsets, `license: 'BSD-3-Clause'`, upstream `source` URLs, exact `sizeBytes`, `sha256` checksum, and the audio contract (48 kHz / mono / 480-sample frames).
- [x] **T2.3** Implement checksum verification (`crypto.subtle.digest('SHA-256', ...)`) of the fetched weights against the manifest before graph construction; size or checksum mismatch is a hard, user-visible error.
- [x] **T2.4** Exclude the weights asset from PWA install-time precache (`globIgnores`); runtime `CacheFirst` caching only after a successful explicit load (verified against `dist/sw.js`).
- [x] **T2.5** Unit-test manifest validation: valid manifest, each missing/invalid required field, checksum/size mismatch handling (R9.3) — plus a byte-for-byte verification of the shipped asset.
- [x] **T2.6** Unit-test that startup performs zero model/weight fetches: module-graph assertions (`?raw`) plus runtime fetch/Worker spies through probe + controller + bridge import and a full `probeCapabilities()` run (R9.2).

## T3 — Audio Cleanup worker and protocol

- [x] **T3.1** Add `CleanupWorkerCommand` / `CleanupWorkerState` message unions to `src/protocol.ts` (probe, load-model, begin/chunk/end, cancel, dispose; probe-result, model-status, progress, result, cancelled, error).
- [x] **T3.2** Create `src/engine/audio-cleanup/cleanup-worker.ts` as a separate worker entry: owns the `MLContext`, graph, and all processing; imports nothing from `src/engine/worker.ts`.
- [x] **T3.3** Create `src/ui/cleanup-bridge.ts`: lazy `import('../engine/audio-cleanup/cleanup-worker.ts?worker')` on first action; typed send with transferables; `onerror` → crash reset; the production build emits the worker as its own chunk outside the entry bundle.
- [x] **T3.4** Implement backend selection (`npu → gpu → cpu` preference order, overridable), reporting the chosen backend in `cleanup-model-status`.
- [x] **T3.5** Implement cancellation checked at every chunk/batch boundary: prompt stop, buffers released, `cleanup-cancelled` posted, worker reusable; `cleanup-dispose` releases graph/context and terminates the worker; cancel during model load abandons the stale load generation.
- [x] **T3.6** Unit-test cancellation during model load and mid-chunk: prompt stop, `cancelled` terminal state (not `error`), no partial output retained (R9.4) — processor-level and controller-level tests.

## T4 — RNNoise graph and DSP

- [x] **T4.1** Create `src/engine/audio-cleanup/rnnoise-graph.ts`: build the RNNoise GRU graph (dense → VAD/noise/denoise GRUs → sigmoid gains) with `MLGraphBuilder` from validated weights, per the WebNN samples reference; GRU hidden state carried across batches.
- [x] **T4.2** Create `src/engine/audio-cleanup/rnnoise-dsp.ts`: full TypeScript port of the reference C DSP (Bluestein 960-point DFT with kiss-fft scaling, Vorbis window, 22-band energies/correlations, DCT, celt pitch search + doubling removal, pitch filter, gain interpolation, overlap-add synthesis); pure per-frame functions unit-testable without WebNN.
- [x] **T4.3** Create `src/engine/audio-cleanup/cleanup-jobs.ts`: pure chunk scheduler — 480-sample frame alignment, bounded batch size (100 frames), DSP/GRU state carried across frames and chunks, one-frame delay compensation, monotonic progress.
- [x] **T4.4** Unit-test chunk scheduling and progress: frame alignment, state carry-over (chunked output ≡ unchunked output), progress monotonic; DSP tests include unit-gain reconstruction (one-frame delay), silence gating, gain attenuation, and reset determinism (R9.5).

## T5 — Audio input/output path

- [x] **T5.1** Source input PCM from the existing engine surface: `extract-clip-audio` pipeline command serves bounded windows via `SequentialAudioSource.pcmWindowAt` — no new decode path.
- [x] **T5.2** Downmix to mono in the cleanup worker; resample with the existing streaming polyphase sinc `AudioResampler` when input isn't 48 kHz; in-flight memory bounded by ≤30 s extraction windows and a 15-minute per-job cap.
- [x] **T5.3** Produce the denoised preview buffer; the panel plays original/cleaned A/B through a short-lived local `AudioContext` (bounded preview range; UI-level playback, not a media pipeline).
- [x] **T5.4** Produce the denoised asset candidate: PCM16 WAV encoded in the cleanup worker, registered through the standard import path (fingerprint, OPFS persistence, media bin) as `*.cleaned.wav`; never registered on cancel or error.
- [x] **T5.5** Unit-test the WAV encoder, the downmix/resample contract, and the no-partial-output invariant on cancellation.

## T6 — UI panel

- [x] **T6.1** Create `src/ui/AudioCleanupPanel.tsx`: "Local Audio Cleanup (Experimental)" modal panel following the existing dialog/ARIA idioms; `onCleanup` stops playback and closes the local `AudioContext`.
- [x] **T6.2** Render the permanent privacy statement: "Runs on this device. No upload. No API key. No server inference."
- [x] **T6.3** Implement the four actions — Load model, Preview cleanup, Cancel, Apply to export / create cleaned audio asset — each disabled with a reason via the pure `cleanupActionAvailability` helper.
- [x] **T6.4** Show model state, backend in use, model size, and chunk progress; A/B original/cleaned toggle for the previewed range.
- [x] **T6.5** WebNN unavailable → "WebNN local cleanup unavailable in this browser." with all actions disabled; controller tests assert zero worker spawns in this state.
- [x] **T6.6** Footer with model id, license, and provenance.
- [x] **T6.7** Unit-test the unsupported-WebNN path: unavailable message reason on every action, zero spawns, zero extractions (R9.6).

## T7 — Project state, undo, export routing

- [x] **T7.1** Add optional `cleanedAudio` (asset id, covered source range, model id/version) to `TimelineClip` and the versioned serialization (absent = no cleanup; invalid persisted entries degrade to no cleanup); audio resolution prefers the cleaned asset when set and covering.
- [x] **T7.2** Implement Apply / Remove cleanup as pipeline-worker commands flowing through `commitTimelineMutation` (worker-owned snapshot undo/redo); `setClipCleanedAudio` is a no-op-preserving pure timeline mutation.
- [x] **T7.3** Default export path unchanged: routing happens only through `cleanedAudioSubstitute` when a clip carries the reference; `mixAudioWindow` tests cover both the substituted and the untouched path.
- [ ] **T7.4** Timeline badge + Inspector row for clips with cleanup applied. *(The Audio Cleanup panel shows the applied model and offers Remove cleanup; a timeline/Inspector affordance is still open.)*
- [x] **T7.5** Missing cleaned asset → fall back to original audio with a `missing-cleaned-audio` source-health warning (non-blocking, deduplicated per session).
- [x] **T7.6** Unit-test apply → undo → redo round-trips through `createTimelineHistory`, serialization round-trips, and the missing-asset fallback.

## T8 — Diagnostics

- [ ] **T8.1** Dedicated "Audio Cleanup (WebNN)" DiagnosticsPanel section. *(Currently: WebNN backends row in the capability matrix; backend/model status/size/last-analysis duration live in the Audio Cleanup panel itself.)*
- [x] **T8.2** Cleanup errors flow through the existing recent-errors store (worker crash via the controller's `onError`, apply failures via the pipeline worker's `recordRecentError`), redaction rules applied.
- [x] **T8.3** Diagnostic state is display-only: no logic elsewhere reads cleanup state (WebNN probe never feeds tier derivation).

## T9 — Non-regression, quality gate

- [x] **T9.1** Existing import/play/export suites stay green with WebNN absent and cleanup modules never loaded; `no-startup-load.test.ts` pins the module graph (R9.7).
- [x] **T9.2** Cleanup-worker crash test: feature resets to not-loaded with a recorded error and recovers on the next explicit action; timeline/playback/export untouched (separate worker by construction).
- [x] **T9.3** `npm run lint`: all Phase 28 files clean; repo baseline has pre-existing failures in untouched files (count unchanged by this phase).
- [x] **T9.4** `npm run format:check`: all Phase 28 files clean; same pre-existing baseline caveat.
- [x] **T9.5** `npm test` green; test count grew from 700 to 764.
- [x] **T9.6** `npm run build` green (strict TypeScript); cleanup worker emitted as a separate lazy chunk; `dist/sw.js` precaches no model bytes.

## T10 — Docs and manual verification

- [x] **T10.1** `docs/USER-GUIDE.md`: "Local Audio Cleanup (Experimental)" section — privacy statement, WebNN requirement, load/preview/apply/remove flow, fallback and limits.
- [x] **T10.2** RNNoise license (BSD-3-Clause) + provenance recorded in the manifest, the panel footer, and the user guide.
- [ ] **T10.3** Manual: Chromium with WebNN — load model (weights fetch only then), preview, A/B, cancel mid-job, apply, export, undo.
- [ ] **T10.4** Manual: browser without WebNN — unavailable message; full import/play/edit/export smoke test unchanged.
- [ ] **T10.5** Manual: fresh load — network tab shows zero model requests at startup (A1).
