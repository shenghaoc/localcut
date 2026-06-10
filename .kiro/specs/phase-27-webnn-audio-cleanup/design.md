# Design: Phase 27 — Local Audio Cleanup with WebNN RNNoise

> Status: **Planned / Optional / Experimental.** First on-device ML feature. Local-first by construction: no cloud AI, no API keys, no accounts, no media upload. WebNN inference runs in a dedicated Audio Cleanup worker — never on the SolidJS main thread, never in the pipeline worker.

## Goal

Let a user clean up noisy audio entirely on their own device: probe WebNN, lazily load the RNNoise noise-suppression model on explicit request, process a selected clip or the mixed track preview in cancellable chunks, A/B the result, and — only if the user applies it — route a cleaned derived audio asset through explicit, undoable project state. Browsers without WebNN see an honest "unavailable" message and an otherwise unchanged editor.

## Why RNNoise first

RNNoise (Valin, Xiph/Mozilla; BSD-3-Clause) is an established hybrid DSP + recurrent-network noise suppressor with a known WebNN sample in the [webmachinelearning/webnn-samples](https://github.com/webmachinelearning/webnn-samples) ecosystem. Its contract is small and fixed — 48 kHz mono, 480-sample (10 ms) frames, hand-written feature extraction feeding a GRU network that outputs per-band gains plus VAD — which makes it ideal for the first model: small weights (sub-megabyte), streaming-friendly recurrent state, and pure audio-domain value (noise removal) that maps directly to an editor feature.

## Non-goals (this phase)

- No LLMs, transcription, object detection, segmentation, or generative models.
- No WASM or WebGPU inference fallback (a `backend` seam exists in the protocol, but no fallback code paths).
- No automatic cleanup, no batch processing of the whole media bin, no changes to default export.

## Architecture

```
Main thread (SolidJS UI)
  ├─ capability probe (extended): probeWebNN() — navigator.ml presence + per-backend MLContext checks
  ├─ AudioCleanupPanel.tsx — "Local Audio Cleanup (Experimental)"
  │     spawns lazily ─────────────────────────────┐
  ├─ pipeline worker (src/engine/worker.ts)        │   UNCHANGED — no model code
  │     audio source / mix stage supplies PCM      │
  └─ cleanup-bridge.ts ◄── typed postMessage ──► Audio Cleanup worker (src/engine/audio-cleanup/cleanup-worker.ts)
                                                    ├─ manifest validation + same-origin weights fetch (on demand)
                                                    ├─ SHA-256 checksum verification
                                                    ├─ WebNN MLContext + MLGraphBuilder (RNNoise GRU graph)
                                                    ├─ DSP: resample → 480-sample framing → features → gains → overlap state
                                                    └─ chunked, cancellable processing + progress
```

Key boundaries:

- The **pipeline worker is untouched** except for the existing, already-public audio extraction surface (`pcmAt` / `pcmWindowAt`, mix stage) used to source PCM. No inference, model state, or weights ever enter it.
- The **cleanup worker** is a separate `Worker` from a separate entry module, spawned via dynamic `import('./audio-cleanup/cleanup-worker.ts?worker')` only when the panel opens or an action starts. It never appears in the startup module graph.
- The **UI** holds only signals and serializable state; PCM buffers move worker↔worker/main as transferables.

## WebNN capability probe

Extends the Phase 26 probing layer without touching `CapabilityTierV2` derivation — WebNN gates only this feature.

```typescript
// src/protocol.ts
type FeatureSupport = 'supported' | 'unsupported' | 'unknown'; // existing

interface WebNNProbeResult {
	mlPresent: boolean; // typeof navigator.ml !== 'undefined'
	backends: {
		cpu: FeatureSupport; // navigator.ml.createContext({ deviceType }) succeeds
		gpu: FeatureSupport;
		npu: FeatureSupport;
	};
	// Ground truth only after an explicit user-initiated graph build:
	modelSupport: FeatureSupport; // starts 'unknown'
}
```

Probe rules:

- Cheap and side-effect free: context-creation checks only; any created `MLContext` is discarded; no graph building, no weight fetch.
- Every probe error maps to `'unknown'`; the probe never throws.
- `modelSupport` is upgraded to `'supported'`/`'unsupported'` by the cleanup worker after the first explicit model load attempt (graph build success/failure), and echoed back over the protocol.
- Result is displayed as a "WebNN" row in `CapabilityMatrixPanel` / diagnostics with the standard chip + action-hint format (e.g. "Use a Chromium browser with WebNN enabled for local audio cleanup").

## Model manifest

Checked into the repo next to the weights asset; validated before any fetch is trusted.

```typescript
// src/engine/audio-cleanup/model-manifest.ts
interface CleanupModelManifest {
	id: 'rnnoise';
	version: string; // upstream model/weights version
	license: string; // 'BSD-3-Clause' (RNNoise, Xiph.Org)
	source: string; // upstream provenance URL (webnn-samples / rnnoise)
	sizeBytes: number; // exact byte length of the weights asset
	checksum: string; // 'sha256-<hex>' of the weights asset
	audio: {
		sampleRate: 48000;
		channels: 1;
		frameSize: 480; // 10 ms
	};
}

function validateManifest(value: unknown): CleanupModelManifest; // pure; throws ManifestError with a specific reason
```

Weights policy:

- Weights live under `public/models/rnnoise/` and are fetched **same-origin only**, on explicit user action. No third-party CDN at runtime.
- Fetched bytes must match `sizeBytes` and the SHA-256 `checksum` (via `crypto.subtle.digest`) before graph construction. Mismatch → hard, user-visible error; never a silent retry elsewhere.
- The PWA service worker does **not** precache the weights at install (startup stays model-free); after one successful explicit load the asset may enter the runtime cache so later loads work offline.
- License + provenance from the manifest are surfaced in the panel footer and in docs attributions.

## Audio Cleanup worker

`src/engine/audio-cleanup/cleanup-worker.ts` — owns the entire model lifecycle.

States: `idle → loading-model → ready → processing → ready` with terminal events `cancelled` and `error` (both return to a reusable state or a clean `disposed`).

Protocol (added to `src/protocol.ts`):

```typescript
type CleanupCommand =
	| { type: 'cleanup-probe' } // re-check backends inside the worker
	| { type: 'cleanup-load-model'; manifest: CleanupModelManifest; preferredBackends: ('npu' | 'gpu' | 'cpu')[] }
	| {
			type: 'cleanup-process';
			jobId: number;
			pcm: Float32Array; // transferred; source-rate PCM
			sampleRate: number;
			channels: number;
	  }
	| { type: 'cleanup-cancel'; jobId?: number } // omitted jobId cancels everything incl. model load
	| { type: 'cleanup-dispose' };

type CleanupState =
	| { type: 'cleanup-model-status'; status: 'not-loaded' | 'loading' | 'loaded' | 'failed'; backend?: 'npu' | 'gpu' | 'cpu'; sizeBytes?: number; error?: string }
	| { type: 'cleanup-progress'; jobId: number; fraction: number; processedSeconds: number; totalSeconds: number }
	| { type: 'cleanup-result'; jobId: number; pcm: Float32Array; sampleRate: 48000; durationMs: number } // transferred
	| { type: 'cleanup-cancelled'; jobId?: number }
	| { type: 'cleanup-error'; jobId?: number; message: string };
```

Rules:

- Backend selection tries `preferredBackends` in order (`npu → gpu → cpu` by default), records the winner, and reports it in `cleanup-model-status` — it is diagnostic data, not a tier.
- Large `Float32Array` payloads are always transferred, never structured-cloned.
- Cancellation is checked at every chunk boundary (an `AbortController` per job); cancel stops scheduling promptly, releases in-flight buffers, posts `cleanup-cancelled`, and leaves the worker reusable.
- `cleanup-dispose` (panel closed / project disposed) releases the graph and context and terminates the worker; next use re-spawns it.
- A worker crash surfaces as `cleanup-error` via the bridge's `onerror`; the panel resets to "not loaded". The pipeline worker, clock, and export are unaffected by construction (separate process, no shared state).

## Processing pipeline

```
input PCM (clip via pcmWindowAt / mixed preview via mix stage, source rate, N channels)
  → downmix to mono (equal-power)
  → resample to 48 kHz via the existing streaming polyphase sinc resampler (src/engine/audio-resampler.ts)
  → split into bounded chunks (e.g. 1 s = 100 frames), each aligned to 480-sample frames
  → per frame: RNNoise feature extraction (band energies / pitch features, ported per the WebNN sample)
  → WebNN graph compute (GRU layers → per-band gains + VAD); recurrent state carried across frames AND chunks
  → apply gains (band interpolation) → output frame
  → progress per chunk → assemble output
  → result: 48 kHz mono Float32Array
      ├─ Preview: handed to the audio engine as an A/B preview buffer for the selected range
      └─ Apply:   encoded as WAV (PCM16/Float32) → OPFS → registered as a derived media asset
                  (fingerprint-linked to the source asset, Phase 23 conventions)
```

Constraints:

- Memory in flight is bounded: source PCM is pulled and processed window-by-window for long sources; no whole-file buffering.
- The DSP feature/gain code runs in the cleanup worker only — never on main (hard gate 1 applies to this worker's host thread, which is not main).
- Chunk boundaries must be inaudible: GRU state and overlap context persist across chunks; unit tests compare chunked vs. unchunked output on a synthetic signal.
- Cancellation mid-job discards partial output; no partial asset is ever registered.

## UI — `AudioCleanupPanel.tsx`

"**Local Audio Cleanup (Experimental)**" panel, following existing panel idioms (Kobalte primitives, dark professional aesthetic, ARIA + keyboard standards, `onCleanup` for every listener).

- Permanent privacy statement: **"Runs on this device. No upload. No API key. No server inference."**
- Buttons: **Load model**, **Preview cleanup**, **Cancel**, **Apply to export / create cleaned audio asset**. Each disabled with a reason when prerequisites are missing (no WebNN, model not loaded, no audio selection, job in flight).
- Status block: model state (not loaded / loading / loaded / failed), backend in use, model size (from manifest), progress bar with processed/total time.
- A/B toggle for the previewed range (original vs. cleaned) before applying.
- WebNN absent → the panel body is replaced by **"WebNN local cleanup unavailable in this browser."**; everything else in the app behaves exactly as before. No cloud fallback is offered.
- Footer: model id, version, license (BSD-3-Clause), provenance link from the manifest.

## Project state, undo, and export

- Default export is untouched: no export code branches on WebNN or the cleanup worker.
- **Apply** creates a derived asset (WAV in OPFS, fingerprint-linked to its source) and issues a timeline command setting `cleanedAudioAssetId` on the clip (serialized with the existing versioned schema; absent field = no cleanup). Audio resolution prefers the cleaned asset when the field is set.
- The command flows through the worker-owned snapshot undo/redo (Phase 9): undo restores the original reference exactly; an explicit **Remove cleanup** affordance issues the inverse command.
- Clips with cleanup applied show a badge plus an Inspector row.
- Missing cleaned asset on restore (e.g. OPFS cleared) → fall back to original audio + source-health warning (Phase 18 conventions); never a silent or broken clip.

## Diagnostics

New "Audio Cleanup (WebNN)" section in the diagnostics panel, display-only:

| Row | Source |
|-----|--------|
| WebNN available (cpu/gpu/npu chips) | `WebNNProbeResult` |
| Backend used | last `cleanup-model-status` |
| Model loaded / not loaded | last `cleanup-model-status` |
| Model size | manifest `sizeBytes` |
| Last analysis duration | last `cleanup-result.durationMs` |
| Errors | recent-errors store (existing redaction rules) |

## Modules

| Module | Description |
|--------|-------------|
| `src/engine/audio-cleanup/webnn-probe.ts` | `probeWebNN(): Promise<WebNNProbeResult>`; side-effect free, error → `'unknown'` |
| `src/engine/audio-cleanup/model-manifest.ts` | `CleanupModelManifest` type, `validateManifest()` pure function, checksum helper |
| `src/engine/audio-cleanup/cleanup-worker.ts` | Dedicated worker: WebNN context/graph, DSP, chunked cancellable processing |
| `src/engine/audio-cleanup/rnnoise-graph.ts` | `MLGraphBuilder` graph construction from validated weights |
| `src/engine/audio-cleanup/rnnoise-dsp.ts` | Feature extraction, band-gain application, frame/chunk scheduler with carried state |
| `src/engine/audio-cleanup/cleanup-jobs.ts` | Job state machine, progress accounting, cancellation (pure, unit-testable) |
| `src/ui/AudioCleanupPanel.tsx` | Experimental panel, privacy statement, buttons, A/B preview, status |
| `src/ui/cleanup-bridge.ts` | Lazy worker spawn + typed message bridge (mirrors `worker-bridge.ts`) |
| `public/models/rnnoise/` | Weights asset + `manifest.json` (same-origin, not precached) |
| `src/protocol.ts` | `WebNNProbeResult`, `CleanupCommand`, `CleanupState`, `CleanupModelManifest` additions |

## Validation

| Scenario | Expected result |
|----------|----------------|
| App startup (any browser) | Zero requests for model/weights assets; cleanup worker not spawned; entry bundle free of cleanup modules |
| Chromium with WebNN | Panel enabled; Load model fetches + checksums weights, builds graph, reports backend; preview produces denoised buffer; A/B works |
| Browser without `navigator.ml` | Panel shows "WebNN local cleanup unavailable in this browser."; import/play/edit/export fully normal |
| Cancel during model load / mid-processing | Prompt stop, `cleanup-cancelled`, no partial asset, worker reusable |
| Checksum mismatch | Hard user-visible error; `modelSupport: 'unsupported'` not set (load failed, not model-unsupported); no retry against another origin |
| Apply → undo | Clip's `cleanedAudioAssetId` set then cleared exactly; export uses cleaned audio only while applied |
| Cleaned asset missing on restore | Original audio plays; source-health warning shown |
| Cleanup worker crash mid-job | `cleanup-error` shown; timeline/playback/export unaffected |
| Quality gate | `npm run lint`, `npm run format:check`, `npm test`, `npm run build` all green; test count grows |
