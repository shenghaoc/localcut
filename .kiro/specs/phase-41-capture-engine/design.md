# Design: Phase 41 — Capture Engine

> Status: **Active / foundation implemented** — recording as a first-class source. Capture streams are hardware-encoded while recording, streamed to OPFS in crash-safe chunks, and land as separate, sample-aligned timeline tracks. See `tasks.md` for the implemented-vs-open breakdown.

## Goal

Make "record" a peer of "import": the user captures any combination of screen/window/tab, webcam, microphone, and (where the platform allows) system audio. Each source is encoded live through WebCodecs and written incrementally to OPFS so a tab kill loses at most the last chunk. Stopping (or recovering after a crash) lands every source as its own P11 media asset and timeline track with capture timestamps preserved — nothing is premixed, so everything stays editable.

This phase is the recording substrate that later phases compose: Phase 45 scene mixing, Phase 46 replay buffer, and Phase 47 streaming all consume the per-track ISO pipelines defined here.

## Non-goals

- **Scene mixing / live compositing** — Phase 45. v1 records sources independently; there is no program output.
- **Live streaming out** — Phase 47.
- **Replay buffer** — Phase 46. No ring-buffer retention; recording is start/stop.
- **Cursor effects** (highlight, zoom-follow) — Phase 43.
- **Pause/resume UX polish** — Phase 42. v1 sessions are a single continuous take.
- **Audio mixing beyond existing P16 buses** — landed audio tracks use the existing per-track gain/pan/master bus; no live mixer.
- **Live audio monitoring** — self-monitor video tiles only; audio monitor is muted (feedback safety).
- **Non-Chromium recording tiers** — the capability matrix documents Safari/Firefox honestly, but v1 gates recording to the accelerated tier.

## Dependencies

Builds only on shipped phases: P8/P26 capability gating and diagnostics, P11 media assets/tracks, P18 conformance metadata (`frameRateMode`), P23 fingerprints, P9 undo, and the Mediabunny `Output`/`StreamTarget` machinery already used by `src/engine/export.ts`. No dependency on unimplemented phases.

## Capability gating

Recording requires `CapabilityTierV2 === 'core-webgpu'` **and** every capture-critical probe below. Probes extend `CapabilityProbeResult` (new optional `capture` group) and render as new `CapabilityMatrixPanel` rows.

| Probe | How | Critical? |
|---|---|---|
| `mediaStreamTrackProcessor` | constructor presence (video + audio kinds) | yes |
| `transferableMediaStreamTrack` | `structuredClone(track, {transfer})` smoke probe on a canvas-captured track | yes |
| `displayCapture` | `getDisplayMedia` presence (gesture-free presence check only) | yes for screen sources |
| `displayAudioCapture` | constraint-acceptance probe; result may be `unknown` until first real picker | no — gates audio toggle only |
| `videoEncodeRealtime` | `VideoEncoder.isConfigSupported` H.264 1080p, `latencyMode: 'realtime'`, `hardwareAcceleration: 'prefer-hardware'`, recording whether the hardware-preferred or fallback config passed | yes |
| `audioEncode` (Opus, AAC separately) | `AudioEncoder.isConfigSupported` | Opus yes; AAC optional |
| `opfsSyncAccessHandle` | `createSyncAccessHandle` smoke probe on a scratch file in a worker | yes |

### Reference capture capability matrix

> Verified at spec-writing time; re-check at implementation and before each release. Documentation only — runtime behaviour derives from probes, never UA strings.

| Capability | Chromium desktop | Safari | Firefox |
|---|---|---|---|
| `getDisplayMedia` video (screen/window/tab) | ✓ | ✓ | ✓ |
| Tab audio capture | ✓ (desktop) | ✗ | ✗ |
| System audio capture | Windows, ChromeOS; **macOS only Chrome 141+ on macOS 14.2+** | ✗ | ✗ |
| `getUserMedia` camera/mic | ✓ | ✓ | ✓ |
| `MediaStreamTrackProcessor` | ✓ | partial/in-flight — treat as probe-determined | ✗ |
| Transferable `MediaStreamTrack` | ✓ | ✗ | ✗ |
| WebCodecs realtime encode | ✓ | partial | ✗ |
| OPFS `SyncAccessHandle` | ✓ | ✓ | ✓ |
| **Recording v1 verdict** | **enabled** | disabled with reasons | disabled with reasons |

Safari/Firefox therefore capture nothing in v1 (panel disabled with per-row reasons); when they do gain capture in a later tier, their screen capture is video-only — the matrix and Record panel reasons must say so.

## Acquisition flow (main thread)

```
[Add screen]  → getDisplayMedia({ video, audio: toggle })   // one gesture per source, every time
[Camera]      → getUserMedia({ video: { deviceId } })       // enumerateDevices only post-permission
[Mic]         → getUserMedia({ audio: { deviceId } })
                  ↓ per acquired track
monitor = track.clone()         → <video srcObject> tile (browser-composited; muted)
worker  ← postMessage('capture-add-source', { track }, [track])   // transferred original
monitor.onended (browser "Stop sharing") → same path as in-app stop for that source
// NB: transferred tracks are detached on main; only the clone's onended fires there
```

No silent enumeration of display surfaces exists on the platform and none is attempted; camera/mic enumeration happens only after a permission grant. Denial, cancellation, and `NotReadableError` each map to distinct recoverable UI states.

## Worker pipeline

Ingestion and encoding run in the **pipeline worker** (it already owns WebCodecs and capability state, and Phase 45 will need these frames for compositing). All blocking OPFS I/O runs in a separate **capture writer worker**, so `SyncAccessHandle.write()`/`flush()` can never stall the playback loop (R0.7).

```
pipeline worker (per track)                          capture writer worker (per session)
────────────────────────────                         ───────────────────────────────────
MediaStreamTrackProcessor.readable
  → reader loop (AbortController)
      VideoFrame ts preserved ──→ VideoEncoder ──→ EncodedVideoChunk
      frame.close()  // exactly once                       │
      backpressure: encodeQueueSize > 8 ⇒                  ▼
        pre-encode drop of non-key VideoFrame,     Mediabunny Output
        increment drop counter + append             (Mp4OutputFormat fragmented,
        pre-encode-gap manifest record
                                                     EncodedVideoPacketSource /
AudioData ts preserved ──→ AudioEncoder              EncodedAudioPacketSource)
  audioData.close() // exactly once                        │ StreamTarget chunks
  encodeQueueSize > 16 sustained for ≥ 4 frames            ▼ postMessage(ArrayBuffer, transfer)
    ⇒ graceful stop ('audio-overrun')
                                                    SyncAccessHandle.write(chunk)
                                                    SyncAccessHandle.flush()
                                                    manifest.append(record); manifest.flush()
                                                          ▼ postMessage({ type: 'chunk-ack', sourceId })
```

Writer→pipeline backpressure: the pipeline worker limits in-flight chunks per track (max 2 in-flight per track). Each chunk is sent with a transfer; the writer worker sends a short `chunk-ack` after chunk + manifest flush completes. The pipeline worker does not send the next chunk until the in-flight count drops below the bound. This prevents unbounded message-queue growth when `SyncAccessHandle` writes/flushes stall under I/O pressure. The writer worker also sends a `chunk-error` message on write failure, triggering the per-source error policy (R6.6).

Audio overrun rationale: audio frames are small and frequent (~10 ms per `AudioData` at 48 kHz). The audio encode queue uses a higher bound (16, vs 8 for video) and requires sustained overrun (≥ 4 consecutive frames above threshold) before triggering a graceful stop. This prevents premature shutdown from brief encode bursts without allowing silent audio loss — audio is never dropped; overrun always leads to a surfaced stop with reason `audio-overrun`.

Frame lifetime invariants:

| Object | Closed by | When |
|---|---|---|
| `VideoFrame` from MSTP | reader loop | immediately after `encoder.encode(frame)` returns, or on drop/abort |
| `AudioData` from MSTP | reader loop | immediately after `encoder.encode(data)` returns, or on abort |
| Encoded chunk buffers | writer worker | transferred, written, then released with the fragment buffer |

Per-source failure policy: a video pipeline error finalizes that source's file and the session continues if another source remains; the UI names the failed source. Audio failure ⇒ graceful stop (audio loss is never silent).

## Container choice: fragmented MP4 (Matroska rejected)

**Chosen:** fMP4 per track via Mediabunny `Output` + `Mp4OutputFormat({ fastStart: 'fragmented' })` + `StreamTarget`, fed by Mediabunny's encoded-packet sources (no re-encode; WebCodecs chunks pass straight through).

- **Append-only.** Fragmented output never backpatches earlier bytes, so it composes with sequential `SyncAccessHandle` appends and byte-offset manifest records. Non-fragmented MP4 (moov backpatch) is disqualified outright.
- **Truncation-tolerant at fragment granularity.** Init segment + N complete `moof`/`mdat` pairs is a valid, demuxable MP4 — recovery is "truncate to last manifest offset", no container surgery.
- **Codec coverage.** H.264 (the hardware-encode default) + AAC and Opus all mux into fMP4; one container family covers every track type including audio-only.
- **Zero new dependencies, import-for-free.** The same Mediabunny `Output`/`StreamTarget` machinery `export.ts` already uses; recovered files demux through the existing Mediabunny import path unchanged (R6.3), keeping record→import→export in one container family.

**Matroska/WebM rejected:** clusters are also append-friendly and codec-flexible, but recovering a torn EBML stream needs custom element scanning (vs fMP4's "valid prefix" property), it adds a second container family to the import/recovery surface, and it buys nothing while v1 is Chromium-tier with H.264 hardware encode. Revisit only if a future tier requires VP9-in-WebM for platform reasons.

A key frame is requested at each chunk boundary (`encode(frame, { keyFrame: true })`) so every fragment starts independently decodable; fragment flush is cut at key-frame arrival, targeting the configured chunk duration (default 2 s, range 1–4 s).

## OPFS layout + chunk manifest

```
opfs:/capture/<sessionId>/
  manifest.ndjson        append-only log (own sync handle)
  video-<sourceId>.mp4   one fMP4 per track — never premixed
  audio-<sourceId>.mp4
```

`manifest.ndjson` records (structured-clone-safe; surfaced types get the protocol `Snapshot` suffix):

```typescript
type CaptureManifestRecord =
  | { kind: 'header'; version: 1; sessionId: string; startedAtIso: string;
      epochUs: number | null;                       // patched forward via 'epoch' record
      sources: CaptureSourceSnapshot[];             // id, type, label, encoder config, hw/fallback
      chunkTargetS: number }
  | { kind: 'epoch'; epochUs: number }              // min first-sample ts, once known
  | { kind: 'chunk'; sourceId: string; file: string;
      byteOffset: number; byteLength: number;
      fromUs: number; toUs: number; keyFrame: boolean;
      preEncodeDrops: number }                      // VideoFrames dropped before encode (backpressure gaps)
  | { kind: 'source-ended'; sourceId: string; reason: CaptureSourceEndReason }
  | { kind: 'finalize'; endedAtIso: string; reason: CaptureStopReason };
```

Per-chunk write ordering (the crash-safety contract): **data write → data flush → manifest append → manifest flush.** A kill between any two steps loses at most the in-flight chunk; a torn final manifest line is tolerated by the parser. Writer buffers are bounded to one fragment + fixed slack per track; overflow is a surfaced session error, never silent growth.

## Crash recovery

Boot runs a read-only `scanCaptureSessions()` in the writer worker: any session directory whose manifest lacks a `finalize` record is an orphan, reported via `capture-recovery-list`. The recovery dialog lists date, sources, recovered duration, and size per orphan; the user picks **Import** or **Discard** (discard deletes the directory; nothing is auto-deleted).

Import path: parse manifest tolerating a torn tail line → per track, truncate the file to the last recorded `byteOffset + byteLength` → validate record arithmetic against actual file length → land exactly like a clean stop. Unreadable artifacts report which file failed and still offer Discard.

## Timestamps, VFR, and alignment (PR #49 lessons from day one)

- **Preserve, never synthesize.** MSTP `timestamp`s pass through to encoder and container unmodified. Screen capture is inherently VFR (long static holds, bursts on motion): per-sample duration = delta to the next capture timestamp. On session stop, the last VFR frame's duration is extended to `stopTime − lastFrameTimestamp` (not blindly reusing the previous delta), so the final frame covers the gap to the stop command and landed duration matches the actual recorded span. No nominal-fps grid anywhere (the B3 lesson).
- **Landed metadata is honest.** Screen tracks land with `frameRateMode: 'variable'` and observed (not nominal) effective fps, so `SequentialFrameSource` uses per-frame durations.
- **Offsets are data, not noise.** Session `epochUs` = min first-sample timestamp across tracks; each clip lands at `firstSampleTs − epochUs`. Tracks are never force-zeroed to "line up" (the 44 ms audio-lead lesson).
- **Cross-clock sanity.** Chromium capture timestamps share a monotonic clock domain; the pipeline still anchors each track's first sample against `performance.now()` and warns (without re-aligning) if inter-track anchor skew exceeds threshold. Target: landed tracks mutually aligned within one audio quantum (128 frames at context rate; ≈ 2.67 ms at 48 kHz), unit-tested with synthetic clocks.

## Storage preflight + quota watch

- **Preflight:** `navigator.storage.estimate()` must show headroom ≥ 60 s × configured total bitrate + fixed overhead, else Start is blocked with the shortfall stated.
- **Live watch:** re-estimated on every chunk flush (piggybacks existing I/O cadence; no timers). Below the graceful-stop floor (`max(2 × per-flush ceiling, 64 MiB)`), the session stops gracefully: finalize all tracks, write `finalize { reason: 'quota' }`, land tracks, notify with sizes.
- **UI:** live bytes written + remaining-time estimate from the *observed* byte rate.

## Landing

On clean stop or recovery import, one undoable operation (P9): each track file → existing Mediabunny inspection → P11 media asset with P23 fingerprint → new dedicated timeline track (`type: 'video'` for screen/webcam, `'audio'` for mic/system audio) with one clip placed at the track's epoch offset. Existing tracks and project state are untouched; sessions that the user discards never touch the project.

## Protocol additions

New `WorkerCommand` members and state messages (kebab-case, structured-clone-safe; `MediaStreamTrack` rides the transfer list):

```typescript
| { type: 'capture-add-source'; source: CaptureSourceDescriptor; track: MediaStreamTrack }
| { type: 'capture-remove-source'; sourceId: string }
| { type: 'capture-start'; settings: CaptureSettingsSnapshot }
| { type: 'capture-stop' }
| { type: 'capture-recovery-import'; sessionId: string }
| { type: 'capture-recovery-discard'; sessionId: string }

interface CaptureStatusMessage   { type: 'capture-status'; state: 'idle'|'armed'|'recording'|'stopping';
                                   elapsedUs: number; bytesWritten: number; remainingSeconds: number | null;
                                   sources: CaptureSourceStatusSnapshot[] }   // per-source chips, drop counts
interface CaptureErrorMessage    { type: 'capture-error'; sourceId: string | null; code: CaptureErrorCode; detail: string }
interface CaptureRecoveryList    { type: 'capture-recovery-list'; sessions: CaptureRecoverySessionSnapshot[] }
interface CaptureLandedMessage   { type: 'capture-landed'; sessionId: string; trackIds: string[] }
```

## UI

- **`RecordPanel.tsx`** — Add screen (one gesture each), camera/mic pickers, capability-gated system/tab-audio toggle (disabled-with-reason when unsupported), chunk-duration setting, Start/Stop, elapsed, per-source chips with drop warnings, bytes + remaining-time, monitor tiles (`<video srcObject>`, muted). Keyboard operable, ARIA-labeled, focus-managed per the accessibility steering.
- **`CaptureRecoveryDialog.tsx`** — orphan list with Import/Discard per session.
- **Status bar** — persistent recording indicator (not colour-only); `beforeunload` confirmation while recording.
- **Docs** — `docs/USER-GUIDE.md` section: starting a recording, one-gesture-per-screen-source, audio capability summary, crash recovery, where recordings live.

## Modules

| Module | Description |
|---|---|
| `src/engine/capture/capture-session.ts` | Session orchestrator: source registry, start/stop, epoch, landing, error policy |
| `src/engine/capture/track-pipeline.ts` | Per-track MSTP reader loop + encoder + backpressure; close-exactly-once owner |
| `src/engine/capture/fragmented-writer.ts` | Mediabunny fragmented-MP4 `Output`/`StreamTarget` per track → writer-worker chunks |
| `src/engine/capture/writer-worker.ts` | Dedicated worker owning all `SyncAccessHandle` I/O + manifest append/flush + recovery scan |
| `src/engine/capture/chunk-manifest.ts` | NDJSON record types, append/parse (torn-tail tolerant), recovery truncation math |
| `src/engine/capture/quota.ts` | Preflight + per-flush quota watch + graceful-stop floor |
| `src/engine/capture/capture-fixtures.ts` | Mock MSTP readers, spy encoders, in-memory fault-injecting sync handle |
| `src/ui/RecordPanel.tsx`, `src/ui/CaptureRecoveryDialog.tsx` | Record panel + recovery dialog |
| `src/protocol.ts` | Capture commands, status/error/recovery messages, snapshots, probe extensions |

## Library policy

No new third-party libraries. Muxing, demuxing, and import inspection are Mediabunny (already in-tree, actively developed); everything else is platform API (WebCodecs, MSTP, OPFS, Permissions). If implementation finds a Mediabunny fragmented-output gap, the fallback is contributing upstream or a minimal in-house fMP4 fragmenter — adding a second muxing library is not on the table without an AGENTS.md-criteria justification added here.

## Validation

| Scenario | Expected result |
|---|---|
| 2 min screen+mic record, clean stop | Two new tracks land at correct offsets; files demux via existing import; undo removes both as one operation |
| Kill tab at minute 1, relaunch | Recovery dialog lists the orphan; Import lands tracks missing ≤ 1 chunk per track (fault-injection unit test mirrors this) |
| 30-minute 1080p mocked session | All buffer high-water marks constant; manifest in-memory state O(1) (R10.3) |
| Screen capture of a static window | VFR durations honoured: long frame deltas preserved, no frame-skip cadence on playback (B3 regression guard) |
| Mic starts 44 ms after screen | Clips land offset by 44 ms; nothing force-zeroed; skew ≤ one audio quantum with synthetic clocks |
| Quota near-full at start / mid-record | Start blocked with shortfall / graceful stop with `quota` reason; manifest finalized; tracks landed |
| "Stop sharing" browser bar | Source ends via `monitor.onended` (clone's event fires on main after transfer); same finalize path; session continues or stops per remaining sources |
| System-audio toggle on unsupported OS | Toggle visible but disabled with reason before recording |
| Safari/Firefox | Record panel disabled with per-probe reasons; no crash; rest of app unaffected |
| `npm run build` / `npm test` | Green; test count grows |
