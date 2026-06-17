# Design — Auto Captions Whisper ONNX backend

## Key insight: the engine is already swappable

`whisper-decode.ts` is engine-agnostic — it drives a `WhisperRuntime`
(`encode(mel)` / `decode(tokens, encoded)` / `dispose()`) and owns all the quality
logic (greedy + temperature fallback, no-speech gate, compression-ratio /
log-prob checks, hallucination filtering, de-overlap). The LiteRT runtime is one
implementation. So the ONNX backend is **a second `WhisperRuntime`** plus a second
manifest shape — `whisper-decode.ts`, `whisper-tokenizer.ts`, and `whisper-dsp.ts`
are reused unchanged.

## Model choice (R4)

The published `onnx-community/whisper-{base,tiny}` exports offer fp32/fp16/int8
(and q4/bnb4). Totals (encoder + decoder):

| Model | int8 | fp16 | fp32 |
| ----- | ---- | ---- | ---- |
| tiny  | **~41 MB** | ~76 MB | ~152 MB |
| base  | **~77 MB** | ~146 MB | ~290 MB |

**Default = base int8 (~77 MB)** — 3.7× smaller than the fp32 LiteRT base at
comparable accuracy; **tiny int8 (~41 MB)** as the quicker option. int8 is also the
most broadly supported quantization on ORT-WASM (Transformers.js's default for
these repos). The fp32 LiteRT builds stay in the catalog as the fidelity fallback.
Full table + provenance in `public/models/whisper-onnx/README.md`.

## Manifest (R1)

`public/models/whisper-onnx/manifest.json` (+ `manifest-tiny.json`) declare a
`runtime: "ort-whisper"` discriminator, `format: "onnx"`, pinned
`executionProviders`, and **three** digest-pinned assets: `encoder`, `decoder`
(no-past), `tokenizer` (`vocab.json`). The audio contract, special tokens, and
decode params are the same shapes as the LiteRT manifest; `ort-whisper-manifest.ts`
validates them by **reusing** the LiteRT manifest's `validateAsset` /
`validateAudioConfig` / `validateSpecialTokens` / `validateDecodeParams`, and the
ORT `resolveExecutionProviders` EP policy. `decoderWithPast` is an optional declared
asset reserved for a future KV-cache runtime; it is not downloaded today. Merges
are omitted — decode-only needs the id→token map, not BPE merges. Digests came from
the HF repo tree API (LFS `oid` = SHA-256), confirmed by hashing the tiny pair.

## Runtime (R2)

`whisper-ort-runtime.ts` builds two sessions through `createOrtSession()` (encoder,
decoder), reaching ORT only via the lazy `loadOrtWasm()` import:

- `encode(mel)`: transpose frame-major mel → mel-major `[1, nMel, melFrames]`
  (pad/trim to the fixed 3000), run the encoder, retain `last_hidden_state`.
- `decode(tokens, encoded)`: build `input_ids` (int64 `BigInt64Array`), feed the
  retained hidden state as `encoder_hidden_states`, **fetch only `logits`** (the
  no-past decoder also emits `present.*` KV tensors we ignore), slice the last row.

**EP = WASM, tensor location = cpu.** ASR is not frame-coupled, so the no-WASM hard
gate does not apply. Per-token decoder dispatch is latency-bound where a GPU EP's
per-call sync overhead and patchier Whisper op coverage make WASM the robust
default; the classic ASR worker has no renderer `GPUDevice` to share anyway. The
manifest's `executionProviders` still allows pinning `webgpu` later.

No KV cache: re-running the no-past decoder each greedy step keeps the loop
identical to LiteRT's and reuses `whisper-decode.ts` verbatim. A 30 s window is
≤128 tokens, so the quadratic cost is small. This is the deliberate
"don't complicate decode" choice from R2.

## Worker routing & engine reporting

`asr-worker.ts` fetches the manifest JSON and routes on the discriminator:
`isOrtWhisperManifestDocument(json)` → ORT path, else the existing LiteRT path. A
shared `downloadVerifiedAssets` helper streams + verifies both manifests' assets
with aggregate progress. `LoadedModel` now holds an engine-agnostic
`AsrRuntime` + `AsrTranscribeConfig` + an `engine` tag. The loaded status reports
the `engine`, which the controller stores and stamps into the generated caption
track's metadata. The catalog gains the two ONNX entries (base int8 = recommended
default) alongside the LiteRT ones; the worker's detection is authoritative.

## Preserved guarantees (R3) & tests (R5)

OPFS-by-digest, explicit load, offline-after-first, and no-startup-load all come
from reusing the Phase 29 `asset-cache` + the lazy `ort-loader` (a test asserts
`whisper-ort-runtime.ts` never statically imports `onnxruntime-web`). Tests:
`ort-whisper-manifest.test.ts` (validation, en/zh tokens, shipped manifests,
cache-corruption via `loadVerifiedAsset`) and `whisper-ort-runtime.test.ts`
(encode transpose, int64 ids, logits slicing, fetch list, dispose, no-startup).
