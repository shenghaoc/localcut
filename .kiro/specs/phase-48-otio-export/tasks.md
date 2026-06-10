# Tasks: Phase 48 — OpenTimelineIO Export

> Status: **Active**. Serialisers, validators, bundle integration, protocol/worker/UI, golden fixtures + CI reference validation, and docs landed. Manual external-app verification (T9.1/T9.2) pending.

## Time model

- [x] **T1.1** Create `src/engine/interchange/time.ts`: `interchangeRate(doc)` (export fps → dominant source video frame rate → 30), `snapToFrames(timeS, rate)`, boundary-derived duration helpers, and `formatTimecode(frames, fps)` (HH:MM:SS:FF non-drop, hour rollover).
- [x] **T1.2** Unit-test the adjacency invariant: clips adjacent in seconds remain adjacent after independent boundary snapping at 23.976/29.97/30/60; durations are never negative; zero-frame collapse is detected.
- [x] **T1.3** Unit-test `formatTimecode` (frame 0, sub-minute, hour rollover) and `interchangeRate` fallbacks (no export settings, no video sources).

## OTIO serialiser

- [x] **T2.1** Define plain-interface OTIO node types and the schema allowlist in `src/engine/interchange/otio.ts` (`Timeline.1`, `Stack.1`, `Track.1`, `Clip.2`, `Gap.1`, `Transition.1`, `Marker.2`, `ExternalReference.1`, `GeneratorReference.1`, `MissingReference.1`, `RationalTime.1`, `TimeRange.1`).
- [x] **T2.2** Implement `serializeTimelineToOtio(doc, options): { text, warnings }`: tracks in compositing-preserving stack order, `Gap` items from the gap model, `Clip.2` with `source_range`/`available_range` at the sequence rate; deterministic output (fixed key order, `doc.savedAt` only, no generated IDs, `JSON.stringify(value, null, 2)`).
- [x] **T2.3** Implement media references: `ExternalReference` with `resolveTargetUrl(sourceId)` hook (bundle-relative vs original file name), `metadata.localcut` fingerprint/sourceId/mimeType; `MissingReference` for sources missing at export; `GeneratorReference` (`generator_kind: "localcut.title"`) for title clips.
- [x] **T2.4** Implement markers on the top-level `Stack`: `Marker.2`, color `PURPLE`, zero-duration frame-snapped `marked_range`, `metadata.localcut.markerId`.
- [x] **T2.5** Implement transitions: cut-point placement, total duration snapped first then split `in_offset = floor(total/2)` / `out_offset = total − in_offset`, `SMPTE_Dissolve` vs `Custom_Transition` mapping, `metadata.localcut.transition` with exact kind + params; omit (with warning) transitions invalidated by dropped clips or snapping.
- [x] **T2.6** Implement zero-frame clip dropping with per-clip warnings; never emit zero/negative-duration items.
- [x] **T2.7** Populate `metadata.localcut`: per-clip effects/transform/keyframes/LUT-ref/fades, per-track mix state, timeline-level projectId/schema/app version/master gain/caption tracks; verify nothing LocalCut-specific leaks outside the namespace.
- [x] **T2.8** Unit-test structure mapping with in-memory `ProjectDoc` builders: multi-track + gaps, title clip, missing source, markers, all four transition kinds, drop/omission warnings, and full `metadata.localcut` round-trip content.
- [x] **T2.9** Unit-test determinism: serialising the same doc twice is byte-identical; serialising a doc with a different `savedAt` differs only where expected.

## Structural validation

- [x] **T3.1** Create `src/engine/interchange/otio-validate.ts`: `validateOtioDocument(json)` walks the tree, asserts every `OTIO_SCHEMA` is allowlisted, required fields per schema are present, and all `RationalTime`/`TimeRange` values are finite and non-negative.
- [x] **T3.2** Unit-test the validator accepts serialiser output and rejects corrupted documents (unknown schema tag, missing `source_range`, negative duration).

## EDL serialiser

- [x] **T4.1** Implement `serializeTimelineToEdl(doc, options): { text, warnings }` in `src/engine/interchange/edl.ts`: `TITLE:`/`FCM:` headers, sequential 3-digit events, `V`/`C` lines with source/record timecodes, record start `01:00:00:00`, gaps advancing record TC without events.
- [x] **T4.2** Implement reel naming (≤ 8-char uppercase alphanumeric including dedup suffixes, `REEL` fallback for non-alphanumeric stems, deterministic first-appearance dedup, `AX` for titles) and `* FROM CLIP NAME:` comments; fractional-rate rounding comment per R9.3.
- [x] **T4.3** Implement track selection (default first video track with clips; explicit `trackId` option) and warnings for omitted tracks/audio/transitions.
- [x] **T4.4** Write a strict CMX3600 line-grammar validator (test-side) and unit-test it against the emitter output plus malformed-line rejection.
- [x] **T4.5** Unit-test reel dedup collisions, timecode math at 24/30/60, title events, and the transitions-become-cuts behaviour.

## P23 bundle integration

- [x] **T5.1** Add `PROJECT_OTIO_PATH = 'project.otio'` to `src/engine/project-bundle/paths.ts`; in `exportProjectBundle`, after `project.json`, serialise with bundle-relative `target_url`s from the built asset table and write the file.
- [x] **T5.2** Wrap generation/write so failure adds a `warning`-severity integrity item naming `project.otio` and bundle export still succeeds; bundle import ignores the file; `BUNDLE_SCHEMA_VERSION` unchanged.
- [x] **T5.3** Unit-test via the memory sink: `project.otio` present with `media/…` target URLs matching the manifest; injected serialiser failure → warning + successful bundle; import path untouched by the file.

## Protocol + worker + UI

- [x] **T6.1** Add `export-interchange { format: 'otio' | 'edl'; trackId? }` command and `interchange-result { format, suggestedName, text, warnings }` / `interchange-error { format, message }` state messages to `src/protocol.ts`.
- [x] **T6.2** Handle `export-interchange` in `src/engine/worker.ts`: build serialiser options from the live model and display name; sanitised suggested file name with correct extension.
- [x] **T6.3** Add UI actions "Export Timeline (.otio)" and "Export EDL (.edl)": save via `showSaveFilePicker` with download-blob fallback (reuse existing save path), EDL track picker, non-blocking warnings display; available on every capability tier with a non-empty timeline.

## Golden fixtures + CI

- [x] **T7.1** Add fixture `ProjectDoc` builders and check in golden `.otio`/`.edl` files under `test-fixtures/interchange/` (multi-track + transition + markers + title; missing-source; EDL single-track case).
- [x] **T7.2** Golden tests: serialiser output byte-equals goldens; `validateOtioDocument` passes on every golden; CMX3600 grammar validator passes on EDL goldens.
- [x] **T7.3** Add `scripts/validate-otio-fixtures.py` (parse each golden with the reference `opentimelineio` package) and a CI step in `.github/workflows/ci.yml` (`setup-python`, `pip install opentimelineio`, run script). CI-only — `npm test` does not require Python.

## Documentation

- [x] **T8.1** Add "Timeline Interchange (OTIO / EDL)" to `docs/USER-GUIDE.md`: what exports, what foreign tools see vs `metadata.localcut`, EDL limitations (cuts-only, single track, rounded fractional rates).
- [x] **T8.2** Document the `otioconvert` path for AAF/FCPXML in the same section, with the explicit note that these are not implemented in-browser.
- [x] **T8.3** Create `docs/VERIFY_INTERCHANGE.md`: fixture-project recipe and the Kdenlive 25.04+ / DaVinci Resolve / `otioconvert` / EDL-import checklist from the design's Validation section.

## Verification

- [ ] **T9.1** Manual: run the full `docs/VERIFY_INTERCHANGE.md` checklist — Kdenlive cut timing frame-exact, Resolve import with relink prompts showing original names, dissolve placement, marker frames, EDL record TC.
- [ ] **T9.2** Manual: export the same unchanged project twice; `.otio` files byte-identical.
- [x] **T9.3** `npm run build` and `npm test` green (783 tests, +52); goldens parse cleanly with reference `opentimelineio` 0.18.1; test count grows.
