# Tasks: WASM SIMD Audio Resampler

> Status: **Planned**. Drop-in SIMD-accelerated replacement for the JS
> polyphase sinc resampler.

## T1 — WASM module (R1)

- [ ] **T1.1** Implement the 16-tap polyphase FIR inner loop in C/Rust with
  `wasm-simd128` intrinsics.
- [ ] **T1.2** Port the streaming state (history buffer, fractional position,
  filter table) to match the JS `AudioResampler.process()` contract.
- [ ] **T1.3** Verify output parity: < 1e-6 per-sample error vs. JS on a
  reference signal.

## T2 — Build + integration (R2, R3)

- [ ] **T2.1** Build pipeline (Emscripten/wasm-pack) producing `.wasm` output.
- [ ] **T2.2** Wrapper class implementing `AudioResampler` interface, lazy-
  loading the WASM module on first use.
- [ ] **T2.3** SIMD feature detection via `WebAssembly.validate`; transparent
  fallback to JS `AudioResampler`.

## T3 — Performance (R4)

- [ ] **T3.1** Benchmark harness: measure samples/sec for 44.1→48 kHz stereo.
- [ ] **T3.2** Document results in `test-fixtures/BENCHMARKS.md`.

## T4 — Tests (R5)

- [ ] **T4.1** Run existing `audio-resampler.test.ts` against WASM impl.
- [ ] **T4.2** `npm run build` green; `npm test` green.
