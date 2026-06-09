# Requirements: Phase 27 — WebCodecs decode bridge + codec support matrix

## R1 — Direct decode complements Mediabunny

- **R1.1** Demuxing stays on Mediabunny (`EncodedPacketSink`); the bridge only
  drives `VideoDecoder` / `AudioDecoder` directly. No container parsing is
  reimplemented.
- **R1.2** `WebCodecsVideoDecoder` satisfies the `SequentialVideoSource` contract
  and `WebCodecsAudioDecoder` the `AudioSampleStream` contract, so either can stand
  in for the Mediabunny-sink-backed source without changing consumers.
- **R1.3** Decoder configuration comes from Mediabunny's `track.getDecoderConfig()`
  so out-of-band codec `description` bytes are present; a hardware-acceleration
  preference may be layered on but never drops the extradata.

## R2 — Bounded, leak-free decode

- **R2.1** In-flight frames are bounded by **both** the decode queue depth and the
  decoded-but-unyielded backlog; a slow consumer cannot grow memory without bound.
- **R2.2** Every decoded `VideoFrame` / `AudioData` is closed exactly once across
  normal completion, `endTimestamp` break, early return, and error paths.
- **R2.3** `decoder.flush()` is called at most once after packet exhaustion.
- **R2.4** Decoded sample timestamps and durations are exposed in **seconds** to
  match `VideoSampleLike` / `AudioSampleLike` consumers (WebCodecs reports
  microseconds).

## R3 — Seeking

- **R3.1** When a start timestamp is given, iteration begins at the nearest key
  packet (`getKeyPacket`) rather than the start of the track.
- **R3.2** The same start/`endTimestamp` handling applies to the audio decoder.

## R4 — Codec support matrix

- **R4.1** Probe a representative set of video and audio codecs via
  `isConfigSupported`, classifying each as `webcodecs-native`,
  `webcodecs-software`, or `unsupported`, with a `hardwarePreferred` flag that
  reflects a *preference* probe (not a guarantee of hardware use).
- **R4.2** Report Mediabunny container demux coverage and a compatibility summary
  suitable for a diagnostics surface.
- **R4.3** All probes degrade gracefully (return `unsupported`) when the WebCodecs
  APIs are absent or throw.

## R5 — Integration (pending)

- **R5.1** Wire `WebCodecsVideoDecoder` into the worker decode path behind a
  capability/feature decision without regressing the Mediabunny default.
- **R5.2** Provide two concurrent decoders for the Phase 13 transition readahead
  (two clips, possibly one source).
- **R5.3** Surface the codec matrix in the capability/diagnostics UI.

## R6 — Tests

- **R6.1** Capability probes covered for supported / unsupported / throwing /
  absent WebCodecs globals.
- **R6.2** (Pending) decode-loop tests: frame ordering, backpressure bound,
  key-packet seek, and close-exactly-once with spy frames.
- **R6.3** `npm run build` and `npm test` green; test count grows.
