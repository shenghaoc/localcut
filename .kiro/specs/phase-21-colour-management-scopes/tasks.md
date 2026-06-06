# Tasks: Phase 21 — Colour Management + Scopes

> Status: **Planned**. Land the colour model + pipeline order first — scopes and warnings ride on top of a stable pipeline.

## Colour model + metadata

- [ ] **T1.1** Add `src/engine/colour.ts`: `ColorMetadata`, `WorkingColorConfig`, `ColorPipelineStage`, `PIPELINE_ORDER` const array, `TransferCharacteristic`/`ColourPrimaries`/`MatrixCoefficients` union types.
- [ ] **T1.2** Attach `ColorMetadata` to clip handles during mediabunny probe in `src/engine/media-io.ts`; parse container colour boxes (colr/nclc/nclx); set `origin: 'container'` when present, `'none'` otherwise.
- [ ] **T1.3** Add colour metadata to the timeline state mirror and snapshot (`schemaVersion` bump); verify backward compatibility (absent metadata → `origin: 'none'` defaults).
- [ ] **T1.4** Unit-test colour metadata parsing from known container samples.

## Pipeline order refactor

- [ ] **T2.1** Refactor `src/engine/effects.ts`: split `encodeColourChain` into `encodeBaseCorrection` (brightness/contrast → saturation → colour-temperature) and `encodeLutApply`; each takes per-layer params and encodes its own pass(es).
- [ ] **T2.2** Add `encodeOpacity` compute pass (multiply alpha by per-layer opacity uniform in working linear space).
- [ ] **T2.3** Refactor `compositeLayers` in `src/engine/gpu.ts` to iterate `PIPELINE_ORDER` and dispatch each stage in order; transform and compositing stages unchanged.
- [ ] **T2.4** Unit-test `PIPELINE_ORDER` integrity: verify array contains every stage exactly once, no duplicates, and that `compositeLayers` dispatches in that exact order (mock pipeline).
- [ ] **T2.5** Verify export path calls the same `compositeLayers` entry point; add a parity assertion if not already guaranteed by design.
- [ ] **T2.6** `npm run build` and `npm test` green after refactor; no test count regression.

## Source normalization pass

- [ ] **T3.1** Add `src/engine/shaders/source-normalize.wgsl` (+ `.f16.wgsl`): inverse transfer (identity/BT.709/sRGB/PQ/HLG) + 3×3 matrix conversion to working space; `fullRange` flag for limited → full range expansion.
- [ ] **T3.2** Add normalization matrix builders in `src/engine/colour.ts`: BT.601 → BT.709, BT.2020 → BT.709, P3 → BT.709; PQ and HLG inverse EOTF functions; BT.2408 SDR tone-map.
- [ ] **T3.3** Integrate `source-normalize` as the first stage in `compositeLayers`; skip (identity) when `origin: 'none'` or metadata is unsupported.
- [ ] **T3.4** Golden-test colour transforms: sRGB → linear → sRGB round-trip; BT.709 linear → sRGB EOTF known reference values.
- [ ] **T3.5** Unit-test matrix builders against known reference matrices.

## Output conversion pass

- [ ] **T4.1** Add `src/engine/shaders/output-convert.wgsl` (+ `.f16.wgsl`): working linear → sRGB OETF (current); uniform layout supports future PQ/HLG outputs.
- [ ] **T4.2** Integrate `output-convert` as the final stage in `compositeLayers`, after compositing; route both preview and export through it.
- [ ] **T4.3** Verify scope pipeline reads the composited frame **before** output conversion (scopes see the linear working-space signal).

## Scope compute infrastructure

- [ ] **T5.1** Add `src/engine/scopes.ts`: `ScopeFrameInput`, `ScopeResult`, `ScopeFeatures`, SAB ring-buffer layout and write/read helpers with torn-write protection.
- [ ] **T5.2** Add `src/engine/shaders/scopes.wgsl` (+ `.f16.wgsl`): histogram, luma waveform, RGB parade, and vectorscope compute entry points in one shader.
- [ ] **T5.3** Add scope pipeline compilation in `gpu.ts`: create compute pipelines for scopes, gated on feature detection (`subgroups`, `f16`).
- [ ] **T5.4** Add `dispatchScopes(input: ScopeFrameInput): ScopeResult` in `src/engine/scopes.ts` — orchestrates the single-pass scope compute dispatch and writes results to SAB.
- [ ] **T5.5** Wire scope dispatch into the preview loop in `src/engine/worker.ts`: throttled (default every 6th frame ≈ 10 Hz at 60 fps), skip when preview is paused and frame hasn't changed.
- [ ] **T5.6** Unit-test SAB ring-buffer write/read correctness; test torn-write detection.
- [ ] **T5.7** Unit-test `ScopeResult` data layouts (histogram bin count, waveform column count, vectorscope resolution) against expected sizes.

## Clipping detection

- [ ] **T6.1** Extend scopes.wgsl with a post-compositing clipping counter (per-frame count of pixels with any component outside [0, 1] in working linear space).
- [ ] **T6.2** Add clipping counter to SAB ring-buffer alongside scope data.
- [ ] **T6.3** Add `src/engine/shaders/clipping-overlay.wgsl`: single-dispatch zebra pattern pass that writes a striped overlay to a small GPUTexture when enabled.
- [ ] **T6.4** Integrate clipping overlay into `present` path as an optional second-pass blend (only when user toggles zebra on).
- [ ] **T6.5** Unit-test clipping counter: all-1.0 input → 100%, all-0.5 → 0%, known-clipped gradient → expected percentage.

## HDR warning states

- [ ] **T7.1** Add `HDRWarning` type in `src/engine/colour.ts`: `type` discriminant, affected clip IDs, message.
- [ ] **T7.2** Generate HDR warnings during clip probe when source metadata indicates Rec.2020 primaries or PQ/HLG transfer.
- [ ] **T7.3** Add HDR warnings to engine state mirror; propagate to main thread via existing state update protocol.
- [ ] **T7.4** Add pre-export check: when project contains HDR-origin clips and export target is SDR, emit a confirmation-required warning.
- [ ] **T7.5** Unit-test HDR warning generation from mock clip metadata.

## UI: Colour Inspector + warnings

- [ ] **T8.1** Add `src/ui/ColourInspector.tsx`: read-only section in Inspector showing `ColorMetadata` (primaries, transfer, matrix, origin) for the selected clip; amber/red warning badges for HDR content and unsupported colour profiles.
- [ ] **T8.2** Wire `ColourInspector` into `Inspector.tsx` below the Transform section.
- [ ] **T8.3** Add HDR warning badge on timeline clips in `TimelineClip.tsx`.
- [ ] **T8.4** Add pre-export HDR-to-SDR confirmation dialog in `ExportDialog.tsx`.

## UI: Scope panel

- [ ] **T9.1** Add `src/ui/ScopePanel.tsx`: collapsible panel with 2×2 scope grid; reads SAB ring-buffer in rAF; renders each scope to a `<canvas>` via Canvas2D (no pixel analysis).
- [ ] **T9.2** Implement histogram renderer: log-scale bar chart, 256 bins × 4 channels (R/G/B/Y), dark theme with semi-transparent fills.
- [ ] **T9.3** Implement luma waveform renderer: luminance trace with min/max fill per column.
- [ ] **T9.4** Implement RGB parade renderer: R/G/B waveforms stacked horizontally with colour-coded traces.
- [ ] **T9.5** Implement vectorscope renderer: 2D bubble plot from hit-count texture, skin-tone indicator line, graticule circles.
- [ ] **T9.6** Add scope panel toggle (collapsed by default on first launch); fullscreen toggle per scope view (expands to preview area).
- [ ] **T9.7** Add clipping badge in scope panel header: "⚠ X% pixels clipped", amber < 5%, red ≥ 5%.
- [ ] **T9.8** Add `src/ui/ZebraOverlay.tsx`: toggle button + wire to scope panel clipping badge; sends `toggle-zebra` command to worker.
- [ ] **T9.9** Persist scope panel visibility and active scope views in IndexedDB user preferences (not project data).

## Protocol + wiring

- [ ] **T10.1** Add scope SAB transfer to `init` message in `src/protocol.ts`; define `ScopeToggleCommand`, `ZebraToggleCommand`, `HDRWarningStateUpdate`.
- [ ] **T10.2** Wire scope toggle, zebra toggle, and HDR warning handling in `src/ui/worker-bridge.ts`.
- [ ] **T10.3** Update `src/ui/App.tsx` to create scope SAB, pass to worker at init, and propagate scope/HDR state to UI components.

## Performance + degradation

- [ ] **T11.1** Implement feature detection for `subgroups`, `timestamp-query`, `shader-f16` at device acquisition in `gpu.ts`; store in `ScopeFeatures`.
- [ ] **T11.2** Implement subgroups fallback (shared-memory atomics) and f16 fallback (f32 shader) in scopes.wgsl.
- [ ] **T11.3** Add scope pass GPU timing via timestamp-query when available; skip silently when unavailable.
- [ ] **T11.4** Implement scope throttling: track frame count, dispatch every Nth frame (configurable, default 6).
- [ ] **T11.5** Implement scope resolution scaling: `scopeResX = floor(compositeWidth / 4)`, `scopeResY = floor(compositeHeight / 4)`; overridable for debugging.
- [ ] **T11.6** Performance benchmark: measure scope dispatch time on throttled throughput tier; ensure < 1ms at reference resolution.
- [ ] **T11.7** Degraded-scope integration test: compare histogram bins between subgroups+f16 and shared-memory+f32 paths; verify within ±1 count per bin.

## Verification + cleanup

- [ ] **T12.1** Full pipeline parity test: preview and export both call `compositeLayers` with identical stage order; verify no stage divergence.
- [ ] **T12.2** Golden-test selected transforms: BT.709 → linear → BT.709 round-trip; BT.601 matrix → BT.709; Reinhard tone-map preserves relative luminance.
- [ ] **T12.3** `npm run build` (strict `tsc`) green.
- [ ] **T12.4** `npm test` green; test count grows (no regression).
- [ ] **T12.5** Manual smoke test in Chromium with hardware WebGPU:
  - Import BT.709 MP4 → verify metadata display, preview looks correct, scopes render.
  - Import BT.601 MOV → verify matrix corrective pass visible in scopes.
  - Import Rec.2020 PQ clip → verify HDR warning badge, tone-map active, preview is viewable (not blown out).
  - Enable zebra overlay → verify clipping pixels striped on out-of-range content.
  - Export → verify output matches preview visually.
  - Collapse/expand scope panel, toggle individual scopes, fullscreen a scope.
