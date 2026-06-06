# Tasks: Phase 18 — Media Conformance + Adapter Boundary

> Status: **Implemented in PR**. Adapter boundary, conformance metadata, shared timing, health UI, diagnostics scaffold, and fixture documentation are implemented. Manual fixture smoke remains pending.

## Adapter foundation

- [x] **T1.1** Add `src/engine/media-adapters/types.ts` defining `MediaAdapterId`, `MediaAdapter`, `MediaAdapterOpenInput`, `MediaAdapterInspectionResult`, `PrimaryMediaAdapterOpenResult`, `SourceInspection`, `SourceConformance`, `SourceHealthWarning`, `SourceHealthReport`, and `NormalizedSourceTiming`.
  - Acceptance: exported types are strict, readonly where practical, and contain no `any`.
- [x] **T1.2** Add `src/engine/media-adapters/mediabunny-adapter.ts` by moving the current Mediabunny open/inspect logic behind `MediabunnyAdapter`.
  - Acceptance: `BlobSource` lazy reads remain; still image handling still serves one decoded frame; existing playback/export tests continue to use Mediabunny handles.
- [x] **T1.3** Add `src/engine/media-adapters/registry.ts` with Mediabunny as the only default primary adapter.
  - Acceptance: adapter selection is deterministic and testable; no diagnostic adapter participates unless explicitly feature-flagged.
- [x] **T1.4** Keep `src/engine/media-io.ts` as the stable facade for existing worker callers while delegating to the registry.
  - Acceptance: current imports of `openMediaFile` and `MediaInputHandle` do not need broad rewrites.

## Inspection and descriptor evolution

- [x] **T2.1** Populate `SourceInspection` from Mediabunny for container, duration, track count, video codec, display/coded size where available, frame-rate stats, decodability, audio codec, sample rate, channels, and per-track start/duration.
  - Acceptance: unsupported or missing fields are represented as `null`/`unknown`, not guessed.
- [x] **T2.2** Derive `SourceConformance` from inspection: selected primary tracks, source kind, usable duration, timing model, and health state.
  - Acceptance: a file with decodable audio but undecodable video becomes an audio asset instead of an unplayable video clip.
- [x] **T2.3** Extend `MediaInputHandle` with `adapterId`, `inspection`, `conformance`, `timing`, and `warnings` while preserving existing convenience fields.
  - Acceptance: playback/export code still receives `frameSource`, `audioSource`, `duration`, `displayWidth`, `displayHeight`, and `frameRate`.
- [x] **T2.4** Extend `SourceDescriptorSnapshot` and `MediaAssetSnapshot` with serialized conformance fields: timing summary, rotation, color hints, codec/decodability, and health summary.
  - Acceptance: old project documents deserialize with conservative defaults; new descriptors contain enough metadata for relink validation.
- [x] **T2.5** Update descriptor matching for relink to include timing/rotation fields with tolerances where appropriate.
  - Acceptance: tests reject a same-name/same-size file with materially different track starts, duration, rotation, or primary audio parameters.

## Shared timing normalization

- [x] **T3.1** Add `src/engine/media-adapters/source-timing.ts` with `resolveSourceTimestamp()` and source-bound helpers.
  - Acceptance: the helper returns normalized source time, adapter timestamp, availability, and fill reason.
- [x] **T3.2** Update preview frame decode to call the shared timing helper before requesting frames from `frameSource`.
  - Acceptance: non-zero track starts are not manually clamped in worker playback code.
- [x] **T3.3** Update export video and audio paths to call the same timing helper used by preview.
  - Acceptance: no export-only timestamp mapping remains; range export still re-bases output timestamps to zero.
- [x] **T3.4** Update thumbnail source-time sampling only where it maps clip/timeline time to source time.
  - Acceptance: media-bin thumbnails that sample raw source seconds continue to work, and clip filmstrips use the same normalized source semantics as playback.
- [x] **T3.5** Unit-test timestamp mapping for zero-start media, non-zero video start, non-zero audio start, A/V offset, VFR timing, trim in/out, and out-of-range gaps.
  - Acceptance: preview/export mapping expectations are asserted from the same helper.

## Health reports and UI serialization

- [x] **T4.1** Add `src/engine/media-adapters/source-health.ts` to generate stable `SourceHealthWarning` codes for VFR, non-zero track starts, A/V offset, rotation metadata, mixed sample rates, unsupported codecs, corrupt/truncated files, missing duration, and undecodable tracks.
  - Acceptance: each required issue has a specific code and unit coverage.
- [x] **T4.2** Add worker protocol support for source health reports, either by extending media asset snapshots or by sending dedicated `source-health`/`import-health` messages.
  - Acceptance: reports are structured-clone-safe, bounded, and contain no raw file data.
- [x] **T4.3** Surface source health in the media bin/import and relink flows.
  - Acceptance: multiple warnings render per source; blocking warnings are announced with `role="alert"` only when they block user action.
- [x] **T4.4** Keep batch import resilient when one file is corrupt or blocked.
  - Acceptance: usable files import; blocked files produce actionable health reports and do not crash the worker or blank the app.
- [x] **T4.5** Revalidate mixed audio sample rates during export planning using conformance metadata.
  - Acceptance: export fails early with a specific message when resampling would be required but unsupported.

## Experimental diagnostics scaffold

- [x] **T5.1** Add a disabled-by-default feature flag for experimental media diagnostics.
  - Acceptance: with the flag off, build output and runtime adapter selection behave like Mediabunny-only.
- [x] **T5.2** Define the future `WebDemuxerAdapter`/MP4Box diagnostic shape without wiring it into playback/export.
  - Acceptance: any scaffold is role `'diagnostic'` and cannot return the primary `MediaInputHandle`.
- [x] **T5.3** Add tests that prove diagnostic adapters cannot be selected as primary adapters.
  - Acceptance: registry tests fail if a diagnostic adapter can feed playback/export while still marked experimental.

## Fixture matrix and tests

- [x] **T6.1** Add a fixture matrix document covering MP4, MOV, WebM, VFR screen recording, rotated phone footage, mixed sample rates, audio-only, still image, long 4K media, and corrupt/truncated files.
  - Acceptance: each fixture row states purpose, expected warnings, whether the file is checked in or generated, and the command/source for reproduction.
- [x] **T6.2** Add unit tests for warning generation from mocked `SourceInspection` values.
  - Acceptance: tests cover every required warning code and at least one non-blocking plus one blocking report.
- [x] **T6.3** Add unit tests for descriptor serialization/matching with timing, rotation, codec, sample-rate, and channel-count fields.
  - Acceptance: relink tests include both backward-compatible old descriptors and new conformance-aware descriptors.
- [x] **T6.4** Add integration tests or documented smoke fixtures for import → trim → preview → export on a small MP4/WebM/audio-only/still subset.
  - Acceptance: the test path stays client-side and does not require server media compute.
- [x] **T6.5** Add explicit regressions for non-zero track start and mixed sample-rate export behavior.
  - Acceptance: one regression proves timestamp normalization; one regression proves export blocks or warns before unsupported resampling.

## Verification

- [x] **T7.1** Run `npm run build`.
  - Acceptance: strict TypeScript build passes.
- [x] **T7.2** Run `npm test`.
  - Acceptance: Vitest passes and test count increases for the new pure logic.
- [ ] **T7.3** Manual smoke: import a normal MP4, a rotated phone clip, an audio-only file, and a corrupt/truncated file.
  - Acceptance: usable sources appear in the media bin with accurate warnings; corrupt media reports a blocking issue without crashing the shell.
- [ ] **T7.4** Manual parity: trim a non-zero-start fixture, preview the trimmed segment, export it, and compare visible/audio timing.
  - Acceptance: preview and export resolve the same source timestamps through the shared helper.
