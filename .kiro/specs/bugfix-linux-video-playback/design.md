# Design: Bugfix — Video with unsupported codec blocks audio playback

This document maps each bug in `bugfix.md` to the concrete change and the
invariant the change protects. All edits stay within one file; no new worker,
message type, or rendering pass is introduced.

## D1 — Remove `canDecode` guard + normalize codec strings (B1)

`src/engine/media-adapters/mediabunny-adapter.ts`

The condition at line 554 changes from `if (primaryVideo && primaryVideoInspection?.canDecode)` to `if (primaryVideo)`.

Additionally, `normalizeVideoCodecString()` maps H.264 codec strings with
unsupported level suffixes to a known-supported level (L4.0 = 0x28). This is
needed because `VideoDecoder.isConfigSupported()` does exact string matching —
`avc1.64000d` (High@L1.3) is rejected while `avc1.640028` (High@L4.0) passes.

The normalization is applied in three places:
1. `tryCreateWebCodecsVideoSource()` — before `isConfigSupported`
2. `WebCodecsVideoDecoder.samples()` — before `decoder.configure()`
3. Monkey-patched `canDecode`/`getDecoderConfig` on the track — so Mediabunny's `VideoSampleSink` also works

The monkey-patch is necessary because `VideoSampleSink._createDecoder()` calls
`track.canDecode()` (which uses the original codec string) and
`track.getDecoderConfig()` (which returns the original codec string). By
overriding these methods on the track instance, the normalized codec string
flows through to the WebCodecs `VideoDecoder.configure()` call.

Additionally, `isConfigSupported` is retried without `hardwareAcceleration`
when the first attempt fails, since environments without hardware codec support
(like headless Linux) reject `prefer-hardware` even when software decode works.

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

## D5 — Tests

`src/engine/webcodecs-decoder.test.ts` — unit tests for `normalizeH264CodecString`:
- Non-H.264 passthrough, invalid hex passthrough, unrecognized profile passthrough
- Known-level passthrough, unknown-level normalization to L4.0
- Baseline/Main/High profile coverage, case insensitivity

Existing tests cover:
- `canDecode` flag on inspection records
- Source-health warning emission for unsupported codecs
- Frame source creation with WebCodecs and Mediabunny fallback
