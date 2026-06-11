# Bugfix — Video with unsupported codec blocks audio playback on Linux

> Status: **Active**. Bugfix spec for the playback issue where an MP4 with an
> H.264 codec string not recognized by `VideoDecoder.isConfigSupported()` (e.g.
> `avc1.64000d` on Linux Chromium) causes the entire clip — including its
> decodable audio track — to be rejected from the timeline. Tracks the work on
> `fix/video-decode-fallback` (PR #82).

## Summary

On Linux Chromium, `VideoDecoder.isConfigSupported()` rejects certain H.264
profile/level combinations that the browser can actually decode (e.g.
`avc1.64000d` — H.264 High@L1.3). The codebase uses this check to gate
frame source creation: when `canDecode` is false, the entire video frame source
creation block is skipped, `frameSource` stays null, and `placeAsset()` rejects
the clip. Since the clip has `kind: 'video'` (because a video track exists),
the audio track is also rejected — no audio reaches the timeline.

Architecture is preserved:

- SolidJS UI on the main thread; the pipeline worker owns media I/O, the
  timeline, playback, WebGPU, and export.
- Mediabunny remains the primary media adapter; no Mediabunny replacement.
- No CPU pixel round-trip on the accelerated preview/export hot path.
- No server-side media processing.

## Bugs

### B1 — `canDecode` guard prevents Mediabunny fallback from running

`mediabunny-adapter.ts` line 554 gates frame source creation on
`primaryVideoInspection?.canDecode`. When `canDecode` is false (because
`VideoDecoder.isConfigSupported()` rejected the exact codec string), the entire
block is skipped. The fallback path at lines 571–574 (which creates a
`VideoSampleSink` → `SequentialFrameSource`) is inside this guard and never
executes.

The Mediabunny `VideoSampleSink` uses its own internal decoder (backed by
ffmpeg) and may succeed where WebCodecs fails. But the guard prevents it from
being tried.

**Expected:** Frame source creation is always attempted for video tracks. The
WebCodecs path is tried first (when enabled), and the Mediabunny fallback is
tried if WebCodecs fails. The `canDecode` flag is still stored on the inspection
record for source-health warnings, but it does not gate frame source creation.

### B2 — Audio blocked when video frame source is null

`worker.ts` line 709 rejects clips where `handle.kind !== 'audio' &&
!handle.frameSource`. When a video file has both video and audio tracks but the
video can't decode, `kind` is `'video'` (because `primaryVideo` exists) and
`frameSource` is null. The entire clip — including the decodable audio — is
rejected.

**Expected:** When the fix for B1 is applied, `frameSource` is always created
for video tracks (the Mediabunny fallback handles the decode). The guard at
line 709 becomes a safety net for truly undecodable video (e.g. HEVC on
browsers without HEVC support), and in that case the audio should still be
placed.

## Non-goals

- No AI of any kind.
- No new product features beyond fixing the fallback.
- No Mediabunny replacement; no server media processing.
- No change to the accelerated `VideoFrame → importExternalTexture → compute
  chain → queue.submit` pipeline.
- Not fixing `VideoDecoder.isConfigSupported()` browser behavior (this is a
  browser-level decision).
- Not adding codec string normalization/parsing (too complex, too fragile).

## Acceptance criteria

- An MP4 with `avc1.64000d` (H.264 High@L1.3) imported on Linux Chromium
  places both video and audio on the timeline and plays back.
- The source-health warning for unsupported video codec is still emitted when
  `canDecode` is false (the warning is informational, not blocking).
- Audio-only files continue to work as before.
- Files with truly unsupported codecs (e.g. HEVC) still produce a blocking
  warning and are rejected from the timeline.
- `vp build` passes (strict TypeScript).
- `vp test run` passes (test count does not decrease).
