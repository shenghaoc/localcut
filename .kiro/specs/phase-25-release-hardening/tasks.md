# Tasks: Phase 25 - Diagnostics, Recovery + Release Hardening

> Status: **Planned**. Land typed diagnostics and redaction first; recovery simulations and budgets next; fixture/a11y/release gates last.

## Types + report redaction

- [x] **T1.1** Add shared diagnostic types: `DiagnosticSnapshot`, `CapabilityReport`, `RecentErrorLog`, `RecentError`, `RecoveryAction`, `PerformanceBudget`, storage/cache summaries, export settings summary, and safe source summary.
  - Acceptance: exported types are strict, readonly where practical, structured-clone-safe, and contain no media objects, file handles, GPU/WebCodecs objects, audio buffers, DOM nodes, or `any`.
- [x] **T1.2** Add `buildCopyableDiagnosticReport()` and redaction helpers.
  - Acceptance: the copied report omits media bytes, thumbnails, waveforms, captions, LUT contents, title text, marker/note text, raw `ProjectDoc`, raw file names, paths, `FileSystemHandle`s, IndexedDB/OPFS contents, full fingerprints, and raw cache keys.
- [x] **T1.3** Unit-test redaction with adversarial fixtures.
  - Acceptance: tests include path-shaped DOMException messages, file names inside error strings, title/caption/LUT content, binary arrays, raw fingerprints, source ids, and project JSON; the report keeps stable capability/error codes and safe technical summaries.
- [x] **T1.4** Add source/clip aliasing for reports.
  - Acceptance: aliases are stable within one copied report but cannot be correlated across reports without the original private project data.

## Diagnostics snapshot collection

- [x] **T2.1** Add a diagnostics collector that composes capability tier, `crossOriginIsolated`, SAB, WebGPU, optional WebGPU features, WebCodecs decoder/encoder support, Mediabunny, AudioWorklet, File System Access, OPFS, storage usage, proxy/cache status, active export settings, performance budgets, and recent errors.
  - Acceptance: opening diagnostics does not decode media, hash full sources, render frames, walk private file contents, or run sustained main-thread work.
- [x] **T2.2** Extend WebGPU capability probing with adapter/device status, optional features (`shader-f16`, `timestamp-query`, `subgroups`), relevant limits, and last device-lost summary.
  - Acceptance: unavailable adapter, request failure, ready device, lost device, and recovery states produce distinct stable codes and actionable messages.
- [x] **T2.3** Extend WebCodecs probing for supported import/export codec/container combinations used by the app.
  - Acceptance: unsupported decoder/encoder cases are visible in diagnostics and can be used as explicit fixture skip reasons.
- [x] **T2.4** Add bounded recent-error recording.
  - Acceptance: the log caps entries, counts drops, deduplicates repeated subsystem failures where useful, preserves stable codes, and redacts detail before UI/copy use.
- [x] **T2.5** Add diagnostics protocol messages.
  - Acceptance: snapshot request/response and low-frequency updates are structured-clone-safe and never emitted per frame.

## Diagnostics UI

- [x] **T3.1** Add `DiagnosticsPanel.tsx` and a persistent chrome entry point.
  - Acceptance: the panel shows capability tier, isolation, WebGPU/device state, optional features, WebCodecs support, File System Access, OPFS/storage, proxy/cache status, active export settings, performance budgets, and recent errors.
- [x] **T3.2** Add copy report UI.
  - Acceptance: the user can inspect/copy the redacted report; copy success/failure is announced accessibly; clipboard writes only use the redacted report.
- [x] **T3.3** Add specific degraded-mode messages and recovery action buttons.
  - Acceptance: missing isolation, WebGPU unavailable, device lost, audio init failure, quota pressure, permission loss, failed import, and failed export do not share a generic error message.
- [x] **T3.4** Keep diagnostics panel lightweight and accessible.
  - Acceptance: keyboard focus enters/exits predictably, headings are ordered, icon-only buttons have labels, and passive status does not use disruptive alerts.

## Worker, GPU, and audio recovery

- [x] **T4.1** Add project recovery checkpoints emitted after committed project mutations.
  - Acceptance: checkpoints include serialized project state, source statuses, revision, and active export settings, but no media bytes or handles; they are mutation-frequency, not playback-frequency.
- [x] **T4.2** Implement worker crash/unresponsive restart flow.
  - Acceptance: simulated crash terminates/recreates the worker, remounts the preview canvas for a new OffscreenCanvas transfer, reinitializes SAB/protocol state, restores from latest checkpoint or autosave, and leaves the shell mounted.
- [x] **T4.3** Add a worker recovery state machine and tests.
  - Acceptance: tests cover crash before command ack, crash after committed edit, init failure, restart failure, and repeated restart throttling; unacknowledged destructive commands are not replayed automatically.
- [x] **T4.4** Implement GPU device-lost handling.
  - Acceptance: `device.lost` pauses preview/export safely, releases stale GPU resources, closes in-flight frames exactly once, records `gpu.device_lost`, retries device creation when bounded policy allows, and falls back to labeled limited mode when recovery fails.
- [x] **T4.5** Unit-test GPU unavailable/device-lost paths with mocked adapter/device.
  - Acceptance: tests cover no adapter, `requestDevice` rejection, device lost during preview, device lost during export, retry success, retry failure, and export item failed/retryable without silent partial success.
- [x] **T4.6** Implement audio init failure and underrun diagnostics.
  - Acceptance: missing AudioWorklet, failed worklet module load, user-gesture-blocked AudioContext, ring setup failure, and runtime underruns produce distinct codes; timeline/edit shell remains usable; retry action is available when appropriate.

## Storage quota and cleanup recovery

- [x] **T5.1** Add storage diagnostics using `navigator.storage.estimate()`, OPFS/cache manifests, IndexedDB/autosave health, persistent storage state, and cleanup job state.
  - Acceptance: diagnostics separate project/autosave data from disposable generated media and show quota pressure with actionable status.
- [x] **T5.2** Add quota-exceeded handling in cache/proxy/export/import write paths.
  - Acceptance: quota errors pause disposable writes, preserve project state where possible, record `storage.quota_exceeded`, and never delete project documents or source metadata as automatic cleanup.
- [x] **T5.3** Add `StorageCleanupDialog.tsx`.
  - Acceptance: actions include delete render cache, delete thumbnails/filmstrips, delete waveform peaks, delete unpinned proxies, delete all generated media, repair cache manifest, request persistent storage, and export project bundle when available.
- [x] **T5.4** Unit-test quota exceeded and cleanup idempotency.
  - Acceptance: mocked OPFS/IndexedDB quota failures trigger cleanup actions; repeated cleanup is safe; usage drops below target in tests; project/source descriptors remain intact.

## Import/export/permission recovery

- [x] **T6.1** Add structured import failure diagnostics.
  - Acceptance: corrupt media, unsupported container/codec, descriptor mismatch, permission denial, and user cancellation produce distinct codes; current project is not replaced unless import validation and user confirmation allow it.
- [x] **T6.2** Add structured export failure diagnostics and retry.
  - Acceptance: prepare/decode/render/encode/mux/write/device-lost/permission-lost failures preserve export settings and queue item state; retry uses the same settings unless the user changes them.
- [x] **T6.3** Add permission-loss recovery actions.
  - Acceptance: lost source/output permissions mark affected items offline/needs-permission and offer re-pick/choose-new-output; new bindings still run descriptor/fingerprint checks.
- [x] **T6.4** Unit-test failed import/export/permission recovery.
  - Acceptance: tests prove the shell stays mounted, project state is preserved where possible, and no export fidelity/source mode is changed silently.

## Performance budgets

- [x] **T7.1** Add default `PerformanceBudget` definitions for main-thread blocking, worker decode queue frames/ms, GPU submissions per frame, dropped preview frame rate, export throughput, memory usage, cache usage, and audio underruns.
  - Acceptance: each metric has target/warning/breach thresholds, units, window, and status classification.
- [x] **T7.2** Add budget counters at subsystem boundaries.
  - Acceptance: GPU submissions count where `queue.submit` already happens; decode/encode counters live with queues; audio underruns aggregate before UI updates; no per-frame diagnostics `postMessage` is introduced.
- [x] **T7.3** Unit-test budget math and status classification.
  - Acceptance: tests cover ok/warning/breach/not-measured states, threshold edges, dropped-frame percentages, throughput regression math, queue bounds, cache/memory budgets, and audio underrun rates.
- [x] **T7.4** Add accelerated-path regression assertions.
  - Acceptance: tests or debug counters prove one GPU submit per accelerated preview/export frame, bounded decode/encode queues, and no CPU pixel readback in accelerated diagnostics/performance paths.
- [x] **T7.5** Add reproducible performance benchmark docs.
  - Acceptance: docs describe hardware/browser prerequisites, fixtures, commands, baseline recording, acceptable skip reasons, and where release evidence is recorded.

## Fixture matrix and integration tests

- [x] **T8.1** Document fixture matrix under the test fixture location.
  - Acceptance: docs list required CI fixtures, optional/manual fixtures, generation commands or provenance, expected capability skips, and validation criteria.
- [x] **T8.2** Add required tiny fixtures or deterministic generation scripts for MP4 H.264/AAC, still image/title/composite, audio-only, offline/relink, quota-exceeded mocked, worker-crash mocked, GPU-device-lost mocked, and export-failure mocked scenarios.
  - Acceptance: fixtures stay local/client-side and do not require server media processing, accounts, external APIs, telemetry, or cloud storage.
- [x] **T8.3** Add import -> edit -> export integration coverage.
  - Acceptance: at least one video+audio path, one still/title/composite path, one offline/relink path, and one export failure/retry path are validated; output structure and timing are checked, not just job completion.
- [x] **T8.4** Add capability-aware skip reporting.
  - Acceptance: unsupported WebGPU/WebCodecs/container/encoder cases report explicit skip reasons from diagnostics, not silent passes.
- [x] **T8.5** Add worker crash/restart, GPU loss, quota exceeded, failed import/export, and permission loss integration simulations.
  - Acceptance: simulations assert shell survival, recovery actions, recent error entries, and preserved project/export settings.

## Accessibility and keyboard audit

- [x] **T9.1** Add or update a shortcut registry with scopes, key chords, labels, `when` predicates, and browser-reserved flags.
  - Acceptance: duplicate key chords in overlapping scopes fail a test unless predicates are mutually exclusive.
- [x] **T9.2** Implement keyboard conflict policy.
  - Acceptance: dialog scope wins while modal; text entry keeps text-editing keys; inspector numeric fields own arrows while focused; timeline shortcuts apply only with timeline focus; `Escape` has one active meaning at a time.
- [x] **T9.3** Audit timeline, dialogs, inspector, toolbar, diagnostics panel, capability panel, and export queue.
  - Acceptance: issues preventing keyboard-only import/edit/export/diagnostics/recovery are filed as release blockers.
- [x] **T9.4** Fix blocking accessibility issues found by the audit.
  - Acceptance: focus trap/return, visible focus, semantic controls, labels, contrast, reduced motion, alert usage, and keyboard-only workflows pass manual audit.
- [x] **T9.5** Add manual accessibility audit checklist to release docs.
  - Acceptance: checklist covers import, timeline selection/editing, inspector edits, diagnostics copy, export queue retry/cancel, storage cleanup, recovery actions, and dialogs without a mouse.

## Release readiness gates

- [x] **T10.1** Add a release readiness document or checklist generated from this spec.
  - Acceptance: every item maps to a command, test, manual procedure, diagnostic panel state, or documented capability skip.
- [x] **T10.2** Wire readiness evidence into PR/release review.
  - Acceptance: reviewers can see build/test status, fixture matrix status, diagnostics privacy proof, recovery simulations, performance budget status, accessibility audit result, COOP/COEP result, and manual smoke result.
- [x] **T10.3** Define blocker classification.
  - Acceptance: gates classify failures as blocks release, blocks accelerated tier, manual follow-up required, or known limited mode; P0/P1 hard-gate violations block release.
- [x] **T10.4** Add final diagnostics self-check.
  - Acceptance: accelerated, limited/non-isolated, and blocked/missing-capability snapshots are captured and reviewed before release.

## Verification

- [x] **T11.1** Run `npm run build`.
  - Acceptance: strict TypeScript build passes.
- [x] **T11.2** Run `npm test`.
  - Acceptance: Vitest passes and test count increases for redaction, recovery, budget, fixture, and shortcut logic.
- [ ] **T11.3** Run required integration/fixture matrix.
  - Acceptance: required fixtures pass or skip with explicit capability reasons; exported outputs are structurally valid and timed correctly.
- [ ] **T11.4** Manual smoke: Chromium full-performance run at `http://localhost:5173`.
  - Acceptance: diagnostics shows accelerated tier, COOP/COEP OK, WebGPU/WebCodecs support, import -> edit -> export completes, and budgets remain acceptable.
- [ ] **T11.5** Manual smoke: non-isolated or missing-capability run.
  - Acceptance: diagnostics shows limited/blocked tier with specific reasons and the shell stays alive.
- [ ] **T11.6** Manual privacy check.
  - Acceptance: copied diagnostics report contains no media bytes, file names, paths, title/caption/LUT contents, raw project JSON, raw fingerprints, or handles.
- [ ] **T11.7** Manual keyboard/a11y check.
  - Acceptance: common workflows and recovery actions complete without a mouse and focus returns correctly.

## Final release-readiness checklist

- [ ] `npm run build` passes.
- [ ] `npm test` passes with no test count regression for non-trivial logic.
- [ ] Required fixture matrix passes or records explicit capability skips.
- [ ] Import -> edit -> export succeeds for required supported fixtures.
- [ ] Exported fixture outputs are structurally valid and timed correctly.
- [ ] Diagnostics panel works in accelerated, limited, and blocked/missing-capability states.
- [ ] Copyable diagnostics report passes automated and manual privacy checks.
- [ ] Worker crash/restart simulation preserves project state to the latest acknowledged checkpoint/autosave.
- [ ] GPU unavailable/device-lost simulation recovers or falls back without blank shell or silent partial export.
- [ ] Audio init failure keeps the editor usable and exposes retry/degraded audio state.
- [ ] Storage quota simulation preserves project data and exposes cleanup actions.
- [ ] Failed import/export and permission-loss simulations preserve current project state where possible and expose retry/re-pick actions.
- [ ] Accelerated path budgets pass: one GPU submit per frame, bounded queues, no CPU pixel readback, no sustained main-thread media work.
- [ ] Dropped-frame, export-throughput, memory/cache, and audio-underrun budgets are recorded or explicitly marked not measured with a release-approved reason.
- [ ] COOP/COEP headers are verified in dev and production/preview paths.
- [ ] Keyboard-only audit passes for timeline, dialogs, inspector, toolbar, diagnostics, capability panel, storage cleanup, and export queue.
- [ ] No P0/P1 hard-gate issue from `AGENTS.md` remains open.
- [ ] Manual Chromium full-tier smoke passes.
- [ ] Manual non-isolated/limited-tier smoke shows actionable degraded mode instead of a blank app.
- [ ] Release notes list known limited modes and hardware/browser requirements honestly.
