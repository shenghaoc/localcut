# Tasks: Phase 27 — WebCodecs decode bridge + codec support matrix

> Status: **Worker integration complete.** Foundation shipped in PR #54
> (decoders + codec matrix). Worker wiring, DualStreamFrameSource, diagnostics
> surface, and decode-loop integration tests shipped in PR #58.

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
  `track.getDecoderConfig()`; accepts `WebCodecsDecoderConfig` with
  `maxQueueDepth`. `hardwareAcceleration` intentionally not forwarded (audio
  decoders are CPU-bound).
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
  graceful degradation when WebCodecs is absent or throws. Container list
  manually synced with Mediabunny (documented comment).
- [x] **T3.3** `probeWebCodecsDecodeSupport` / `probeWebCodecsAudioDecodeSupport`
  helpers.

## T4 — Worker integration (R5)

- [x] **T4.1** `tryCreateWebCodecsVideoSource` / `tryCreateWebCodecsAudioSource`
  in Mediabunny adapter with `typeof VideoDecoder === 'undefined'` guards +
  `isConfigSupported()` + try-catch fallback. Named constant
  `WEBCODECS_PREFERRED_WHEN_SUPPORTED` controls selection.
- [x] **T4.2** `DualStreamFrameSource` in `frame-source.ts`: two independent
  `VideoFrameProvider` streams with `frameAtA`/`frameAtB`, `reset()`, and
  `dispose()` for teardown.
- [x] **T4.3** `probeFormatCompatibilityUncached` surfaced in diagnostics panel
  via `<Show when={...}>` guard; `videoCodecs`/`audioCodecs` populated from
  single `probeAllCodecs()` call.

## T5 — Tests (R6)

- [x] **T5.1** `webcodecs-decoder.test.ts` + `codec-support.test.ts`: probes for
  supported / unsupported / throwing / absent WebCodecs globals.
- [x] **T5.2** `webcodecs-decoder-loop.test.ts`: integration tests with mocked
  globals + stubbed `EncodedPacketSink`. Covers: frame ordering, early-break
  finally-cleanup, endTimestamp range, key-packet seek (video + audio), and
  `close()`-exactly-once with spy frames. `getKeyPacketCalls` spy verifies
  seek timestamps.
- [x] **T5.3** `npm run build` green; `npm test` green; test count grows
  (729 tests on rebased branch).

## T6 — Manual verification

- [ ] **T6.1** Decode a long H.264 MP4 via the bridge and seek to 60 s — decode
  starts from the nearest key packet, not zero; no hang.
- [ ] **T6.2** Decode an `hvc1`/AAC MP4 — `getDecoderConfig()` extradata makes the
  first `decode()` succeed where a hand-built config would fail.
- [ ] **T6.3** Diagnostics panel lists each probed codec with its strategy and
  hardware-preferred flag.
