# Tasks: Phase 41 — Capture Engine

> Status: **Active / foundation implemented.** Protocol + manifest types (T1), capture probes + `recordingAvailable` gating + diagnostics rows (T2), per-track ingestion pipelines with backpressure, timestamp-based keyframe cadence, and close-exactly-once tests (T4), the writer worker with ordered chunk+manifest writes, ACK backpressure, and recovery scan (T6.2/T6.3/T6.5), and the pipeline-worker command handlers are implemented. **Own-tab DOM event sidecar** (T13) lands the worker → main lifecycle hook, the SAB ring, the main-thread tap, the session drain, and the `events.ndjson` sidecar (panel migration + recovery wiring + docs remain).
>
> Open build-out, honestly labeled: **track files are not yet valid fMP4** — encoded packets are appended raw pending the Mediabunny fragmented muxer (T6.1); acquisition UI + Record panel (T3/T10); recovery wiring + dialog (T7); quota wiring (T8); landing (T9); remaining tests, Playwright, docs (T11/T12). Order matters: T6.1 before T7.3/T9; T9 before T10 happy path.

## T1 — Protocol and model

- [x] **T1.1** Add capture types to `src/protocol.ts`: `CaptureSourceDescriptor`, `CaptureSettingsSnapshot`, `CaptureSourceSnapshot`, `CaptureSourceStatusSnapshot`, `CaptureRecoverySessionSnapshot`, `CaptureErrorCode`, `CaptureStopReason`, `CaptureSourceEndReason`.
- [x] **T1.2** Add worker commands `capture-add-source` (with transferred `MediaStreamTrack`), `capture-remove-source`, `capture-start`, `capture-stop`, `capture-recovery-import`, `capture-recovery-discard` to the `WorkerCommand` union.
- [x] **T1.3** Add state messages `capture-status`, `capture-error`, `capture-recovery-list`, `capture-landed` to the worker state message union.
- [x] **T1.4** Define `CaptureManifestRecord` (header / epoch / chunk / source-ended / finalize) in `src/engine/capture/chunk-manifest.ts` with version field `1`.

## T2 — Capability probes and gating

- [x] **T2.1** Extend the capability probe with the capture group: `mediaStreamTrackProcessor`, `transferableMediaStreamTrack`, `displayCapture`, `displayAudioCapture`, `videoEncodeRealtime` (recording hw-preferred vs fallback), `audioEncode` (Opus, AAC separately), `opfsSyncAccessHandle`. Each maps probe errors to `'unknown'`.
- [x] **T2.2** Add a `recordingAvailable` derivation: `core-webgpu` tier AND all critical capture probes `supported`; export it as a pure function alongside `deriveCapabilityTierV2`.
- [x] **T2.3** Add one `CapabilityMatrixPanel` row per capture probe with action links (e.g. "Recording requires a Chromium browser").
- [ ] **T2.4** Unit-test `recordingAvailable` across fixture probe results: accelerated tier with all probes (enabled), Safari-like and Firefox-like fixtures (disabled with the correct missing set), accelerated tier minus `opfsSyncAccessHandle` (disabled).

## T3 — Acquisition (main thread)

- [ ] **T3.1** Implement screen-source acquisition: one `getDisplayMedia` call per Add-screen gesture, audio constraint from the capability-gated toggle; never enumerate or auto-select display surfaces.
- [ ] **T3.2** Implement camera/mic acquisition: `getUserMedia` first, `enumerateDevices` for labeled pickers only after a grant.
- [ ] **T3.3** Clone each track for the muted `<video srcObject>` monitor tile; transfer the original to the worker via `capture-add-source`; stop both on source removal and session stop.
- [ ] **T3.4** Map permission denial, picker cancel, and `NotReadableError` to distinct recoverable UI states; no stuck "starting" state.
- [ ] **T3.5** Wire `monitorTrack.onended` (the clone staying on main; transferred originals are detached) into the same per-source stop path as the in-app control; last-video-source end triggers graceful session stop.

## T4 — Worker ingestion (per-track pipelines)

- [x] **T4.1** Create `src/engine/capture/track-pipeline.ts`: MSTP reader loop per track driven by `AbortController`; preserves MSTP timestamps unmodified; closes every `VideoFrame`/`AudioData` exactly once on happy, drop, error, and abort paths.
- [x] **T4.2** Video backpressure: when `encodeQueueSize > 8`, perform pre-encode drop-and-close of non-key `VideoFrame` objects (never drop already-encoded chunks). Track `preEncodeDrops` per source; emit gap info for the chunk manifest; surface a live warning via `capture-status`.
- [x] **T4.3** Audio overrun policy: audio is never silently dropped. Use higher encode queue bound (16 vs 8) with sustained-overrun guard (≥ 4 consecutive frames above threshold) before triggering graceful stop with reason `audio-overrun`; prevents premature shutdown from brief audio encode bursts.
- [x] **T4.4** Per-source error policy: encoder/reader failure finalizes that source's file; session continues when another source remains; emit `capture-error` naming the source and code.
- [x] **T4.5** Unit-test close-exactly-once and backpressure with `capture-fixtures.ts` mock readers and spy encoders, including VFR timestamp sequences and abort mid-frame.

## T5 — Encode while recording

- [ ] **T5.1** Configure `VideoEncoder` with `latencyMode: 'realtime'`, `hardwareAcceleration: 'prefer-hardware'`; fall back to `'no-preference'`; record which config was used in the manifest header and `capture-status`.
- [ ] **T5.2** Default H.264 at captured resolution with probed bitrate; default audio Opus, AAC only when probed and selected.
- [ ] **T5.3** Request a key frame at each chunk boundary; cut fragments at key-frame arrival targeting the configured chunk duration (default 2 s, clamp 1–4 s).
- [ ] **T5.4** Unit-test keyframe cadence and config fallback recording with spy encoders.

## T6 — Fragmented writer + chunk manifest

- [ ] **T6.1** Create `src/engine/capture/fragmented-writer.ts`: per-track Mediabunny `Output` with `Mp4OutputFormat({ fastStart: 'fragmented' })` + `StreamTarget`, fed by encoded-packet sources; assert append-only chunk positions (no backpatching) at runtime.
- [x] **T6.2** Create `src/engine/capture/writer-worker.ts`: dedicated worker owning one `SyncAccessHandle` per track file plus one for `manifest.ndjson`; receives transferred `ArrayBuffer` chunks.
- [x] **T6.3** Enforce per-chunk write ordering: data write → data flush → manifest append → manifest flush → send `chunk-ack` to pipeline worker; one NDJSON record per flushed chunk with byte offset/length, time range, key-frame flag, and drop-gap info. Pipeline worker limits in-flight chunks per track (max 2) and waits for ACK before sending the next chunk.
- [ ] **T6.4** Bound the writer buffer to one fragment + fixed slack per track; surface overflow as a session error.
- [x] **T6.5** Write `header` at start, `epoch` once the minimum first-sample timestamp is known, `source-ended` per source, `finalize` on clean/graceful stop.
- [ ] **T6.6** Build the in-memory fault-injecting `SyncAccessHandle` mock in `capture-fixtures.ts` (kill-after-N-writes, torn final write); unit-test write ordering and bounded buffering against it.
- [ ] **T6.7** Bounded-memory acceptance test: mocked 30-minute 1080p session (mocked chunks); assert constant high-water marks for writer buffers, encoder queues, and manifest in-memory state.

## T7 — Crash recovery

- [ ] **T7.1** Implement read-only `scanCaptureSessions()` in the writer worker at boot; sessions without `finalize` surface via `capture-recovery-list` without blocking startup.
- [ ] **T7.2** Manifest parser tolerates a torn final line; validates chunk arithmetic against actual file lengths.
- [ ] **T7.3** Recovery import: truncate each track file to the last recorded `byteOffset + byteLength`, then land via the T9 path; verify the recovered fMP4 demuxes through the existing Mediabunny import path.
- [ ] **T7.4** Create `src/ui/CaptureRecoveryDialog.tsx`: per-orphan date, sources, recovered duration, size; Import / Discard per session; nothing auto-deleted; unreadable artifacts report the failing file and still offer Discard.
- [ ] **T7.5** Kill-tab acceptance test: fault-inject a kill mid-chunk; assert recovery loses at most one chunk per track plus the torn manifest line.

## T8 — Storage preflight + quota watch

- [ ] **T8.1** Create `src/engine/capture/quota.ts`: preflight `storage.estimate()` requiring ≥ 60 s × configured total bitrate + overhead; block Start with the shortfall stated.
- [ ] **T8.2** Re-check quota on every chunk flush; below the floor (`max(2 × per-flush ceiling, 64 MiB)`) trigger graceful stop with reason `quota`: finalize, land, notify with sizes.
- [ ] **T8.3** Report live bytes written and remaining-time estimate from observed byte rate in `capture-status`.
- [ ] **T8.4** Unit-test preflight block, mid-record graceful stop, and estimate math with a mocked `storage.estimate`.

## T9 — Landing + alignment

- [ ] **T9.1** Compute `epochUs` = min first-sample timestamp across tracks; per-track placement offset = `firstSampleTs − epochUs`; never force-zero offsets.
- [ ] **T9.2** Land each track file through the existing import/inspection path as a P11 media asset with a P23 fingerprint; create one dedicated timeline track per source with one clip at its offset; emit `capture-landed`.
- [ ] **T9.3** Mark screen tracks `frameRateMode: 'variable'` with observed effective fps so `SequentialFrameSource` uses per-frame durations. Last frame duration = `stopTime − lastFrameTimestamp` on session stop (not previous delta) so landed duration matches the actual recorded span (PR #49 / B3 guard).
- [ ] **T9.4** Make the landing one undoable operation via the existing P9 command path.
- [ ] **T9.5** Runtime cross-clock sanity check: warn (without re-aligning) when `performance.now()`-anchored first-sample skew across tracks exceeds threshold.
- [ ] **T9.6** Unit-test alignment with synthetic capture clocks: landed offsets mutually consistent within one audio quantum (128 frames at context rate); 44 ms-style audio lead preserved.

## T10 — Record panel UI

- [ ] **T10.1** Create `src/ui/RecordPanel.tsx`: Add screen / camera picker / mic picker / capability-gated audio toggle (disabled-with-reason), chunk-duration setting, Start/Stop, elapsed, per-source status chips with drop warnings, bytes + remaining time, monitor tiles.
- [ ] **T10.2** Gate the whole panel on `recordingAvailable`; disabled state lists each missing probe with its action link; never hide silently.
- [ ] **T10.3** Status-bar recording indicator (not colour-only) and `beforeunload` confirmation while recording.
- [ ] **T10.4** Accessibility pass per steering: keyboard operation, ARIA labels, focus management, contrast; `onCleanup` for all listeners and object URLs.

## T11 — Tests and non-regression

- [ ] **T11.1** All capture unit tests run against `capture-fixtures.ts` mocks (scripted MSTP readers, spy encoders, fault-injecting sync handle); no media fixtures in CI.
- [ ] **T11.2** Playwright (UI-critical happy path only): launch with fake-device flags, start camera+mic recording, stop, assert two new timeline tracks land. Recovery/quota/VFR stay in unit tests.
- [ ] **T11.3** Assert no capture module imports from the accelerated preview pipeline; pipeline-worker playback loop untouched; no media/encoder/OPFS handles reachable from `src/ui/`.
- [ ] **T11.4** `npm run build` and `npm test` green; test count grows.

## T12 — Documentation and manual verification

- [ ] **T12.1** `docs/USER-GUIDE.md`: recording section — starting a session, one-gesture-per-screen-source rule, audio capability matrix summary, crash recovery flow, where recordings are stored.
- [x] **T12.2** Add Phase 41 to the AGENTS.md spec index.
- [ ] **T12.3** Manual: 2-minute screen+mic recording on Chromium — tracks land aligned; static-window capture plays back without frame-skip cadence; kill-tab mid-record → recovery dialog → import succeeds.
- [ ] **T12.4** Manual: system-audio toggle disabled-with-reason on an unsupported OS; Safari/Firefox show the disabled panel with per-probe reasons; no crash.

## T13 — Own-tab DOM event sidecar

Captures the editor's own DOM events (keystroke combos via the existing P44 `shouldRecordKey` gate; pointer-down/-up reserved for P43 cursor effects) into a per-session `events.ndjson` alongside the track files, without coupling listeners to the worker-owned session lifecycle. The worker drives both edges via `capture-dom-tap-init`/`capture-dom-tap-stop`, so DOM listeners are only installed while a session is live; main never observes the session ID independently.

- [x] **T13.1** SAB ring layout in `src/protocol.ts`: 16-int32 header (magic, schema, capacity, record size, write/read indices, drop count, generation) + 1024 fixed 64-byte records (32-byte fixed fields + 32-byte UTF-8 string buffer); power-of-two capacity for `& (CAPACITY - 1)` slot math.
- [x] **T13.2** Worker → main lifecycle messages `capture-dom-tap-init` (sessionId, SAB, epochMs) and `capture-dom-tap-stop` (sessionId).
- [x] **T13.3** `src/engine/capture/event-ring.ts`: single-producer / single-consumer ring with `Atomics.load`/`store` on write/read indices and `Atomics.add` on the drop counter; never blocks the main thread on a full ring.
- [x] **T13.4** `src/ui/capture-dom-tap.ts`: main-thread CaptureDomTap singleton. Default attaches `document` on session start; same-origin iframes opt-in via `attachDocument(doc)`. Capture-phase passive listeners; auto-detach on stop or App unmount.
- [x] **T13.5** `CaptureSession.attachEventRing(ring)` drains the ring on every `emitStatus()` (chunk-flush cadence) plus a 250 ms backstop interval so silent-screen sessions don't fill the ring; final drain runs inside `stop()` before finalize.
- [x] **T13.6** Writer worker opens `events.ndjson` per session alongside `manifest.ndjson` and appends `write-event-batch` JSON lines; non-fatal sidecar — track recovery never depends on it.
- [x] **T13.7** Unit tests for ring layout, FIFO across wraparound, overflow drop counter, cross-origin attach rejection, gate-driven key recording, and start/stop idempotency.
- [ ] **T13.8** Wire the existing `KeystrokeOverlayPanel` to consume the sidecar on session land (auto-populate the entries log) instead of running its own `window` listener — currently the panel still self-records, so during an active capture both paths run independently. Track the migration here.
- [ ] **T13.9** Crash-recovery and import paths read `events.ndjson` when present and offer to regenerate the keystroke overlay track from the sidecar; missing/torn sidecar is silently ignored.
- [ ] **T13.10** User-guide section on what is and is not captured (no printable text, no values from text inputs, no cross-origin iframe events).
