# Tasks: Phase 23 — Project Packaging + Portability

> Status: **Planned**. Land types + manifest first; streaming export/import next; UI + integration last.

## Types + manifest

- [x] **T1.1** Add `src/engine/project-bundle/types.ts` with `ProjectBundleManifest`, `BundleAsset`, `BundleSourcePolicy`, `BundleIntegrityReport`, `MediaFingerprint`, and related enums.
- [x] **T1.2** Add `src/engine/project-bundle/manifest.ts`: parse/serialize manifest, `BUNDLE_SCHEMA_VERSION` gate, stub `migrateBundle` for v1-only.
- [x] **T1.3** Extend `SourceDescriptor` / protocol snapshot with optional `fingerprint`; ensure `deserializeProject` ignores unknown fields and round-trips when present.
- [x] **T1.4** Unit-test manifest round-trip, unknown `bundleSchemaVersion` rejection, and forward-incompatible rejection.

## Fingerprinting + integrity

- [x] **T2.1** Add `src/engine/project-bundle/fingerprint.ts`: incremental SHA-256 over `Blob`/`File`/stream with chunked reads (no full-file `arrayBuffer()` for large inputs).
- [x] **T2.2** Add `src/engine/project-bundle/integrity.ts`: build `BundleIntegrityReport` from validation passes (size, fingerprint, `sourceDescriptorMismatchReasons`).
- [x] **T2.3** Unit-test dedup map (`digest → single BundleAsset`), fingerprint mismatch, and descriptor mismatch reporting.
- [x] **T2.4** Unit-test streaming hasher with a mock stream that asserts bounded chunk size (large-file memory regression).

## Export + collect

- [x] **T3.1** Add `src/engine/project-bundle/sinks.ts`: directory writer abstraction over FS Access `FileSystemDirectoryHandle` + writable streams.
- [x] **T3.2** Add `src/engine/project-bundle/export.ts`: embed-media and reference-only policies; write `project.json`, `manifest.json`, deduped `media/`, optional `assets/luts/`.
- [x] **T3.3** Stream-copy media bytes sink-to-sink; emit `bundle-job-progress` with byte counts; support `cancel-bundle-job`.
- [x] **T3.4** Implement `collect-project-media` (`collect-media` policy, `relocate` flag) reusing export walker.
- [x] **T3.5** Optional cache export: waveform peaks + thumbnail manifest when worker/UI caches exist (skip silently when empty).
- [x] **T3.6** Unit-test export with in-memory writable mocks: two sources, one shared fingerprint → one `media/` file.

## Import

- [x] **T4.1** Add `src/engine/project-bundle/import.ts`: read manifest, migrate, validate required paths, `deserializeProject` on `project.json`.
- [x] **T4.2** Bind embedded media: size + fingerprint verify → `File` construction → existing adapter inspect → descriptor match; register sources via `persistence.ts` save paths.
- [x] **T4.3** Missing/corrupt/mismatched media: offline sources, integrity items, no silent bind.
- [x] **T4.4** Best-effort cache hydrate; cache failures downgrade to regenerate, not blocking.
- [x] **T4.5** Replace-project prompt protocol hook when IndexedDB already holds a project (main thread dialog; worker waits asynchronously for decision).
- [x] **T4.6** Integration-test round-trip: export embedded small fixtures → import into clean IDB → timeline + source count parity.

## Worker + protocol

- [x] **T5.1** Extend `src/protocol.ts` with bundle commands/states and structured-clone-safe payload types.
- [x] **T5.2** Wire `export-project-bundle`, `import-project-bundle`, `collect-project-media`, `cancel-bundle-job` in `src/engine/worker.ts` with job table + progress emissions.
- [x] **T5.3** On successful import, trigger debounced autosave and emit standard timeline/media state refresh.

## UI

- [x] **T6.1** Add `src/ui/BundleDialog.tsx` (or File menu section): export/import/collect flows, policy pickers, progress display.
- [x] **T6.2** Directory pickers on main only; pass opaque job targets to worker; integrity summary with offline re-pick links to existing re-link affordances.
- [x] **T6.3** Capability-tier message when directory pickers unavailable (no broken silent no-op).

## Regression matrix (tests)

- [x] **T7.1** Round-trip export/import in clean profile (embedded media).
- [x] **T7.2** Import with missing, renamed-on-disk, corrupted, and descriptor-mismatched media files.
- [x] **T7.3** Import bundle without `cache/` and without `proxies/` — project edits and export plan builds.
- [x] **T7.4** Large media streaming test (mocked): export/import does not allocate a single buffer of full file size.
- [x] **T7.5** `bundleSchemaVersion` unsupported → rejected with `unsupported-bundle-schema`; migration fixture passes when bump introduced.

## Verification

- [x] **T8.1** Manual: copy bundle directory between two Chromium profiles; confirm accelerated tier, playback, and export on embedded media.
- [x] **T8.2** Manual: reference-only bundle → clean profile → re-pick relink with mismatch surfaced.
- [x] **T8.3** `npm run build` and `npm test` green; test count grows for non-trivial logic.

## Future (out of scope v1 — do not block Phase 23)

- [x] **T9.1** Single-file zip archive container sharing the same `ProjectBundleManifest` (streamed zip writer/reader; no full-archive memory buffer).
- [x] **T9.2** Caption sidecar bundling when caption tracks ship in a later phase.
- [x] **T9.3** Decode proxy bundling when a formal proxy pipeline exists.
