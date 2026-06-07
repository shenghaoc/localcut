# Design: Bugfix — IMG_6213.mov media handling

This document maps each bug in `bugfix.md` to the concrete change and the
invariant the change protects. All edits stay within existing modules; no new
worker, message type, or rendering pass is introduced.

## D1 — Rotation metadata on clip placement (B1)

`src/engine/worker.ts`

`placeAsset()` looks up the inspection record for the **primary** decoded video
track (matching `handle.conformance.primaryVideoTrackId`) and reads its
`rotationDeg`. The first `defaultTimelineClip(...)` call for the video clip
sets `transform: normalizeTransform({ rotation: sourceRotation })`. All other
transform fields default to `DEFAULT_TRANSFORM` via `normalizeTransform`.

Why match the primary track and not the first video track: a container with an
auxiliary or preview video stream first can decode the *non-first* stream as the
primary one; rotation metadata from the wrong stream would put a clip sideways
again.

Audio-only clips and stills are unaffected (stills carry `rotationDeg = 0`).

## D2 — Rotation-aware fit rect (B2)

`src/engine/transform.ts`

`packTransformUniform()` swaps `sourceWidth`/`sourceHeight` before passing them
to `computeFitRect` when the rotation is an odd quarter-turn:

```ts
const quarterTurns = t.rotation / 90;
const nearestQuarter = Math.round(quarterTurns);
const isQuarterTurn = Math.abs(quarterTurns - nearestQuarter) < 1e-3;
const swap = isQuarterTurn && ((nearestQuarter % 2) + 2) % 2 === 1;
const fitSourceWidth = swap ? sourceHeight : sourceWidth;
const fitSourceHeight = swap ? sourceWidth : sourceHeight;
const rect = computeFitRect(fitSourceWidth, fitSourceHeight, outputWidth, outputHeight, t.fit);
```

Behaviour summary:

| `t.rotation` | Swap? | Reason |
|---|---|---|
| 0°, ±180°, ±360° | No | Bounding box unchanged. |
| ±90°, ±270° | Yes | Bounding box is the transposed rectangle. |
| Non-orthogonal (e.g. 45°) | No | The existing "fit before rotate" semantic is preserved; the user picked a non-orthogonal angle. |

The fit rect now matches what the rotated layer actually occupies for orthogonal
rotations, so a portrait 2160×3840 frame in a landscape 3840×2160 output with
rotation 90° fills exactly (rect `(1, 1)`) instead of being scaled 3.16× and
cropped to a narrow centre strip. 180° rotations and arbitrary user-set rotations
produce bit-identical output to before.

The matrix/translation/anchor packing below the fit rect is unchanged.

## D3 — VFR frame cadence (B3)

`src/engine/media-adapters/mediabunny-adapter.ts`

`SequentialFrameSource` is constructed with a rate-mode-aware floor:

```ts
const minFrameDuration =
  primaryVideoInspection.frameRateMode === 'variable'
    ? 1e-4
    : frameRate > 0 ? 1 / frameRate : 0;
frameSource = new SequentialFrameSource(sink, minFrameDuration);
```

`SequentialFrameSource.endOf(sample)` returns
`sample.timestamp + max(sample.duration, minFrameDuration)`. For CFR, `1/fps`
guards against zero-duration packets; for VFR, the `1e-4` floor lets each
sample's actual reported duration drive the iterator so a 16 ms frame in a
30/60 fps mix is not held for a 33 ms window.

Still sources continue to construct their own provider (`StillFrameSource`) and
are not affected.

## D4 — Unsupported-codec warning text (B4)

`src/engine/media-adapters/source-health.ts`

The two codec warnings (`unsupported-video-codec`, `unsupported-audio-codec`)
unconditionally include the codec string, falling back to `unknown codec` when
the container reports null:

```ts
`${trackLabel(track)} uses an unsupported audio codec (${track.codec ?? 'unknown codec'}).`
```

The `details.codec` payload is unchanged (still the raw `string | null`).

## D5 — Media Bin details popover (B5)

`src/ui/MediaBin.tsx`

- A new `MetaInfoPopover` SolidJS component renders an ⓘ trigger and a Kobalte
  `Popover` (the same primitive used by `ExportDialog`/`BundleDialog`).
- The popover body has three sections: filename, a label/value grid of resolution,
  frame rate (with VFR badge), rotation, video/audio codecs, channel layout +
  sample rate, duration, file size, MIME type; the full health warning list
  coloured by severity (`is-info` / `is-warning` / `is-error`); the proxy
  recommendation when present.
- `media-bin-health-item span` no longer applies `white-space: nowrap` /
  `text-overflow: ellipsis`, so the inline warnings wrap.

`src/global.css`

New `.media-info-popover` block reuses the `.panel` token, sets a
`min(280px, calc(100vw - 2rem))` width, a grid label/value layout, and
severity-coloured borders.

`docs/USER-GUIDE.md`

A **Media Details** section under *Importing Media* describes the three bin
buttons (ⓘ / + / 🗑) and a **Source Health Warnings** subsection enumerates the
common warnings (VFR, rotation, A/V offset, unsupported codec) and what the
engine does about each.

## D6 — Tests (B6)

- `src/engine/media-adapters/source-health.test.ts` — IMG_6213.mov scenario
  warning sequence; `(unknown codec)` fallback for null-codec tracks.
- `src/engine/media-adapters/source-timing.test.ts` — negative audio
  `firstTimestampS` keeps `normalizedStartS = 0`, `avOffsetS = -0.044`, and
  both tracks resolve as available at normalized time 0.
- `src/engine/proxy-jobs.test.ts` — 4K + VFR triggers the
  *"Recommended for large resolution, variable frame rate."* string.
- `src/engine/frame-source.test.ts` — VFR advances short-duration frames when
  `minFrameDuration` is `1e-4`; CFR holds short-duration frames for the nominal
  interval at `1/fps`.
- `src/engine/transform.test.ts` — `packTransformUniform` swaps source dims at
  90°/270°, leaves 0°/180°/45° unchanged.

No tests are removed.
