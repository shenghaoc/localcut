# Requirements: Phase 6 — Pipelined Export

## R1 — Pipeline

- **R1.1** Export walks the timeline: decode → effect chain → encode → mux, fully off-main-thread.
- **R1.2** Effects are baked from the **same** processed texture used by preview (chain not re-run).
- **R1.3** Output written via the File System Access API without buffering the whole file.

## R2 — Backpressure

- **R2.1** Bounded inter-stage queues (3–5 frames) between decode, effects, and encode.
- **R2.2** Before decoding the next frame, check `encoder.encodeQueueSize`; await drain above threshold.
- **R2.3** Memory stays flat while the encoder is saturated.

## R3 — Progress + ETA

- **R3.1** Low-frequency progress + ETA messages to the main thread.
- **R3.2** ETA derived from the Phase 2 throughput probe, adjusted for the chosen preset — not guessed.
- **R3.3** Clean cancel that tears down decode/encode/mux without leaking frames.

## R4 — Quality/speed toggle

- **R4.1** Export dialog exposes at least two presets: **Quality** (higher bitrate, slower preset) and **Fast** (lower bitrate, faster preset).
- **R4.2** Preset visibly affects export time and output bitrate.
- **R4.3** On sub-real-time hardware, the dialog states the plain estimate (e.g., "~12 min for 10 min of footage").

## R5 — Output correctness

- **R5.1** Output MP4 is valid in VLC, QuickTime, and the browser `<video>` element.
- **R5.2** Video + audio muxed in sync; all edits and effects baked in.

## R6 — Verification

- **R6.1** 10-min 1080p30 exports in < 5 min at Quality on hardware-encoder-capable machines; faster at Fast.
- **R6.2** Timestamp queries confirm the encoder is the bottleneck (decode/effects keep its queue fed).
- **R6.3** `npm run build` and `npm test` green.
