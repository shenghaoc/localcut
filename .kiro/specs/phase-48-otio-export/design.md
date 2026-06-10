# Design: Phase 48 — OpenTimelineIO Export

> Status: **Planned** — TypeScript ProjectDoc → `.otio` serialiser with P23 fingerprints in metadata, plus a cuts-only CMX3600 EDL; `project.otio` lands in the bundle root next to the authoritative `project.json`.

## Goal

Let a LocalCut timeline travel to other NLEs. OpenTimelineIO's serialized form is a documented JSON schema, so the serialiser is plain TypeScript over the existing `ProjectDoc` — no Python, no WASM, no native bindings. The structural skeleton (tracks, gaps, clips, markers, transitions) uses standard OTIO schemas that Kdenlive, DaVinci Resolve, and `otioconvert` understand; everything LocalCut-specific rides along under a `metadata.localcut` namespace that foreign tools ignore and a future OTIO *import* phase can restore. A cuts-only CMX3600 EDL falls out of the same time model nearly for free.

## Non-goals

- **OTIO import** — a follow-up phase; this phase only guarantees the exported metadata is sufficient for it.
- **AAF or FCPXML in-browser** — documented via the `otioconvert` path instead (R10.2).
- **Translating effects, LUTs, keyframes, transforms, or caption styling into other applications' native equivalents** — they round-trip through `metadata.localcut` only.
- **Audio events or dissolves in the EDL** — the EDL is a cuts-only, single-video-track freebie.
- **Embedding media bytes in the `.otio`** — references only; the P23 bundle already handles media transport.
- **A general-purpose OTIO library** — the serialiser emits exactly the allowlisted schemas LocalCut needs, nothing more.

## OTIO output shape

Top-level structure (abridged):

```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "My Project",
  "global_start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": 30, "value": 0 },
  "metadata": { "localcut": { "projectId": "…", "projectSchemaVersion": 10, "appVersion": "…",
                              "masterGain": 1, "captionTracks": [ … ] } },
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "markers": [ { "OTIO_SCHEMA": "Marker.2", "name": "Scene 2", "color": "PURPLE",
                   "marked_range": { … }, "metadata": { "localcut": { "markerId": "…" } } } ],
    "children": [
      { "OTIO_SCHEMA": "Track.1", "kind": "Video",
        "metadata": { "localcut": { "trackId": "…", "gain": 1, "pan": 0, "muted": false, … } },
        "children": [
          { "OTIO_SCHEMA": "Gap.1", "source_range": { … } },
          { "OTIO_SCHEMA": "Clip.2", "name": "beach.mp4",
            "source_range": { "OTIO_SCHEMA": "TimeRange.1",
              "start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": 30, "value": 45 },
              "duration":   { "OTIO_SCHEMA": "RationalTime.1", "rate": 30, "value": 120 } },
            "media_references": {
              "DEFAULT_MEDIA": {
                "OTIO_SCHEMA": "ExternalReference.1",
                "target_url": "media/3fb2a1c09d8e4f10_beach.mp4",
                "available_range": { … },
                "metadata": { "localcut": {
                  "sourceId": "…", "mimeType": "video/mp4",
                  "fingerprint": { "algorithm": "sha-256", "digest": "…" } } } } },
            "active_media_reference_key": "DEFAULT_MEDIA",
            "metadata": { "localcut": { "clipId": "…", "effects": { … }, "transform": { … },
                                        "keyframes": { … }, "lut": { "key": "…", "fileName": "…" },
                                        "audioFadeIn": 0, "audioFadeOut": 0 } } },
          { "OTIO_SCHEMA": "Transition.1", "transition_type": "SMPTE_Dissolve",
            "in_offset": { … }, "out_offset": { … },
            "metadata": { "localcut": { "transition": { "id": "…", "kind": "cross-dissolve", "params": {} } } } }
        ] }
    ]
  }
}
```

Schema allowlist: `Timeline.1`, `Stack.1`, `Track.1`, `Clip.2`, `Gap.1`, `Transition.1`, `Marker.2`, `ExternalReference.1`, `GeneratorReference.1`, `MissingReference.1`, `RationalTime.1`, `TimeRange.1`. `Clip.2` (media-references map + active key) is what OpenTimelineIO ≥ 0.15 writes and what Kdenlive 25.04+ and current Resolve consume; readers built on pre-0.15 OTIO are out of scope.

## Time model

LocalCut times are float seconds; OTIO consumers expect frame-aligned `RationalTime`. One module owns the conversion:

```typescript
// src/engine/interchange/time.ts
interchangeRate(doc: ProjectDoc): number
  // exportSettings.fps when finite > 0, else the most common source video
  // frameRate, else 30. Fractional rates (23.976, 29.97) are kept exact for OTIO.

snapToFrames(timeS: number, rate: number): number   // Math.round(timeS * rate)

formatTimecode(frames: number, fps: number): string // HH:MM:SS:FF, non-drop
```

**Adjacency invariant:** every timeline boundary (clip starts/ends, marker times, transition cut points) is snapped *independently*, and item durations are derived as `endFrames − startFrames`. Two clips adjacent in seconds therefore stay adjacent in frames — rounding can shift a cut by at most half a frame but can never open a gap or create an overlap. Clips that collapse to zero frames are dropped and reported (R2.4); transitions left without an adjacent pair are likewise dropped (R5.4).

Determinism: the serialiser is a pure function of `ProjectDoc` (plus an options record). It reads `doc.savedAt` for any timestamp, generates no IDs, and emits via `JSON.stringify(value, null, 2)` over objects built in fixed key order — golden fixtures compare byte-for-byte.

## Mapping table

| LocalCut | OTIO | Notes |
|----------|------|-------|
| `ProjectDoc` | `Timeline.1` | name = display name; `global_start_time` 0 at sequence rate |
| `TimelineTrack` | `Track.1` kind `Video`/`Audio` | emitted so OTIO's bottom-first stack order preserves LocalCut compositing; mix state in `metadata.localcut` |
| empty space | `Gap.1` | from the Phase 10 gap model; durations frame-derived |
| `TimelineClip` (source) | `Clip.2` + `ExternalReference.1` | `source_range` from `inPoint`/`duration`; `available_range` from descriptor duration |
| `TimelineClip` (title) | `Clip.2` + `GeneratorReference.1` | `generator_kind: "localcut.title"`; `TitleContent` in `metadata.localcut.title` |
| source missing at export | `Clip.2` + `MissingReference.1` | original file name + `sourceId` preserved |
| `TimelineMarker` | `Marker.2` on the `Stack` | zero-duration `marked_range`; color `PURPLE` |
| `TimelineTransition` | `Transition.1` between the two clips | `in_offset = out_offset = durationS/2` snapped; `cross-dissolve` → `SMPTE_Dissolve`, others → `Custom_Transition` |
| effects / transform / keyframes / LUT ref / fades | `Clip.metadata.localcut` | LUT by `key` + `fileName` only — never texture data |
| caption tracks + styling | `Timeline.metadata.localcut.captionTracks` | no portable OTIO caption schema; not emitted as tracks |
| `MediaFingerprint` (P23) | `ExternalReference.metadata.localcut.fingerprint` | content identity for future re-linking |

## EDL (CMX3600, cuts-only)

A flat text emitter sharing `time.ts`. One video track per list (CMX3600 is structurally single-track): default is the first video track containing clips; the UI offers a picker. Example:

```
TITLE: MY PROJECT
FCM: NON-DROP FRAME
001  BEACH001 V     C        00:00:01:15 00:00:05:15 01:00:00:00 01:00:04:00
* FROM CLIP NAME: beach.mp4
002  AX       V     C        00:00:00:00 00:00:03:00 01:00:04:00 01:00:07:00
* FROM CLIP NAME: Title: Opening
```

- Record TC starts at `01:00:00:00` (broadcast convention); gaps advance record TC without an event.
- Frame rate is `Math.round(sequenceRate)` non-drop; fractional rates add a `* LOCALCUT: RATE 29.97 ROUNDED TO 30 NDF` comment (R9.3).
- Reel names: uppercase alphanumeric from the file-name stem, padded/truncated to 8 chars, deduplicated with numeric suffixes assigned in first-appearance order (deterministic). Titles use reel `AX`.
- Transitions on the exported track become straight cuts at the cut point; each omission (transitions, other tracks, audio) is returned as a warning, not silently dropped.

## P23 bundle integration

`exportProjectBundle` gains one step after writing `project.json`: serialise the same `doc` with bundle-relative `target_url`s and write `PROJECT_OTIO_PATH = 'project.otio'` to the bundle root. The serialiser receives a `resolveTargetUrl(sourceId): string` hook; bundle export supplies fingerprint-derived `media/…` paths (from the just-built asset table), standalone export supplies original file names.

- `project.json` stays authoritative; `project.otio` is derived and **never read back** by bundle import (R7.4).
- Serialisation/write failure → `addIntegrityItem(report, integrityItem('ok' → no; use a warning item))` — concretely: a `warning`-severity integrity item with a message naming `project.otio`, and bundle export still succeeds (R7.3).
- The file is a root-level sibling of `project.json`, not an entry in the asset table; `BUNDLE_SCHEMA_VERSION` stays 1 (optional additive file).

## Protocol sketch

OTIO/EDL text is small (KBs — proportional to clip count, never media size), so it crosses the worker boundary as a string:

```
UI → Worker:  { type: 'export-interchange'; format: 'otio' | 'edl'; trackId?: string }
Worker → UI:  { type: 'interchange-result'; format; suggestedName: string;
                text: string; warnings: string[] }
Worker → UI:  { type: 'interchange-error'; format; message: string }
```

The UI saves via `showSaveFilePicker` with the download-blob fallback already used by export. Generation is synchronous string building over the in-memory model — negligible work, but it lives in the worker anyway because that is where the authoritative model lives (no model snapshot needs to cross to main).

## Modules

| Module | Work |
|--------|------|
| `src/engine/interchange/time.ts` (new) | `interchangeRate`, `snapToFrames`, boundary-derived durations, `formatTimecode` |
| `src/engine/interchange/otio.ts` (new) | OTIO node types (plain interfaces), `serializeTimelineToOtio(doc, options)` returning `{ text, warnings }` |
| `src/engine/interchange/otio-validate.ts` (new) | `validateOtioDocument(json)` structural validator (schema allowlist + required fields + non-negative times) — used by tests and CI fixtures |
| `src/engine/interchange/edl.ts` (new) | `serializeTimelineToEdl(doc, options)` returning `{ text, warnings }`; strict CMX3600 line grammar shared with its test validator |
| `src/engine/project-bundle/paths.ts` | add `PROJECT_OTIO_PATH = 'project.otio'` |
| `src/engine/project-bundle/export.ts` | write `project.otio` after `project.json`; warning-severity integrity item on failure |
| `src/protocol.ts` | `export-interchange` command; `interchange-result` / `interchange-error` state messages |
| `src/engine/worker.ts` | handle `export-interchange`; build options from the live model + display name |
| `src/ui/` (export/project menu) | "Export Timeline (.otio)" / "Export EDL (.edl)" actions; track picker for EDL; warnings display; save with fallback |
| `docs/USER-GUIDE.md` | "Timeline Interchange (OTIO / EDL)" section + `otioconvert` path for AAF/FCPXML |
| `docs/VERIFY_INTERCHANGE.md` (new) | manual Kdenlive/Resolve/EDL verification checklist |
| `test-fixtures/interchange/` (new) | golden `.otio` / `.edl` fixtures (small JSON/text, fine for CI) |
| `scripts/validate-otio-fixtures.py` (new) + `.github/workflows/ci.yml` | CI-only reference validation of goldens with Python `opentimelineio` |

## Third-party libraries

**None at runtime.** The OTIO serialized form is documented JSON; hand-rolling the emitter keeps the bundle free of a dependency that has no maintained, first-party JavaScript implementation (the OTIO project's official bindings are Python/C++ — exactly what this phase avoids shipping).

CI-only: the Python `opentimelineio` package (Academy Software Foundation; actively developed, organisational backing per AGENTS.md criteria) is installed in the CI job to parse the golden fixtures with the reference implementation. It is never shipped, never required locally (`npm test` covers everything except this extra CI check), and touches only checked-in fixtures.

## Testing strategy

- **Unit (Vitest, in-memory builders):** time model (R11.1), structure mapping incl. drop/omission paths (R11.2), `metadata.localcut` completeness, EDL reel naming + timecode math. No media fixtures — interchange never reads media bytes.
- **Golden fixtures:** 2–3 small `ProjectDoc`s built in TS (multi-track with gaps + transition + markers + title; missing-source; single-track EDL case) serialised and compared byte-for-byte against checked-in goldens (R11.3). Since output is deterministic, golden equality + golden validation (next two bullets) validates serialiser output transitively.
- **Structural validation:** `validateOtioDocument` over every golden and every test-generated document (R11.4); CMX3600 line-grammar validator over EDL goldens (R11.6).
- **CI reference check:** `pip install opentimelineio` + `scripts/validate-otio-fixtures.py` parses each golden with the real library (R11.5).
- **Bundle integration:** memory-sink bundle export asserts `project.otio` exists with `media/…` target URLs; injected serialiser failure → warning item + successful bundle (R11.7).
- **No Playwright** (R11.8): the only UI surface is a menu action that saves a string through already-exercised file-save code; cross-application correctness is inherently manual (`docs/VERIFY_INTERCHANGE.md`).

## Validation (manual)

Per `docs/VERIFY_INTERCHANGE.md`:

1. Build the documented fixture project (two video tracks, one audio track, a gap, a cross-dissolve, three markers, one title clip).
2. Export a P23 bundle with embedded media; confirm `project.otio` sits at the bundle root and references `media/…` paths.
3. Open the `.otio` in **Kdenlive 25.04+**: track and clip counts match; every cut frame-exact at the sequence rate; markers at correct frames; dissolve centred on its cut.
4. Open the same `.otio` in **DaVinci Resolve** (File → Import → Timeline): same checks; missing-media relink prompts show original file names.
5. Run `otioconvert -i project.otio -o project.xml` (FCPXML) to confirm the documented AAF/FCPXML path works on the fixture.
6. Export the `.edl`; confirm the CMX3600 grammar test passes on it and it imports into a CMX3600-aware tool with correct record timecodes from `01:00:00:00`.
7. Re-export the unchanged project twice; confirm byte-identical `.otio` output.
