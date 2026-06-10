# Tasks: WASM SIMD Audio Resampler

> Status: **Planned**. Drop-in SIMD-accelerated replacement for the JS
> polyphase sinc resampler.

## T1 — WASM module (R1)

- [ ] **T1.1** Implement the 16-tap polyphase FIR inner loop in C/Rust with
  `wasm-simd128` intrinsics.
- [ ] **T1.2** Port the streaming state (history buffer, fractional position,
  filter table) to match the JS `AudioResampler.process()` contract. Use `f32`
  precision throughout (filter table, accumulator, history) to match the SIMD
  `f32x4` lane width.
- [ ] **T1.3** Verify output parity: < 1e-5 per-sample error vs. the JS
  `Float64Array` implementation on a reference signal (tolerance accounts for
  `f64` → `f32` precision reduction).

## T2 — Build + integration (R2, R3, R4)

- [ ] **T2.1** Build pipeline (Emscripten/wasm-pack) producing `.wasm` output.
- [ ] **T2.2** Wrapper class implementing `AudioResampler` interface with an
  async `init()` that compiles and instantiates the WASM module. `process()` is
  synchronous and uses the pre-compiled instance; if `init()` was not called or
  failed, the wrapper delegates to the JS `AudioResampler` transparently.
- [ ] **T2.3** SIMD feature detection: guard with
  `typeof WebAssembly !== 'undefined'` + `try-catch` around
  `WebAssembly.validate(simdTestBytes)`; fall back to JS on any failure
  (missing global, validate rejection, instantiation error).
- [ ] **T2.4** Call `init()` during worker startup or audio source setup so the
  module is ready before the first synchronous `process()` call.

## T3 — Performance (R4)

- [ ] **T3.1** Benchmark harness: measure samples/sec for 44.1→48 kHz stereo.
- [ ] **T3.2** Document results in `test-fixtures/BENCHMARKS.md`.

## T4 — Tests (R5)

- [ ] **T4.1** Run existing `audio-resampler.test.ts` against WASM impl
  (tolerance adjusted for `f32` precision).
- [ ] **T4.2** `npm run build` green; `npm test` green.
