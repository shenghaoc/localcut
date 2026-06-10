# Requirements: WASM SIMD Audio Resampler

## R1 — SIMD-accelerated FIR convolution

- **R1.1** The polyphase sinc resampler's inner loop (16-tap dot product per
  channel per frame) runs in a WASM module using `wasm-simd128` intrinsics
  (`v128.load`, `f32x4.mul`, `f32x4.add`).
- **R1.2** The WASM module implements the same streaming `process()` contract
  as the JS `AudioResampler`: history carryover, fractional position tracking,
  and compatible filter table layout. The WASM inner loop operates on `f32`
  precision; the filter table is built as `Float32Array` so both implementations
  share the same numeric type without runtime conversion overhead.
- **R1.3** Output is within a bounded tolerance (< 1e-5 per sample) of the JS
  `Float64Array` implementation. Bit-level equivalence is not expected due to
  the `f64` → `f32` precision reduction in the filter table and accumulator.

## R2 — Same interface, transparent swap

- **R2.1** The WASM resampler satisfies the `AudioResampler` interface so
  `audio-source.ts` and `resampleBlock` callers are unchanged.
- **R2.2** Feature-detect SIMD support at init; guard against environments where
  `WebAssembly` is undefined (SSR, older browsers) by checking
  `typeof WebAssembly !== 'undefined'` before calling `WebAssembly.validate`,
  wrapped in a `try-catch`. Fall back to the JS implementation on any failure.

## R3 — Build integration

- **R3.1** WASM module authored as hand-written WAT with SIMD intrinsics;
  compiled via `wabt` (`parseWat` + `toBinary`); output inlined as a base64
  data URL in `resampler-simd-wasm-b64.ts`.
- **R3.2** `npm run build:wasm` regenerates the binary from `resampler-simd.wat`.
- **R3.3** `npm run build` and `npm test` green; no native toolchain required
  beyond `wabt` (pure JS, ships as an npm devDependency).

## R4 — Performance

- **R4.1** Benchmark: ≥2x throughput improvement for 44.1 kHz → 48 kHz stereo
  resampling vs. the JS implementation on representative hardware.
- **R4.2** No regression in startup time. The WASM module is compiled
  asynchronously via `WasmAudioResampler.init()` during worker/source startup.
  `process()` is synchronous; if `init()` has not been called (or failed), the
  wrapper falls back to the JS implementation transparently.

## R5 — Tests

- **R5.1** Existing `audio-resampler.test.ts` suite passes against both JS and
  WASM implementations (tolerance adjusted for `f32` precision: < 1e-5).
- **R5.2** Streaming content comparison test verifies chunked output matches
  single-block processing (catches history corruption across boundaries).
- **R5.3** Benchmark harness in `test-fixtures/BENCHMARKS.md` documents measured
  throughput; `console.warn` when speedup < 2x.
