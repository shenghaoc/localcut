# Design: Phase 46 — Replay Buffer and Live Audio Chain

> Status: **Implemented (v1)** — live capture, GOP-aligned ring buffer with OPFS spill, instant replay clip drop, and the live audio insert chain on the recording path (print-to-recording). The monitor-path AudioWorklet (hearing the processed chain live) is a tracked follow-up; see tasks T6.2–T6.7.

## Goal

Add an always-on replay buffer that continuously encodes a browser capture session into a GOP-aligned ring buffer, letting the user save the last N seconds as a timeline clip at any moment without interrupting recording. Complement this with a live audio processing chain (gate, compressor, limiter) in the AudioWorklet monitor path so the user hears a polished signal during capture, with measured and surfaced latency.

## Non-goals (this phase)

- ShadowPlay-style OS-wide background capture (browser sessions only).
- Multiple simultaneous replay tracks in v1 (one capture session at a time).
- GPU-accelerated live effects on the capture video path (the replay buffer stores raw encoded frames).
- Automatic/scheduled saves (only manual "Save Last N Seconds" in this phase).
- Live streaming output (the buffer feeds only local save-to-timeline).
- The Phase 36 denoiser itself — only the insert slot is reserved in the chain architecture.
- Camera + display simultaneous capture (single `getDisplayMedia` or `getUserMedia` at a time).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Main thread (SolidJS UI)                                             │
│                                                                      │
│  getUserMedia / getDisplayMedia() → MediaStream                      │
│  │                                                                    │
│  ├─ VideoTrack → MediaStreamTrackProcessor → ReadableStream<VideoFrame>
│  │                 │ transferred to worker                            │
│  ├─ AudioTrack → MediaStreamTrackProcessor → ReadableStream<AudioData>
│  │                 │ transferred to worker                            │
│  └─ MediaStream → <video> (muted preview) + AudioWorklet monitor path │
│                                                                      │
│  ReplayBufferPanel.tsx ← typed messages → worker                     │
│  LiveAudioChainPanel.tsx ← typed messages → worker                   │
│                       ↕ SAB meters (Phase 16, extended)              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ postMessage
┌──────────────────────────────▼───────────────────────────────────────┐
│ Pipeline worker (src/engine/worker.ts)                                │
│                                                                      │
│  ReadableStream<VideoFrame> ──→ VideoEncoder ──→ GOP-aligned ring    │
│  ReadableStream<AudioData>  ──→ AudioEncoder  ──→     buffer         │
│                                                     │                │
│                                          ┌──────────┴──────────┐     │
│                                          │  In-memory chunk store│     │
│                                          │  (RAM budget 256 MiB) │     │
│                                          │  OPFS spill (excess) │     │
│                                          └─────────────────────┘     │
│                                                     │                │
│  User "Save Last N" ──→ assemble chunks ──→ Mediabunny mux           │
│                              │                  │                    │
│                              ▼                  ▼                    │
│                         OPFS asset        timeline insert             │
│                                                                      │
│  Live audio chain control ──→ AudioWorklet (via SAB params)          │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ AudioWorklet (monitor path)                                          │
│                                                                      │
│  Capture audio + timeline mix ──→ [Gate] → [Compressor] → [Limiter]  │
│                                   ↕ SAB params (bypass, threshold,   │
│                                          ratio, attack, release...)  │
│                                   ──→ monitor output (speakers)       │
│                                   ──→ SAB meters (insert levels,     │
│                                          aggregate latency)           │
└─────────────────────────────────────────────────────────────────────┘
```

Key boundaries:

- **Main thread** owns the `MediaStream` and `MediaStreamTrackProcessor` instantiation, the monitor `<video>` element, and the UI panels. It transfers `ReadableStream` handles to the worker; no frame processing on main.
- **Pipeline worker** owns the encoders, the ring buffer, OPFS spill management, the save assembly/mux path, and the live audio chain parameter dispatch. It gains new command handlers for replay buffer and live chain operations — no changes to the existing playback/export pipeline.
- **AudioWorklet** owns the live audio insert DSP. Parameters are written by the pipeline worker into an extended SAB layout; the worklet reads them atomically per processing block.

## Capture Path

### Media Stream Acquisition

`getDisplayMedia({ video: true, audio: true })` for tab/window capture, or `getUserMedia({ video: true, audio: true })` for camera/mic. The resulting `MediaStream` is used in three ways:

1. **Video track** → `new MediaStreamTrackProcessor({ track: videoTrack })` → `ReadableStream<VideoFrame>` transferred to the pipeline worker.
2. **Audio track** → `new MediaStreamTrackProcessor({ track: audioTrack })` → `ReadableStream<AudioData>` transferred to the pipeline worker.
3. **Full stream** → attached to a muted `<video>` element on main for visual monitoring, and connected to the `AudioContext` destination via the monitor path for live audio monitoring.

### Encoder Setup in Worker

On receipt of the `ReadableStream`, the worker creates:

```typescript
// Video encoder — configured for low-latency, constant quality
const videoEncoder = new VideoEncoder({
  output: (chunk, metadata) => ringBuffer.pushVideo(chunk, metadata),
  error: (err) => reportCaptureError('video-encoder', err),
});
videoEncoder.configure({
  // H.264 High 4.2 first, probed via isConfigSupported with constrained-
  // baseline fallbacks (see CAPTURE_VIDEO_CODEC_FALLBACKS in capture.ts).
  codec: 'avc1.64002a',
  width: trackSettings.width,
  height: trackSettings.height,
  framerate: trackSettings.frameRate ?? 30,
  bitrate: 8_000_000,
  latencyMode: 'realtime',
  // 'avc' (length-prefixed + decoderConfig.description) — required by the
  // mp4 muxer; annexb would not carry an avcC box.
  avc: { format: 'avc' },
});

// Audio encoder
const audioEncoder = new AudioEncoder({
  output: (chunk, metadata) => ringBuffer.pushAudio(chunk, metadata),
  error: (err) => reportCaptureError('audio-encoder', err),
});
audioEncoder.configure({
  codec: 'mp4a.40.2', // AAC-LC
  sampleRate: trackSettings.sampleRate ?? 48000,
  numberOfChannels: trackSettings.channelCount ?? 2,
  bitrate: 128_000,
});
```

The reader loop runs on the `ReadableStream` in the worker:

```typescript
async function captureLoop(videoStream: ReadableStream<VideoFrame>, audioStream: ReadableStream<AudioData>) {
  const videoReader = videoStream.getReader();
  const audioReader = audioStream.getReader();
  // Read both streams concurrently; encode each frame as it arrives
  // VideoFrame.close() after encode
  // AudioData.close() after encode
}
```

### Capability Gating

`MediaStreamTrackProcessor` availability is probed at editor startup alongside existing probes; the replay buffer feature is disabled when unsupported. `crossOriginIsolated` is required only for the Live Audio Chain; when absent, the replay buffer works normally and the live audio chain is disabled with a message. (The v1 print-to-recording path runs in the pipeline worker and does not itself need SABs; the chain stays isolation-gated for forward compatibility with the monitor-path worklet's SAB params/meters.)

## GOP-Aligned Ring Buffer

### Data Model

```typescript
interface RingBufferEntry {
  type: 'video' | 'audio';
  data: Uint8Array;     // encoded chunk bytes, copied out of the WebCodecs chunk
  timestamp: number;    // capture-clock time in seconds
  duration: number;     // seconds
  byteSize: number;     // data.byteLength
  isKeyframe: boolean;  // always false for audio entries
}
```

Entries hold copied bytes rather than live `EncodedVideoChunk`/`EncodedAudioChunk` references: copies survive OPFS spill round-trips unchanged, need no explicit release tracking, and feed Mediabunny `EncodedPacket`s directly at save time.

```typescript

interface RingBufferState {
  entries: RingBufferEntry[];          // in-memory portion (hot tail)
  spilledRanges: SpillRange[];         // OPFS-backed cold segments
  config: {
    maxDurationS: number;              // configured limit (default 30)
    maxMemoryBytes: number;            // RAM budget (default 256 MiB)
  };
  stats: {
    totalDurationS: number;
    memoryBytes: number;
    spilledBytes: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
    keyframeCount: number;
    droppedFrameCount: number;
  };
}

interface SpillRange {
  startTimestamp: number;
  endTimestamp: number;
  opfsFileName: string;    // relative path under OPFS replay-buffer/
  byteCount: number;
  entryCount: number;
  hasKeyframe: boolean;
}
```

### GOP Alignment

The ring buffer tracks keyframe positions. When eviction is needed (total duration exceeds limit):

1. Find the oldest keyframe such that all chunks after it have total duration ≤ max duration.
2. If no such keyframe exists (e.g., a single GOP exceeds the buffer limit), evict to the oldest keyframe and warn (dropped-frame counter incremented).
3. Drop all entries (video + audio) with timestamp < the eviction cutoff.
4. Delete any OPFS spill files whose range is fully evicted.

When saving the last N seconds:

1. Start timestamp `T_start = newestTimestamp - N`.
2. Find the nearest video keyframe at or before `T_start` → `T_keyframe`.
3. The save range is `[T_keyframe, newestTimestamp]`. All video chunks from `T_keyframe` forward + all audio chunks where timestamp ≥ `T_keyframe` are included, ensuring the clip starts on a clean keyframe.

### OPFS Spill Strategy

```
┌──────────────────────────────────────────────────────────┐
│  OPFS (cold, oldest)           │  RAM (hot, newest)       │
│  ┌──────────┐ ┌──────────┐     │  [chunk][chunk][chunk]   │
│  │spill_001 │ │spill_002 │     │                          │
│  │t=0..15s  │ │t=15..25s │     │  t=25..30s              │
│  └──────────┘ └──────────┘     │                          │
└──────────────────────────────────────────────────────────┘
  ◄──────── eviction direction ──────── write direction ──►
```

- When `memoryBytes` exceeds `maxMemoryBytes`, the oldest contiguous in-memory entries are serialized into an OPFS file (one `SpillRange` per spill operation). Each spill file stores a header (start/end timestamps, entry count, keyframe bitmap) followed by chunk data in order.
- Spill files are named `replay-spill-{seq}-{startTimestamp.toFixed(3)}.bin` under an OPFS directory `replay-buffer/`.
- On save, assembly reads from OPFS spill files for the cold range then from in-memory for the hot range, merging in timestamp order.
- Spill files are deleted when their entire timestamp range is evicted from the ring.

### Concurrent Save + Write

Save takes a snapshot of chunk references (not copies) at invocation time. New chunks added to the ring during a save are not included in the current save but remain in the ring for the next save. The ring is a circular log, not a queue being consumed — save is a non-destructive read.

## Replay Save Flow

```
User presses "Save Last N" (or keyboard shortcut)
  │
  ▼
Worker: determine save range [T_keyframe, T_newest]
  │
  ▼
Worker: collect chunk references from ring buffer (in-memory + OPFS)
  │  ── new chunks may arrive concurrently; they go into the ring, not the save
  ▼
Worker: create Mediabunny muxer  ──→ OPFS temp file
  │
  ▼
Worker: feed video chunks + audio chunks to muxer in timestamp order
  │  ── report progress (chunks written / total chunks)
  ▼
Worker: finalize mux → OPFS asset file
  │
  ▼
Worker: register asset (fingerprint, Phase 23) → media bin entry
  │
  ▼
Worker: issue timeline mutation: insert clip at playhead / end of project
  │  ── command flows through snapshot undo/redo (Phase 9)
  ▼
UI: clip appears on timeline; notification shows save complete
```

The save operation reuses the existing Mediabunny mux path (Phase 6) by feeding it `EncodedChunk` references from the ring buffer, avoiding a decode/re-encode round-trip. The muxer writes directly to OPFS; the resulting file is a valid MP4 or WebM.

## Live Audio Chain

### Insert Architecture

The chain runs in the AudioWorklet processor on the monitor path — after capture audio + timeline audio are mixed, before the destination output. Each insert is a standalone processing function with a shared parameter interface:

```typescript
interface AudioInsertParams {
  bypass: boolean; // 0 = active, 1 = bypassed
}

interface GateParams extends AudioInsertParams {
  thresholdDb: number;    // dBFS, e.g. -40
  rangeDb: number;        // attenuation when closed, e.g. -80
  attackMs: number;       // e.g. 0.1
  holdMs: number;         // e.g. 20
  releaseMs: number;      // e.g. 50
}

interface CompressorParams extends AudioInsertParams {
  thresholdDb: number;    // dBFS, e.g. -24
  ratio: number;          // e.g. 4
  attackMs: number;       // e.g. 5
  releaseMs: number;      // e.g. 100
  kneeDb: number;         // e.g. 6
  makeupGainDb: number;   // e.g. 0
}

interface LimiterParams extends AudioInsertParams {
  ceilingDb: number;      // dBFS, e.g. -1
  attackUs: number;       // microseconds, e.g. 100
  releaseMs: number;      // e.g. 50
}
```

### SAB Parameter Interface

Parameters are written by the pipeline worker into an extended SAB layout (appended to the existing Phase 16 meter SAB). The AudioWorklet reads parameters atomically at the start of each processing block (128 samples).

```
SAB layout (Float32Array):
  [0..3]     Phase 16 meters: peakL, peakR, rmsL, rmsR
  [4..5]     Insert 1 (Gate) input peak L/R
  [6..7]     Insert 1 (Gate) output peak L/R
  [8..9]     Insert 2 (Compressor) input peak L/R
  [10..11]   Insert 2 (Compressor) output peak L/R
  [12..13]   Insert 3 (Limiter) input peak L/R
  [14..15]   Insert 3 (Limiter) output peak L/R
  [16]       Aggregate chain latency (samples)
  [17]       Gate: bypass flag (0/1)
  [18]       Gate: threshold (dBFS)
  [19]       Gate: range (dB)
  [20]       Gate: attack (ms)
  [21]       Gate: hold (ms)
  [22]       Gate: release (ms)
  [23]       Compressor: bypass flag (0/1)
  [24]       Compressor: threshold (dBFS)
  [25]       Compressor: ratio
  [26]       Compressor: attack (ms)
  [27]       Compressor: release (ms)
  [28]       Compressor: knee (dB)
  [29]       Compressor: makeup gain (dB)
  [30]       Limiter: bypass flag (0/1)
  [31]       Limiter: ceiling (dBFS)
  [32]       Limiter: attack (µs)
  [33]       Limiter: release (ms)
  [34]       Denoiser: bypass flag (0/1) — reserved, always 1 until Phase 36
  [35..47]   Reserved for Phase 36 denoiser parameters (13 slots pre-sized so the SAB never resizes)
```

### Latency Measurement

Each insert reports its processing delay: the number of samples between the first input sample and the corresponding first output sample. For the gate (lookahead optional but not required), latency is 0; for a lookahead compressor/limiter, it may be non-zero. The worklet accumulates per-insert latency into `SAB[16]` each block.

Aggregate chain latency (sum of active inserts) is displayed in ms at the current `AudioContext.sampleRate`. This is diagnostic data — the latency is inherent to the monitoring path; no compensation is applied.

### Denoiser Slot

A reserved insert slot between the gate and compressor in the chain topology. In this phase, the slot is a permanent bypass (identity pass-through, zero latency). The SAB layout reserves space for denoiser parameters. The UI shows the slot as disabled with a text label: "Noise suppression — available in a future update".

### Chain Bypass Behaviour

- When all inserts are bypassed (default), the chain is a wire: input → output with zero added latency.
- Individual bypass toggles are smoothed: crossfade (5 ms linear) between active and bypassed paths to avoid clicks.
- Both the UI and SAB parameters reflect bypass state. The SAB `bypass` field is the source of truth; the UI writes to it via the worker → SAB path.

### Printing Chain to Recording

An optional toggle `printToRecording` (default `false`): when enabled, the `AudioData` frames entering the audio encoder are the chain-processed output (post-limiter) instead of the raw capture audio.

**Implementation (v1): the chain runs in the pipeline worker, on the recording path.** The worker's audio pump copies each capture `AudioData` to planar PCM, runs gate → compressor → limiter per channel using the same pure DSP functions, and re-wraps the result before encoding. The monitor `AudioContext` is not involved at all.

> **Why not the AudioWorklet ring design?** The AudioWorklet runs on the browser's audio rendering thread, driven by the active `AudioContext`. If the `AudioContext` is suspended (autoplay policy, background tab throttling, or the user muting the monitor), a worklet-fed SAB ring would stop being written and starve the encoder — silent recordings or A/V desync. Running the DSP in the worker's capture loop removes that failure mode structurally: recordings are processed deterministically whether or not monitoring is audible. The trade-offs are an extra PCM copy per audio frame (cheap relative to encoding) and that the *monitor* output stays unprocessed until the monitor-path worklet ships (T6.2/T6.5). The limiter's 5 ms lookahead delays recorded audio content by 5 ms relative to video — below perceptibility thresholds, and only while the limiter is engaged.

If chain processing fails (e.g. `AudioData.copyTo` format conversion unsupported), the worker falls back to encoding raw capture audio and posts a single `live-chain-error` message rather than failing the capture.

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/replay-buffer/capture.ts` | Capture session/config helpers and codec fallback list (encoder lifecycle + pump loops live in `worker.ts`) |
| `src/engine/replay-buffer/ring-buffer.ts` | GOP-aligned ring buffer data structure: push (with chunk bytes), evict, snapshot, spill splicing, stats |
| `src/engine/replay-buffer/spill.ts` | OPFS spill binary codec (pure encode/decode) + file lifecycle, cleanup, saved-clip file helpers |
| `src/engine/replay-buffer/replay-save.ts` | Save-last-N: range calculation, snapshot reuse, combined spill+RAM entry assembly (mux + asset registration + timeline insert run in `worker.ts`) |
| `src/engine/live-audio/live-chain.ts` | SAB layout writer, chain latency helper, and the per-channel recording-path chain processor |
| `src/engine/live-audio/gate.ts` | Noise gate DSP function (pure, unit-testable without AudioWorklet) |
| `src/engine/live-audio/compressor.ts` | Feed-forward peak compressor DSP function (pure, unit-testable) |
| `src/engine/live-audio/limiter.ts` | Brickwall lookahead peak limiter DSP function (pure, unit-testable) |
| `src/engine/live-audio/live-chain-worklet.ts` | (Follow-up, T6.2) AudioWorkletProcessor for the monitor path: reads SAB params, runs insert chain, writes SAB meters |
| `src/ui/capture-bridge.ts` | `getDisplayMedia` + `MediaStreamTrackProcessor` setup on the main thread; stream transfer to the worker |
| `src/ui/ReplayBufferPanel.tsx` | Capture start/stop, ring-buffer indicator, save-last-N button, elapsed time |
| `src/ui/LiveAudioChainPanel.tsx` | Per-insert bypass + params, aggregate latency display, denoiser reserved slot |
| `src/protocol.ts` | `RingBufferState`, `CaptureSessionState`, `LiveAudioChainConfig`, `AudioInsertParams` types; new `WorkerCommand` / `WorkerStateMessage` variants |
| `src/engine/project.ts` | Schema bump with `replayBufferConfig` and `liveAudioChainConfig` fields |

## Validation

| Scenario | Expected result |
|----------|----------------|
| Start capture → save-last-30s after 35s | Clip appears on timeline; starts at t≈5s (nearest keyframe); ends at t≈35s; capture continues uninterrupted |
| Save-last-30s → save-last-30s again 10s later | Second clip has overlapping content with first; both are valid, independently playable assets |
| Ring buffer exceeds configured duration | Oldest chunks evicted to nearest keyframe boundary; total duration ≤ limit + 1 GOP; stats reflect eviction |
| Ring buffer exceeds RAM budget | Chunks spilled to OPFS; in-memory bytes ≤ budget; save-last-N assembles from OPFS + RAM correctly |
| Capture stopped by user | Encoders flushed; ring buffer finalized; all spill files tracked; no leaked chunks |
| Live chain: enable gate → audio passes | Gate opens/closes at threshold; meters show gain reduction when signal is below threshold |
| Live chain: enable all inserts | Signal passes through gate → compressor → limiter; aggregate latency displayed in ms |
| Live chain: bypass all → audio clean | Output is sample-exact match to input (zero latency, unity gain) |
| Live chain: AudioWorklet crash | Chain bypasses; capture continues; ring buffer unaffected; error surfaced in UI |
| Print chain to recording enabled | Saved replay clip's audio track has chain processing baked in |
| `crossOriginIsolated` absent | Replay buffer functional; live audio chain disabled with message; editor fully functional |
| `MediaStreamTrackProcessor` unsupported | Replay buffer disabled; friendly message shown |

## Interaction with Existing Systems

- **Phase 9 (undo/redo)**: Save-last-N is a `commitTimelineMutation` call inserting a clip. Undo removes it exactly.
- **Phase 16 (audio mixing)**: The existing SAB meter layout is extended, not replaced. Existing meter indices [0..3] are preserved.
- **Phase 18 (media conformance)**: Saved replay clips carry source metadata; source health checks apply (e.g., variable GOP structure reported if encoder produces irregular keyframe intervals).
- **Phase 23 (project packaging)**: Saved replay assets are fingerprint-registered; they participate in project bundles and integrity validation.
- **Phase 25 (diagnostics)**: Replay buffer and live chain diagnostics appear as dedicated rows in the existing diagnostics panel.
- **Phase 36 (future denoiser)**: The reserved SAB slot and chain position are designed to accept a denoiser insert without re-architecting.
