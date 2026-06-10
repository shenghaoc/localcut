# Design: Phase 27 — WebCodecs decode bridge + codec support matrix

> Status: **Complete.** Foundation shipped in PR #54 (decoders + codec matrix).
> Worker integration, DualStreamFrameSource, diagnostics surface, and
> decode-loop integration tests shipped in PR #58. Manual verification (T6)
> pending.

## Goal

Add a direct WebCodecs decode path that **complements** Mediabunny: keep
Mediabunny for demuxing (it owns container parsing for MP4/MOV/WebM/MP3/OGG/WAV),
but drive `VideoDecoder` / `AudioDecoder` ourselves for finer control than
`VideoSampleSink` / `AudioSampleSink` expose — explicit backpressure, key-packet
seeking, configurable hardware preference, and **multiple simultaneous decoders**
for the Phase 13 transition dual-stream readahead. Ship a codec support matrix so
the UI can report, per codec, whether decode is available and hardware-preferred.

## Why complement Mediabunny here

Mediabunny's sinks are excellent for single-stream sequential decode, but the
accelerated editor needs:

- **Bounded in-flight frames** under producer/consumer rate mismatch, counting
  both the decode queue and decoded-but-unyielded frames.
- **Concurrent decoders** over one input (two clips cut from one source during a
  transition) without sharing a single sequential iterator.
- **Seek to the nearest key packet** instead of decoding from zero on every
  forward seek / range export.

Demuxing stays on Mediabunny via `EncodedPacketSink`; we never reimplement
container parsing.

## Components

### `src/engine/webcodecs-decoder.ts`

`WebCodecsVideoDecoder implements SequentialVideoSource` and `WebCodecsAudioDecoder`
(an `AudioSampleStream`). Each:

- Reads the decoder configuration from Mediabunny's `track.getDecoderConfig()`,
  which carries the out-of-band codec `description` bytes (e.g. `avc1`/`hvc1`
  extradata, many AAC/FLAC configs) and Mediabunny's browser-specific decode
  workarounds. Rebuilding the config from codec + size alone would let
  `isConfigSupported` pass yet make the first `decode()` fail on common H.264 /
  HEVC / AAC sources. A `hardwareAcceleration` preference is applied on top unless
  it is `'no-preference'`.
- Pulls packets from `EncodedPacketSink.packets(startPacket, …)` and feeds them as
  `packet.toEncodedVideoChunk()` / `toEncodedAudioChunk()` (Mediabunny's helpers,
  preserving timestamps and side data).
- Wraps each decoded `VideoFrame` / `AudioData` in a small `…Sample` adapter that
  converts WebCodecs **microsecond** timestamps to the **seconds** the engine's
  `VideoSampleLike` / `AudioSampleLike` consumers expect, and owns exactly one
  `close()`.

### `src/engine/codec-support.ts`

`probeAllCodecs()` probes a representative set of video codecs (H.264 baseline/high,
VP9, VP8, AV1, HEVC main/main10) and audio codecs (AAC-LC, Opus, FLAC, Vorbis,
MP3) via `VideoDecoder` / `AudioDecoder` `isConfigSupported`, recording a
`DecodeStrategy` (`webcodecs-native` / `webcodecs-software` / `unsupported`) and a
`hardwarePreferred` flag. `canDemuxContainer()` reports Mediabunny's container
coverage; `getFormatCompatibility()` summarizes counts and demuxable containers for
a diagnostics surface.

## Decode loop + backpressure

A single async generator interleaves feeding and draining:

- **Feed** while `decoder.decodeQueueSize < maxQueueDepth` **and** the
  decoded-but-unyielded backlog (`pendingFrames` / `pending`) is below
  `maxQueueDepth`. Bounding both halves keeps total in-flight frames at
  `~2 × maxQueueDepth`, so a slow consumer cannot make the decoder buffer
  unbounded `VideoFrame`s and exhaust GPU/video memory.
- **Drain** the oldest frame (video frames are kept timestamp-sorted) and `yield`
  it; honour `endTimestamp` by closing and stopping.
- **Flush** exactly once via a `flushed` flag after packets are exhausted, never in
  a loop.
- A `decoderError` captured from the `error` callback is rethrown from the loop.

## Seeking

When `startTimestamp` is provided, the decoder resolves the nearest key packet with
`EncodedPacketSink.getKeyPacket(startTimestamp)` and begins iteration there, so a
forward seek or range export decodes from the right GOP boundary instead of from
zero. Frames before the requested start are still produced by the decoder (a key
packet may precede the target) and filtered by the consumer's timestamp logic.

## Resource lifetime

Every `VideoFrame` / `AudioData` is closed exactly once: yielded samples close in
their adapter's `close()`; the `finally` block closes anything still queued on
early return, error, or `endTimestamp` break, then closes the decoder and returns
the packet iterator.

## Relationship to Phase 13 (Transitions)

Phase 13 needs two clips — possibly cut from one source — decoding concurrently
inside a transition window (`requirements R2`). `WebCodecsVideoDecoder` provides an
independent decoder per instance, so two readahead streams can run without sharing
a sequential iterator. This phase delivers that decode primitive; Phase 13 consumes
it.

## Validation

- Unit-probe the capability functions with mocked `VideoDecoder` / `AudioDecoder`
  globals (supported / unsupported / throwing / absent).
- Integration: `webcodecs-decoder-loop.test.ts` — mocked globals + stubbed
  `EncodedPacketSink`; frame ordering, early-break cleanup, endTimestamp range,
  key-packet seek (video + audio), close-exactly-once with spy frames.
- A single `queue.submit` per frame is unaffected — this phase is decode only and
  feeds the existing accelerated chain.
