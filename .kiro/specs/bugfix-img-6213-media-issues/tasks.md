# Tasks: Bugfix — IMG_6213.mov media handling

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in
> `design.md`. Tracks the work on `claude/img-6213-media-issues-1YIFu` (PR #49).

## T1 — Rotation metadata on placement (B1)

- [x] **T1.1** In `worker.ts:placeAsset`, look up the inspection record matching
  `handle.conformance.primaryVideoTrackId` (not just the first video track) and
  extract `rotationDeg`.
- [x] **T1.2** Pass `transform: normalizeTransform({ rotation: sourceRotation })`
  on the video-clip `defaultTimelineClip(...)` call.
- [x] **T1.3** Leave audio-only and still-image placements unchanged.

## T2 — Rotation-aware fit rect (B2)

- [x] **T2.1** In `transform.ts:packTransformUniform`, swap `sourceWidth`/
  `sourceHeight` before calling `computeFitRect` when `t.rotation` is an odd
  quarter-turn (within `1e-3` of ±90° / ±270°).
- [x] **T2.2** Add `transform.test.ts` cases covering 90°/270° swap, 180°
  non-swap (matches 0°), and 45° non-swap (matches 0°).
- [x] **T2.3** In `compatibility/canvas-compositor.ts:drawTransformedImage`,
  apply the same `swap` logic — compute the fit rect on the rotated source
  aspect, then size `drawWidth`/`drawHeight` (and the letterbox card) against
  the swapped output dims so the rotated layer fills the canvas exactly.
- [x] **T2.4** Add `compatibility.test.ts` cases covering the rotated portrait
  → landscape draw and the 0°/180°/45° non-swap regression.

## T3 — VFR frame cadence (B3)

- [x] **T3.1** In `mediabunny-adapter.ts`, construct `SequentialFrameSource`
  with `minFrameDuration = 1e-4` when
  `primaryVideoInspection.frameRateMode === 'variable'`, otherwise the existing
  `1 / frameRate` floor.
- [x] **T3.2** Add `frame-source.test.ts` cases for VFR (`1e-4` floor advances
  short frames at actual duration) and CFR (`1/fps` floor holds short frames
  for the nominal interval).

## T4 — Unsupported-codec warning text (B4)

- [x] **T4.1** In `source-health.ts`, change the
  `unsupported-video-codec` / `unsupported-audio-codec` message templates to
  always include the codec, falling back to `unknown codec`.
- [x] **T4.2** Add a `source-health.test.ts` case asserting both messages
  include `(unknown codec)` when `track.codec === null`.

## T5 — Media Bin details popover (B5)

- [x] **T5.0** In `worker.ts:sourceDescriptorFromHandle`, look up the inspection
  record matching `handle.conformance.primaryVideoTrackId` (with a first-video
  fallback) so the metadata snapshot's `rotationDeg`, `codec`, and `color` come
  from the same track that `placeAsset` rotates.
- [x] **T5.1** Add a `MetaInfoPopover` component in `MediaBin.tsx` using the
  existing `@kobalte/core/popover` primitive; trigger is an ⓘ button placed
  before the existing `+` and `🗑` actions.
- [x] **T5.2** Render metadata in a label/value grid: resolution, frame rate
  (with `(variable)` badge), rotation, video codec, audio (channels · kHz ·
  codec), duration, file size, MIME type.
- [x] **T5.3** Render the full health-warning list, coloured by severity, and
  the proxy recommendation when present.
- [x] **T5.4** In `global.css`, add `.media-info-*` styles and remove
  `white-space: nowrap` / `text-overflow: ellipsis` from
  `.media-bin-health-item span` so inline warnings wrap.
- [x] **T5.5** In `docs/USER-GUIDE.md`, add **Media Details** and **Source Health
  Warnings** subsections under *Importing Media* documenting the buttons and
  what each warning means.

## T6 — Coverage and gate (B6)

- [x] **T6.1** IMG_6213.mov scenario test in `source-health.test.ts`.
- [x] **T6.2** Negative-audio-start test in `source-timing.test.ts`.
- [x] **T6.3** 4K-VFR proxy recommendation test in `proxy-jobs.test.ts`.
- [x] **T6.4** Null-codec fallback test in `source-health.test.ts`.
- [x] **T6.5** VFR/CFR `minFrameDuration` tests in `frame-source.test.ts`.
- [x] **T6.6** Rotation-aware fit rect test in `transform.test.ts`.
- [x] **T6.7** Canvas2D rotated-fit tests in `compatibility.test.ts`.
- [x] **T6.8** `npm run build` green; `npm test` green; test count grows
  (638 → 648 on this branch).

## T7 — Manual verification

- [ ] **T7.1** Import a portrait-mode phone MOV — clip lands upright on the
  timeline without manual adjustment; preview and export match.
- [ ] **T7.2** Import a VFR clip — scrubbing reveals each frame; nothing is
  held for a nominal-interval window past its actual duration.
- [ ] **T7.3** Import a file with an unidentified codec (or trigger via the
  test fixture path) — every unsupported-codec warning names the codec or says
  `(unknown codec)`.
- [ ] **T7.4** Click ⓘ on a bin entry — popover lists every metadata field and
  the full warning text. The corresponding help-panel section is reachable from
  the in-app Help.
