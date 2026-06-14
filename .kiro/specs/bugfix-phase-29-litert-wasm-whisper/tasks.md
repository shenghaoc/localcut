# Tasks: Phase 29 LiteRT WASM Whisper

> Status: **Implemented in this PR (spec + implementation).**

- [x] Add LiteRT.js runtime loading for the ASR worker with experimental WebNN,
  WebGPU, and `wasm` accelerator selection. (`litert-runtime.ts` + untyped
  `litert-loader.js` boundary; WASM/JSPI assets self-hosted under
  `public/litert/` via `pnpm setup:litert`.)
- [x] Define and validate the Whisper model manifest, including encoder,
  decoder, tokenizer, size, license, source, and per-asset SHA-256 digests.
  (`model-manifest.ts`, `public/models/whisper/manifest.json`.)
- [x] Cache verified model assets for offline reuse after first download.
  (`asset-cache.ts`, OPFS-backed, digest-verified, re-download on corruption;
  the worker reports a `cached` flag so the UI shows cache-only loads.)
- [x] Curated model catalog + trusted-host allowlist (`model-catalog.ts`):
  selectable models with provider/license/`infoUrl` ("Learn more" link), and
  `assertTrustedModelUrl` enforced in the worker on the manifest + every asset
  URL (this origin, Hugging Face, Kaggle/GCS, GitHub). UI model picker appears
  once more than one model is listed.
- [x] Implement PCM windowing from selected clips using the existing pipeline
  worker extraction messages. (`asr-controller.ts` streams 16 kHz mono windows.)
- [x] Implement Whisper feature extraction: mono input validation, log-mel
  generation, chunk overlap, and progress accounting. (`whisper-dsp.ts`
  `prepareMonoPcm` + existing log-mel/chunk helpers.)
- [x] Implement LiteRT encoder/decoder invocation and token decoding.
  (`litert-runtime.ts` encode/decode; greedy decode in `whisper-decode.ts`.)
- [x] Convert decoded tokens into non-empty caption segments with language and
  timestamp metadata. (`word-timestamps.ts`; empty transcript rejected.)
- [x] Wire Auto Captions UI states for model download, load, transcription,
  cancellation, and explicit failures. (`asr-controller.ts`,
  `AutoCaptionsPanel.tsx`.)
- [x] Add unit tests for manifest validation, empty-result rejection, controller
  state, worker errors, caption-track creation, the byte-level tokenizer, the
  greedy decode loop, the trusted-host allowlist, and the Whisper mel DSP.
- [ ] Manual Chrome smoke — verify against the production build with both
  selectable models after any DSP/backend change. The accepted result is a real
  word transcript from the test clip, not repeated numbers or degenerate token
  output.

## Notes

- Browser SpeechRecognition / Chrome Speech is removed: LiteRT Whisper is the
  only engine, identified as `litert-whisper` across the protocol. The probe
  gates availability on `WebAssembly` and reports WebNN/WebGPU as optional
  accelerator signals.
- **Real model**: `litert-community/whisper-tiny` — a single TFLite with `encode`
  /`decode` signatures. Decode uses a constant lower-triangular additive causal
  mask (`0` on/below the diagonal, `-3.4e38` above) over a fixed 128-token buffer,
  argmaxing the last filled row; forces only `<|startoftranscript|>` and stops at
  `<|endoftext|>`. Mel features follow Whisper exactly (slaney filterbank,
  reflect-centered STFT, periodic Hann, `log10`, `clamp(max−8)/4` normalisation) —
  getting any of these wrong makes the encoder emit `<|nospeech|>`.
- **LiteRT loads its WASM via `importScripts`**, which ES module workers forbid,
  so the ASR worker is spawned as a **classic** worker (`{ type: 'classic' }`) and
  `@litertjs/core` is statically bundled into it. Because @litertjs passes no file
  locator, a `globalThis.Module.locateFile` is set so emscripten fetches the WASM
  from `/litert/` rather than the worker's asset directory.
- **Known limitation**: classic workers are bundled correctly in the production
  build but Vite's **dev server** serves them as ESM and errors. Auto Captions
  therefore works in the built app (`pnpm build` + serve), not under `pnpm dev`.
- `@litertjs/core`'s type surface is kept out of the TS program (it has a global
  TypedArray augmentation) via the untyped `litert-loader.js` boundary.
