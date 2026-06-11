# Design: Phase 29 — Auto Captions (识别字幕)

> Status: **Planned / Active.** Automatic speech recognition (ASR) fed from the existing PCM pipeline, writing word-level timed captions into the Phase 22 caption-track model. Bilingual zh/en is the primary differentiator. Chrome 139+ on-device Web Speech provides a phrase-level local-only fallback for lower-tier browsers without WebNN. Zero server calls, zero accounts, zero telemetry — all inference and transcription stays on the user's device.

## Goal

Give SG (Singapore) creators and bilingual editors a one-click path from audio to editable caption tracks: select a clip (or range), trigger auto-caption, and receive language-detected, word-level-timed caption segments directly in the transcript panel. The primary engine is a WebNN Whisper-class model (bilingual zh/en). Browsers without WebNN fall back to Chrome's on-device Web Speech API at phrase-level granularity, visibly labeled as a reduced-tier result.

## Why Whisper-class ASR

Whisper (OpenAI, MIT-licensed) is the state-of-the-art open multilingual speech recognition model. The tiny quantized variant (~75 MB INT8) supports zh/en and runs within the WebNN budget established by Phase 28. Word-level timestamps are recovered via cross-attention alignment, giving editors the fine-grained timing they need for subtitle work. A dedicated ASR worker (separate from the pipeline worker and the cleanup worker) owns the model lifecycle — same lazy-spawn pattern as Phase 28.

## Why Chrome Web Speech fallback

Chrome 139+ ships on-device speech recognition (`SpeechRecognition`) that processes audio locally without any network request. Audio and transcripts never leave the browser. It produces phrase-level results (not word-level), so the UI explicitly labels fallback captions as "phrase-level auto-captions". This gives non-WebNN users a usable — if coarser — auto-captioning path while maintaining the "no cloud" guarantee.

## Non-goals (this phase)

- No server-side transcription, no cloud ASR API, no upload of audio anywhere.
- No live/streaming captioning during recording or WHIP publish.
- No speaker diarisation ("who said what").
- No translation between languages — the model transcribes in the source language.
- No custom vocabulary or keyword boosting.
- No WASM-only inference fallback (the Chrome Web Speech fallback covers non-WebNN browsers; ORT Web WASM backend is deferred).
- No batch processing of all media-bin clips in one click.

## Architecture

```
Main thread (SolidJS UI)
  ├─ capability probe (extended): asrProbe() — WebNN mlPresent + Chrome SpeechRecognition availability
  ├─ AutoCaptionsPanel.tsx — "Auto Captions (识别字幕) (Experimental)"
  │     spawns lazily ───────────────────────────────────────┐
  ├─ pipeline worker (src/engine/worker.ts)                  │ UNCHANGED
  │     extract-clip-audio PCM windows                       │
  └─ asr-bridge.ts ◄── typed postMessage ─────────────────► ASR worker (src/engine/asr/asr-worker.ts)
                                                               ├─ WebNN path: model load + inference
                                                               │   ├─ encoder-decoder transformer graph (Whisper-class)
                                                               │   ├─ log-mel spectrogram feature extraction
                                                               │   ├─ multilingual tokenizer (zh/en)
                                                               │   └─ word-level timestamp alignment
                                                               ├─ Web Speech path: MediaStream → SpeechRecognition
                                                               │   └─ phrase-level result assembly
                                                               └─ output: CaptionSegment[] with timestamps
```

Key boundaries:

- The **pipeline worker is untouched** except for the existing `extract-clip-audio` surface used to source PCM. No model code, tokenizer, or ASR state enters it.
- The **ASR worker** is a separate `Worker` from a separate entry module, spawned via dynamic `import('./asr/asr-worker.ts?worker')` only on explicit user action.
- The **UI** holds only signals and serializable state; PCM buffers move via transferables.
- The **Web Speech fallback** runs on a short-lived `AudioContext` + `MediaStreamAudioDestinationNode` to bridge PCM → `SpeechRecognition`; it never touches the pipeline worker or WebNN.

## ASR Engine Selection

```typescript
// src/protocol.ts
export interface AsrProbeResult {
  /** Phase 28 WebNN probe — reused, not duplicated. */
  webnn: WebNNProbeResult;
  /** Chrome 139+ on-device SpeechRecognition */
  speechRecognition: FeatureSupport;
  /** Selected engine after probe ordering */
  recommended: 'webnn-whisper' | 'chrome-speech' | 'none';
}
```

Selection order:
1. WebNN with `modelSupport === 'supported'` → `webnn-whisper` (word-level, bilingual)
2. Chrome 139+ `SpeechRecognition` available → `chrome-speech` (phrase-level, monolingual heuristic)
3. Neither → `none` — panel shows "unavailable" message

The probe is cheap and side-effect free:
- `navigator.ml` presence check (reuses Phase 28 probe)
- `typeof SpeechRecognition !== 'undefined' || typeof webkitSpeechRecognition !== 'undefined'`
- No model load, no graph build, no audio context created

## WebNN Whisper Path (Primary)

### Model

A quantized Whisper-class encoder-decoder transformer, bilingual zh/en:
- Encoder: 2× Conv1D (stride 2) → sinusoidal position encoding → 4 transformer blocks (self-attention + FFN)
- Decoder: learned position encoding → 4 transformer blocks (self-attention + cross-attention + FFN)
- Output: token logits over a multilingual vocabulary (~5,000 tokens for tiny)
- Weights: INT8 quantized, ~75 MB, shipped same-origin as `public/models/whisper/weights.bin`
- Tokenizer vocab: `public/models/whisper/vocab.json` (~500 KB)

The model architecture follows the established Phase 28 pattern:
- `model-manifest.ts`: `AsrModelManifest` type, `validateAsrManifest()` pure function, SHA-256 checksum
- `whisper-graph.ts`: `MLGraphBuilder` graph construction from validated weights
- `whisper-dsp.ts`: log-mel spectrogram feature extraction (pure TypeScript, unit-testable without WebNN)
- `asr-tokenizer.ts`: sentencepiece-style tokenizer (decoding side, pure)

### Audio preprocessing

```
source PCM (via extract-clip-audio, source rate, N channels)
  → downmix to mono (equal-power)
  → resample to 16 kHz via existing polyphase sinc AudioResampler
  → 25 ms Hann window, 10 ms stride → log-mel spectrogram (80 bins)
  → normalise (mean-variance per utterance)
  → pad/pack into 30-second chunks with carry-over context (3 s overlap)
  → feed to encoder
```

Constraints:
- Memory in flight bounded: ≤30 s extraction windows, no whole-file buffering for long sources
- 3 s overlap between chunks ensures seamless cross-attention alignment at boundaries
- Chunking is inaudible (decoded token sequences are joined by overlapping-token dedup)

### Decoding and word-level timestamps

The decoder runs autoregressively per chunk:
1. Encoder runs once per chunk → hidden states
2. Decoder runs token-by-token with cross-attention over encoder hidden states
3. Greedy or beam-search (beam=2) decoding produces token sequence
4. Word-level timestamps: cross-attention weights are aggregated per output token, then mapped to time via encoder stride (20 ms per frame for 2× stride-2 convolutions on 10 ms input stride → 40 ms per encoder frame). Token-to-word grouping follows the Whisper timestamp token scheme (`<|0.00|>`, `<|0.04|>`, ...).

### Caption segment conversion

Decoded token sequence → `CaptionSegment[]`:

1. Group tokens into words using whitespace and punctuation boundaries
2. Each word gets a `start` and `duration` from the timestamp alignment
3. Adjacent words with no inter-word gap (≤0.1 s silence) are merged into a single caption segment
4. Segments are trimmed to keep duration ≤7 s and character count ≤42 (subtitling best practice)
5. A language-detection token (`<|zh|>` or `<|en|>` from the decoder start-of-sequence) sets `language` on the caption track

## Chrome Web Speech Fallback (Low-Tier)

Activated when WebNN is unavailable but Chrome 139+ `SpeechRecognition` is present.

```
source PCM
  → downmix + resample to 16 kHz mono
  → create OfflineAudioContext → decode to AudioBuffer
  → create MediaStreamAudioDestinationNode → MediaStream
  → SpeechRecognition(mediaStream, { continuous: true, interimResults: false })
  → collect SpeechRecognitionResult[] with timestamps
  → convert to CaptionSegment[] (phrase-level, no word timestamps)
```

Chrome 139's on-device speech works fully offline — no network request. The result is phrase-level only (5–15 seconds per phrase), so the UI labels these segments as "phrase-level auto-captions" and disables the word-level editing affordance (split-by-word, per-word timing). The caption track `kind` remains `'caption'`; a metadata field distinguishes the generation method.

Fallback constraints:
- Audio is routed through a real-time `AudioContext` (not offline) because `SpeechRecognition` requires a live `MediaStream`
- Playback speed must be 1× realtime (sequential audio feed)
- Very long clips (>15 min) produce progressively less accurate results due to language-model drift
- The AudioContext and MediaStream are created/destroyed per-job; no persistent audio routing

## ASR Worker

`src/engine/asr/asr-worker.ts` — owns the model lifecycle (both WebNN graph and Web Speech bridge).

States: `idle → loading-model → ready → transcribing → ready` with terminal events `cancelled` and `error`.

Protocol (added to `src/protocol.ts`):

```typescript
export type AsrWorkerCommand =
  | { type: 'asr-probe' }
  | {
      type: 'asr-load-model';
      manifest: AsrModelManifestSnapshot;
      weightsUrl: string;
      vocabUrl: string;
      preferredBackends: WebNNDeviceTypeSnapshot[];
    }
  | {
      type: 'asr-transcribe';
      jobId: number;
      engine: 'webnn-whisper' | 'chrome-speech';
      pcm: Float32Array;
      sampleRate: number;
      channels: number;
      /** Clip-local start of this window in seconds. */
      offsetS: number;
      /** Total duration of the full clip being transcribed. */
      totalDurationS: number;
    }
  | { type: 'asr-cancel'; jobId?: number }
  | { type: 'asr-dispose' };

export type AsrWorkerState =
  | { type: 'asr-probe-result'; result: AsrProbeResult }
  | {
      type: 'asr-model-status';
      status: AsrModelStatus;
      engine: 'webnn-whisper' | 'chrome-speech' | null;
      backend?: WebNNDeviceTypeSnapshot;
      sizeBytes?: number;
      error?: string;
    }
  | {
      type: 'asr-progress';
      jobId: number;
      fraction: number;
      processedSeconds: number;
      totalSeconds: number;
    }
  | {
      type: 'asr-result';
      jobId: number;
      engine: 'webnn-whisper' | 'chrome-speech';
      segments: CaptionSegmentSnapshot[];
      language: string | null;
      /** True for Chrome Speech fallback — UI labels these as phrase-level. */
      phraseLevel: boolean;
      durationMs: number;
    }
  | { type: 'asr-cancelled'; jobId?: number }
  | { type: 'asr-error'; jobId?: number; message: string };
```

Rules:
- Backend selection reuses Phase 28 pattern (`npu → gpu → cpu`)
- PCM payloads are always transferred, never structured-cloned
- Cancellation checked at chunk boundaries; cancel posts `asr-cancelled`
- Worker crash → `asr-error` via bridge `onerror`; pipeline/playback/export unaffected

## Model Manifest

```typescript
// src/engine/asr/model-manifest.ts
export interface AsrModelManifestSnapshot {
  id: 'whisper-tiny-bilingual';
  version: string;
  license: string; // 'MIT' (OpenAI Whisper)
  source: string; // upstream provenance URL
  sizeBytes: number;
  checksum: string; // 'sha256-<hex>'
  audio: { sampleRate: 16000; channels: 1; hopLength: 160; nMel: 80 };
  /** Vocabulary token count. */
  vocabSize: number;
  /** Encoder output frames per second of audio (1/stride). */
  encoderFramesPerSecond: number;
  languages: string[]; // ['zh', 'en']
}
```

Weights policy (identical to Phase 28):
- `public/models/whisper/weights.bin` + `public/models/whisper/vocab.json`
- Same-origin only, fetched on explicit user action
- SHA-256 checksum verified before graph construction
- PWA service worker excludes from install-time precache
- After one successful load, may enter runtime CacheFirst

## UI — `AutoCaptionsPanel.tsx`

"**Auto Captions (识别字幕) (Experimental)**" panel, following existing panel idioms.

- Permanent privacy statement: **"All speech recognition runs on this device. No audio leaves your browser. No cloud API."**
- **Detected ASR engine** chip (WebNN Whisper / Chrome Speech / Unavailable), shown prominently
- **Language selector**: auto-detect (default) or force zh / en
- Action: **"Transcribe selected clip"** — extracts audio from the selected timeline clip, runs ASR, creates caption track
- **"Transcribe timeline range"** — extracts mixed audio for the visible/selected range
- Progress bar with "transcribed X of Y seconds"
- **Cancel** button (prompt stop, no partial captions)
- WebNN unavailable + Chrome Speech unavailable → **"Auto captions unavailable in this browser."** message with all actions disabled
- Chrome Speech only → engine chip says "Browser Speech (phrase-level)" with tooltip: "Chrome on-device speech recognition — caption timings are approximate. Install a Chromium browser with WebNN for word-level accuracy."
- Footer: model id, version, license (MIT), provenance

## Caption Track Integration

Transcription result inserts into the Phase 22 caption model:

1. A new `CaptionTrack` is created (or an existing one is targeted) with `language` set to the detected/selected language
2. `CaptionSegment[]` from the ASR result are inserted as the track's segments
3. Segment `id`s are generated using the existing `makeCaptionSegmentId` convention
4. The track name follows the pattern: `"Auto (zh)"` or `"Auto (en)"` with the clip/file name
5. A metadata field `generatedBy: 'auto-captions-phase-29'` is stored on the track's `kind`-adjacent properties so the UI can display a "generated" badge
6. The operation is undoable (flows through worker-owned snapshot undo/redo, Phase 9)
7. Multiple auto-caption passes create separate tracks (no collision — unique track names)

Export and burn-in work identically to manual captions (Phase 22) — the auto-caption track is indistinguishable from an imported/edited caption track after creation.

## Project State, Undo, Export

- Auto-captioned tracks serialize into the project document via existing caption-track persistence
- Undo after auto-caption removes the entire generated track
- Export path unchanged — auto-caption tracks export identically to manually-created tracks
- Sidecar export (SRT/VTT) includes the `language` field as a VTT header or an SRT comment

## Diagnostics

New "Auto Captions (ASR)" section in the diagnostics panel:

| Row | Source |
|-----|--------|
| ASR engine recommended | `AsrProbeResult.recommended` |
| WebNN available | `WebNNProbeResult` (reused) |
| Chrome Speech available | `speechRecognition` support |
| Model status | last `asr-model-status` |
| Last transcription engine | last `asr-result.engine` |
| Last transcription language | last `asr-result.language` |
| Last transcription duration | last `asr-result.durationMs` |
| Errors | recent-errors store |

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/asr/asr-probe.ts` | `probeAsr(): Promise<AsrProbeResult>`; reuses Phase 28 WebNN probe + checks Chrome SpeechRecognition |
| `src/engine/asr/model-manifest.ts` | `AsrModelManifestSnapshot` type, `validateAsrManifest()` pure function |
| `src/engine/asr/asr-worker.ts` | Dedicated ASR worker: WebNN graph + Web Speech bridge; chunked cancellable transcription |
| `src/engine/asr/whisper-graph.ts` | `MLGraphBuilder` graph construction: encoder + decoder transformer blocks |
| `src/engine/asr/whisper-dsp.ts` | Log-mel spectrogram extraction, normalisation, chunk packer (pure, unit-testable) |
| `src/engine/asr/asr-tokenizer.ts` | Sentencepiece-style token decoder with timestamp token handling |
| `src/engine/asr/word-timestamps.ts` | Cross-attention weight aggregation → word-level timing (pure, unit-testable) |
| `src/engine/asr/chrome-speech.ts` | Web Speech fallback: PCM → MediaStream → `SpeechRecognition` → `CaptionSegment[]` |
| `src/ui/AutoCaptionsPanel.tsx` | Experimental panel, engine chip, language selector, progress, cancel |
| `src/ui/asr-bridge.ts` | Lazy worker spawn + typed message bridge (Phase 28 pattern) |
| `src/ui/asr-controller.ts` | Job orchestration: windowed extraction → worker → caption-track insertion |
| `public/models/whisper/` | Weights + vocab + `manifest.json` (same-origin, not precached) |
| `src/protocol.ts` | `AsrProbeResult`, `AsrWorkerCommand`, `AsrWorkerState`, `AsrModelManifestSnapshot` additions |

## Validation

| Scenario | Expected result |
|----------|----------------|
| App startup (any browser) | Zero ASR worker spawns, zero model fetches, zero audio context creation |
| WebNN available | "WebNN Whisper" engine chip; Load model → transcribe → word-level captions in new track; language detected automatically |
| Chrome only (no WebNN) | "Browser Speech" engine chip with phrase-level warning; transcribe produces usable phrase-level captions |
| Neither available | "Auto captions unavailable" message; import/play/edit/export fully normal |
| Bilingual clip (zh + en mixed) | Model auto-detects language per chunk; segments are labeled correctly |
| Cancel mid-transcription | Prompt stop, `asr-cancelled`, no partial caption track created |
| Very long clip (>30 min) | Chunked processing with 3 s overlap; memory bounded; no whole-file buffering |
| Quality gate | `npm run lint`, `npm run format:check`, `npm test`, `npm run build` all green; test count grows |
