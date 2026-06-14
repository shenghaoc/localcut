# Bugfix: Phase 29 LiteRT WASM Whisper

> Status: **Spec + implementation (this PR).** Restores Phase 29 Auto Captions
> with a real selected-audio Whisper path. LiteRT.js Whisper is now the only
> engine — preferring experimental WebNN when enabled, then WebGPU,
> and falling back to WASM. There is no placeholder probe and no Browser
> SpeechRecognition fallback.

## Problem

Auto Captions needs to transcribe audio selected from the timeline. Browser
SpeechRecognition cannot accept extracted clip PCM, and WebNN presence alone did
not provide a working Whisper implementation. Phase 29 needs a real on-device
inference framework (LiteRT), not a "plug the model in" stub like Phase 28.

## Requirements

- Transcription must use PCM extracted from the selected clip or timeline range,
  never mic input or app playback capture.
- The runtime is LiteRT.js, so it works on baseline `wasm` and can use WebGPU or
  experimental WebNN when the browser supports those accelerators. The requested
  backend order is WebNN, then WebGPU, then WASM fallback.
- Model assets load only after explicit user action, declare size/license/source
  in a manifest, pass SHA-256 digest checks, and cache (OPFS) for offline reuse.
- Inference runs in the ASR worker. The Solid UI must only drive state and show
  progress.
- Empty or whitespace-only results must not create a caption track.
- Successful transcription creates a normal generated caption track with
  editable caption segments.

## Acceptance

- With `1177688_693058837376611_43054_n.mp4`, selecting the speaking clip and
  clicking **Transcribe selected clip** produces a non-empty transcript.
  _(Manual smoke — requires the provisioned Whisper assets; see
  `public/models/whisper/README.md`.)_
- Chrome Speech is not used or requested. ✅ The Browser SpeechRecognition path
  is removed entirely (`chrome-speech.ts` / `web-speech.d.ts` deleted).
- The app remains usable when the model is missing, checksum validation fails,
  or the browser lacks WASM support. ✅ Each path surfaces an explicit error and
  never creates an empty caption track or falls back to the cloud.
