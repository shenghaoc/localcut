# Tasks: Phase 46 — Replay Buffer and Live Audio Chain

> Status: **Implemented (v1)** — capture, ring buffer, OPFS spill, save-last-N, recording-path live audio chain, persistence, UI panels, and unit tests are in. Follow-ups tracked below as unchecked items: monitor-path AudioWorklet (T6.2–T6.7), per-insert meters (T8.2 note), keyboard shortcut (T8.5), diagnostics panel sections (T10.1/T10.2), saved-clip capture metadata in the Inspector (T4.4), and manual verification (T12.3–T12.5).

## T1 — Live Capture Infrastructure

- [x] **T1.1** Add capture-related types to `src/protocol.ts`: `CaptureSessionState` (active/inactive, source label, video/audio track info, resolution, frame rate, elapsed), `CaptureConfig` (codec preferences, bitrate), and the capture command / state message variants.
- [x] **T1.2** Capture engine: `src/engine/replay-buffer/capture.ts` holds session/config helpers and the codec fallback list; the pipeline worker accepts transferred `ReadableStream<VideoFrame>` / `ReadableStream<AudioData>`, configures `VideoEncoder` / `AudioEncoder` (probed via `isConfigSupported` at the captured resolution), runs concurrent pump loops, handles stream end, and flushes encoders on stop.
- [x] **T1.3** Implement capability probe for `MediaStreamTrackProcessor` (check `window.MediaStreamTrackProcessor` presence); the UI gates the replay buffer feature on it (plus `getDisplayMedia` availability).
- [x] **T1.4** Add capture command handlers to the pipeline worker (`src/engine/worker.ts`): `replay-capture-transfer-streams` (carries the streams plus track settings; capture starts on receipt — a separate start command was dropped because capture must begin from a main-thread user gesture) and `replay-capture-stop` (encoder flush + final buffer state); names are `replay-`prefixed to stay clear of the Phase 41 capture engine. Pause/resume is not in v1.
- [x] **T1.5** Add `replay-capture-state` state message from worker to UI: streams session info (active, elapsed, track presence) at low frequency (every 500 ms).
- [x] **T1.6** On main thread, create `src/ui/capture-bridge.ts`: invoke `getDisplayMedia` / `getUserMedia` from a user-gesture-bound action, instantiate `MediaStreamTrackProcessor` per track, transfer `ReadableStream`s to the worker. (A muted `<video>` monitor attach helper exists but is not mounted in v1.)
- [x] **T1.7** Handle capture edge cases: user cancels the browser picker (clean abort, incl. `NotAllowedError`), captured tab/share ends (`ended` track event → graceful stop), encoder error (report, stop capture, preserve buffered data), encoder backpressure (frames dropped at the input per `encodeQueueSize`, counted in stats).
- [ ] **T1.8** Unit-test the capability probe: `MediaStreamTrackProcessor` present/absent; assert feature flag reflects correctly (R8.1 scope).

## T2 — GOP-Aligned Ring Buffer

- [x] **T2.1** Create `src/engine/replay-buffer/ring-buffer.ts`: factory with `pushVideo(timestamp, duration, data, isKeyframe)`, `pushAudio(timestamp, duration, data)`, `getStats()`, `getSnapshot(startTimestamp, endTimestamp)`. Entries hold the copied encoded chunk bytes; internal ordered entry list with keyframe tracking.
- [x] **T2.2** Implement duration-based eviction: when `totalDurationS > maxDurationS`, find the nearest keyframe such that remaining chunks after it fit within the limit; drop all entries before that keyframe (video + audio). Handle the edge case where no suitable keyframe exists (single GOP exceeds limit).
- [x] **T2.3** Implement `getSnapshot(startS, endS)`: find the nearest keyframe ≤ `startS`, collect all entries (video + audio) from that keyframe to `endS`, return as an ordered array. Snapshot references existing chunks — no copies, no mutation of the ring.
- [x] **T2.4** Implement ring buffer stats: `totalDurationS`, `memoryBytes`, `spilledBytes`, `oldestTimestamp`, `newestTimestamp`, `keyframeCount`, `droppedFrameCount`.
- [x] **T2.5** Unit-test ring buffer: push known chunks with timestamps, verify `totalDurationS` matches expected span, verify GOP-aligned eviction drops to correct keyframe, verify both video and audio chunks in evicted range are dropped (R8.1, R8.5).
- [x] **T2.6** Unit-test ring buffer capacity and snapshot: spill splicing keeps RAM on a GOP boundary and preserves payloads; snapshot assembly from spill read-back + in-memory entries is covered in `replay-save.test.ts` (`assembleSaveEntries`). (OPFS file I/O itself is exercised at the binary-codec level — see T3.5.)

## T3 — OPFS Spill

- [x] **T3.1** Create `src/engine/replay-buffer/spill.ts`: `spillEntries(entries, range)` serializes chunk data to an OPFS file; `readSpillRange(range)` deserializes; `deleteSpillFile(range)` removes the OPFS file. Pure `encodeSpillBuffer`/`decodeSpillBuffer` helpers keep the format unit-testable without OPFS.
- [x] **T3.2** Spill file format: binary header (start timestamp as float64, end timestamp as float64, entry count as uint32, hasKeyframe as uint8) followed by per-entry: type flag (1 byte), timestamp (float64), duration (float64), isKeyframe (1 byte), byteSize (uint32), chunk data (byteSize bytes).
- [x] **T3.3** Integrate spill into the capture path: when `memoryBytes > maxMemoryBytes`, the worker splices the oldest entries (extended to the next keyframe), writes them via a serialized OPFS queue, and registers the `SpillRange`; ranges that fall outside the duration window are evicted and their files deleted. A failed spill write is surfaced as a project warning instead of silently shrinking the buffer.
- [x] **T3.4** Implement crash cleanup on capture start: scan the `replay-buffer/` OPFS directory, delete all spill files from previous sessions.
- [x] **T3.5** Unit-test the spill codec: read back spilled data → matches original entry order, metadata, and payload bytes; empty and large payloads covered. (Spill→evict→delete file lifecycle runs through the worker's OPFS queue, which Node tests can't exercise; covered by T12.3 manual verification.)

## T4 — Replay Save (Save Last N Seconds)

- [x] **T4.1** Save path: `src/engine/replay-buffer/replay-save.ts` provides `computeSaveRange`/`saveLastN` (single snapshot, keyframe-aligned) and `assembleSaveEntries` (combined spill + RAM selection); the worker handler snapshots the ring, awaits in-flight spill writes, reads back overlapping spill ranges, muxes, writes to OPFS, registers the file as a media source, and appends a timeline clip.
- [x] **T4.2** Implement mux integration with Mediabunny `EncodedVideoPacketSource`/`EncodedAudioPacketSource` over the same `Output`/`StreamTarget` pattern as Phase 6 export, feeding chunks in timestamp order with the captured decoder configs. Video-only and audio-only save ranges are handled.
- [x] **T4.3** Implement save progress: report chunks written / total chunks to the UI via a `replay-save-progress` message. Support cancellation: abort the mux, discard the partial OPFS file, leave the ring buffer unchanged.
- [ ] **T4.4** Implement saved clip metadata: store capture source label, original resolution, frame rate, codec, and capture timestamp range in the media asset's metadata. Surface in Inspector. (v1 registers the saved file like any import — codec/resolution metadata comes from the file itself; the capture-session provenance fields are not yet attached.)
- [x] **T4.5** Wire the save action as a `commitTimelineMutation` (Phase 9) for undo/redo support.
- [x] **T4.6** Unit-test save-last-N: with a populated ring buffer (known chunks with timestamps and keyframes), verify saved range starts on correct keyframe and ends at newest chunk, verify ring buffer is not mutated during save (snapshot semantics), verify no chunks are lost (R8.3).
- [x] **T4.7** Unit-test concurrent save + write: enqueue new chunks while a save snapshot exists; assert the save only includes chunks present at invocation time; assert new chunks remain in the ring for the next operation (R8.4).
- [ ] **T4.8** Unit-test repeated saves with overlapping ranges: assert each save produces a distinct, valid asset fingerprint; assert no data corruption from concurrent access (R8.3 extension).
- [x] **T4.9** Unit-test edge cases: save with N > buffer duration (saves whatever is available, starting from the oldest keyframe); audio-only ranges (no keyframe constraint); video ranges with no reachable keyframe return empty.

## T5 — Live Audio Chain DSP

- [x] **T5.1** Create `src/engine/live-audio/gate.ts`: pure function `processGate(input, params, state, sampleRate)`. Implements peak detection with an attack/hold/release envelope (hold state persists across blocks); gate range sets the closed-floor gain.
- [x] **T5.2** Create `src/engine/live-audio/compressor.ts`: pure function `processCompressor(input, params, state, sampleRate)`. Feed-forward peak compressor with configurable ratio, attack/release smoothing, soft knee, makeup gain.
- [x] **T5.3** Create `src/engine/live-audio/limiter.ts`: pure function `processLimiter(input, params, state, sampleRate)`. Brickwall peak limiter with short lookahead (1–5 ms), attack in microseconds, smooth release. Lookahead peak tracking uses a monotonic deque (O(1) amortized per sample) over a cross-block delay line.
- [x] **T5.4** Each DSP function is pure and unit-testable: no Web Audio API dependencies, no AudioWorklet. State is a plain object passed in/out.
- [x] **T5.5** Unit-test gate: assert gate opens above threshold, closes below threshold with specified range, hold persists across 128-sample block boundaries before release, block-size-invariant output (R8.6).
- [x] **T5.6** Unit-test compressor: assert gain reduction matches ratio, knee attenuates (never amplifies), makeup gain applied, unity envelope at start, block-size-invariant output (R8.6).
- [x] **T5.7** Unit-test limiter: assert output never exceeds ceiling in steady state, lookahead catches peaks across block boundaries, deque peak tracking matches the brute-force reference sample-exactly, block-size-invariant output (R8.6).
- [x] **T5.8** Unit-test bypass: assert all three inserts are sample-exact identity when bypassed (R8.7). (Click-free crossfade on live toggling belongs to the monitor worklet — see T6.3.)

## T6 — AudioWorklet Live Chain Processor (monitor path — follow-up)

> v1 ships the live chain on the **recording path** (see T7): the pipeline worker runs the DSP before encoding, so recordings never depend on the monitor `AudioContext` running. The monitor-path worklet below remains future work.

- [x] **T6.1** Extend the Phase 16 SAB meter layout with insert-level meters (indices 4–15), aggregate latency (index 16), and per-insert parameter slots (indices 17–N). Update `src/protocol.ts` with the new `LiveChainMeterIndex` constants (denoiser params reserved at 35..47).
- [ ] **T6.2** Create `src/engine/live-audio/live-chain-worklet.ts`: AudioWorkletProcessor that reads SAB parameters at the start of each `process()` block, runs the insert chain (gate → compressor → limiter) on the input, writes output to the destination, updates insert-level meters and aggregate latency in the SAB.
- [ ] **T6.3** Implement crossfade on bypass toggle: maintain both active and bypassed output buffers, crossfade over 5 ms (linear) when bypass state changes.
- [x] **T6.4** Reserve the denoiser slot: a no-op insert between gate and compressor. SAB parameter slots reserved; bypass permanently set to 1 (bypassed). Zero latency reported for this slot.
- [ ] **T6.5** Connect the live chain to the monitor path: the AudioWorklet's input is the mixed capture + timeline audio; the output is the `AudioContext.destination`. The existing audio graph routing is extended, not replaced.
- [ ] **T6.6** Unit-test the worklet channel: mock the SAB, call `process()` with synthetic input, verify gate/compressor/limiter are applied in order, verify meters update, verify latency accumulates correctly (R8.8).
- [ ] **T6.7** Unit-test chain failure recovery: simulate a worklet processor error, assert the chain falls back to bypass (output = input), assert a `live-chain-error` message is posted, assert capture continues (R8.9).

## T7 — Print Chain to Recording

- [x] **T7.1** Run the live audio chain on the recording path inside the pipeline worker: when `printToRecording` is enabled and any insert is active, capture `AudioData` is copied to planar PCM, processed gate → compressor → limiter per channel (`createLiveChainProcessor` in `live-chain.ts`), and re-wrapped before encoding. No separate SAB ring is needed, and a suspended monitor `AudioContext` can never starve the encoder.
- [x] **T7.2** Implement the routing toggle: when enabled, encoder input is the chain-processed PCM; when disabled, the raw capture `AudioData`. The toggle is live (checked per audio frame) and persisted with the project. A chain processing failure falls back to raw audio and posts a single `live-chain-error`.
- [x] **T7.3** Unit-test the chain processor used by the routing: bypass-all identity, ceiling enforcement on hot input, per-channel state independence, and config swap (`live-chain.test.ts`). (The `AudioData` copy/re-wrap itself requires WebCodecs — covered by T12.4 manual verification.)

## T8 — UI

- [x] **T8.1** Create `src/ui/ReplayBufferPanel.tsx`: collapsible panel following existing dark professional aesthetic. Shows: capture state indicator (red dot + "Recording"), elapsed time in `HH:MM:SS` (tabular-nums), ring buffer fill bar (% of configured max), "Save Last N Seconds" button (label tracks the configured duration), "Start Capture" / "Stop Capture" buttons. Controls disabled with reasons when prerequisites are missing.
- [x] **T8.2** Create `src/ui/LiveAudioChainPanel.tsx`: collapsible panel with three implemented insert rows (Gate, Compressor, Limiter). Each row: bypass toggle, insert name, expandable parameter sliders with numeric readouts; aggregate latency display. (Per-insert pre/post meters arrive with the monitor worklet — T6.2.)
- [x] **T8.3** Keep the reserved denoiser slot internal only; the UI does not render a disabled placeholder or redirect row.
- [x] **T8.4** Add the "Print chain to recording" toggle to the live chain panel, visible only during an active capture session, with a hint that v1 processes the recording (monitor output stays raw).
- [ ] **T8.5** Keyboard shortcuts: default binding for "Save Last N Seconds" (suggest `Ctrl+Shift+R` or `Cmd+Shift+R`), integrated with the existing keyboard map (Phase 10). Shortcut is active only when a capture session is running.
- [x] **T8.6** Capability-unavailable state: when `MediaStreamTrackProcessor` is unsupported, the ReplayBufferPanel shows only the unavailability message with all controls disabled. When `crossOriginIsolated` is false, the ReplayBufferPanel works normally and the LiveAudioChainPanel shows the unavailability message with all controls disabled.
- [x] **T8.7** Follow ARIA and keyboard standards (Phase 25 accessibility): collapse headers and insert headers respond to Enter/Space, bypass toggles use `aria-pressed`, sliders are native range inputs with `aria-valuemin`/`aria-valuemax`/`aria-valuenow`, latency display uses `aria-live="polite"`.

## T9 — Project State and Configuration Persistence

- [x] **T9.1** Add `replayBufferConfig` (duration limit, save-N default, RAM budget) and `liveAudioChainConfig` (per-insert bypass + params) to `ProjectDoc`. Schema v11; both fields optional and validated on parse, falling back to factory defaults (additive migration — v10 docs deserialize unchanged).
- [x] **T9.2** Wire configuration read/write: restore/import apply persisted configs and echo them to the UI (`replay-buffer-state`, `live-chain-config`); UI sends `update-replay-buffer-config` / `update-live-chain-config` / `set-print-to-recording`; the worker persists via autosave (Phase 9).
- [x] **T9.3** Unit-test configuration serialization round-trip: save → reload → verify all fields match; v10 docs and malformed configs produce factory defaults (R8.1 scope).

## T10 — Diagnostics

- [ ] **T10.1** Add a "Replay Buffer" section to the diagnostics panel (Phase 25). Rows: capture session state (chip: active/inactive), buffer duration (s and % of limit), memory usage (MiB in-RAM / MiB spilled), encoder config (codec, bitrate, keyframe interval), encoder queue depth, dropped frame count.
- [ ] **T10.2** Add a "Live Audio Chain" section to the diagnostics panel. Rows: each insert state (chip: active/bypassed), aggregate chain latency (ms).
- [x] **T10.3** Capture and chain errors flow through the existing recent-errors store (Phase 25); redaction rules applied.
- [x] **T10.4** Diagnostic state is display-only — no logic branches on it.

## T11 — Non-Regression and Quality Gate

- [x] **T11.1** Existing import/play/edit/export suites stay green with capture modules loaded but no active session; encoders are created only when streams arrive.
- [x] **T11.2** Existing audio path suites stay green with live chain modules loaded; the timeline playback path is untouched (the chain runs only on capture audio when printing is enabled).
- [x] **T11.3** No new strict-TypeScript or build failures (`npm run build` is the lint gate in this repo).
- [x] **T11.4** Formatting matches the existing style (tabs, single quotes); no formatter script exists in this repo.
- [x] **T11.5** `npm test` green; test count grows (785 → 844).
- [x] **T11.6** `npm run build` green (strict TypeScript). Capture modules ship inside the pipeline worker bundle (no main-thread cost when unused).

## T12 — Docs and Manual Verification

- [x] **T12.1** `docs/USER-GUIDE.md`: "Replay Buffer" section — capture setup, save-last-N workflow, buffer behaviour, fallback when unsupported.
- [x] **T12.2** `docs/USER-GUIDE.md`: "Live Audio Chain" section — insert descriptions, bypass behaviour, latency explanation, print-to-recording toggle.
- [ ] **T12.3** Manual: Chromium with `crossOriginIsolated` — start capture, wait 40s, save-last-30s, verify clip appears on timeline and plays correctly; save-last-30s again after 15s, verify overlapping clip; stop capture, verify all clips are valid assets.
- [ ] **T12.4** Manual: enable live chain inserts during capture with print-to-recording on, save-last-N, verify baked-in chain audio; toggle bypass, verify clean raw recording.
- [ ] **T12.5** Manual: non-Chromium or non-isolated browser — verify replay buffer still works without isolation (R0.8), live chain disabled message, and the full import/play/edit/export smoke test unchanged.
