# Design: Bugfix — Video with unsupported codec blocks audio playback

This document maps each bug in `bugfix.md` to the concrete change and the
invariant the change protects. All edits stay within one file; no new worker,
message type, or rendering pass is introduced.

## D1 — Remove `canDecode` guard on frame source creation (B1)

`src/engine/media-adapters/mediabunny-adapter.ts`

The condition at line 554 changes from:

```ts
if (primaryVideo && primaryVideoInspection?.canDecode) {
```

to:

```ts
if (primaryVideo) {
```

The `canDecode` flag is still computed during inspection (line 139) and stored
on the `SourceVideoTrackInspection` record (line 160). It is still used by the
source-health warning system (`source-health.ts`) to emit an
`unsupported-video-codec` warning. But it no longer gates frame source creation.

Why this is safe:

- `tryCreateWebCodecsVideoSource()` (lines 387–401) already calls
  `VideoDecoder.isConfigSupported()` and returns `null` gracefully if the codec
  is unsupported. No exception propagates.
- `VideoSampleSink` constructor (the fallback) just stores the track reference;
  it does not attempt to decode at construction time.
- `SequentialFrameSource` constructor stores the sink and the min frame
  duration; it does not iterate samples at construction time.
- If the fallback decoder also fails to decode the codec, the error surfaces
  during playback iteration — which is already handled by the playback error
  reporting system (the "Playback error: ..." status line).

The `primaryVideoInspection?.` optional chaining on `frameRateMode` (line 558)
handles the case where `primaryVideoInspection` is null (which can't happen in
practice since `primaryVideo` existing implies the inspection succeeded, but
the optional chaining is defensive).

## D2 — No change needed in worker.ts (B2)

With D1 applied, `frameSource` is always created for video tracks (the
Mediabunny fallback constructs a `SequentialFrameSource` unconditionally when
`primaryVideo` exists). The guard at `worker.ts:709`

```ts
if (handle.kind !== 'audio' && !handle.frameSource) return tl;
```

is now unreachable for video files. It remains a safety net for hypothetical
edge cases where `primaryVideo` is null (which shouldn't happen for video
files).

For truly undecodable codecs (e.g. HEVC on browsers without HEVC support),
`frameSource` is non-null (the `VideoSampleSink` → `SequentialFrameSource`
fallback is always constructed), but decode will fail at playback time. The
playback error surfaces in the status bar. This is acceptable because the
source-health warning already tells the user the codec is unsupported.

## D3 — Conformance post-processing (B1)

`src/engine/media-adapters/mediabunny-adapter.ts`

After frame source creation, the `unsupported-video-codec` warnings are
post-processed to be non-blocking when `frameSource` was successfully created.
The conformance health is recomputed from the updated warnings:

```ts
const warnings = frameSource
    ? initialWarnings.map((w) =>
            w.code === 'unsupported-video-codec' ? { ...w, blocking: false } : w
        )
    : initialWarnings;
const conformance: SourceConformance = frameSource
    ? {
            ...initialConformance,
            health: warnings.some((w) => w.blocking)
                ? 'blocked'
                : warnings.length > 0
                    ? 'warnings'
                    : 'ok'
        }
    : initialConformance;
```

Why post-process instead of changing `deriveConformance`: the `inspect` path
(line 502) does not create a frame source, so it cannot know whether the
fallback will succeed. The `open` path (line 531) creates the frame source
first, then adjusts the warnings. This keeps the `inspect` path honest (it
reports the warning as blocking since it doesn't know about the fallback) while
the `open` path (which actually imports the file) correctly marks it as
non-blocking.

## D4 — Source-health warning preserved

`src/engine/media-adapters/source-health.ts`

No changes. The `unsupported-video-codec` warning is still emitted when
`track.canDecode` is false (line 83). After the D3 post-processing, the
warning's `blocking` flag is `false` when a frame source was created, so
`conformance.health` is `'warnings'` (not `'blocked'`). The user sees the
warning in the Media Bin but the clip is still usable.

## D4 — Tests

Existing tests cover:
- `canDecode` flag on inspection records
- Source-health warning emission for unsupported codecs
- Frame source creation with WebCodecs and Mediabunny fallback

No new tests are needed for this one-line change because:
- The existing `frame-source.test.ts` tests cover `SequentialFrameSource`
  creation with `VideoSampleSink`.
- The existing `source-health.test.ts` tests cover the warning emission.
- The fix is a guard removal, not a new code path.
