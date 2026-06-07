# Requirements: Phase 25 - Diagnostics, Recovery + Release Hardening

## R1 - Diagnostics Snapshot + Panel

- **R1.1** Add a persistent diagnostics entry point that opens a panel showing the active capability tier, cross-origin isolation status, WebGPU adapter/device status, optional WebGPU features, WebCodecs encoder/decoder support, File System Access support, OPFS/storage usage, proxy/cache status, active export settings, performance budget status, and recent errors.
- **R1.2** Diagnostics data must be gathered into a typed `DiagnosticSnapshot` composed from structured subreports, not ad hoc strings scraped from UI labels.
- **R1.3** Capability messages must be specific and actionable. For example, distinguish "cross-origin isolation missing, SAB disabled" from "WebGPU adapter unavailable" from "H.264 encoder unsupported."
- **R1.4** The panel must show degraded modes explicitly. It must not collapse missing capabilities, device loss, failed audio init, quota pressure, or failed exports into a generic "error" state.
- **R1.5** Snapshot collection must be bounded and non-invasive. It may read feature probes, counters, storage estimates, cache manifests, and current settings, but it must not decode media, render frames, hash full sources, or walk private file contents just to open the panel.

**Acceptance criteria:** opening diagnostics on accelerated, limited, and blocked capability tiers produces a complete `DiagnosticSnapshot`; each missing or degraded feature has a stable code plus human-readable recovery guidance; opening the panel does not block the main thread for sustained work or trigger media processing.

## R2 - Copyable Privacy-Safe Report

- **R2.1** Add a copyable diagnostics report generated from `DiagnosticSnapshot` for support/debugging.
- **R2.2** The default report must exclude media bytes, thumbnails, waveforms, captions, LUT contents, title text contents, raw `ProjectDoc`, full file paths, raw file names, `FileSystemHandle`s, IndexedDB/OPFS object contents, and full source fingerprints.
- **R2.3** Source and clip references in the report must use anonymized stable ids for the report session, plus safe technical descriptors such as container, codec, dimensions, duration bucket, capability result, and status codes.
- **R2.4** Error messages must be redacted before copying because browser `DOMException` and codec errors can include user file names or paths.
- **R2.5** The report must include the app version/build id, browser user agent family/version, platform family, capability tier, isolation status, feature support matrix, storage/quota summary, active export settings, performance budget summary, and recent structured errors.

**Acceptance criteria:** unit tests prove report redaction removes media bytes, paths, file names, title text, captions, LUT content, raw fingerprints, and private project JSON while preserving useful capability/error codes; copying the report never serializes media objects or file handles.

## R3 - Failure Recovery + Project Preservation

- **R3.1** Define `RecentErrorLog` and `RecoveryAction` so every recoverable failure has a stable code, severity, affected subsystem, timestamp, user-facing message, and one or more actions where appropriate.
- **R3.2** Recover gracefully from pipeline worker crash or unresponsive worker by restarting the worker, reinitializing protocol state, rehydrating the latest recovery checkpoint/autosaved project, and preserving the editor shell.
- **R3.3** Recover from GPU device loss by pausing playback/export safely, disposing stale GPU resources, retrying device creation when reasonable, and falling back to a labeled limited mode when WebGPU remains unavailable.
- **R3.4** Recover from AudioContext or AudioWorklet initialization failure by keeping edit/preview shell state alive, offering retry after user gesture, and surfacing an audio-limited tier rather than crashing startup.
- **R3.5** Recover from storage quota errors by pausing disposable cache/proxy writes, preserving project document state where possible, showing cleanup actions, and making it clear when autosave itself is at risk.
- **R3.6** Recover from failed imports, failed exports, and permission loss by keeping the current project editable where possible, marking affected sources/jobs offline or failed, and presenting retry/re-pick/export-again actions.
- **R3.7** Recovery flows must never silently bind mismatched media, silently switch export fidelity, or hide a degraded mode behind a generic toast.

**Acceptance criteria:** tests simulate worker crash/restart, GPU unavailable/device lost, quota exceeded, failed import/export, audio init failure, and permission loss; the app remains mounted, project state is preserved to the latest acknowledged checkpoint where possible, and diagnostics show the failure plus recovery action.

## R4 - Performance Budgets

- **R4.1** Define `PerformanceBudget` entries for main-thread blocking, worker decode queue length, GPU submission count, dropped preview frames, export throughput, memory/cache usage, and audio underruns.
- **R4.2** The accelerated path must keep its hard-gate budget: one WebGPU `queue.submit` per preview/export frame in the accelerated renderer, no CPU pixel readback, bounded decode/encode queues, and no sustained media work on the main thread.
- **R4.3** Budget collection must use counters already produced by engine paths where possible. It must not add per-frame `postMessage` traffic or hot-path allocations that change the behavior under test.
- **R4.4** Budget status must be visible in diagnostics with `ok`, `warning`, and `breach` states plus enough context to reproduce the scenario.
- **R4.5** Performance regressions must be tested where practical and documented where hardware-specific manual validation is still required.

**Acceptance criteria:** unit/performance tests cover GPU submission counting, queue bounds, dropped-frame budget math, export throughput regression thresholds, cache/memory budget accounting, and audio underrun counters; diagnostics show budget breaches without introducing extra hot-path work.

## R5 - Integration Fixture Matrix

- **R5.1** Define a fixture matrix for import -> edit -> export validation across representative containers/codecs, audio layouts, stills, titles, transitions, proxy/cache states, source relink states, capability tiers, and failure cases.
- **R5.2** Fixtures must remain client-side and local. They must not require server-side media processing, accounts, external APIs, telemetry, or cloud storage.
- **R5.3** The matrix must clearly separate required CI fixtures from optional hardware/manual fixtures when WebGPU, WebCodecs encoder support, or codec licensing differs by browser.
- **R5.4** Integration validation must prove exported output is structurally valid and timed correctly, not merely that an export job resolves.
- **R5.5** Fixture docs must include generation commands or provenance for tiny synthetic clips, plus expected capability skip rules.

**Acceptance criteria:** CI or reproducible local tests cover at least one import -> edit -> export path with a video+audio source, one still/title/composite path, one relink/offline-source path, and one export failure/retry path; unsupported codec cases are skipped with explicit capability reasons, not silent passes.

## R6 - Accessibility + Keyboard Audit

- **R6.1** Audit timeline, dialogs, inspector, toolbar, diagnostics panel, capability panel, and export queue against the repo accessibility steering.
- **R6.2** Define an accessibility checklist covering semantic controls, labels, focus order, focus return, focus traps, `aria-live`/`role="alert"` use, contrast, reduced motion, and keyboard-only completion of common edit/export workflows.
- **R6.3** Define a keyboard conflict policy so timeline shortcuts, toolbar shortcuts, dialog shortcuts, inspector inputs, browser-reserved shortcuts, and text entry never fight each other.
- **R6.4** New diagnostics/recovery UI must use persistent visible text for status and reserve `role="alert"` for blocking or user-action-required states.
- **R6.5** Accessibility issues found by the audit must be represented as release readiness blockers when they prevent keyboard completion, focus recovery, or comprehension of degraded capability states.

**Acceptance criteria:** manual keyboard audit covers import, timeline selection/editing, inspector edits, diagnostics copy, export queue actions, recovery actions, and dialogs without a mouse; conflicts are recorded in a shortcut registry/testable policy; blocking a11y issues are listed in release readiness gates.

## R7 - Protocol, Ownership, and Privacy Boundaries

- **R7.1** Diagnostics and recovery protocol payloads must be structured-clone-safe and contain no media objects, raw bytes, GPU handles, WebCodecs objects, audio buffers, `FileSystemHandle`s, or DOM nodes.
- **R7.2** Worker-owned subsystems report diagnostics as summaries and counters. `src/ui/` may render diagnostics, request recovery actions, and trigger native pickers, but it must not own media processing, cache writes, GPU device recovery, or export retry internals.
- **R7.3** `DiagnosticSnapshot`, `CapabilityReport`, `RecentErrorLog`, `RecoveryAction`, and `PerformanceBudget` must live in shared protocol or engine-safe modules with strict types and redaction helpers.
- **R7.4** Recovery actions must be idempotent or explicitly state when they are not; repeated clicks must not duplicate workers, double-close frames, leak GPU devices, or corrupt storage metadata.
- **R7.5** Diagnostics must comply with the user data policy: no uploads, no remote support endpoint, no telemetry, and no private data copied unless explicitly shown in the copyable local report.

**Acceptance criteria:** static search and tests confirm diagnostics payloads are serializable summaries; UI files do not import media/cache/GPU internals; report generation uses redaction helpers before any clipboard write.

## R8 - Release Readiness Gates

- **R8.1** Define release readiness gates that combine build/test status, diagnostics completeness, recovery coverage, fixture matrix results, performance budgets, accessibility audit, privacy redaction, COOP/COEP verification, and manual smoke results.
- **R8.2** A release candidate must fail readiness if accelerated-path invariants regress, recovery leaves the shell blank, copyable diagnostics leak private data, or any required import -> edit -> export fixture cannot complete without an explicit capability skip.
- **R8.3** Gates must distinguish "blocks release", "blocks accelerated tier", "manual follow-up required", and "known limited mode" so degraded browsers are honest instead of hidden.
- **R8.4** The readiness checklist must be runnable by an agent or engineer without relying on unstated tribal knowledge.

**Acceptance criteria:** `tasks.md` includes a final release-readiness checklist; every checklist item maps to a test, manual procedure, diagnostic panel state, or documented capability skip; a release cannot be marked ready while P0/P1 hard gates from `AGENTS.md` are violated.
