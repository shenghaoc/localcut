# Design: WASM SIMD Audio Resampler

> Status: **Complete.** Core shipped in PR #54; hardened in PR #57.

## Goal

Replace the pure-JS polyphase sinc resampler's inner loop with a hand-written
WASM module using `wasm-simd128` intrinsics for ≥2x throughput on the 16-tap
FIR convolution that dominates real-time audio resampling cost.

## Approach

### WAT over Emscripten/Rust

The hot loop is ~200 lines of WAT — small enough that a hand-written module
avoids build toolchain complexity (no Emscripten, no Rust, no wasm-pack). The
`wabt` npm package compiles WAT→WASM in pure JS via `scripts/build-wasm.mjs`.

### Transparent fallback

`WasmAudioResampler` wraps a JS `AudioResampler` as a fallback. Detection is
layered: `typeof WebAssembly` guard → `WebAssembly.validate(simdTestBytes)` →
`WebAssembly.compile(binary)` → `new WebAssembly.Instance(module)`. Any failure
at any layer silently falls back to JS. A `usedFallback` flag prevents
mid-stream hot-swap between JS and WASM paths.

### Async compile, sync process

`WasmAudioResampler.init()` is async (calls `WebAssembly.compile`) and should
be called during startup. `process()` and `flush()` are synchronous — they use
the pre-compiled instance. If init hasn't completed, a lazy-init guard retries
once and re-checks before falling back to JS.

### Memory layout

```
[filter table (f32 × filterSize × tablePoints)] [working area] [output area]
```

The working area holds `history + new input` (interleaved, f32). WASM reads the
combined buffer; JS-side `historyFilled` stays in sync with the WASM global
`$historyFilled` across `process()`, `flush()`, and `reset()`.

### SIMD strategy

- **Mono**: contiguous `v128.load` (4 taps per iteration) + `f32x4.mul` + `f32x4.add`.
- **Multi-channel**: `v128.load32_lane` ×4 to gather interleaved samples for one
  channel across 4 taps. This is scalar-equivalent for stereo but matches the
  conventional WASM SIMD pattern for interleaved audio.
- **Horizontal sum**: f32x4 → f64 promotion → horizontal add → f32 demotion.
  Avoids f32 catastrophic cancellation in the accumulator reduction.

## Files

| File | Role |
|---|---|
| `src/engine/resampler-simd.wat` | WASM module source (WAT + SIMD) |
| `src/engine/resampler-simd.wasm` | Compiled binary |
| `src/engine/resampler-simd-wasm-b64.ts` | Base64-inlined binary for bundling |
| `src/engine/audio-resampler-wasm.ts` | TypeScript wrapper + fallback |
| `src/engine/audio-resampler-wasm.test.ts` | Unit tests |
| `src/engine/audio-resampler-bench.test.ts` | Benchmark harness |
| `scripts/build-wasm.mjs` | WAT→WASM build script |
