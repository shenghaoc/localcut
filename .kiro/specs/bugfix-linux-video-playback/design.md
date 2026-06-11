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
Mediabunny fallback succeeds for all codecs that ffmpeg can decode, which
includes `avc1.64000d`). The guard at `worker.ts:709`

```ts
if (handle.kind !== 'audio' && !handle.frameSource) return tl;
```

becomes a safety net for truly undecodable video (e.g. HEVC on browsers without
HEVC support). In that case, `frameSource` is null, the clip is rejected, and
the source-health warning already tells the user why. This is the correct
behavior — HEVC video genuinely can't be displayed, and placing an audio-only
clip from a video file would be confusing.

For the `avc1.64000d` case that motivated this bugfix, the Mediabunny fallback
creates a `SequentialFrameSource` successfully, `frameSource` is non-null,
`kind` is `'video'`, and the clip is placed on the timeline with both video and
audio.

## D3 — Source-health warning preserved

`src/engine/media-adapters/source-health.ts`

No changes. The `unsupported-video-codec` warning is still emitted when
`track.canDecode` is false (line 83). The warning is `blocking: false` when
there's a fallback frame source (the conformance health is not `'blocked'`
because `frameSource` is non-null). The user sees the warning in the Media Bin
but the clip is still usable.

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
