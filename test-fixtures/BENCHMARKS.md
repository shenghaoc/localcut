# Performance Benchmarks

Reproducible performance benchmark procedures for release validation.

## Prerequisites

- Chromium 120+ with WebGPU enabled
- Hardware GPU (discrete preferred; integrated acceptable with noted baselines)
- `crossOriginIsolated === true` (COOP/COEP headers via `npm run dev`)
- Test fixtures generated: `cd test-fixtures && ./generate-fixtures.sh`

## Benchmark commands

### 1. Build timing

```bash
time npm run build
```

Baseline: < 10s on modern hardware. Report: build time, output bundle size.

### 2. Test suite timing

```bash
time npm test
```

Baseline: < 2s. Report: total duration, test count.

### 3. Startup + pipeline ready

Open `http://localhost:5173` in Chromium. Measure time from page load to status bar showing "Pipeline ready".

Baseline: < 3s. Affected by: GPU adapter enumeration, WebCodecs probing, autosave restore check.

### 4. Import latency

Import `test-fixtures/tiny-h264.mp4`. Measure time from file selection to "Loaded" status.

Baseline: < 1s for the tiny fixture. Scales with file size and codec complexity.

### 5. Preview frame rate

Play the imported clip. Open diagnostics panel. Check the `dropped-preview-frame-rate` budget counter.

Target: < 5% dropped frames at source fps. Warning: > 10%. Breach: > 25%.

### 6. Export throughput

Export the imported clip with default H.264 settings. Record the export ETA and actual duration.

Target: >= 1x realtime for the tiny fixture. Report: codec, resolution, fps, actual throughput.

### 7. GPU submission count

During preview playback, check the `gpu-submissions-per-frame` budget counter in diagnostics.

Target: exactly 1 submission per frame on the accelerated path.

### 8. WASM SIMD resampler throughput

```bash
npx vitest run src/engine/audio-resampler-bench.test.ts --disable-console-intercept
```

Measures samples/sec for 44.1 kHz → 48 kHz stereo resampling, WASM SIMD
(`src/engine/audio-resampler-wasm.ts`) vs pure-JS `AudioResampler`.

Target: >= 2x speedup on hardware with wasm-simd128 (informational in CI —
the test logs a warning below 2x rather than failing, since CI hardware
varies). Report: JS samples/sec, WASM samples/sec, speedup.

Reference run (Apple Silicon, Node 22, 2026-06): JS 63.1M samples/sec,
WASM 197.3M samples/sec — **3.12x** speedup.

## Recording baselines

Record results in a local file (not committed):

```
Date: YYYY-MM-DD
Browser: Chrome XXX
GPU: [model]
OS: [platform]
Build: X.Xs
Tests: X.Xs (NNN tests)
Startup: X.Xs
Import (tiny-h264): X.Xs
Preview dropped: X%
Export throughput: X.Xx realtime
GPU submits/frame: 1
```

## Acceptable skip reasons

| Metric | Skip reason | When |
|--------|-------------|------|
| GPU submissions | `webgpu.unavailable` | No WebGPU adapter |
| Preview frame rate | `webgpu.unavailable` | Software rendering fallback |
| Export throughput | `webcodecs.encoder_unsupported` | Missing H.264 encoder |

## Where release evidence is recorded

- CI: `npm run build` and `npm test` output in CI logs
- Performance: local benchmark file (not committed; screenshot in PR description)
- Diagnostics: copy report from diagnostics panel pasted in PR description
