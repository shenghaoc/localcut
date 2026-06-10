# Requirements: Phase 41 — Capture Engine

> Status: **Planned** — recording as a first-class source: screen, webcam, mic, and system audio captured, hardware-encoded while recording, streamed crash-safely to OPFS, and landed as separate timeline tracks.

## R0 — Hard Constraints

- **R0.1** The main thread performs only gesture-mediated stream acquisition (`getUserMedia`, `getDisplayMedia`) and UI; all frame consumption, encoding, muxing, and storage I/O run in workers. No sustained pixel, encode, or write loops on main.
- **R0.2** Captured frames flow `MediaStreamTrackProcessor` → `VideoFrame` → `VideoEncoder` with no CPU pixel round-trip and no Canvas2D staging. Self-monitor preview uses a native `<video srcObject>` element on the main thread (browser-composited), never an engine readback path.
- **R0.3** Every `VideoFrame` and `AudioData` produced by a track processor is closed exactly once, including on drop, error, abort, and graceful-stop paths.
- **R0.4** Memory is bounded for arbitrarily long recordings: no whole-recording buffering anywhere. Encoder queues are gated by `encodeQueueSize`; muxer output is flushed to OPFS at chunk granularity; all in-memory buffers have fixed high-water marks independent of recording duration.
- **R0.5** All recording artifacts live in OPFS under the app origin. No server upload, no accounts, no telemetry. `package-lock.json` remains the only lockfile; no new third-party libraries are required (Mediabunny covers muxing).
- **R0.6** Recording must never corrupt an existing project: capture sessions write only inside their own OPFS session directory until the user lands or imports them.
- **R0.7** Capture must not regress the premium playback/export path: no changes to the accelerated preview pipeline, and blocking `FileSystemSyncAccessHandle` writes must not execute on the pipeline worker's playback loop.

## R1 — Capability Gating (P8 / P26)

- **R1.1** Recording is an **accelerated-tier feature in v1**: the Record panel is enabled only when the resolved `CapabilityTierV2` is `core-webgpu` *and* all capture-specific probes pass. On any other tier the panel renders disabled with a per-missing-feature reason (P26 diagnostics pattern), never hidden silently.
- **R1.2** Extend the capability probe with independent capture probes, each reporting `supported` / `unsupported` / `unknown`: `mediaStreamTrackProcessor` (video and audio constructors), `transferableMediaStreamTrack`, `displayCapture` (`getDisplayMedia` presence), `displayAudioCapture` (tab/system audio constraint accepted), `videoEncodeRealtime` (hardware-preferred H.264 1080p config), `audioEncode` (Opus, AAC probed separately), `opfsSyncAccessHandle`.
- **R1.3** The diagnostic panel (`CapabilityMatrixPanel`) gains one row per capture probe with the standard chip + action-link format.
- **R1.4** A reference capture capability matrix must be maintained in `design.md`, including at minimum: tab audio on Chromium desktop; system audio on Windows and ChromeOS; system audio on macOS only on Chrome 141+ with macOS 14.2+; Safari/Firefox screen capture is video-only. The matrix is documentation — all runtime branching derives from probes (R1.2), never from user-agent strings.
- **R1.5** Audio-capture options the platform cannot deliver (e.g. system audio on an unsupported OS) must be visible but disabled in the Record panel with a one-line reason before recording starts, not discovered as silent missing audio afterwards.

## R2 — Acquisition

- **R2.1** Each screen/window/tab source costs exactly one user picker gesture (`getDisplayMedia` call per source). The engine never enumerates or auto-selects display surfaces.
- **R2.2** Camera and microphone selection uses `enumerateDevices` only after a successful `getUserMedia` permission grant; device labels are never requested pre-permission.
- **R2.3** Acquired `MediaStreamTrack`s are cloned for the local self-monitor (`<video srcObject>`, audio monitor muted in v1) and the original track is transferred to the worker. Ending capture stops both the transferred track and the monitor clone.
- **R2.4** Permission denial, picker cancellation, and device-in-use errors each produce a distinct user-facing message and leave the Record panel in a recoverable state (no stuck "starting" state).
- **R2.5** The user ending capture from browser UI (e.g. the "Stop sharing" bar) fires `ended` on all tracks including clones; listen on the **monitor clone's** `onended` on main (transferred originals are detached on main, so their `onended` never fires there). This triggers the same graceful stop as the in-app Stop button for that source; if it was the last video source, the session stops gracefully.

## R3 — Worker Ingestion

- **R3.1** Each captured track gets its own ingestion pipeline in the pipeline worker: `MediaStreamTrackProcessor.readable` → reader loop → `VideoEncoder` / `AudioEncoder`. Pipelines are independent; one source erroring must not tear down the others until policy says so (R6.6).
- **R3.2** MSTP timestamps are preserved exactly: the `timestamp` of every `VideoFrame`/`AudioData` is passed through to the encoder and container unmodified (no re-stamping to a nominal frame-rate grid).
- **R3.3** Screen content is treated as inherently VFR (PR #49 lessons): per-sample durations are derived from successive capture timestamps, never from a nominal fps. The last frame's duration on session stop is `stopTime − lastFrameTimestamp` (not the previous delta), so landed duration matches the actual recorded span. Landed metadata marks screen tracks `frameRateMode: 'variable'` so `SequentialFrameSource` uses per-frame durations.
- **R3.4** Video backpressure: when `encoder.encodeQueueSize` exceeds the configured bound, non-key `VideoFrame` objects are dropped pre-encode (closed immediately without encoding). Each pre-encode drop increments a per-track `preEncodeDrops` counter, is recorded as a `pre-encode-gap` in the chunk manifest, and surfaces a live warning in the Record panel. This is distinct from already-encoded chunk drops — only raw frames are dropped; encoded chunks are never silently discarded.
- **R3.5** Audio is never silently dropped. Audio uses a higher encoder queue bound (16 vs 8 for video) and requires sustained overrun (≥ 4 consecutive `AudioData` above threshold) before triggering a graceful stop with reason `audio-overrun`. This prevents premature shutdown from brief encode bursts while guaranteeing audio loss is always surfaced.
- **R3.6** Reader loops exit cleanly on stop/abort via `AbortController`; on exit they cancel the reader, flush the encoder, and close any frame still held.

## R4 — Encode While Recording

- **R4.1** Video encodes through WebCodecs configured with `latencyMode: 'realtime'` and `hardwareAcceleration: 'prefer-hardware'`; if the hardware-preferred config is unsupported, fall back to `'no-preference'` and record which was used in the session manifest and diagnostics.
- **R4.2** Default video codec is H.264 at the source's captured resolution (1080p-class targets); the actual codec string, resolution, and bitrate are recorded in the manifest. Codec/bitrate selection is probed, not assumed.
- **R4.3** Audio encodes to Opus by default; AAC is used only when its encode probe reports `supported` and the user selects it. Both mux into the same container family (R5).
- **R4.4** A key frame is requested at every chunk boundary so each flushed fragment starts with an independently decodable key frame.
- **R4.5** Encoder `error` callbacks trigger the per-source error policy (R6.6) with the codec and config in the message — never a silent stop.

## R5 — Streamed Container + OPFS Chunked Writes

- **R5.1** Each captured track is muxed into its **own** file (screen, webcam, mic, system audio are never premixed) as fragmented MP4 via Mediabunny `Output` + `Mp4OutputFormat({ fastStart: 'fragmented' })` + `StreamTarget`, fed by Mediabunny's encoded-packet sources. The container choice must be justified against Matroska in `design.md`.
- **R5.2** Output is append-only: the muxer must never backpatch earlier bytes. Chunks are written incrementally to OPFS through `FileSystemSyncAccessHandle` in a dedicated writer worker; `flush()` is called after every chunk.
- **R5.3** A per-session chunk manifest is maintained as an append-only NDJSON log with its own sync handle: a header record (session id, epoch, sources, encoder configs), one record per flushed chunk (file, byte offset, byte length, time range, key-frame flag, drop-gap info), and a final `finalize` record on clean stop. Write order per chunk: data write → data flush → manifest append → manifest flush.
- **R5.4** Target chunk (fragment) duration defaults to 2 s, configurable within 1–4 s. The bound on data loss from a hard kill is at most one in-flight chunk per track plus a possibly torn final manifest line.
- **R5.5** The writer worker sends a `chunk-ack` per source after each chunk + manifest flush completes. The pipeline worker limits in-flight chunks per track (max 2) and does not send the next chunk until the in-flight count drops below the bound. This prevents unbounded message-queue growth when OPFS writes stall.
- **R5.6** The writer worker's buffer high-water mark is bounded by one fragment plus fixed slack per track; exceeding it is a bug surfaced as a session error, not silent growth.

## R6 — Crash Safety + Recovery

- **R6.1** A session directory missing its `finalize` record is an orphan. On boot, a recovery scan lists orphaned session directories and surfaces them to the UI; the scan must be read-only and must not block app startup interactivity.
- **R6.2** The recovery dialog shows, per orphan: when it was recorded, sources, recovered duration, and size; the user chooses **Import** or **Discard** per session. No orphan is deleted without explicit user action.
- **R6.3** Import truncates each track file to the last manifest-recorded byte offset, tolerates a torn final manifest line, validates chunk records against actual file lengths, then lands the tracks exactly like a clean stop (R8). The recovered fMP4 (init segment + N complete fragments) must demux through the existing Mediabunny import path unchanged.
- **R6.4** Kill-tab acceptance: killing the tab mid-record and relaunching recovers the session minus at most one chunk per track (R5.4), verified by a fault-injection unit test against the mocked sync handle.
- **R6.5** Recovery import failures (manifest unreadable, file missing) report which artifact failed and still offer Discard; they never crash the shell.
- **R6.6** Per-source runtime error policy: a failed video source stops that source's pipeline, finalizes its file, and the session continues if at least one source remains; the UI states which source stopped and why. Audio-encoder failure follows R3.5.

## R7 — Storage Preflight + Quota Watch

- **R7.1** Before recording starts, `navigator.storage.estimate()` is checked: starting requires headroom for at least 60 s at the configured total bitrate plus fixed overhead; otherwise starting is blocked with the shortfall stated.
- **R7.2** During recording, quota is re-checked on every chunk flush (no extra timers). When remaining headroom falls below the graceful-stop floor, the session performs a graceful stop: finalize all tracks, write `finalize`, land tracks, and tell the user recording stopped due to storage with sizes.
- **R7.3** The Record panel shows live bytes written and an estimate of remaining recordable time derived from observed (not configured) byte rate.

## R8 — Timestamps, Alignment, Landing

- **R8.1** The session epoch is the minimum first-sample timestamp across all tracks, recorded in the manifest. Per-track placement offset is `firstSampleTimestamp − epoch`.
- **R8.2** On clean stop (or recovery import), each track file is registered as a P11 media asset through the existing import/inspection path, fingerprinted per P23, and placed on its **own** new timeline track (video tracks for screen/webcam; audio tracks for mic/system audio) at its placement offset. Tracks are never premixed and no audio is baked into a video file.
- **R8.3** Mutual alignment: with synthetic capture clocks, landed clips are mutually aligned within one audio quantum (128 frames at the context rate; ≈ 2.67 ms at 48 kHz), asserted by unit test. A runtime cross-clock sanity check compares per-track `performance.now()`-anchored first-sample skew and surfaces a warning above threshold rather than silently re-aligning.
- **R8.4** Per-track start offsets are honoured (the PR #49 44 ms lesson): landing must not force-zero clip starts to make tracks "line up".
- **R8.5** Landing happens through the existing timeline command path so undo/redo (P9) treats the landed session as one undoable operation.

## R9 — UI

- **R9.1** A Record panel provides: Add screen source (one gesture each), camera picker, mic picker, system/tab-audio toggle (capability-gated per R1.5), chunk-duration setting, Start/Stop, elapsed time, per-source status chips, live bytes + remaining-time estimate, and dropped-frame warnings.
- **R9.2** The status bar shows a persistent recording indicator while a session is active; closing-tab intent during recording triggers a `beforeunload` confirmation.
- **R9.3** Self-monitor tiles render the cloned tracks via `<video srcObject>`; audio monitoring is muted in v1 (feedback safety).
- **R9.4** All Record panel controls follow the accessibility steering (keyboard operable, ARIA labels, visible focus); the recording indicator does not rely on colour alone.
- **R9.5** User-facing documentation in `docs/USER-GUIDE.md` covers: starting a recording, the one-gesture-per-screen-source rule, audio capability matrix summary, crash recovery flow, and where recordings are stored.

## R10 — Tests

- **R10.1** All capture unit tests use mocked streams and handles: a mock MSTP reader (scripted `VideoFrame`/`AudioData` sequences with VFR timestamps), spy encoders, and an in-memory `FileSystemSyncAccessHandle` mock with fault injection (kill-after-N-writes, torn final write). No large media fixtures in CI.
- **R10.2** Required unit coverage: close-exactly-once for frames/audio data on happy, drop, error, and abort paths; chunk write ordering (data flush before manifest append); manifest parse with torn tail; recovery truncation math; epoch/offset alignment within one audio quantum; quota preflight and graceful-stop trigger; backpressure drop policy and gap records.
- **R10.3** Bounded-memory acceptance: a mocked-chunk simulation of a 30-minute 1080p session asserts writer and pipeline high-water marks stay constant (no O(duration) growth in any buffer, queue, or manifest in-memory state).
- **R10.4** Playwright covers only the UI-critical happy path: with fake-device flags, start a camera+mic recording, stop, and assert two new tracks land on the timeline. Recovery, quota, and VFR logic stay in unit tests.
- **R10.5** `npm run build` and `npm test` stay green; test count must not decrease.

## R11 — Isolation and Non-regression

- **R11.1** Capture engine code lives under `src/engine/capture/`; the writer worker owns all `SyncAccessHandle` I/O. No capture module imports from the accelerated preview pipeline; the pipeline worker's playback loop is unmodified.
- **R11.2** No media objects, encoder handles, or OPFS handles leak into `src/ui/`; the UI sees only protocol messages and snapshots.
- **R11.3** Existing import, playback, and export behaviour is bit-identical when no recording has ever been made.
