# Bugfix — Phone-recorded MOV media handling (IMG_6213.mov scenario)

> Status: **Active**. Bugfix spec for media-import correctness issues exposed by a
> phone-recorded MOV (variable frame rate, 90° rotation metadata, audio starting
> 44 ms before video, a secondary audio track using an unsupported codec). Tracks
> the changes landing on `claude/img-6213-media-issues-1YIFu` (PR #49).

## Summary

LocalCut Studio inspects imports and surfaces source-health warnings, but several of
those warnings were purely informational — the engine warned the user that
something was unusual without doing the obvious correct thing about it. This spec
collects the bugs the IMG_6213.mov scenario exposed, the minimum fixes, and the
documentation update required by the review policy. Architecture is preserved:

- SolidJS UI on the main thread; the pipeline worker owns media I/O, the timeline,
  playback, WebGPU, and export.
- Mediabunny remains the primary media adapter; no Mediabunny replacement.
- No CPU pixel round-trip on the accelerated preview/export hot path.
- No server-side media processing.

## Bugs

### B1 — Rotation metadata is warned about but never applied

`mediabunny-adapter.ts` extracts `track.getRotation()` and stores it on the source
inspection; `source-health.ts` raises an informational `rotation-metadata` warning.
Nothing actually rotates the frame. Portrait-mode phone clips (90°/270° metadata)
appear sideways on the timeline and in the exported file. The transform pipeline
already supports per-clip rotation, but `placeAsset()` never reads `rotationDeg`.

**Expected:** Placing a clip onto the timeline applies the source's rotation
metadata as the clip's initial `transform.rotation` (looked up against the
**primary** video track inspection, not just the first video track — Mediabunny
may select a non-first track as primary). The Inspector still allows manual
override. The default-zero path stays bit-identical to the pre-fix output.

### B2 — Rotation + `fit:fill` crops the frame

Once `transform.rotation` is 90° or 270°, `packTransformUniform()` still computes
the fit rect from the un-swapped source dimensions. For a 2160×3840 portrait
source displayed in a 3840×2160 landscape output, the layer ends up scaled to
~3.16× output height **then** rotated, putting the long axis horizontal and
cropping all but a narrow centre strip. This is broken for any 90°/270° rotation,
not just rotation metadata.

**Expected:** `packTransformUniform()` swaps the source dimensions before
computing the fit rect when the clip rotation is an odd quarter-turn
(90°/270°/-90°/-270°, with a small floating-point tolerance). 180° and 0° must be
unchanged (the bounding box of those rotations equals the source rectangle).
Arbitrary rotations (e.g. 45°) must also be unchanged — the existing "fit before
rotate" semantic is the best we can do without a more invasive renderer change,
and the user explicitly picked a non-orthogonal angle.

### B3 — VFR frames are skipped during playback

`SequentialFrameSource` is constructed with `minFrameDuration = 1 / sourceFps`
for every source. For a VFR clip (e.g. a 30/60 fps mix), every short frame is
held for the full nominal interval (33 ms), making the next short frame invisible
until the playhead has advanced past the long interval.

**Expected:** The Mediabunny adapter passes `minFrameDuration = 1e-4 s` (a guard
against true zero-duration frames only) when the inspected track reports
`frameRateMode === 'variable'`, so each VFR frame advances at its Mediabunny-
reported actual duration. CFR sources keep the `1/fps` floor.

### B4 — Unsupported-codec warnings silently omit the codec

`source-health.ts` appended the codec string only when the container reported a
non-null codec. For containers that do not advertise one (or that Mediabunny
reports as null), the warning collapsed to "audio track audio-2 uses an
unsupported audio codec." — useless for diagnosing what failed.

**Expected:** The codec string is always present, falling back to
`(unknown codec)` when null. Example output:
`audio track audio-2 uses an unsupported audio codec (ac-3).`
`video track video-1 uses an unsupported video codec (unknown codec).`

### B5 — Bin entry truncates every interesting piece of metadata

The Media Bin row uses `white-space: nowrap` + `text-overflow: ellipsis` on the
subtitle row **and** each health warning, collapsing all the details to a single
truncated line. The only way to read the full text was the browser's native
`title` tooltip — undocumented and slow-to-trigger. No surface existed to read
the codec, resolution, rotation, frame-rate mode, or full warning text without
hovering.

**Expected:** The bin row has an explicit info (ⓘ) button that opens a popover
listing every relevant metadata field and every warning at full length. The
inline warning list also wraps instead of truncating so users notice there is
more to read. The Media Details popover is documented in
`docs/USER-GUIDE.md` (single source of truth for the in-app Help panel).

### B6 — Build & test hard gate

`npm run build` and `npm test` must remain green. Tests must cover:

- Source-health warning sequence for the IMG_6213.mov scenario
  (`variable-frame-rate`, `rotation-metadata`, `non-zero-track-start`,
  `unsupported-audio-codec`, `audio-video-offset`) and the `(unknown codec)`
  fallback for null codec strings.
- `buildNormalizedSourceTiming` correctly handles a negative audio
  `firstTimestampS` without rebasing `normalizedStartS` below zero.
- `proxyStatusForAsset` produces the expected "Recommended for large resolution,
  variable frame rate." string for a 4K VFR source under the high-bitrate
  threshold.
- `SequentialFrameSource` advances at the sample's actual duration when
  `minFrameDuration` is near zero (VFR), and holds for the nominal interval
  otherwise (CFR).
- `packTransformUniform` swaps source dimensions for 90°/270° but not for 0°,
  180°, or arbitrary non-orthogonal angles.

## Non-goals

- No AI of any kind.
- No new product features beyond surfacing existing inspection data.
- No Mediabunny replacement; no server media processing.
- No change to the accelerated `VideoFrame → importExternalTexture → compute
  chain → queue.submit` pipeline.
- Not addressing arbitrary-angle rotation fit semantics (only orthogonal
  rotations need to match the rotated aspect for this bugfix to be useful).
- Not auto-fallback to a secondary audio track when the primary is unsupported
  (still silently skipped, as before).

## Acceptance criteria

- A portrait-mode phone MOV imported and placed on the timeline appears upright
  in the preview and the exported file without manual Inspector adjustment.
- A 4K VFR clip plays back without skipping short-duration frames; scrubbing
  reveals each frame.
- Every `unsupported-*-codec` warning names the codec (or says
  `(unknown codec)`).
- Each bin row has an ⓘ button; clicking it opens a popover with the full file
  details and every warning at full length. The popover is documented in the
  user guide.
- `npm run build` and `npm test` pass with new coverage matching the cases above
  (test count grows; nothing existing is silently dropped).
