# Requirements: WASM SIMD Audio Resampler

## R1 — SIMD-accelerated FIR convolution

- **R1.1** The polyphase sinc resampler's inner loop (16-tap dot product per
  channel per frame) runs in a WASM module using `wasm-simd128` intrinsics
  (`v128.load`, `f32x4.mul`, `f32x4.add`).
- **R1.2** The WASM module implements the same streaming `process()` contract
  as the JS `AudioResampler`: history carryover, fractional position tracking,
  and compatible filter table layout. The WASM inner loop operates on `f32`
  precision; the JS `Float64Array` filter table must be converted to `Float32Array`
  (or built as `f32` from the start) so both implementations share the same
  numeric type without runtime conversion overhead.
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

- **R3.1** WASM module built via Emscripten or wasm-pack; output checked into
  `public/` or inlined as a base64 data URL.
- **R3.2** `npm run build` and `npm test` green; no new native toolchain
  required in CI beyond what ships with the WASM toolchain.

## R4 — Performance

- **R4.1** Benchmark: ≥2x throughput improvement for 44.1 kHz → 48 kHz stereo
  resampling vs. the JS implementation on representative hardware.
- **R4.2** No regression in startup time. The WASM module is compiled and
  instantiated **asynchronously** via an explicit `init()` call (e.g. during
  audio source setup or worker startup) — not lazily on the first synchronous
  `process()` call. `process()` is synchronous; modern browsers disallow
  synchronous `WebAssembly.Module` compilation for modules > 4 KB on the main
  thread, so the module must be ready before `process()` is first called. If
  `init()` has not been called (or failed), the wrapper falls back to the JS
  implementation transparently.

## R5 — Tests

- **R5.1** Existing `audio-resampler.test.ts` suite passes against both JS and
  WASM implementations (tolerance adjusted for `f32` precision).
- **R5.2** Benchmark harness in `test-fixtures/BENCHMARKS.md` documents measured
  throughput.
