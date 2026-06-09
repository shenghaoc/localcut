# Requirements: WASM SIMD Audio Resampler

## R1 — SIMD-accelerated FIR convolution

- **R1.1** The polyphase sinc resampler's inner loop (16-tap dot product per
  channel per frame) runs in a WASM module using `wasm-simd128` intrinsics
  (`v128.load`, `f32x4.mul`, `f32x4.add`).
- **R1.2** The WASM module implements the same streaming `process()` contract
  as the JS `AudioResampler`: history carryover, fractional position tracking,
  and identical filter table layout.
- **R1.3** Output is bit-level equivalent or within a bounded tolerance (< 1e-6
  per sample) of the JS implementation.

## R2 — Same interface, transparent swap

- **R2.1** The WASM resampler satisfies the `AudioResampler` interface so
  `audio-source.ts` and `resampleBlock` callers are unchanged.
- **R2.2** Feature-detect SIMD support at init; fall back to the JS
  implementation when `WebAssembly.validate` rejects the SIMD test module.

## R3 — Build integration

- **R3.1** WASM module built via Emscripten or wasm-pack; output checked into
  `public/` or inlined as a base64 data URL.
- **R3.2** `npm run build` and `npm test` green; no new native toolchain
  required in CI beyond what ships with the WASM toolchain.

## R4 — Performance

- **R4.1** Benchmark: ≥2x throughput improvement for 44.1 kHz → 48 kHz stereo
  resampling vs. the JS implementation on representative hardware.
- **R4.2** No regression in startup time (lazy-load the WASM module on first
  resample, not at import).

## R5 — Tests

- **R5.1** Existing `audio-resampler.test.ts` suite passes against both JS and
  WASM implementations.
- **R5.2** Benchmark harness in `test-fixtures/BENCHMARKS.md` documents measured
  throughput.
