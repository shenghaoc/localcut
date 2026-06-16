# ONNX Whisper model assets (Phase 29 — Auto Captions, ORT backend)

This is the **ONNX Runtime Web (ORT)** backend for Auto Captions — the follow-up
to the original [LiteRT.js path](../whisper/README.md). It transcribes selected
audio with [OpenAI Whisper](https://github.com/openai/whisper) exported to ONNX,
run on-device by ORT. Two int8-quantized models ship:

| File                 | Model                                                                               | Download | Notes                          |
| -------------------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------ |
| `manifest.json`      | [`onnx-community/whisper-base`](https://huggingface.co/onnx-community/whisper-base) | ~77.3 MB | **Default.** int8, ~74M params |
| `manifest-tiny.json` | [`onnx-community/whisper-tiny`](https://huggingface.co/onnx-community/whisper-tiny) | ~41.4 MB | int8, ~39M params, fastest     |

Each manifest declares **three** digest-pinned assets: an `encoder` ONNX graph,
a no-past `decoder` ONNX graph, and the byte-level BPE `tokenizer` vocabulary.
The tokenizer is the standard multilingual Whisper `vocab.json` (reused from
`openai/whisper-base`, byte-identical across tiny/base), so both manifests share
one cached tokenizer copy.

The worker selects the runtime from each manifest's `runtime` field
(`ort-whisper` here, absent on the LiteRT manifests), so the two engines coexist
behind one model picker. See [`docs/ML-RUNTIME.md`](../../../docs/ML-RUNTIME.md).

## Why ONNX / ORT, and why these models

The LiteRT path ships fp32 graphs (`whisper-base` is **~290 MB**) — a heavy first
download for a PWA. ORT lets us ship **int8-quantized** Whisper at a fraction of
the size with comparable caption quality, which is the point of this backend.
Per the product brief, we **do not** keep the 290 MB fp32 base as the default.

### Size vs quality (encoder + decoder, from the published ONNX exports)

| Model | Precision | Encoder | Decoder  | Total\*    | Notes                                                   |
| ----- | --------- | ------- | -------- | ---------- | ------------------------------------------------------- |
| tiny  | int8      | 10.1 MB | 30.5 MB  | **~41 MB** | Shipped. Fastest; lowest accuracy.                      |
| tiny  | fp16      | 16.5 MB | 59.4 MB  | ~76 MB     | Larger than base-int8 for less accuracy — not shipped.  |
| tiny  | fp32      | 32.9 MB | 118.4 MB | ~152 MB    | No size win over LiteRT — not shipped.                  |
| base  | **int8**  | 23.2 MB | 53.3 MB  | **~77 MB** | **Default.** Best size/accuracy balance.                |
| base  | fp16      | 41.3 MB | 104.4 MB | ~146 MB    | Higher fidelity; ~2× the int8 download — not shipped.   |
| base  | fp32      | 82.5 MB | 208.3 MB | ~290 MB    | Matches LiteRT base; defeats the purpose — not shipped. |

\* Totals are encoder + decoder; the manifest's `sizeBytes` also adds the ~0.8 MB
tokenizer.

**Decision.** Default to **base-int8 (~77 MB)** — a 3.7× smaller download than the
fp32 LiteRT base at comparable accuracy — with **tiny-int8 (~41 MB)** as the
quicker, lower-accuracy option. int8 (ONNX dynamic quantization) is also the most
broadly supported quantization on the ORT-WASM execution provider (it is what
Transformers.js loads by default for these repos), so it is the robust choice as
well as the small one. fp16/fp32 and `q4`/`bnb4` variants exist upstream and can
be added as catalog entries later if a higher-fidelity or 4-bit option is wanted;
the manifest schema already supports them (only the asset URLs/digests change).

### Quantization & decode tuning

int8 predictions are slightly less confident than fp32, which can trip Whisper's
silence gate / temperature fallback. The per-model `decode` thresholds in each
manifest (`logProbThreshold`, `noSpeechThreshold`, `compressionRatioThreshold`,
`temperatures`) are tunable without code changes — the tiny manifest already uses
the more permissive values calibrated for the smaller model.

## How the model runs

- **Execution provider: WASM** (CPU tensors). ASR is not frame-coupled, so the
  accelerated-pipeline hard gate that forbids CPU tensors does not apply. The
  autoregressive decoder is dominated by per-step graph dispatch, where a GPU
  EP's per-call sync overhead and patchier Whisper op coverage make WASM the
  robust default; the ASR worker is also a classic worker without the renderer's
  `GPUDevice`. A WebGPU EP can be pinned per model later (the manifest's
  `executionProviders` allows it) once op support is verified.
- **No KV cache (yet).** The shipped `decoder` is the **no-past** graph
  (`decoder_model_quantized.onnx`): each greedy step re-runs it with the full
  token sequence and reads the last logits row, keeping the decode loop identical
  to the LiteRT runtime's so the shared `whisper-decode.ts` drives both. A 30 s
  window is ≤128 tokens, so the quadratic cost is small. The manifest reserves an
  optional `decoderWithPast` asset for a future incremental-decode runtime; the
  current runtime does **not** download or use it.
- **No `merges.txt`.** Decoding token ids → text needs only the id→token map
  (`vocab.json`); BPE merges are an encoding-only concern. The manifest therefore
  ships the tokenizer vocabulary only.

## Fetch, verify, cache (identical to the LiteRT path)

The model is **fetched from Hugging Face at runtime — never bundled or hosted by
this app** — through the same-origin Worker proxy (`/_model/hf/…`, see
[`src/worker/index.ts`](../../../src/worker/index.ts)), which sidesteps the CORS /
COEP constraints of the cross-origin-isolated app. The worker fetches each asset,
verifies it against its SHA-256 digest, and caches it in OPFS keyed by digest —
**only after the user clicks "Load model"**. Nothing loads at startup; after the
first verified load the model is reused offline. A corrupt cache entry fails its
digest check and is silently re-downloaded; a download whose bytes don't match is
a hard error, never served.

The ORT **runtime** WASM (`ort-wasm-*.wasm`) is a separate concern — proxied
same-origin from the pinned npm package at `/_ort/` and runtime-cached on first
ORT use (see `docs/ML-RUNTIME.md`). No `pnpm setup:` step is needed for it.

## Provenance & integrity

- **Models:** `onnx-community/whisper-{base,tiny}` `onnx/*_quantized.onnx`
  (Apache-2.0 export of OpenAI Whisper, MIT). **Tokenizer:**
  `openai/whisper-base` `vocab.json`.
- **Digests:** every asset's `sizeBytes` + `sha256-…` was taken from the Hugging
  Face repo tree API (the LFS `oid` is the file's SHA-256) and confirmed by
  downloading and hashing the tiny pair. To refresh after an upstream re-export,
  re-read the digests from
  `https://huggingface.co/api/models/<repo>/tree/main/onnx` (or `shasum -a 256`
  the file), keep each `checksum` as `sha256-<64 hex>`, and keep the top-level
  `sizeBytes` equal to the sum of the downloaded assets (encoder + decoder +
  tokenizer).
- **Host allowlist:** assets may be fetched only from this app's origin or an
  allowlisted host (`ORT_TRUSTED_MODEL_HOSTS` / `ASR_TRUSTED_MODEL_HOSTS`). The
  digest pins _what_; the allowlist pins _where_.

> **Dev-server note.** The ASR worker is a **classic** worker (the LiteRT path
> loads WASM via `importScripts`). Vite serves classic workers as ESM under
> `pnpm dev`, where they fail to load — test Auto Captions against the built app
> (`pnpm build` then `pnpm preview`), not `pnpm dev`.
