# Tasks: Phase 27 — WebCodecs decode bridge + codec support matrix

> Status: **Foundation implemented; integration pending.** Decoders and the codec
> matrix are built and probe-tested on `claude/beautiful-johnson-1kjhvv` (PR #54).
> Worker wiring, Phase 13 dual-stream consumption, and the diagnostics surface
> remain open (T4, T5.2, T6.2).

## T1 — WebCodecs video decoder (R1, R2, R3)

- [x] **T1.1** `WebCodecsVideoDecoder implements SequentialVideoSource` in
  `src/engine/webcodecs-decoder.ts`, configured from `track.getDecoderConfig()`
  with an optional `hardwareAcceleration` preference layered on.
- [x] **T1.2** Feed via `EncodedPacketSink` + `packet.toEncodedVideoChunk()`; bound
  the loop by both `decodeQueueSize` and the `pendingFrames` backlog against
  `maxQueueDepth`.
- [x] **T1.3** Keep `pendingFrames` timestamp-sorted; honour `endTimestamp`; flush
  exactly once via a `flushed` flag; rethrow decoder errors.
- [x] **T1.4** Seek to the nearest key packet with `getKeyPacket(startTimestamp)`.
- [x] **T1.5** Wrap frames in `WebCodecsVideoSample` (µs → seconds; single
  `close()`); close all queued frames in `finally`.

## T2 — WebCodecs audio decoder (R1, R2, R3)

- [x] **T2.1** `WebCodecsAudioDecoder` (`AudioSampleStream`) configured from
  `track.getDecoderConfig()`; feed via `packet.toEncodedAudioChunk()`.
- [x] **T2.2** Same backpressure bound (`pending` backlog), single flush, key-packet
  seek, and `endTimestamp` handling as the video decoder.
- [x] **T2.3** `WebCodecsAudioSample implements AudioSampleLike` converting
  µs → seconds for `timestamp` / `duration` and exposing `allocationSize` /
  `copyTo` / `close`.

## T3 — Codec support matrix (R4)

- [x] **T3.1** `src/engine/codec-support.ts`: `probeAllCodecs()` over a
  representative video + audio codec set, classifying `webcodecs-native` /
  `webcodecs-software` / `unsupported` with a `hardwarePreferred` flag.
- [x] **T3.2** `canDemuxContainer()` and `getFormatCompatibility()` summary;
  graceful degradation when WebCodecs is absent or throws.
- [x] **T3.3** `probeWebCodecsDecodeSupport` / `probeWebCodecsAudioDecodeSupport`
  helpers.

## T4 — Worker integration (R5) — pending

- [ ] **T4.1** Select `WebCodecsVideoDecoder` in the worker decode path behind a
  capability/feature decision; keep the Mediabunny sink as the default and do not
  regress the accelerated path.
- [ ] **T4.2** Provide two concurrent decoders for Phase 13 transition readahead
  (two clips, possibly one source) — the dual-stream primitive Phase 13 consumes.
- [ ] **T4.3** Surface `getFormatCompatibility()` in the capability/diagnostics UI.

## T5 — Tests (R6)

- [x] **T5.1** `webcodecs-decoder.test.ts` + `codec-support.test.ts`: probes for
  supported / unsupported / throwing / absent WebCodecs globals.
- [ ] **T5.2** Decode-loop tests with mocked `VideoDecoder` / `AudioDecoder`:
  frame ordering, backpressure bound (decode queue + backlog), key-packet seek, and
  `close()`-exactly-once with spy frames.
- [x] **T5.3** `npm run build` green; `npm test` green; test count grows.

## T6 — Manual verification — pending

- [ ] **T6.1** Decode a long H.264 MP4 via the bridge and seek to 60 s — decode
  starts from the nearest key packet, not zero; no hang.
- [ ] **T6.2** Decode an `hvc1`/AAC MP4 — `getDecoderConfig()` extradata makes the
  first `decode()` succeed where a hand-built config would fail.
- [ ] **T6.3** Diagnostics panel lists each probed codec with its strategy and
  hardware-preferred flag.
