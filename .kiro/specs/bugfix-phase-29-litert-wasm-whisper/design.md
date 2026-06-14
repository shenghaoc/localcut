# Design: Phase 29 LiteRT WASM Whisper

## Runtime

The ASR worker owns LiteRT.js (`@litertjs/core`) and compiles the Whisper
encoder/decoder graphs on **experimental WebNN** when `navigator.ml` is enabled,
then **WebGPU** when the device supports it, transparently falling back to the
`wasm` accelerator if accelerated compilation fails. WebNN uses LiteRT's JSPI
runtime and tries `{ webNNOptions: { devicePreference: 'npu' } }`, then `gpu`,
then `cpu` before the final WASM fallback. The reported accelerator reflects whichever actually compiled. The package is loaded through
an **untyped `.js` loader boundary** (`src/engine/asr/litert-loader.js`) so its
`declare global` TypedArray augmentation never enters the TypeScript program;
Vite still bundles it as a lazy chunk. The ~9 MB WASM payload is served
same-origin from `public/litert/` (vendored by `pnpm setup:litert`, COOP/COEP
safe) and fetched at runtime via `loadLiteRt('/litert/')`.

The decode orchestration (`whisper-decode.ts`) depends only on a small
`WhisperRuntime` interface, so the greedy autoregressive loop and segment
assembly are fully unit-tested with a scripted fake runtime; the concrete
LiteRT-backed runtime (`litert-runtime.ts`) is the only un-mockable boundary.

## Model Bundle

A versioned manifest at `/models/whisper/manifest.json` (same-origin app config)
declares:

- model id, version, license, source, and total size;
- the single TFLite model + tokenizer asset URLs, sizes, and SHA-256 digests;
- audio shape: 16 kHz mono, mel count, hop length, 30 s context window;
- the Whisper special-token ids and supported languages.

The **model is fetched from Hugging Face at runtime, not self-hosted** — but
through a **same-origin Worker proxy** (`/_model/hf/…`, `src/worker/index.ts`).
The app is cross-origin isolated (`COEP: require-corp`), and HF's signed file CDN
does not return CORS for arbitrary deployed origins, so a direct cross-origin
`fetch()` is blocked in production (it only happens to work from `localhost`).
The Cloudflare Worker fetches the file from HF server-side and streams it back
same-origin, sidestepping CORS/COEP; the bytes never leave HF as the source of
truth (the Worker only relays them, and the 25 MB Workers static-asset limit
doesn't apply to streamed responses). `validateAsrManifest` checks the document
(including that the top-level size equals the sum of asset sizes) and
`assertTrustedModelUrl` rejects any URL off the app's origin or
`ASR_TRUSTED_MODEL_HOSTS`. Each asset is verified byte-for-byte against its digest
(`asset-cache.ts`, `mode: 'cors'`) and cached in OPFS for offline reuse — the
network is touched at most once per model, and the worker reports `cached: true`
on cache-only loads. The manifests pin `litert-community/whisper-base`,
`litert-community/whisper-tiny`, and the matching OpenAI tokenizer by their real
digests. LiteRT WASM runtime assets, including the JSPI build needed by WebNN,
are additionally served same-origin (`pnpm setup:litert`).

## Model catalog & trust

`model-catalog.ts` holds a curated list of selectable models — each with a name,
provider, license, total size, and an `infoUrl` model-card link the panel
surfaces ("Learn more") — plus `ASR_TRUSTED_MODEL_HOSTS`, the allowlist of hosts
the loader may fetch from (this app's origin, Hugging Face, Kaggle / Google AI
Edge via `storage.googleapis.com`, GitHub). Because model assets are executable
TFLite graphs, the worker calls `assertTrustedModelUrl` on the manifest URL and
every asset URL before fetching; an off-allowlist host is refused before any
byte is read. The digest pins the exact bytes; the allowlist pins their origin.
The catalog ships two models — **Whisper Base** (default, ~290 MB, better
accuracy) and **Whisper Tiny** (~151 MB, faster) — each with its own manifest
(`manifest.json`, `manifest-tiny.json`), and the panel shows a picker whenever
there is more than one. Because OPFS keys cached assets by SHA-256 digest, both
can be downloaded and kept at once; switching between them never re-downloads
(and they share the byte-identical tokenizer). `selectModel` disposes the loaded
model, terminates the ASR worker, and resets status so the next transcribe loads
the chosen one from a fresh LiteRT runtime.

## Audio Flow

The controller requests 16 kHz mono PCM windows (30 s) from the pipeline worker
and streams them to the ASR worker, which processes them through a serial queue.
For each window the worker downmixes to mono and asserts the 16 kHz contract
(`prepareMonoPcm`), extracts normalised Whisper log-mel features, runs the LiteRT
encoder, greedily decodes tokens (forced start-of-transcript/language/transcribe
prompt), and converts timestamp + text tokens into caption segments offset into
the clip/timeline. The worker accumulates segments across windows and emits a
single `asr-result` after the final window.

## UI Flow

The Auto Captions panel shows the detected engine (LiteRT Whisper), model size,
download/compile progress, the active accelerator, and transcription progress.
The primary action is **Transcribe selected clip**; **Transcribe timeline range**
covers a window from the playhead. A successful job creates a generated caption
track edited through the existing caption/transcript UI. The model loads only on
an explicit **Load model** click (or implicitly on the first transcribe), never
at startup.

## Failure Handling

Model fetch, checksum failure, unsupported WASM, worker crash, cancellation, and
empty transcript all surface explicit errors. No failure path creates an empty
caption track or silently falls back to Browser SpeechRecognition (which has been
removed). Availability is gated only on `WebAssembly`; WebNN, WebGPU, and
cross-origin isolation are reported for information.
