# Tasks: Phase 27 — Local Audio Cleanup with WebNN RNNoise

> Status: **Planned.** Optional, experimental, local-only. Nothing here may regress startup, the pipeline worker, or default export. See `requirements.md` (R0 hard constraints) and `design.md` before starting.

## T1 — WebNN capability probe

- [ ] **T1.1** Add `WebNNProbeResult` (with `FeatureSupport` per backend and `modelSupport`) to `src/protocol.ts`.
- [ ] **T1.2** Create `src/engine/audio-cleanup/webnn-probe.ts`: `probeWebNN()` checks `navigator.ml` presence and per-backend `createContext({ deviceType })` for `cpu`/`gpu`/`npu`; discards any created context; maps every error to `'unknown'`; never throws.
- [ ] **T1.3** `modelSupport` starts `'unknown'`; wire the upgrade path so the cleanup worker's first explicit graph build reports `'supported'`/`'unsupported'` back through the bridge.
- [ ] **T1.4** Ensure the probe does not feed `deriveCapabilityTierV2` or any existing tier logic; it gates only the Audio Cleanup feature.
- [ ] **T1.5** Add a "WebNN" row to `CapabilityMatrixPanel` using the standard chip + action-hint format.
- [ ] **T1.6** Unit-test the probe with mocked `navigator.ml`: present/absent, per-backend success/failure mixes, throwing probe → `'unknown'` (R9.1).

## T2 — Model manifest and weights asset

- [ ] **T2.1** Create `src/engine/audio-cleanup/model-manifest.ts`: `CleanupModelManifest` type and pure `validateManifest()` (specific rejection reasons; unknown fields tolerated).
- [ ] **T2.2** Add the RNNoise weights and `manifest.json` under `public/models/rnnoise/` with `id`, `version`, `license: 'BSD-3-Clause'`, upstream `source` URL, exact `sizeBytes`, `sha256` checksum, and the audio contract (48 kHz / mono / 480-sample frames).
- [ ] **T2.3** Implement checksum verification (`crypto.subtle.digest('SHA-256', ...)`) of the fetched weights against the manifest before graph construction; size or checksum mismatch is a hard, user-visible error.
- [ ] **T2.4** Exclude the weights asset from PWA install-time precache; allow runtime caching only after a successful explicit load.
- [ ] **T2.5** Unit-test manifest validation: valid manifest, each missing/invalid required field, checksum/size mismatch handling (R9.3).
- [ ] **T2.6** Unit-test that app startup performs zero model/weight fetches: spy on `fetch` through app init and assert no request targets `models/` (R9.2).

## T3 — Audio Cleanup worker and protocol

- [ ] **T3.1** Add `CleanupCommand` / `CleanupState` message unions to `src/protocol.ts` per `design.md` (load-model, process, cancel, dispose; model-status, progress, result, cancelled, error).
- [ ] **T3.2** Create `src/engine/audio-cleanup/cleanup-worker.ts` as a separate worker entry: owns the `MLContext`, graph, and all processing; imports nothing from `src/engine/worker.ts`.
- [ ] **T3.3** Create `src/ui/cleanup-bridge.ts` mirroring `worker-bridge.ts`: lazy `import('../engine/audio-cleanup/cleanup-worker.ts?worker')` on first panel open or cleanup action; typed send with transferables; `onerror` → `cleanup-error`; verify via build output that cleanup modules are not in the entry chunk.
- [ ] **T3.4** Implement backend selection (`npu → gpu → cpu` preference order, overridable), reporting the chosen backend in `cleanup-model-status`.
- [ ] **T3.5** Implement per-job `AbortController` cancellation checked at every chunk boundary: prompt stop, in-flight buffers released, `cleanup-cancelled` posted, worker reusable; `cleanup-dispose` releases graph/context and terminates the worker.
- [ ] **T3.6** Unit-test cancellation during model load and mid-chunk: prompt stop, `cancelled` terminal state (not `error`), no partial output retained (R9.4).

## T4 — RNNoise graph and DSP

- [ ] **T4.1** Create `src/engine/audio-cleanup/rnnoise-graph.ts`: build the RNNoise GRU graph with `MLGraphBuilder` from validated weights, per the WebNN samples reference implementation.
- [ ] **T4.2** Create `src/engine/audio-cleanup/rnnoise-dsp.ts`: port feature extraction and band-gain application; expose pure per-frame functions so they are unit-testable without WebNN.
- [ ] **T4.3** Create `src/engine/audio-cleanup/cleanup-jobs.ts`: pure chunk scheduler — 480-sample frame alignment, bounded chunk size, recurrent (GRU) state carried across frames and chunks, monotonic progress fractions.
- [ ] **T4.4** Unit-test chunk scheduling and progress: frame alignment, state carry-over (chunked output ≡ unchunked output on a synthetic signal), progress monotonic and terminating at 1.0 (R9.5).

## T5 — Audio input/output path

- [ ] **T5.1** Source input PCM from the existing engine surface: selected clip audio via `pcmAt`/`pcmWindowAt`, or the mixed track preview via the shared mix stage — no new decode path.
- [ ] **T5.2** Downmix to mono and resample to 48 kHz using the existing streaming polyphase sinc resampler (`src/engine/audio-resampler.ts`); bound in-flight memory by pulling source windows incrementally for long sources.
- [ ] **T5.3** Produce the denoised preview buffer and route it through the existing audio engine for A/B playback of the previewed range.
- [ ] **T5.4** Produce the denoised asset candidate: encode WAV, store via OPFS, register as a derived media asset fingerprint-linked to its source (Phase 23 conventions); never register on cancel or error.
- [ ] **T5.5** Unit-test the resample/downmix contract (model always receives 48 kHz mono in 480-sample frames) and the no-partial-asset invariant.

## T6 — UI panel

- [ ] **T6.1** Create `src/ui/AudioCleanupPanel.tsx`: "Local Audio Cleanup (Experimental)" panel following existing panel/ARIA/keyboard standards; `onCleanup` for all listeners and the worker bridge.
- [ ] **T6.2** Render the permanent privacy statement: "Runs on this device. No upload. No API key. No server inference."
- [ ] **T6.3** Implement the four actions — Load model, Preview cleanup, Cancel, Apply to export / create cleaned audio asset — each disabled with a reason when prerequisites are missing.
- [ ] **T6.4** Show model state, backend in use, model size, and chunk progress; add the A/B original/cleaned toggle for the previewed range.
- [ ] **T6.5** WebNN unavailable → render "WebNN local cleanup unavailable in this browser." with all actions disabled; assert no cleanup worker is spawned in this state.
- [ ] **T6.6** Footer with model id, version, license, and provenance from the manifest.
- [ ] **T6.7** Unit-test the unsupported-WebNN panel path: message shown, buttons disabled, zero worker spawns (R9.6).

## T7 — Project state, undo, export routing

- [ ] **T7.1** Add optional `cleanedAudioAssetId` to the clip model and versioned serialization (absent = no cleanup); audio resolution prefers the cleaned asset when set.
- [ ] **T7.2** Implement Apply / Remove cleanup as timeline commands flowing through the worker-owned snapshot undo/redo; undo restores the original reference exactly.
- [ ] **T7.3** Default export path: verify by inspection and test that no export code branches on WebNN, the cleanup worker, or the model unless `cleanedAudioAssetId` is set.
- [ ] **T7.4** Badge + Inspector row for clips with cleanup applied, including the Remove cleanup affordance.
- [ ] **T7.5** Missing cleaned asset on restore → fall back to original audio with a source-health warning (Phase 18 conventions).
- [ ] **T7.6** Unit-test apply → undo → redo round-trips and the restore-with-missing-asset fallback.

## T8 — Diagnostics

- [ ] **T8.1** Add the "Audio Cleanup (WebNN)" diagnostics section: WebNN availability per backend, backend used, model loaded/not loaded, model size, last analysis duration.
- [ ] **T8.2** Route cleanup errors through the existing recent-errors store with redaction rules applied.
- [ ] **T8.3** Keep the section display-only: no logic elsewhere reads cleanup diagnostic state.

## T9 — Non-regression, quality gate

- [ ] **T9.1** Integration-test that import/play/edit/export work with WebNN absent and cleanup modules never loaded (R9.7).
- [ ] **T9.2** Test that a simulated cleanup-worker crash mid-job surfaces `cleanup-error` and leaves timeline/playback/export functional.
- [ ] **T9.3** `npm run lint` green.
- [ ] **T9.4** `npm run format:check` green.
- [ ] **T9.5** `npm test` green; test count does not decrease.
- [ ] **T9.6** `npm run build` green (strict TypeScript); confirm the production entry chunk contains no cleanup/WebNN modules.

## T10 — Docs and manual verification

- [ ] **T10.1** Update `docs/USER-GUIDE.md`: experimental Audio Cleanup section — what it does, local-only privacy statement, WebNN browser requirements, how to load/preview/apply/remove, and the unavailable-browser message.
- [ ] **T10.2** Record RNNoise license (BSD-3-Clause) and provenance in third-party attributions.
- [ ] **T10.3** Manual: Chromium with WebNN — open panel, load model (network tab shows the weights fetch only now), preview, A/B, cancel mid-job, apply, export, undo.
- [ ] **T10.4** Manual: browser without WebNN — panel shows the unavailable message; full import/play/edit/export smoke test passes unchanged.
- [ ] **T10.5** Manual: fresh load — network tab shows zero model requests at startup (A1).
