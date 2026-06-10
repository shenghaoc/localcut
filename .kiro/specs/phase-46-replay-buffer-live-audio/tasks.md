# Tasks: Phase 46 — Replay Buffer and Live Audio Chain

> Status: **Planned** — works through capture setup, ring buffer, replay save, live audio inserts, diagnostics, tests, and docs.

## T1 — Live Capture Infrastructure

- [ ] **T1.1** Add capture-related types to `src/protocol.ts`: `CaptureSessionState` (active/inactive, source label, video/audio track info, resolution, frame rate, elapsed), `CaptureConfig` (codec preferences, bitrate), and `CaptureCommand` / `CaptureState` message variants.
- [ ] **T1.2** Create `src/engine/replay-buffer/capture.ts`: accept transferred `ReadableStream<VideoFrame>` and `ReadableStream<AudioData>`, create and configure `VideoEncoder` / `AudioEncoder` for realtime encoding, run the concurrent capture loop, handle `MediaStreamTrack` ended events, flush encoders on stop.
- [ ] **T1.3** Implement capability probe for `MediaStreamTrackProcessor` (check `window.MediaStreamTrackProcessor` presence) at editor startup; store as a feature flag gating the replay buffer feature.
- [ ] **T1.4** Add capture command handlers to the pipeline worker (`src/engine/worker.ts`): `capture-start`, `capture-stop`, `capture-pause`/`capture-resume`. Start receives the transferred `ReadableStream` handles; stop triggers encoder flush + ring buffer finalize.
- [ ] **T1.5** Add `capture-session-state` state message from worker to UI: streams session info (active, elapsed, track presence) at low frequency (1 Hz).
- [ ] **T1.6** On main thread, create `src/ui/capture-bridge.ts`: invoke `getDisplayMedia` / `getUserMedia` from a user-gesture-bound action, instantiate `MediaStreamTrackProcessor` per track, transfer `ReadableStream` to worker, attach `MediaStream` to muted `<video>` element.
- [ ] **T1.7** Handle capture edge cases: user cancels the browser picker (clean abort), captured tab closes (graceful stop), encoder error (report, stop capture, preserve buffered data), `ReadableStream` backpressure (apply to encoder per `encodeQueueSize`).
- [ ] **T1.8** Unit-test the capability probe: `MediaStreamTrackProcessor` present/absent; assert feature flag reflects correctly (R8.1 scope).

## T2 — GOP-Aligned Ring Buffer

- [ ] **T2.1** Create `src/engine/replay-buffer/ring-buffer.ts`: `RingBuffer` class/plain-object with `pushVideo(chunk, metadata)`, `pushAudio(chunk, metadata)`, `getStats()`, `getSnapshot(startTimestamp, endTimestamp)` methods. Internal: ordered entry list, timestamp index, keyframe tracking.
- [ ] **T2.2** Implement duration-based eviction: when `totalDurationS > maxDurationS`, find the nearest keyframe such that remaining chunks after it fit within the limit; drop all entries before that keyframe (video + audio). Handle the edge case where no suitable keyframe exists (single GOP exceeds limit).
- [ ] **T2.3** Implement `getSnapshot(startS, endS)`: find the nearest keyframe ≤ `startS`, collect all entries (video + audio) from that keyframe to `endS`, return as an ordered array. Snapshot references existing chunks — no copies, no mutation of the ring.
- [ ] **T2.4** Implement ring buffer stats: `totalDurationS`, `memoryBytes`, `oldestTimestamp`, `newestTimestamp`, `keyframeCount`, `droppedFrameCount`. Stats are read by the worker for diagnostics messages.
- [ ] **T2.5** Unit-test ring buffer: push known chunks with timestamps, verify `totalDurationS` matches expected span, verify GOP-aligned eviction drops to correct keyframe, verify both video and audio chunks in evicted range are dropped (R8.1, R8.5).
- [ ] **T2.6** Unit-test ring buffer capacity and snapshot: push chunks to exceed RAM budget, verify spill files created, verify snapshot assembles from spill + in-memory correctly, verify duplicate timestamp handling (R8.2).

## T3 — OPFS Spill

- [ ] **T3.1** Create `src/engine/replay-buffer/spill.ts`: `spillEntries(entries: RingBufferEntry[]): Promise<SpillRange>` serializes chunk data to an OPFS file; `readSpillRange(range: SpillRange): Promise<RingBufferEntry[]>` deserializes; `deleteSpillFile(range: SpillRange)` removes the OPFS file.
- [ ] **T3.2** Spill file format: binary header (start timestamp as float64, end timestamp as float64, entry count as uint32, keyframe bitmap as bytes) followed by per-entry: type flag (1 byte), timestamp (float64), duration (float64), isKeyframe (1 byte), byteSize (uint32), chunk data (byteSize bytes).
- [ ] **T3.3** Integrate spill into the ring buffer: when `memoryBytes > maxMemoryBytes`, select the oldest N entries that bring memory below budget, call `spillEntries()`, remove from in-memory array, add `SpillRange` to `spilledRanges`. Eviction checks spill ranges and deletes files whose range is fully evicted.
- [ ] **T3.4** Implement crash cleanup on capture start: scan `replay-buffer/` OPFS directory, delete all spill files from previous sessions.
- [ ] **T3.5** Unit-test spill lifecycle: push, spill, evict → file deleted; crash cleanup → stale files removed; read back spilled data → matches original entry order and metadata (R8.10).

## T4 — Replay Save (Save Last N Seconds)

- [ ] **T4.1** Create `src/engine/replay-buffer/replay-save.ts`: `saveLastN(ringBuffer, nSeconds, projectState)`: compute start/end timestamps (end = newest, start = newest - N, adjusted to preceding keyframe), call `ringBuffer.getSnapshot(start, end)`, feed chunks to Mediabunny muxer, write to OPFS, register as media asset (fingerprint), issue timeline insert command.
- [ ] **T4.2** Implement mux integration: reuse the existing Mediabunny mux path from Phase 6 without modification. Feed video chunks then audio chunks in timestamp order. Handle the case where only video or only audio chunks are present in the save range.
- [ ] **T4.3** Implement save progress: report chunks written / total chunks to the UI via a `replay-save-progress` message. Support cancellation: abort the mux, discard the partial OPFS file, leave the ring buffer unchanged.
- [ ] **T4.4** Implement saved clip metadata: store capture source label, original resolution, frame rate, codec, and capture timestamp range in the media asset's metadata. Surface in Inspector.
- [ ] **T4.5** Wire the save action as a `commitTimelineMutation` (Phase 9) for undo/redo support.
- [ ] **T4.6** Unit-test save-last-N: with a populated mock ring buffer (known chunks with timestamps and keyframes), verify saved range starts on correct keyframe and ends at newest chunk, verify ring buffer is not mutated during save (snapshot semantics), verify no chunks are lost (R8.3).
- [ ] **T4.7** Unit-test concurrent save + write: enqueue new chunks to a mock ring buffer while a save is in progress; assert the save only includes chunks present at invocation time; assert new chunks remain in the ring for the next operation (R8.4).
- [ ] **T4.8** Unit-test repeated saves with overlapping ranges: assert each save produces a distinct, valid asset fingerprint; assert no data corruption from concurrent access (R8.3 extension).
- [ ] **T4.9** Unit-test edge cases: save with N > buffer duration (should save whatever is available, starting from the oldest keyframe); save with zero video chunks (audio-only capture); save with zero audio chunks (video-only capture).

## T5 — Live Audio Chain DSP

- [ ] **T5.1** Create `src/engine/live-audio/gate.ts`: pure function `processGate(input: Float32Array, params: GateParams, state: GateState): Float32Array`. Implements: RMS or peak detection, hysteresis with attack/hold/release envelope, soft knee around threshold. Returns processed buffer and updated state.
- [ ] **T5.2** Create `src/engine/live-audio/compressor.ts`: pure function `processCompressor(input: Float32Array, params: CompressorParams, state: CompressorState): Float32Array`. Feed-forward RMS compressor with configurable ratio, attack/release smoothing, soft knee, makeup gain.
- [ ] **T5.3** Create `src/engine/live-audio/limiter.ts`: pure function `processLimiter(input: Float32Array, params: LimiterParams, state: LimiterState): Float32Array`. Brickwall peak limiter with sub-sample lookahead (1–5 ms), attack in microseconds, smooth release.
- [ ] **T5.4** Each DSP function is pure and unit-testable: no Web Audio API dependencies, no AudioWorklet. State is a plain object passed in/out.
- [ ] **T5.5** Unit-test gate: assert gate opens above threshold, closes below threshold with specified range, attack/hold/release timing correct, no discontinuities (R8.6).
- [ ] **T5.6** Unit-test compressor: assert gain reduction matches ratio, attack/release envelope correct, knee smoothing functional, makeup gain applied (R8.6).
- [ ] **T5.7** Unit-test limiter: assert output never exceeds ceiling, attack catches transients within specified time, release envelope smooth, no overshoot (R8.6).
- [ ] **T5.8** Unit-test bypass: assert all three inserts are sample-exact identity when bypassed; assert rapid toggle does not produce clicks (crossfade applied) (R8.7).

## T6 — AudioWorklet Live Chain Processor

- [ ] **T6.1** Extend the Phase 16 SAB meter layout with insert-level meters (indices 4–15), aggregate latency (index 16), and per-insert parameter slots (indices 17–35). Update `src/protocol.ts` with the new `MeterIndex` / `LiveChainIndex` constants.
- [ ] **T6.2** Create `src/engine/live-audio/live-chain-worklet.ts`: AudioWorkletProcessor that reads SAB parameters at the start of each `process()` block, runs the insert chain (gate → compressor → limiter) on the input, writes output to the destination, updates insert-level meters and aggregate latency in the SAB.
- [ ] **T6.3** Implement crossfade on bypass toggle: maintain both active and bypassed output buffers, crossfade over 5 ms (linear) when bypass state changes.
- [ ] **T6.4** Reserve the denoiser slot: a no-op insert between gate and compressor. SAB parameter slots reserved; bypass permanently set to 1 (bypassed). Zero latency reported for this slot.
- [ ] **T6.5** Connect the live chain to the monitor path: the AudioWorklet's input is the mixed capture + timeline audio; the output is the `AudioContext.destination`. The existing audio graph routing is extended, not replaced.
- [ ] **T6.6** Unit-test the worklet channel: mock the SAB, call `process()` with synthetic input, verify gate/compressor/limiter are applied in order, verify meters update, verify latency accumulates correctly (R8.8).
- [ ] **T6.7** Unit-test chain failure recovery: simulate a worklet processor error, assert the chain falls back to bypass (output = input), assert a `live-chain-error` message is posted, assert capture continues (R8.9).

## T7 — Print Chain to Recording

- [ ] **T7.1** Add a shared audio ring buffer (separate from the existing Phase 5 audio ring) for the chain output. The AudioWorklet writes the post-limiter output to this ring; the pipeline worker's capture loop reads from it when `printLiveChainToRecording` is enabled.
- [ ] **T7.2** Implement the routing toggle: when enabled, `AudioData` frames for the audio encoder are sourced from the chain output ring; when disabled, from the raw `MediaStreamTrack` reader. Toggle is a capture-session parameter set at start or changed live.
- [ ] **T7.3** Unit-test the routing: with a mock SAB chain-output ring, verify the encoder receives chain-processed data when toggle is on, and raw data when off (R8.11).

## T8 — UI

- [ ] **T8.1** Create `src/ui/ReplayBufferPanel.tsx`: collapsible panel following existing dark professional aesthetic. Shows: capture state indicator (red dot + "Recording" / grey + "Stopped"), elapsed time in `HH:MM:SS` (tabular-nums), ring buffer fill indicator (circular or bar showing % of configured max), configured save duration (N seconds), "Save Last N Seconds" button, "Start Capture" / "Stop Capture" button. All buttons disabled with reasons when prerequisites are missing.
- [ ] **T8.2** Create `src/ui/LiveAudioChainPanel.tsx`: collapsible panel with three insert rows (Gate, Compressor, Limiter) plus the reserved Denoiser slot. Each row: bypass toggle (checkbox/switch), insert name, and a disclosure triangle to reveal parameter controls. Parameter controls: labeled sliders with numeric readout, per-insert mini meters (two horizontal bars: pre- and post-insert levels). Aggregate latency displayed at the bottom.
- [ ] **T8.3** The Denoiser slot renders as disabled (greyed out, all controls inactive) with text "Noise suppression — available in a future update".
- [ ] **T8.4** Add the "Print live audio chain to recording" toggle to the live chain panel, visible only during an active capture session.
- [ ] **T8.5** Keyboard shortcuts: default binding for "Save Last N Seconds" (suggest `Ctrl+Shift+R` or `Cmd+Shift+R`), integrated with the existing keyboard map (Phase 10). Shortcut is active only when a capture session is running.
- [ ] **T8.6** Capability-unavailable state: when `crossOriginIsolated` is false or `MediaStreamTrackProcessor` is unsupported, both panels show only the unavailability message with all controls disabled.
- [ ] **T8.7** Follow ARIA and keyboard standards (Phase 25 accessibility): toggle buttons use `aria-pressed`, sliders use `role="slider"` with `aria-valuemin`/`aria-valuemax`/`aria-valuenow`, latency display uses `aria-live="polite"` for real-time updates.

## T9 — Project State and Configuration Persistence

- [ ] **T9.1** Add `replayBufferConfig` (duration limit, save-N default, RAM budget) and `liveAudioChainConfig` (per-insert bypass + params) to `ProjectDoc`. Bump schema version and write migration from the previous version (additive — new fields default to their factory values).
- [ ] **T9.2** Wire configuration read/write: on worker init, send config from project; on config change in UI, send `update-replay-buffer-config` / `update-live-chain-config` commands to worker; worker persists via autosave (Phase 9).
- [ ] **T9.3** Unit-test configuration serialization round-trip: save → reload → verify all fields match; migration from previous schema version produces correct defaults (R8.1 scope).

## T10 — Diagnostics

- [ ] **T10.1** Add a "Replay Buffer" section to the diagnostics panel (Phase 25). Rows: capture session state (chip: active/inactive), buffer duration (s and % of limit), memory usage (MiB in-RAM / MiB spilled), encoder config (codec, bitrate, keyframe interval), encoder queue depth, dropped frame count.
- [ ] **T10.2** Add a "Live Audio Chain" section to the diagnostics panel. Rows: each insert state (chip: active/bypassed), aggregate chain latency (ms), chain output SAB ring status.
- [ ] **T10.3** Capture and chain errors flow through the existing recent-errors store (Phase 25); redaction rules applied.
- [ ] **T10.4** Diagnostic state is display-only — no logic branches on it.

## T11 — Non-Regression and Quality Gate

- [ ] **T11.1** Existing import/play/edit/export suites stay green with capture modules loaded but no active session; verify zero encoder instances when not capturing.
- [ ] **T11.2** Existing audio path suites stay green with live chain modules loaded but all inserts bypassed; verify no latency added to the default audio path (sample-exact identity).
- [ ] **T11.3** `npm run lint`: all Phase 46 files pass; no new lint failures introduced.
- [ ] **T11.4** `npm run format:check`: all Phase 46 files pass.
- [ ] **T11.5** `npm test` green; test count grows (no regression).
- [ ] **T11.6** `npm run build` green (strict TypeScript); `dist/` emits capture-related modules as tree-shakeable chunks (no capture code in the entry bundle when feature unused).

## T12 — Docs and Manual Verification

- [ ] **T12.1** `docs/USER-GUIDE.md`: "Replay Buffer" section — capture setup, save-last-N workflow, ring buffer configuration, keyboard shortcut, fallback when unsupported.
- [ ] **T12.2** `docs/USER-GUIDE.md`: "Live Audio Chain" section — insert descriptions, bypass behaviour, latency explanation, print-to-recording toggle, denoiser slot note.
- [ ] **T12.3** Manual: Chromium with `crossOriginIsolated` — start capture, wait 40s, save-last-30s, verify clip appears on timeline and plays correctly; save-last-30s again after 15s, verify overlapping clip; stop capture, verify all clips are valid assets.
- [ ] **T12.4** Manual: enable live chain inserts one by one during capture; verify audible effect on monitor output; toggle bypass, verify clean bypass; enable print-to-recording, save-last-N, verify baked-in chain audio.
- [ ] **T12.5** Manual: non-Chromium or non-isolated browser — verify feature-disabled message; verify full import/play/edit/export smoke test unchanged.
