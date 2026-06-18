# Requirements: Phase 28 — Local Audio Cleanup with WebNN RNNoise

> Current runtime note: PR #123 supersedes the historical WebNN/RNNoise design
> for the shipped Audio Cleanup path. The retained implementation is ONNX Runtime
> DTLN on ORT-WASM, with assets under `public/models/dtln-onnx/`.

> **Optional, experimental phase.** Adds local-only, on-device noise suppression for audio using WebNN and the RNNoise model. The core editor must be completely unaffected when WebNN is absent or the feature is never used.

## R0 — Hard Constraints

- **R0.1** No cloud AI, no AI API, no account, no API key, and no upload of user media anywhere. All inference runs on the user's device.
- **R0.2** No model code or weights may be fetched, parsed, or instantiated at app startup. App boot must be byte-identical in network behavior whether or not this feature exists.
- **R0.3** Model weights load only after an explicit user action ("Load local cleanup model" or "Preview cleanup" / "Analyze/Clean audio").
- **R0.4** No inference, feature extraction, or PCM processing loops on the SolidJS main thread.
- **R0.5** Model inference must not run in the pipeline worker (`src/engine/worker.ts`). A separate, dedicated Audio Cleanup worker owns the model lifecycle and processing.
- **R0.6** Normal import/play/edit/export must work unchanged when WebNN is unsupported, when the model fails to load, or when the cleanup worker crashes. Audio cleanup failure may never break the timeline, playback clock, or export path.
- **R0.7** The feature is labeled **Experimental** everywhere it appears (panel title, diagnostics, docs).
- **R0.8** No silent fallback of any kind to a server. If WebNN is unavailable, the UI says so and the feature is disabled. A WASM/WebGPU local fallback is out of scope and must not be implemented in this phase.
- **R0.9** Out of scope for this phase: LLMs, transcription, object detection, segmentation, and generative models. RNNoise noise suppression is the only model.
- **R0.10** Model weights are served same-origin as a static asset of the app (Cloudflare Pages static hosting); no third-party CDN fetch at runtime.

## R1 — WebNN Capability Probe

- **R1.1** Add a WebNN probe to the capability probing layer that reports, without loading any model: `navigator.ml` presence; per-backend `MLContext` creation for `cpu`, `gpu`, and `npu` device types where detectable (each `supported` / `unsupported` / `unknown`); and an RNNoise model-support state of `unknown` / `supported` / `unsupported`.
- **R1.2** The probe must be cheap and side-effect free: no graph building, no weight fetch, no persistent `MLContext` retained after probing. Probe errors map to `'unknown'`, never throw to the caller.
- **R1.3** Model support starts as `'unknown'` and is upgraded to `'supported'` / `'unsupported'` only after the user explicitly loads the model (graph build success/failure is the ground truth).
- **R1.4** The probe result must surface as a WebNN row in the existing diagnostics/capability panel, following the Phase 26 row format (feature name, support chip, action hint).
- **R1.5** The WebNN probe must not influence `CapabilityTierV2` derivation or any existing tier/branching logic; it gates only the Audio Cleanup feature.

## R2 — Audio Cleanup Worker

- **R2.1** A dedicated worker module (separate file and separate `Worker` instance from the pipeline worker) hosts the WebNN context, the model graph, and all chunk processing.
- **R2.2** The worker module is lazy-loaded (dynamic `import(...?worker)`) only when the user opens the Local Audio Cleanup panel or starts a cleanup action; it must not be referenced from the app's startup module graph in a way that bundles it into the entry chunk or spawns it eagerly.
- **R2.3** Every long-running operation (model load, analysis/processing) is cancellable. Cancel must: stop scheduling further chunks promptly (before the next chunk boundary), release in-flight buffers, and leave the worker reusable or cleanly terminated.
- **R2.4** The worker communicates over a typed `postMessage` protocol defined in `src/protocol.ts` (commands: probe, load-model, process, cancel, dispose; state: model-status, progress, result, error). PCM payloads use transferables; no structured-clone copies of large buffers.
- **R2.5** Closing the panel or disposing the project must terminate or quiesce the worker and free model memory; the worker may be re-spawned on next use.

## R3 — RNNoise Model Integration

- **R3.1** A model manifest (checked into the repo, validated at load time) declares: `id`, `version`, `license`, `source` (upstream provenance URL), `sizeBytes`, and `checksum` (SHA-256 of the weights asset), plus the model's fixed audio contract (sample rate, channel count, frame size).
- **R3.2** Weights ship as a static asset under the app's own origin and are fetched only on explicit user action (R0.3). The fetched bytes must match `manifest.sizeBytes` and `manifest.checksum` before graph construction; mismatch is a hard, user-visible error — never a silent retry against another source.
- **R3.3** Manifest validation is a pure, unit-testable function: unknown fields tolerated, missing/invalid required fields rejected with a specific reason.
- **R3.4** The PWA service worker must not precache the weights asset at install; it may cache it after a successful explicit load so subsequent loads work offline.
- **R3.5** The RNNoise license and provenance must be recorded in the manifest and surfaced in the panel/docs alongside other third-party attributions.

## R4 — Audio Processing Path

- **R4.1** Input: either a selected audio (or linked A/V) clip's source audio, or the mixed track preview window, obtained via the existing engine audio APIs (`pcmAt` / `pcmWindowAt` and the mix stage) — no new decode path.
- **R4.2** Input audio is converted to the model's contract (48 kHz mono for RNNoise) using the existing streaming polyphase sinc resampler (`src/engine/audio-resampler.ts`); no naive nearest-sample resampling.
- **R4.3** Processing is chunked: PCM is split into bounded chunks aligned to the model's 480-sample (10 ms) frame size; per-frame recurrent state (GRU state) is carried across chunk boundaries so chunking is inaudible. Memory in flight is bounded (no whole-file buffering for long sources).
- **R4.4** Progress is reported per chunk as a monotonic fraction with processed/total durations; the UI shows it and stays interactive.
- **R4.5** Output is either (a) a denoised preview buffer playable through the existing audio engine for A/B comparison, or (b) a denoised asset candidate: a WAV (PCM) blob stored via OPFS and registered as a derived media asset linked to its source asset by fingerprint.
- **R4.6** Cancellation mid-processing discards partial output (no half-cleaned asset registered) and reports a `cancelled` terminal state, not an error.

## R5 — UI

- **R5.1** Add a "Local Audio Cleanup (Experimental)" panel following existing panel patterns (dark professional aesthetic, Kobalte primitives, ARIA/keyboard standards).
- **R5.2** The panel permanently displays the privacy statement: **"Runs on this device. No upload. No API key. No server inference."**
- **R5.3** Buttons: **Load model**, **Preview cleanup**, **Cancel**, **Apply to export / create cleaned audio asset**. Buttons are disabled with reasons when prerequisites are missing (no WebNN, no model, no selected audio, operation in flight).
- **R5.4** The panel shows model state (not loaded / loading / loaded / failed), backend in use, model size from the manifest, and progress for the active operation.
- **R5.5** When WebNN is unavailable the panel renders the message **"WebNN local cleanup unavailable in this browser."** with all action buttons disabled; the rest of the app is unaffected (R0.6, R0.8).
- **R5.6** Preview cleanup offers an A/B affordance (toggle original vs. cleaned for the previewed range) so the user can judge the result before applying.

## R6 — Export and Project State

- **R6.1** Export behavior is unchanged by default. The export path may not branch on WebNN, the cleanup worker, or the model unless the user has explicitly applied cleanup.
- **R6.2** "Apply" routes the cleaned audio through explicit project state: the clip (or track) references the cleaned derived asset (e.g. `cleanedAudioAssetId`) instead of an implicit runtime filter. Project serialization includes this reference with the existing versioned-schema rules.
- **R6.3** Applying and removing cleanup are timeline commands that flow through the existing worker-owned snapshot undo/redo (Phase 9); undo restores the original audio reference exactly.
- **R6.4** A clip using a cleaned asset is visibly labeled in the UI (badge/inspector row) with an explicit "Remove cleanup" affordance.
- **R6.5** If the cleaned asset is missing on project restore (e.g. OPFS cleared), the clip falls back to its original audio with a source-health warning — never a broken/silent clip.

## R7 — Diagnostics

- **R7.1** Diagnostics must report: WebNN available/unavailable (per backend), backend used for the last/current session, model loaded/not loaded, model size, last analysis duration, and the most recent cleanup errors (via the existing recent-errors store, redaction rules applied).
- **R7.2** Diagnostic state updates flow over the typed protocol from the cleanup worker; the diagnostics snapshot includes the WebNN section only as display data (no logic branches on it elsewhere).

## R8 — Fallback Behavior

- **R8.1** WebNN unavailable → feature visibly unavailable with the R5.5 message; no cloud fallback, no auto-download of alternative runtimes.
- **R8.2** A possible future WASM or WebGPU local fallback is explicitly **not** implemented in this phase; the design may leave a seam (backend field in the protocol) but no fallback code paths.

## R9 — Tests

- **R9.1** Unit-test the WebNN probe with a mocked `navigator.ml` (present, absent, throwing, per-backend mixes); assert `'unknown'` on probe errors.
- **R9.2** Unit-test that no model/weights fetch occurs at startup (spy on `fetch`/asset loader through app init; assert zero weight requests).
- **R9.3** Unit-test model manifest validation (valid manifest, missing fields, checksum/size mismatch handling).
- **R9.4** Unit-test cancellation: cancel during load and mid-chunk; assert prompt stop, buffer release, `cancelled` terminal state, no partial asset registration.
- **R9.5** Unit-test chunk scheduling and progress: frame alignment to 480 samples, recurrent state carry-over across chunks, monotonic progress reaching 1.0.
- **R9.6** Unit-test the unsupported-WebNN browser path: panel state, disabled buttons, unavailable message, zero worker spawn.
- **R9.7** Integration-test that normal import/play/export works with WebNN absent and with the cleanup modules never loaded.
- **R9.8** Quality gate: `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` all green; test count must not decrease.

## R10 — Acceptance Criteria

- **A1** App startup does not load RNNoise (verified by R9.2).
- **A2** Model loads only after explicit user action.
- **A3** Feature is clearly marked Experimental.
- **A4** No media leaves the device.
- **A5** WebNN-unsupported browsers keep full normal editor behavior.
- **A6** Audio cleanup cannot break the core timeline/playback/export path.
