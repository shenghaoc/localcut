# ONNX Whisper model assets

Auto Captions uses ONNX Runtime Web on the WASM execution provider. The model
picker contains only these ORT-backed Whisper manifests:

| File                 | Model                                                                               | Download | Notes                      |
| -------------------- | ----------------------------------------------------------------------------------- | -------- | -------------------------- |
| `manifest.json`      | [`onnx-community/whisper-base`](https://huggingface.co/onnx-community/whisper-base) | ~77.3 MB | Default. int8, ~74M params |
| `manifest-tiny.json` | [`onnx-community/whisper-tiny`](https://huggingface.co/onnx-community/whisper-tiny) | ~41.4 MB | Faster, lower accuracy     |

Each manifest declares three digest-pinned assets: an encoder ONNX graph, a
no-past decoder ONNX graph, and the byte-level BPE `vocab.json`. The tokenizer is
byte-identical across tiny/base, so both manifests share one cached tokenizer.

## Why these models

The int8 ONNX exports give the PWA a substantially smaller on-demand download
than full-precision Whisper while keeping the model runtime unified on ORT. Base
int8 is the default quality/size balance; tiny int8 is the faster option for
lower-powered devices. fp16/fp32 and 4-bit variants can be added later as more
catalog entries if their digests and decode thresholds are pinned.

int8 predictions are slightly less confident than fp32, so each manifest carries
decode thresholds (`logProbThreshold`, `noSpeechThreshold`,
`compressionRatioThreshold`, `temperatures`) that can be tuned without code
changes.

## How the model runs

- **Execution provider:** `wasm` with CPU tensors. ASR is not frame-coupled, so
  the full-frame no-CPU hard gate does not apply.
- **Decoder:** the shipped decoder is the no-past graph. Each greedy step runs
  with the full token sequence and reads the last logits row; the manifest keeps
  an optional `decoderWithPast` slot for a future incremental runtime.
- **Tokenizer:** decoding token ids to text uses only `vocab.json`; BPE merges are
  needed for encoding, not decoding.

## Fetch, verify, cache

The worker fetches model files through the same-origin `/_model/hf/` proxy,
verifies `sizeBytes` and SHA-256, and caches verified bytes in OPFS keyed by
digest. Nothing downloads at startup; the network is touched only after the user
clicks **Load model**. A corrupt cache entry fails the digest check and is
redownloaded.

ORT runtime WASM is separate from these assets. It is version-pinned and proxied
through `/_ort/`, then runtime-cached on first ORT use.

## Provenance

- Models: `onnx-community/whisper-{base,tiny}` `onnx/*_quantized.onnx`
  (Apache-2.0 export of OpenAI Whisper, MIT).
- Tokenizer: `openai/whisper-base` `vocab.json`.
- Digests: taken from the Hugging Face repo tree API; LFS `oid` is the file
  SHA-256. If upstream re-exports a graph, update `sizeBytes`, `checksum`, and
  the top-level manifest size together.

> Dev-server note: the ASR worker is a classic worker. Vite serves classic
> workers as ESM under local dev, so test Auto Captions against the built app
> (`pnpm build` then `pnpm preview`) when validating real inference.
