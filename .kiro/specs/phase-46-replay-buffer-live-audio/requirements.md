# Requirements: Phase 46 — Replay Buffer and Live Audio Chain

> Status: **Implemented (v1)** — live capture, GOP-aligned ring buffer with OPFS
> spill, instant clip drop, and gate/compressor/limiter on the recording path when
> Print to recording is enabled. The monitor AudioWorklet, processed monitoring,
> per-insert meters, and denoiser insert remain explicitly tracked follow-ups in
> tasks T6.2–T6.7; the v1 monitor output is unprocessed.

## R0 — Hard Constraints

- **R0.1** All capture, encoding, ring-buffer management, and live audio processing run on-device. No cloud capture, no server-side encoding, no upload of captured media.
- **R0.2** No sustained encode, buffer, or audio processing loops on the SolidJS main thread. The replay buffer encoder and live audio chain run in the pipeline worker and AudioWorklet respectively; the UI reads state over typed messages.
- **R0.3** Capture is browser-session-only (`getDisplayMedia` for a browser tab/window, or `getUserMedia` for camera/mic). OS-wide background capture (ShadowPlay-style) is out of scope.
- **R0.4** The existing import/play/edit/export pipeline must work unchanged when no capture session is active. Replay buffer code paths must not regress the non-capture editor.
- **R0.5** Ring-buffer memory is bounded by a user-configurable limit (default 30 s, max 300 s). The buffer must never grow unboundedly; eviction must be prompt and verifiable.
- **R0.6** `EncodedVideoChunk` and `EncodedAudioChunk` references must be released exactly once; no leaked chunks in eviction or save paths.
- **R0.7** OPFS is the only persistent storage for spilled chunks and saved clips. No IndexedDB storage of encoded media data.
- **R0.8** The Replay Buffer (capture, ring buffer, OPFS spill, save-to-timeline) works without `crossOriginIsolated`. The Live Audio Chain (SAB-based parameters, meters, and print-to-recording path) requires `crossOriginIsolated`; when isolation is absent, the replay buffer remains fully functional and only the live audio chain is disabled with a clear message.

## R1 — Live Media Capture

- **R1.1** Capture is initiated by explicit user action (a "Start Capture" button) that invokes `getDisplayMedia` or `getUserMedia` via a user-gesture-bound event. Capture never starts automatically.
- **R1.2** The user selects a display surface (tab, window, or screen) or camera/mic device via the browser-native picker. The resulting `MediaStream` is inspected for video and audio tracks; absence of either is surfaced in the UI but does not block capture of the other.
- **R1.3** `MediaStreamTrackProcessor` converts each `MediaStreamTrack` into a `ReadableStream` of `VideoFrame` / `AudioData` frames. These streams are transferred to the pipeline worker; no frame processing occurs on main.
- **R1.4** A muted monitor-attach helper exists for the capture `MediaStream`, but
  v1 does not mount the processed AudioWorklet monitor path. Adding audible,
  processed monitoring is the T6 follow-up and must not be claimed by the v1 UI.
- **R1.5** Capture session state (active/inactive, source label, video/audio track presence, resolution, frame rate, elapsed time) is surfaced over typed messages to the UI.
- **R1.6** Capture is stopped by user action or by the captured tab/surface being closed. Stop must: close all `MediaStreamTrack` instances, cancel the `ReadableStream` readers, flush any in-flight encoder work, and finalize the ring buffer without data loss for already-encoded chunks.
- **R1.7** If the `MediaStreamTrackProcessor` API is unavailable (non-Chromium browsers), the feature is disabled with a capability message; the rest of the editor is unaffected.

## R2 — GOP-Aligned Ring Buffer

- **R2.1** A ring buffer in the pipeline worker holds encoded video and audio chunks (`EncodedVideoChunk` / `EncodedAudioChunk`) with associated metadata: codec, timestamp, duration, byte size, and whether the video chunk is a keyframe.
- **R2.2** The buffer has a configurable duration limit (seconds, default 30, max 300, configurable via a setting persisted with the project). The combined wall-clock span of stored chunks must not exceed the configured duration plus one max GOP interval.
- **R2.3** Eviction is GOP-aligned: when the buffer exceeds its duration limit, chunks are dropped from the head (oldest) up to and including the next video sync sample (keyframe) boundary. Audio chunks within the evicted time range are also dropped. The invariant: the buffer always starts on a video keyframe.
- **R2.4** The ring buffer maintains at most one active GOP-worth of un-keyframed video chunks at the tail (the open GOP being written by the live encoder). These tail chunks are held until the next keyframe arrives, at which point the GOP boundary is marked.
- **R2.5** In-memory chunk storage is capped at a RAM budget (default 256 MiB). When the in-memory budget is exceeded, the oldest chunks are spilled to OPFS files keyed by timestamp range and chunk index. Spilled chunks retain their keyframe metadata. The in-memory portion is always the most recent tail.
- **R2.6** OPFS spill files are deleted promptly when their chunks are evicted from the ring (duration-based eviction). Stale spill files from crashed sessions are cleaned up on next capture start.
- **R2.7** The ring buffer reports its current state — total duration, in-memory byte count, spilled byte count, oldest/newest timestamps, and keyframe count — over typed messages for diagnostics and UI display.

## R3 — Replay Save (Save Last N Seconds)

- **R3.1** "Save Last N Seconds" is a user-invoked action (keyboard shortcut or button) that finalizes a contiguous segment of encoded chunks into a self-contained media clip and inserts it onto the timeline. The action works while capture is ongoing and does not interrupt or pause recording.
- **R3.2** The save bounds are: end = newest chunk timestamp (wall-clock), start = end − N seconds (user-configured, default 30), adjusted backward to the nearest preceding video keyframe. The segment always starts on a keyframe.
- **R3.3** Save assembles the encoded chunks (video + audio) from the in-memory buffer and/or OPFS spill for the determined time range. Assembly must not mutate or evict chunks still in the ring buffer — they are copied/referenced so recording continues from the same buffer state.
- **R3.4** Assembled chunks are muxed into a self-contained MP4 or WebM container via the existing Mediabunny mux path, written to OPFS, and registered as a media asset (fingerprinted per Phase 23 conventions). The asset is then inserted onto the timeline as a new clip at the playhead position (or at end of project, configurable).
- **R3.5** Save is non-blocking and cancellable. Progress (mux phase, bytes written, ETA) is reported. Cancellation stops the mux and discards the partial file; the ring buffer is unaffected.
- **R3.6** The saved clip carries source metadata: capture source label, resolution, frame rate, codec, and the original capture timestamp range. This metadata is visible in the Inspector.
- **R3.7** Repeated saves (e.g. save-last-30s every 30 seconds with no loss, save-last-30s every 10 seconds with overlapping content) must produce valid, independently playable clips. Overlapping saves produce distinct assets with distinct fingerprints.
- **R3.8** The save action is undoable via the existing snapshot undo/redo (Phase 9): undo removes the inserted clip and optionally the derived asset; the ring buffer is not affected.

## R4 — Live Audio Chain (v1 recording path; monitor follow-up)

- **R4.1** In v1, the pipeline worker applies the chain to capture audio only
  when the user explicitly enables Print to recording. The monitor output stays
  raw. A future AudioWorklet will reuse the same chain contract for monitoring.
- **R4.2** The chain includes three inserts, each independently bypassable:
  - **Gate** — noise gate with configurable threshold (dBFS), attack (ms), hold (ms), and release (ms). Signal below threshold is attenuated by the configured range (dB).
  - **Compressor** — feed-forward peak compressor with configurable threshold (dBFS), ratio, attack (ms), release (ms), knee (dB), and makeup gain (dB).
  - **Limiter** — brickwall peak limiter with configurable ceiling (dBFS), attack (µs), and release (ms). Precedes the final output; cannot be placed before gate/compressor.
- **R4.3** The v1 chain processes captured audio before encoding; it does not
  process the mixed timeline/monitor signal or report per-insert monitor meters.
  Those behaviours belong to T6.2–T6.7.
- **R4.4** Each implemented insert's parameters are adjustable via the UI and
  persisted with the project. Changes affect subsequent recording-path frames.
- **R4.5** The architecture reserves a Phase 36 denoiser insert between gate and
  compressor, but v1 does not expose a disabled placeholder or claim denoising.
- **R4.6** The complete chain latency (sum of all active inserts) is measured in samples and mapped to milliseconds at the current sample rate. This latency is surfaced in the diagnostics panel (Phase 25) and shown in the live audio chain UI.
- **R4.7** The live chain defaults to fully bypassed. The user must explicitly enable each insert. State is visible: each bypass toggle, each parameter value, and the aggregate latency.
- **R4.8** A recording-path chain failure must not break capture or the ring
  buffer. AudioWorklet crash/restart handling applies when the T6 monitor worklet
  is implemented.

## R5 — Latency Budget and Diagnostics

- **R5.1** Each live audio insert reports its measured processing latency in samples. The AudioWorklet processor tracks the sample count from input to output for each active insert and writes it to a dedicated slot in the meter SAB.
- **R5.2** Aggregate chain latency is the sum of all active insert latencies, displayed in milliseconds in the live audio chain panel and in the diagnostics panel.
- **R5.3** The replay buffer reports: capture session status, current buffer duration (%), in-memory bytes, OPFS spill bytes, encoder configuration (codec, bitrate, keyframe interval), encoder queue depth, and dropped-frame count.
- **R5.4** Replay buffer and live audio chain diagnostics appear as dedicated rows in the existing diagnostics panel (Phase 25) following the standard row format (feature name, status chip, metric value, action hint).
- **R5.5** Diagnostic state is display-only; no logic elsewhere branches on it.

## R6 — UI

- **R6.1** A "Replay Buffer" panel or toolbar section shows: capture state (stopped/active/paused), elapsed recording time, ring buffer fill as a circular/battery indicator, configured and effective save duration, and the "Save Last N Seconds" action button.
- **R6.2** Capture start/stop buttons are keyboard-accessible with clear ARIA labels. The start button is disabled when the browser lacks `getDisplayMedia` or `MediaStreamTrackProcessor`.
- **R6.3** A "Live Audio Chain" panel shows the three inserts (gate, compressor, limiter) plus the reserved denoiser slot. Each insert has: a bypass toggle, a set of parameter controls (sliders/numeric inputs with labels and units), and a mini level meter (pre- and post-insert).
- **R6.4** The live audio chain panel displays aggregate chain latency in milliseconds, updating in real-time from the SAB meter.
- **R6.5** Both panels follow the existing dark professional aesthetic, Kobalte primitives, ARIA + keyboard standards, and `onCleanup` for every listener.
- **R6.6** When capture prerequisites are unmet (no `getDisplayMedia`, no `MediaStreamTrackProcessor`, no `crossOriginIsolated`), the panels show a clear capability-unavailable message with all action buttons disabled; the rest of the app is unaffected.

## R7 — Project State and Export

- **R7.1** Replay-buffer configuration (duration limit, save-N default, RAM budget) is persisted in the project document with the existing versioned schema.
- **R7.2** Live audio chain configuration (per-insert bypass state and parameter values) is persisted in the project document.
- **R7.3** The default export path is unchanged. Saved replay clips are normal media assets and export identically to imported clips.
- **R7.4** An optional "Print live audio chain to recording" toggle, defaulting to off, routes the live chain output into the ring buffer's audio encoder input instead of the raw capture audio. This is a user-explicit choice surfaced at capture start and in the live chain panel.

## R8 — Tests

- **R8.1** Unit-test the ring buffer data structure: push chunks with timestamps, verify duration tracking, verify GOP-aligned eviction drops to the nearest next keyframe, verify both video and audio chunks within the evicted range are dropped.
- **R8.2** Unit-test ring buffer capacity enforcement: push chunks beyond the configured RAM budget, verify OPFS spill, verify in-memory byte count ≤ budget, verify reassembly from in-memory + OPFS produces correct chunk order.
- **R8.3** Unit-test save-last-N: with a ring buffer populated with known chunks and timestamped keyframes, save last N seconds, assert the assembled segment starts on the correct keyframe and ends at the newest chunk, assert no ring buffer mutation during save.
- **R8.4** Unit-test save during active "recording": enqueue new chunks while a save is in progress, assert the save uses a snapshot of chunk references at invocation time (not mutated by concurrent writes), assert new chunks are not lost.
- **R8.5** Unit-test GOP-aligned eviction with various GOP patterns: all keyframes, single keyframe at start, keyframes every N frames; assert correct alignment in all cases.
- **R8.6** Unit-test the live audio chain inserts (gate, compressor, limiter) as pure DSP functions: assert gate opens/closes at threshold, assert compressor gain reduction matches ratio, assert limiter ceiling is not exceeded. Test with synthetic audio buffers.
- **R8.7** Unit-test insert bypass: assert bypassed insert is an identity pass-through (sample-exact), assert rapid toggle does not produce discontinuities (smoothing applied).
- **R8.8** Unit-test latency measurement: assert each active insert reports the correct processing delay in samples, assert aggregate latency is the sum.
- **R8.9** Unit-test chain failure recovery: assert AudioWorklet crash does not break the ring buffer or stop capture; assert the chain bypasses cleanly.
- **R8.10** Unit-test OPFS spill file lifecycle: spill, evict (file deleted), crash cleanup on restart (stale files removed).
- **R8.11** Unit-test the "Print chain to recording" routing: assert that when enabled, the ring buffer receives chain-processed audio; when disabled, it receives raw capture audio.
- **R8.12** Quality gate: `npm run build` green (strict TypeScript); `npm test` green with no test count regression.

## R9 — Acceptance Criteria

- **A1** save-last-30s succeeds repeatedly during a continuous capture session (at least 5 saves in a 3-minute session); each saved clip is a valid, playable MP4/WebM.
- **A2** Ring buffer memory (in-memory + OPFS) stays within its configured bound; duration never exceeds limit + 1 GOP interval even under encoder backpressure or frame drops.
- **A3** Saved clips are frame-accurate: the first frame of the saved clip matches the visual content at the start timestamp of the source capture, and the clip ends where expected.
- **A4** Live audio chain inserts produce audible, measurable processing when enabled; bypass is a clean identity path.
- **A5** Capture, ring buffer, save, and live chain all work without degrading existing import/play/edit/export functionality.
- **A6** Capture prerequisites unmet → feature disabled with a clear message; editor fully functional otherwise.
- **A7** `crossOriginIsolated` absent → replay buffer remains fully functional; live audio chain disabled with a clear capability message; editor shell remains alive.
