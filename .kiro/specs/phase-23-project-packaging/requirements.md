# Requirements: Phase 23 — Project Packaging + Portability

## R1 — Portable Project Bundle (Export)

- **R1.1** Add a worker-owned **export project bundle** flow that produces a self-contained artifact a user can move to another browser, device, or profile without relying on IndexedDB or surviving `FileSystemFileHandle`s.
- **R1.2** The bundle must include a versioned `ProjectBundleManifest`, the current `ProjectDoc` (`schemaVersion`, timeline, transitions, markers, sources, export settings), and enough asset metadata to rehydrate the editor offline.
- **R1.3** Export must support a user-selected **bundle source policy** (see design): embed referenced media, reference-only (document + descriptors), and **collect media** into a user-chosen output folder/directory.
- **R1.4** Media included in the bundle are keyed by a stable **content fingerprint** (see R4); duplicate timeline references to the same bytes must write one file on disk.
- **R1.5** Optional bundle payloads — thumbnails, waveform peaks, decode proxies, imported `.cube` LUT files, caption sidecars, and other cache manifests — may be included when available but must never be required for project correctness.
- **R1.6** Large media must be streamed or chunked during export/import; the implementation must not read an entire source file into memory when a streaming path exists.
- **R1.7** No cloud sync, accounts, telemetry upload, or server-side packaging is introduced; export runs entirely in the user's browser.

**Acceptance criteria:** exporting a project with embedded media from Chromium produces a directory bundle that can be copied to another machine; export progress is cancellable; peak memory during export of a multi-GB source stays bounded (verified by tests with mocked stream chunk sizes, not by requiring multi-GB CI fixtures).

## R2 — Bundle Import (Clean Profile)

- **R2.1** Add a worker-owned **import project bundle** flow that accepts a directory collection (primary v1 format) and optionally a single-file archive in a later milestone.
- **R2.2** Import into a **clean browser profile** (no prior IndexedDB project, no stored handles) must restore timeline, transitions, markers, titles, keyframes, LUT references, and source descriptors such that editing and export can proceed when bundled media is present.
- **R2.3** Import must run `deserializeProject` (Phase 9) on the bundled `ProjectDoc` and honour existing `schemaVersion` upgrade/reject rules before applying bundle-specific migrations.
- **R2.4** Bundled media files are matched to descriptors by fingerprint first, then by explicit manifest mapping; name/size/duration checks remain the relink floor when fingerprints are absent (legacy bundles).
- **R2.5** Import never silently binds mismatched media: any descriptor ↔ file disagreement surfaced by `sourceDescriptorMismatchReasons` (Phase 9/18) leaves the source offline and records a structured mismatch in `BundleIntegrityReport`.
- **R2.6** Missing bundled media, renamed external references, or user-cancelled file picks preserve an editable shell with offline clips — the same capability-tier philosophy as Phase 9 re-linking.
- **R2.7** After a successful import, the project is persisted through the normal IndexedDB autosave path so subsequent reloads behave like any other project.

**Acceptance criteria:** round-trip export → import in a fresh profile restores the timeline and plays/export parity when media is embedded; import with missing `media/` entries keeps the app alive and marks affected sources offline.

## R3 — Collect Media

- **R3.1** **Collect media** copies all media referenced by the active project into a user-selected folder while optionally leaving the in-editor project on original paths (reference export) or rewriting manifest paths to the collected copies (relocate export).
- **R3.2** Collect respects deduplication: one on-disk file per fingerprint even when multiple clips/sources reference the same bytes.
- **R3.3** Collect must work when the editor only has `File` blobs from IndexedDB (no handle) and when sources are open via one-time `File` picks.
- **R3.4** Unreadable or missing sources are listed in the integrity report; collect skips them without aborting the whole operation unless the user chose "abort on first error."

**Acceptance criteria:** collect into an empty folder produces a `manifest.json` + `media/` tree that import accepts; skipped offline sources appear in the report, not as silent successes.

## R4 — Media Fingerprinting + Deduplication

- **R4.1** Define `MediaFingerprint` as `{ algorithm: 'sha-256', digest: string }` computed over full file bytes during export/collect/import verification.
- **R4.2** Fingerprinting uses incremental hashing (streamed reads); it must not require loading the entire file into a single `ArrayBuffer` for large sources.
- **R4.3** `SourceDescriptor` gains an optional persisted `fingerprint` field once computed; bundle manifests always record fingerprints for embedded assets.
- **R4.4** Dedup map: `fingerprint → bundle relative path`; multiple `sourceId`s referencing the same digest share one `BundleAsset` entry.
- **R4.5** Fingerprint mismatch during import is a hard reject for that binding attempt (source stays offline); partial hash read failure is a blocking integrity error for that asset.

**Acceptance criteria:** two sources pointing at the same file bytes produce one `media/` entry; tampering one bundled byte changes the digest and fails verification; unit tests cover the dedup map and hash streaming adapter.

## R5 — Integrity Validation

- **R5.1** Produce a `BundleIntegrityReport` on every export, collect, and import summarizing per-asset and per-source status: `ok`, `missing`, `corrupt`, `fingerprint-mismatch`, `descriptor-mismatch`, `unsupported-schema`.
- **R5.2** Validation checks, in order: manifest schema version, required files present, recorded byte size matches on-disk size, fingerprint matches when declared, and descriptor fields (duration, timing, rotation, audio params) match inspected media when media is bound.
- **R5.3** Corrupt `project.json` or `manifest.json` rejects import with a user-visible reason; the shell stays alive.
- **R5.4** Optional cache/proxy files validate only when present; their absence or checksum failure downgrades to "cache miss" (regenerate) rather than blocking edit correctness.
- **R5.5** Import surfaces the integrity report in the UI with actionable text (re-pick, skip, view offline clips); use `role="alert"` only when the bundle cannot be opened at all.

**Acceptance criteria:** tests cover missing, renamed, corrupted, and mismatched media paths; report entries cite stable codes and include `sourceId` / `assetId` where applicable.

## R6 — Bundle Schema Versioning + Migration

- **R6.1** Introduce `bundleSchemaVersion` on `ProjectBundleManifest`, independent of `ProjectDoc.schemaVersion` but carrying both values for compatibility auditing.
- **R6.2** Bundle migrations are explicit, gated functions (`migrateBundleV1ToV2`, etc.); unknown bundle versions reject import with a clear message — never crash the worker.
- **R6.3** Bundle migration may rewrite manifest paths or asset tables; `ProjectDoc` content upgrades remain the responsibility of `deserializeProject` (Phase 9).
- **R6.4** Export always writes the latest supported `bundleSchemaVersion`; importers accept all versions they can migrate from.
- **R6.5** Reject forward-incompatible bundles (newer `bundleSchemaVersion` than the app understands) with guidance to update the app, not partial import.

**Acceptance criteria:** unit tests assert rejection of unknown bundle versions and successful migration across at least one version bump fixture; `ProjectDoc` v1 bundles still import via existing deserializers.

## R7 — Protocol, UI, and Ownership

- **R7.1** Packaging logic lives under `src/engine/` (new `project-bundle/` module); `File`, streams, and directory handles never cross into `src/ui/`.
- **R7.2** Main thread handles only native pickers (`showDirectoryPicker`, `showOpenFilePicker`, download anchor for fallback) and forwards opaque bundle job ids + progress to the worker.
- **R7.3** Commands: `export-project-bundle`, `import-project-bundle`, `collect-project-media`, `cancel-bundle-job`; states: `bundle-job-progress`, `bundle-integrity-report`, `bundle-import-result`.
- **R7.4** Toolbar or File menu entries: **Export Project…**, **Import Project…**, **Collect Media…** with policy sub-options and integrity summary step on completion.
- **R7.5** No new npm dependencies for zip/archive in v1; directory export/import is the primary format. A zip-like single-file archive may be added later behind the same manifest abstraction.

**Acceptance criteria:** static search shows no `File`/`FileSystemHandle` imports from `src/ui/` except typed picker wrappers; protocol payloads remain structured-clone-safe.

## R8 — Testing + Quality Gate

- **R8.1** Unit-test manifest serialization, fingerprint dedup, integrity report generation, bundle schema migration gates, and `ProjectDoc` + manifest round-trip without mocks where pure.
- **R8.2** Integration-test export → import in a simulated clean profile (empty IndexedDB, no handles) with embedded small fixtures.
- **R8.3** Regression tests: bundle without proxies/caches still edits and exports; missing/renamed/corrupted/mismatched media; large-file streaming path does not allocate a single buffer sized to the whole file (mock stream chunk assertions).
- **R8.4** Schema tests: unsupported `bundleSchemaVersion` rejection; supported migration upgrade path.
- **R8.5** `npm run build` and `npm test` remain green; test count must not decrease for non-trivial logic.

**Acceptance criteria:** CI covers the scenarios listed in R8.2–R8.4; manual smoke test copies a bundle folder between two browser profiles and confirms offline playback/export when media is embedded.
