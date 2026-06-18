# Design: Phase 29 - Auto Captions

Auto Captions is a non-frame-coupled ORT-WASM feature. It extracts selected clip
audio through the existing pipeline worker surface, runs Whisper in a dedicated
ASR worker, and writes the result into the Phase 22 caption-track model.

## Model Assets

The shipped manifests live under `public/models/whisper-onnx/`:

- `manifest.json`: Whisper Base ONNX int8, default, about 77 MB.
- `manifest-tiny.json`: Whisper Tiny ONNX int8, about 41 MB.

Each manifest pins:

- encoder ONNX graph
- no-past decoder ONNX graph
- tokenizer vocabulary
- exact file sizes and SHA-256 checksums
- language token IDs for English and Chinese
- decode thresholds and temperature ladder

The model README records Hugging Face provenance and digest refresh steps.

## Runtime

`src/engine/asr/asr-worker.ts` loads the manifest, validates
`runtime: "ort-whisper"`, fetches the assets through the same-origin model proxy,
and creates ORT-WASM sessions via the shared ORT foundation. The decoder loop
uses `whisper-decode.ts` and creates timed caption segments from the token stream.

Because ASR is not per video frame, CPU tensors are acceptable. The model and ORT
runtime still load lazily, and no model bytes are precached.

## UI Flow

1. User opens Auto Captions and selects a model.
2. User clicks **Load model**; assets fetch, verify, and cache.
3. User selects a clip and clicks **Transcribe selected clip**.
4. The controller extracts bounded PCM windows and sends them to the ASR worker.
5. The worker returns caption segments.
6. The pipeline worker creates an undoable caption track.

The panel is experimental, local-only, and cancellable. It reports unavailable
when WebAssembly is missing.

## Boundaries

- No browser speech fallback.
- No cloud fallback.
- No startup model load.
- No main-thread inference.
- No runtime choice outside the ORT Whisper model catalog.
