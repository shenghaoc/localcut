# Design: Phase 21 — Colour Management + Scopes

> Status: **Planned** — make colour behaviour explicit and inspectable without pretending to be a professional HDR mastering suite.

## Goal

Surface source colour metadata, define an explicit working space, enforce a single stable pipeline order shared by preview and export, add real-time WebGPU scopes (histogram, waveform, parade, vectorscope), and add clipping/HDR warning states — all without Canvas2D readback in the premium path.

---

## Colour Metadata Model (`src/engine/colour.ts`)

```
type TransferCharacteristic = 'bt709' | 'bt2020-10' | 'bt2020-12' | 'smpte2084' | 'arib-std-b67' | 'linear' | 'srgb' | 'unknown';
type ColourPrimaries = 'bt709' | 'bt2020' | 'smpte170m' | 'p3' | 'unknown';
type MatrixCoefficients = 'bt709' | 'bt601' | 'bt2020-ncl' | 'bt2020-cl' | 'identity' | 'unknown';

ColorMetadata {
  primaries: ColourPrimaries;
  transfer: TransferCharacteristic;
  matrix: MatrixCoefficients;
  origin: 'container' | 'assumed' | 'none';  // never guess
  fullRange: boolean;                         // true = full, false = limited/tv
}
```

Attached to clip handles during mediabunny probe; absent container metadata → `origin: 'none'`, `primaries: 'unknown'`, etc. Inspector displays it read-only.

## Working Colour Config

```
WorkingColorConfig {
  primaries: 'bt709';           // Rec.709 / sRGB gamut
  transferWorking: 'linear';   // linear-light compositing
  transferOutput: 'srgb';      // sRGB OETF for display/export output
  matrix: 'bt709';             // BT.709 Y'CbCr ↔ RGB
}
```

The working space is **documented as an explicit constant**, not buried in shader math. It is deliberately SDR-only for this phase: the editor targets SDR output, and HDR content gets best-effort tone-mapping with a warning.

## Pipeline Stage Order

The pipeline order is the spec — it exists as a single enum-like const map with an ordered array. `compositeLayers` iterates stages in order; no stage is added, removed, or reordered without touching this array.

```
const PIPELINE_ORDER: ColorPipelineStage[] = [
  'source-normalization',
  'base-correction',
  'lut-apply',
  'opacity',
  'transform',
  'compositing',
  'output-conversion',
];

type ColorPipelineStage =
  | 'source-normalization'   // container space → working linear
  | 'base-correction'       // brightness/contrast/saturation/temperature
  | 'lut-apply'              // 3D LUT (Phase 15)
  | 'opacity'               // per-layer opacity modulate
  | 'transform'             // position/scale/rotation (Phase 12)
  | 'compositing'           // premultiplied "over" onto accumulator
  | 'output-conversion';    // working linear → sRGB OETF (preview) or target (export)
```

### Stage Implementation Notes

- **source-normalization**: New. A compute pass that applies the inverse transfer → matrix conversion from source metadata to working space. When `origin: 'none'` or metadata is unsupported, this pass is an identity (passthrough).
- **base-correction**: Existing `encodeColourChain` in `effects.ts`. Brightness/contrast, saturation, colour-temperature in working linear space.
- **lut-apply**: Existing from Phase 15. 3D LUT in working linear space.
- **opacity**: New stage. Currently opacity is likely folded into transform or composite. Extract as a dedicated pre-transform linear multiply on the alpha channel.
- **transform**: Existing `transform.wgsl` from Phase 12.
- **compositing**: Existing `composite-over.wgsl` from Phase 12.
- **output-conversion**: New. A compute pass that applies the working-to-output conversion (sRGB OETF for display, or export target). This is the **last** stage, after compositing, so scopes see the pre-output signal.

### Refactoring Impact

The current `encodeColourChain` in `effects.ts` handles brightness → saturation → colour-temperature → LUT. After this phase, the pipeline is restructured so that `compositeLayers` in `gpu.ts` orchestrates all stages through a single ordered function. `encodeColourChain` is replaced by `encodeBaseCorrection` and `encodeLutApply` as separate, independently callable function calls within the larger pipeline loop. The LUT pass moves after base correction per the new order.

Passes within `base-correction` retain their existing relative order (brightness/contrast → saturation → colour-temperature).

## Source Normalization Pass

New WGSL shader: `source-normalize.wgsl` (and `*.f16.wgsl`).

Input uniforms:
```
struct NormalizationParams {
  inverseTransfer: u32;   // enum: 0=identity, 1=bt709, 2=srgb, 3=pq, 4=hlg, 5=bt2020
  matrixR: vec3<f32>;     // first column of 3×3 matrix
  matrixG: vec3<f32>;
  matrixB: vec3<f32>;
  fullRange: u32;         // 0=limited (16-235 → 0-1), 1=full
};
```

The CPU side pre-computes the matrix + inverse transfer function selection at clip-open time. Per-frame, only the uniform buffer is bound — no runtime branching on metadata.

### Supported Conversions

| Source Metadata | Path | Status |
|---|---|---|
| BT.709 primaries + BT.709 transfer + BT.709 matrix | Identity (already working space) | Supported |
| BT.601 matrix + BT.709 transfer | BT.601 → BT.709 matrix only | Supported |
| Rec.2020 primaries + PQ/HLG transfer | BT.2408 tone-map to SDR | Supported with HDR warning |
| Rec.2020 primaries + SDR transfer | Matrix conversion only + HDR gamut warning | Supported with gamut warning |
| Anything with `origin: 'none'` | Identity + ambiguity badge | Supported |
| P3 primaries | Matrix to BT.709 + possible clipping warning | Supported |

Unsupported combinations (e.g., XYZ primaries, log transfer curves) pass through as identity with an explicit "unsupported colour space" warning.

## Output Conversion Pass

New WGSL shader: `output-convert.wgsl` (and `*.f16.wgsl`).

```
struct OutputParams {
  transferOut: u32;       // 0=srgb OETF, 1=pq, 2=hlg (future HDR export)
  encodeFullRange: u32;   // 0=limited, 1=full
};
```

For this phase, `transferOut` is always `0` (sRGB OETF). The uniform exists so export can later select a different target without touching the shader.

---

## Scope Architecture

### Data Flow

```
Composited frame (GPUTexture, after compositing, before output-conversion)
  → scope compute pass (histogram/waveform/parade/vectorscope, single encoder)
  → scope reduction → SAB ring-buffer (Float32Array, ~4 KB per scope type)
  → main thread rAF reads SAB → renders to <canvas> via Canvas2D (display only)
```

**Key constraints:**
- No `getImageData` or Canvas2D readback at any point.
- SAB ring-buffer format: 4 scope slots, each `[magic, timestamp, ...data]` — the worker writes, the main thread reads with a sequence-number check to avoid torn reads.
- Scopes render at most once per N preview frames (configurable `scopeInterval`; default N ≈ 6 for ~10 Hz at 60 fps).

### Scope Types

```
ScopeType = 'histogram' | 'waveform-luma' | 'parade-rgb' | 'vectorscope';

ScopeResult {
  type: ScopeType;
  timestamp: number;         // frame timestamp for UI sync
  data: Float32Array;        // layout varies by type
};

ScopeFrameInput {
  texture: GPUTexture;       // composited frame (linear working space)
  width: number;
  height: number;
  scopeResX: number;         // reduced resolution
  scopeResY: number;
  features: ScopeFeatures;   // subgroups / f16 availability
};
```

### Scope Compute Shaders

All four scopes are computed in a **single** WebGPU compute pass (one encoder, one submit) from the composited frame texture. This minimizes GPU submission overhead.

**`scopes.wgsl`** (+ `scopes.f16.wgsl`) contains all four scope entry points, selected by workgroup invocation index.

#### Histogram
- Compute per-channel (R, G, B, Y) histograms.
- 256 bins per channel, log-scale for display.
- Shared-memory atomic accumulation across workgroup threads.
- With subgroups: warp-level min/max then atomic binning. Without: shared-memory atomics with barriers.
- Output: 4 × 256 `f32` values (1024 floats).

#### Luma Waveform
- Map luminance (Y = 0.2126R + 0.7152G + 0.0722B) to vertical position.
- Horizontal axis: column position (reduced resolution determines bin count).
- Each column accumulates the luminance value; the waveform shows the distribution.
- Shared-memory per-column max/min with atomic exchange.
- Output: `scopeResX × 2` values (min/max per column).

#### RGB Parade
- Same as luma waveform but for R, G, B channels separately, stacked horizontally.
- Output: `3 × scopeResX × 2` values.

#### Vectorscope
- Compute Cb/Cr from RGB in linear working space, map to polar coordinates on a 2D texture.
- Accumulate hit counts in a 256×256 atomic texture.
- Include a skin-tone indicator line (I-axis at ~123°).
- Output: 256 × 256 `u32` hit counts (65536 ints).

### SAB Ring-Buffer Layout

```
// Per-scope slot (4 slots):
//   [0] magic: f32 (bit pattern to detect torn writes)
//   [1] timestamp: f32 (frame time)
//   [2..N] data: f32[] (scope-specific)
//
// histogram:  N =   2 + 1024 = 1026
// waveform:   N =   2 + 2 * scopeResX
// parade:     N =   2 + 6 * scopeResX
// vectorscope: N =  2 + 65536 (or downsampled to 128×128 = 16384)
//
// Total ring buffer: sum of max sizes + padding → ~100 KB
```

Writer (worker): write magic to 0 first, then data, then magic to the real value.
Reader (main thread): read magic; if 0, skip; read data; re-read magic; if unchanged, data is valid.

### Main-Thread Scope Rendering

`src/ui/ScopePanel.tsx`:
- Reads SAB in rAF (clock.ts already has the rAF loop).
- Renders each scope to a small `<canvas>` element via Canvas2D (display-only — no analysis, no pixel feedback to engine).
- Canvas2D is acceptable here because these are low-resolution diagnostic overlays, not the premium preview pipeline.
- Each scope canvas is `<canvas width={displayW} height={displayH}>` with the dark UI aesthetic.

---

## Clipping & Out-of-Range Detection

Clipping detection is folded into the scope compute pass as an additional reduction:
- After output conversion (sRGB OETF), any pixel with any channel outside [0, 1] increments a per-frame counter.
- The counter is written to the SAB alongside scope data.
- Main thread reads the counter; if > threshold, shows clipping badge.

**Zebra overlay**: A toggleable preview overlay renders pixels outside [0, 1] as a striped pattern. Because this requires per-pixel evaluation, it runs as a dedicated cheap pass (single dispatch, minimal arithmetic) only when the user enables it. It writes to a separate small overlay texture composited onto the preview via the existing present path.

---

## HDR Warning States

```
HDRWarning {
  type: 'hdr-content-detected' | 'gamut-mismatch' | 'tone-map-active' | 'export-hdr-to-sdr';
  clipIds: string[];
  message: string;
}
```

Generated during clip probe and pipeline setup. Stored as part of the engine state mirror sent to the main thread. The main thread displays warnings as:
- A persistent amber badge on affected clips in the timeline.
- A warning banner in the Inspector colour section.
- A pre-export confirmation when SDR export is requested but HDR clips exist.

---

## UI Layout

```
┌──────────────────────────────────────────────┬──────────────┐
│                                              │  Inspector   │
│              Preview Canvas                  │  ─────────   │
│           (with zebra overlay)              │  Effects     │
│                                              │  Transform   │
│                                              │  ─────────   │
│                                              │  Colour      │
│                                              │  Primaries:  │
│                                              │  BT.709      │
│                                              │  Transfer:   │
│                                              │  BT.709      │
│                                              │  ⚠ HDR clip  │
├──────────────────────────────────────────────┤              │
│  [Scopes ▾]  ⚠ 2% clipped                   │              │
│  ┌──────────────┬──────────────┐             │              │
│  │  Histogram   │  Waveform    │             │              │
│  │  (256×128)   │  (256×128)   │             │              │
│  ├──────────────┼──────────────┤             │              │
│  │  Parade      │  Vectorscope │             │              │
│  │  (256×128)   │  (128×128)   │             │              │
│  └──────────────┴──────────────┘             │              │
├──────────────────────────────────────────────┴──────────────┤
│                        Timeline                            │
└─────────────────────────────────────────────────────────────┘
```

- Scopes panel: collapsible, below preview. Default collapsed on first launch for smaller screens.
- Each scope canvas: small fixed pixel dimensions (256×128 or 128×128), hardware-accelerated Canvas2D rendering.
- Fullscreen toggle: clicking a scope expands it to fill the preview area (still Canvas2D, not consuming GPU compute differently).
- Clipping badge: shown in scope header, amber "< 5%", red "≥ 5%".
- UI state (panel open, active scopes, zebra toggle) persisted in IndexedDB user preferences.

---

## New Engine Modules

| Module | Responsibility |
|---|---|
| `src/engine/colour.ts` | `ColorMetadata`, `WorkingColorConfig`, `ColorPipelineStage`, parse and normalization matrix builders, tone-map functions |
| `src/engine/scopes.ts` | `ScopeFrameInput`, `ScopeResult`, SAB ring-buffer layout, scope compute dispatch orchestration |
| `src/engine/shaders/source-normalize.wgsl` | Source → working space normalization compute shader |
| `src/engine/shaders/output-convert.wgsl` | Working → output conversion compute shader |
| `src/engine/shaders/scopes.wgsl` | Combined histogram/waveform/parade/vectorscope compute shader |
| `src/engine/shaders/clipping-overlay.wgsl` | Zebra overlay generation (optional, toggleable) |

## New UI Components

| Component | Role |
|---|---|
| `src/ui/ScopePanel.tsx` | Collapsible scope panel, SAB read + Canvas2D render, scope grid layout |
| `src/ui/ColourInspector.tsx` | Read-only colour metadata section in Inspector, warning badges |
| `src/ui/ZebraOverlay.tsx` | Toggle for clipping zebra pattern on preview |

## Modified Modules

| Module | Change |
|---|---|
| `src/engine/effects.ts` | Split `encodeColourChain` into `encodeBaseCorrection` + `encodeLutApply`; base correction stays in existing relative order |
| `src/engine/gpu.ts` | Refactor `compositeLayers` to iterate `PIPELINE_ORDER`; add scope compute dispatch entry point; add `present` → output-conversion routing |
| `src/engine/worker.ts` | Wire scope dispatch into preview loop (throttled); pass scope SAB to main thread |
| `src/engine/export.ts` | Route through same `compositeLayers` entry point (already the case; verify parity) |
| `src/engine/timeline.ts` | Add `ColorMetadata` to clip handles |
| `src/protocol.ts` | Add scope SAB transfer, HDR warning messages, scope toggle command |
| `src/ui/Inspector.tsx` | Add Colour section (read-only metadata) |
| `src/ui/App.tsx` | Wire scope SAB to ScopePanel; add clipping/HDR warning state |

---

## Validation

- **Pipeline order test**: Unit-test `PIPELINE_ORDER` array and verify `compositeLayers` dispatches stages in that order; a deliberately misordered array fails the test.
- **Colour transform goldens**: Round-trip tests for sRGB ↔ linear; BT.601 → BT.709 matrix; Reinhard tone-map preserves luminance ordering.
- **Preview/export parity**: Both paths call the same pipeline function with the same parameters — verify via a flag-based test that counts calls to each stage from each path.
- **Scope SAB integrity**: Unit-test ring-buffer write/read under concurrent access simulation.
- **Clipping counter**: Test that an all-white input frame produces 100% clip count, an all-0.5 frame produces 0%.
- **Degraded scope mode**: Run the scope shader path with `subgroups=f16=false`; compare histogram bin values against the premium path — must be within ±1 count per bin.
- **Performance**: Benchmark scope pass dispatch time (timestamp-query when available) — must not exceed 1ms at reference resolution on the throttled throughput tier.
- **Manual smoke**: Import BT.709, BT.601, and Rec.2020 PQ clips; verify metadata display, normalization correctness (visual comparison), scope rendering, clipping warnings on out-of-range content.
