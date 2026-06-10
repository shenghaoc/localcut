# Tasks: WASM SIMD Audio Resampler

> Status: **Complete.** SIMD-accelerated polyphase sinc resampler shipped in
> PR #54 (core) and hardened in PR #57 (build script, WAT optimizations,
> streaming tests, review fixes).

## T1 — WASM module (R1)

- [x] **T1.1** Implement the 16-tap polyphase FIR inner loop in hand-written
  WAT with `wasm-simd128` intrinsics (`v128.load`, `f32x4.mul`, `f32x4.add`,
  `v128.load32_lane` for multi-channel gather).
- [x] **T1.2** Port the streaming state (history buffer via `$historyFilled`
  global, fractional position via `$inputFraction`, filter table pointer) to
  match the JS `AudioResampler.process()` contract. `f32` precision throughout.
- [x] **T1.3** Verify output parity: < 1e-5 per-sample error vs. the JS
  `Float64Array` implementation on a reference sine signal.

## T2 — Build + integration (R2, R3, R4)

- [x] **T2.1** `scripts/build-wasm.mjs` using `wabt` JS API (`parseWat` with
  `{ simd: true }`, `toBinary`). Writes `.wasm` + base64 `.ts`. `npm run
  build:wasm` in `package.json`.
- [x] **T2.2** `WasmAudioResampler` wrapper: async `init()` compiles module;
  synchronous `process()`/`flush()`; lazy-init re-check guard; `usedFallback`
  prevents mid-stream hot-swap; transparent JS `AudioResampler` fallback.
- [x] **T2.3** SIMD feature detection: `typeof WebAssembly` guard + nested
  `try-catch` around `WebAssembly.validate(simdTestBytes)` + outer
  `detectAndCompile()` try-catch for `atob` + `WebAssembly.compile`.
- [x] **T2.4** `WasmAudioResampler.init()` called at module level in
  `audio-source.ts` so the module is ready before the first `process()`.

## T3 — Performance (R4)

- [x] **T3.1** Benchmark harness: measures samples/sec for 44.1→48 kHz stereo;
  asserts speedup > 0 (CI-safe); `console.warn` when speedup < 2x.
- [x] **T3.2** `test-fixtures/BENCHMARKS.md` section 8 with reference run data
  (3.12x mono, hardware-dependent).

## T4 — Tests (R5)

- [x] **T4.1** WASM-specific test suite (`audio-resampler-wasm.test.ts`):
  tolerance < 1e-5, streaming content comparison, flush history carryover,
  reset state, lazy-init paths.
- [x] **T4.2** `npm run build` green; `npm test` green (701+ tests).
