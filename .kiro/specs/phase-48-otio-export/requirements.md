# Requirements: Phase 48 — OpenTimelineIO Export

## R1 — OTIO Document Generation

- **R1.1** A pure TypeScript serialiser converts a `ProjectDoc` into an OpenTimelineIO `.otio` JSON document — no Python runtime, no WASM, no native bindings, no new runtime dependencies.
- **R1.2** Every emitted object carries a valid `OTIO_SCHEMA` tag from a fixed allowlist: `Timeline.1`, `Stack.1`, `Track.1`, `Clip.2`, `Gap.1`, `Transition.1`, `Marker.2`, `ExternalReference.1`, `GeneratorReference.1`, `MissingReference.1`, `RationalTime.1`, `TimeRange.1`.
- **R1.3** Serialisation is deterministic: the same `ProjectDoc` always produces byte-identical output. Timestamps come from `doc.savedAt`, never runtime wall-clock state; no random IDs are generated.
- **R1.4** All times are frame-snapped `RationalTime` values at a single sequence rate derived from the project (export settings fps, else the dominant source video frame rate, else 30). Boundaries are snapped independently and durations derived from snapped boundaries, so adjacent clips stay adjacent — rounding never introduces overlaps or gaps.
- **R1.5** Generation runs in the pipeline worker and produces a string; memory is bounded by the size of the timeline model, never by media size (no media bytes are read).

## R2 — Timeline Structure Mapping

- **R2.1** Each `TimelineTrack` maps to an OTIO `Track` with `kind: "Video"` or `kind: "Audio"`; tracks are emitted in an order that preserves LocalCut's compositing result under OTIO's bottom-first stack ordering.
- **R2.2** Empty space between clips (LocalCut's gap model, Phase 10) maps to explicit OTIO `Gap` items so record-side timing is preserved.
- **R2.3** Each `TimelineClip` maps to an OTIO `Clip` whose `source_range` is derived from `inPoint`/`duration` and whose name is the source file name (or title text for title clips).
- **R2.4** Clips whose duration snaps to zero frames at the sequence rate are dropped with a per-clip warning surfaced in the export result; the serialiser never emits zero- or negative-duration items.
- **R2.5** Title clips (Phase 14, source-less) map to OTIO `Clip`s with a `GeneratorReference` (`generator_kind: "localcut.title"`); foreign tools see a placeholder of the correct duration.

## R3 — Media References + Fingerprints

- **R3.1** Source-backed clips reference media via `ExternalReference`. When the export targets a P23 bundle, `target_url` is the bundle-relative POSIX path (`media/<digest-prefix>_<name>.<ext>`); for standalone exports it is the original file name.
- **R3.2** Each `ExternalReference.metadata.localcut` carries the P23 `MediaFingerprint` (`{ algorithm: 'sha-256', digest }`) when the source descriptor has one, plus `sourceId` and `mimeType`, so a future importer can re-link by content identity rather than path.
- **R3.3** Sources that were missing at export map to `MissingReference` with `metadata.localcut.sourceId` and the original file name preserved — the timeline structure still serialises completely.
- **R3.4** `available_range` is populated from the source descriptor duration at the sequence rate.

## R4 — Markers

- **R4.1** Timeline-global markers (Phase 10) map to OTIO `Marker.2` objects attached to the top-level `Stack`, with `name` from the marker label and a zero-duration `marked_range` at the frame-snapped marker time.
- **R4.2** Markers use a fixed color (`PURPLE`) and carry `metadata.localcut.markerId` for round-trip identity.

## R5 — Transitions

- **R5.1** Each `TimelineTransition` (Phase 13, cut-point centred) maps to an OTIO `Transition` placed at the cut between the corresponding clips. The total transition duration is snapped to frames first, then split as `in_offset = floor(totalFrames / 2)` and `out_offset = totalFrames − in_offset`, so the offsets always sum exactly to the snapped total (no frame gained or lost on odd totals).
- **R5.2** `cross-dissolve` maps to `transition_type: "SMPTE_Dissolve"`; `dip-to-black`, `wipe`, and `slide` map to `"Custom_Transition"`.
- **R5.3** Every transition carries `metadata.localcut.transition` with the exact LocalCut `kind` and `params` so LocalCut can restore the original transition on a future import.
- **R5.4** A transition whose clips were dropped (R2.4) or that no longer brackets an adjacent pair after snapping is omitted with a warning, never emitted in an invalid position.

## R6 — `metadata.localcut` Namespace

- **R6.1** Everything LocalCut-specific nests under a `localcut` key inside standard OTIO `metadata` dictionaries, so foreign tools ignore it and LocalCut can round-trip it later. Nothing LocalCut-specific appears outside `metadata.localcut`.
- **R6.2** Per-clip metadata carries effects, transform, keyframes, LUT reference (key + file name, not texture data), and audio fades.
- **R6.3** Per-track metadata carries gain, pan, muted, solo, locked, visible, syncLocked, and editTarget.
- **R6.4** Timeline-level metadata carries `projectId`, `projectSchemaVersion`, app version, master gain, and the full caption tracks payload (Phase 22) including styling — captions are not emitted as OTIO tracks (no portable schema exists).
- **R6.5** All metadata values are plain JSON (no class instances, no binary blobs); the GPU-side LUT payload is never embedded.

## R7 — P23 Bundle Integration

- **R7.1** Bundle export (Phase 23) writes `project.otio` into the bundle root alongside `project.json` and `manifest.json`. `project.json` remains the authoritative document; `project.otio` is a derived interchange artifact.
- **R7.2** `ExternalReference.target_url` values in the bundled `.otio` point at the bundle's `media/` paths for embedded sources, making the bundle directly openable in OTIO-aware tools.
- **R7.3** A failure to generate or write `project.otio` adds a warning to the bundle integrity report but does not fail bundle export.
- **R7.4** Bundle import ignores `project.otio` entirely (OTIO import is a follow-up phase); the bundle schema version is unchanged (the new file is optional and additive).

## R8 — Standalone Export Action

- **R8.1** A UI action exports the current timeline as a standalone `.otio` or `.edl` file: the worker generates the text and posts it to the UI, which saves via the File System Access API with a download-blob fallback (same pattern as existing exports).
- **R8.2** The suggested file name derives from the project display name, sanitised, with the correct extension.
- **R8.3** The export result surfaces any warnings (dropped clips, omitted transitions, missing sources, omitted tracks) in the UI; warnings never block the save.
- **R8.4** The action is gated only on having a non-empty timeline — it requires no extra browser capabilities and is available on every capability tier.

## R9 — CMX3600 EDL Export (Cuts-Only)

- **R9.1** EDL export emits a cuts-only CMX3600 list for one video track (default: the first video track with clips; the UI offers a track picker). Other tracks, audio events, and transitions are omitted; transitions on the exported track become straight cuts at the cut point, and each omission is reported as a warning.
- **R9.2** Output conforms to CMX3600: `TITLE:` header, `FCM: NON-DROP FRAME`, sequential 3-digit event numbers, `V` / `C` event lines with four `HH:MM:SS:FF` timecodes (source in/out, record in/out), and record timecode starting at `01:00:00:00`.
- **R9.3** Timecodes use a non-drop integer frame rate (`Math.round` of the sequence rate); when the sequence rate is fractional, the EDL notes the rounding in a comment line.
- **R9.4** Reel names are uppercase alphanumeric identifiers of at most 8 characters derived from the source file name, falling back to `REEL` when the file name yields no alphanumeric characters. Deduplication suffixes count toward the 8-character limit (the base is shortened to fit), assigned deterministically in first-appearance order. Full file names are preserved via `* FROM CLIP NAME:` comment lines; title clips export with reel `AX`.
- **R9.5** Gaps produce no events — record timecode simply advances.

## R10 — Documentation

- **R10.1** `docs/USER-GUIDE.md` gains a "Timeline Interchange (OTIO / EDL)" section: what exports, what foreign tools see, what is LocalCut-only metadata, and EDL limitations.
- **R10.2** The user guide documents the `otioconvert` path (from the Python `opentimelineio` package and its adapter plugins) for producing AAF and FCPXML from the exported `.otio` — these formats are deliberately not implemented in-browser.
- **R10.3** `docs/VERIFY_INTERCHANGE.md` provides a manual verification checklist: build the fixture project, export `.otio` and `.edl`, open the `.otio` in Kdenlive 25.04+ and DaVinci Resolve, and confirm track count, clip count, cut timing (frame-exact at the sequence rate), marker positions, and dissolve placement; run the `.edl` through a CMX3600-aware importer.

## R11 — Tests + CI

- **R11.1** Unit-test the time model: seconds→frame snapping, boundary-derived durations, adjacency preservation across rounding, and timecode formatting (including hour rollover and fractional-rate rounding).
- **R11.2** Unit-test structure mapping with in-memory `ProjectDoc` builders (no media fixtures): tracks/gaps/clips, title clips, missing sources, markers, transitions (including the omission cases of R2.4/R5.4), and `metadata.localcut` content.
- **R11.3** Golden-fixture tests: small checked-in `ProjectDoc` fixtures serialise to byte-identical checked-in `.otio` and `.edl` goldens under `test-fixtures/interchange/`.
- **R11.4** A structural OTIO validator (`validateOtioDocument`) walks generated documents and asserts every node's `OTIO_SCHEMA` is in the allowlist with its required fields present and times non-negative; it runs against all golden fixtures in `npm test`.
- **R11.5** CI additionally parses the checked-in `.otio` goldens with the reference Python `opentimelineio` package (CI-only dependency, never shipped) so schema validity is checked against the real implementation; combined with R11.3 this validates serialiser output end to end.
- **R11.6** A strict CMX3600 line-grammar validator runs against the EDL goldens in `npm test` (header, FCM, event lines, comment lines, timecode ranges).
- **R11.7** Unit-test bundle integration: bundle export writes `project.otio` with bundle-relative `target_url`s; an injected serialiser failure yields an integrity warning and a successful bundle; bundle import ignores the file.
- **R11.8** No Playwright: the export action is a save-a-string flow with no UI-critical interaction beyond existing, already-tested file-save paths; external-tool behaviour is covered by the R10.3 manual checklist.
- **R11.9** `npm run build` and `npm test` green; test count grows.
