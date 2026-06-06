# Requirements: Phase 18 — Media Conformance + Adapter Boundary

## R1 — Worker-Owned Media Adapter Boundary

- **R1.1** Introduce a `MediaAdapter` boundary in `src/engine/media-adapters/` that owns source inspection, opening, and adapter-specific diagnostics inside the pipeline worker.
- **R1.2** `MediabunnyAdapter` remains the default and primary adapter for import, decode, encode, and mux; Phase 18 must not replace Mediabunny or route normal playback/export through another demuxer.
- **R1.3** The SolidJS UI receives only serialized descriptors, conformance summaries, and health warnings; no `File`, Mediabunny `Input`, sample sink, `VideoFrame`, `AudioData`, WebGPU handle, or adapter object crosses into `src/ui/`.
- **R1.4** Adapter inspection uses lazy file access (`BlobSource` for Mediabunny and equivalent range/lazy reads for future adapters); it must not buffer entire user files in memory.
- **R1.5** No server, external API, telemetry, cloud storage, or paid media compute is introduced for conformance, diagnostics, preview, or export.

**Acceptance criteria:** importing existing MP4/MOV/WebM/image/audio files still goes through Mediabunny by default; UI protocol payloads remain structured-clone-safe; a static code search shows no media adapter or media object import from `src/ui/`.

## R2 — Source Inspection and Conformance Metadata

- **R2.1** Define `SourceInspection` as the adapter-neutral, worker-owned inspection result for file/container identity, track list, codecs, timing, duration, rotation, color hints, audio sample rate, channel count, and per-track decodability.
- **R2.2** Define `SourceConformance` as the normalized, editor-facing interpretation of an inspection: selected primary audio/video tracks, source kind, usable duration, `NormalizedSourceTiming`, decoder support, and health status.
- **R2.3** Define `SourceHealthWarning` as a structured warning with `code`, `severity`, `blocking`, `sourceId`, optional `trackId`, user-facing `message`, and diagnostic `details` containing no raw media bytes.
- **R2.4** Define `NormalizedSourceTiming` so the editor records a normalized content timeline and enough per-track offsets to request adapter timestamps correctly.
- **R2.5** Source descriptors and media asset snapshots include the new timing, rotation, color, codec, decodability, and health summary fields needed for relink, restore, and UI reporting.

**Acceptance criteria:** the new types encode timing/rotation/audio metadata without `any`; old project documents deserialize; new project documents persist enough conformance metadata to reject mismatched relink candidates.

## R3 — Shared Source Timestamp Normalization

- **R3.1** All timeline source seconds are normalized content seconds: clip `inPoint` is measured from normalized source zero, not from an adapter's raw first packet timestamp.
- **R3.2** Implement one shared `resolveSourceTimestamp()` function that maps `(clip, timelineTime, trackKind, NormalizedSourceTiming)` to an adapter timestamp, availability state, and optional gap/fill reason.
- **R3.3** Preview decode, thumbnail decode where source timestamps are used, audio mixing, and export must call the same timestamp normalization helper; no preview-only or export-only timestamp math is allowed.
- **R3.4** Non-zero track starts and audio/video offsets are represented explicitly instead of being silently clamped to zero.
- **R3.5** Range export and trim bounds use the same normalized duration/source-bound rules as playback.

**Acceptance criteria:** unit tests prove that a source with non-zero video/audio starts previews and exports the same source samples for the same timeline time; source timing code has one implementation path.

## R4 — Real-World Media Health Reporting

- **R4.1** Detect and report variable frame rate, non-zero track starts, audio/video offset, rotation metadata, mixed audio sample rates, unsupported video/audio codecs, corrupt or truncated files, missing duration, and undecodable tracks.
- **R4.2** Warnings are specific. The UI must not collapse distinct issues behind a generic "unsupported media" error.
- **R4.3** Non-blocking warnings do not crash import or prevent usable assets from entering the media bin; blocking errors apply only to the affected stream/source.
- **R4.4** A file with no decodable usable stream produces a blocking health report and a recoverable import failure state, not a blank app or worker crash.
- **R4.5** Mixed audio sample rates are detected at import/conformance time and revalidated at export plan time so unsupported resampling never silently corrupts output.

**Acceptance criteria:** each listed issue has a stable warning code and test coverage; importing one problematic file does not prevent other files in the batch from importing.

## R5 — Protocol and UI Serialization

- **R5.1** Add a `SourceHealthReport`/`import-health` protocol path, or equivalent media-asset payload extension, that serializes warnings from worker to UI.
- **R5.2** Health reports appear in the media bin and relevant import/relink flows with persistent visible text; use `role="alert"` only for blocking user action.
- **R5.3** Health warning details are bounded and human-readable: codec names, track ids, offsets, sample rates, rotation degrees, and recommended next action where available.
- **R5.4** Re-link mismatch messages include timing/rotation/conformance reasons when those fields fail to match.

**Acceptance criteria:** UI can render multiple warnings per source; warnings survive autosave/restore where they derive from persisted inspection data; relink mismatch is actionable.

## R6 — Experimental Diagnostic Adapters

- **R6.1** Define the extension point for a future `WebDemuxerAdapter` or MP4Box-backed diagnostic adapter behind an explicit feature flag.
- **R6.2** Experimental diagnostic adapters may inspect and compare metadata, but they must not feed playback, preview, audio, export, thumbnails, or frame cache in Phase 18.
- **R6.3** Feature-flagged diagnostics must be disabled by default and absent from the accelerated hot path unless benchmarked and promoted by a later spec.

**Acceptance criteria:** enabling the flag can add diagnostic warnings only; disabling it produces the same playback/export path and adapter choice as the current Mediabunny-only build.

## R7 — Fixture Matrix and Regression Coverage

- **R7.1** Add a documented fixture matrix for MP4, MOV, WebM, VFR screen recording, rotated phone footage, mixed sample rates, audio-only, still images, long 4K media, and corrupt/truncated files.
- **R7.2** Unit-test normalized timestamp mapping, warning generation, descriptor matching with timing/rotation fields, and import health serialization.
- **R7.3** Integration-test import → trim → preview → export on a small fixture subset that can run in the existing client-side toolchain.
- **R7.4** Add explicit regressions for non-zero track start and mixed sample-rate export behavior.

**Acceptance criteria:** `npm test` covers the pure logic and fixture descriptors; manual/fixture integration instructions are reproducible without server-side media processing.
