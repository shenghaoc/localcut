# Requirements: Phase 21 — Colour Management + Scopes

## R1 — Source Colour Metadata

- **R1.1** When a media container carries colour metadata (colour primaries, transfer characteristics, matrix coefficients per ISO/IEC 23091-2 / ITU-T H.273), extract it during `mediabunny` probe and attach it to the clip handle as `ColorMetadata`.
- **R1.2** Metadata may be absent or ambiguous; store `ColorMetadata.origin: 'container' | 'assumed' | 'none'` and never guess.
- **R1.3** Display source colour metadata in the Inspector (read-only) so the user knows what the editor sees.

## R2 — Working Colour Space

- **R2.1** Define the editor working space as `WorkingColorConfig` with documented assumptions (e.g., sRGB/Rec.709 primaries, linear light for compositing, perceptual-friendly gamma for preview).
- **R2.2** Document the working space in `src/engine/colour.ts` with rationale comments; no hidden pipelines.
- **R2.3** When source metadata disagrees with working space, apply a GPU-based normalization pass only when the mapping is well-defined; skip gracefully when unsupported and note the ambiguity in the Inspector.

## R3 — Stable Pipeline Order

- **R3.1** The accelerated per-layer pipeline must follow a fixed, documented order: **source normalization → base correction (brightness/contrast/saturation/temperature) → LUT → opacity → transform → compositing → output conversion**.
- **R3.2** Preview and export must traverse the **same** pipeline stages in the **same** order — no code-path forks for stage ordering.
- **R3.3** The pipeline order must be enforced by a single `compositeLayers` entry point; individual stages are composed as functions so that reordering or skipping is a deliberate, testable choice, not an accident.

## R4 — Scopes Diagnostics

- **R4.1** Provide four scope views computed from the composited frame (after compositing, before output conversion): **histogram** (per-channel log-scale distribution), **luma waveform** (luminance vs. horizontal position), **RGB parade** (R/G/B waveforms stacked), and **vectorscope** (Cr/Cb polar plot with skin-tone indicator).
- **R4.2** Scopes must use WebGPU compute shaders on the accelerated path; no `getImageData` or Canvas2D readback for any scope.
- **R4.3** Scopes update at a reduced, bounded frequency (configurable, default 10 Hz) to avoid starving the preview/export pipeline.
- **R4.4** Scopes operate at a reduced resolution (configurable, default 1/4 of composited dimensions in each axis) for performance.
- **R4.5** Scope results (`ScopeResult`) are written into a `SharedArrayBuffer`-backed ring-buffer for the main thread to consume and render via Canvas2D (display only, no pixel analysis on main).

## R5 — Feature Detection & Degradation

- **R5.1** Probe `subgroups`, `timestamp-query`, and `shader-f16` WebGPU features at device acquisition.
- **R5.2** When `subgroups` is available, use warp-level reductions in histogram/waveform shaders; fall back to shared-memory atomics otherwise.
- **R5.3** When `timestamp-query` is available, annotate scope compute passes for diagnostics; skip silently when unavailable.
- **R5.4** When `shader-f16` is available, use half-precision scope shaders for reduced memory bandwidth; f32 fallback must produce numerically equivalent outputs within the scope display resolution.
- **R5.5** If WebGPU itself is unavailable but a degraded compatibility preview exists, offer a `ScopeMode.none` state with a visible label — never compute scopes on the main thread.

## R6 — Clipping & Out-of-Range Warnings

- **R6.1** During the pipeline, detect pixel values that exceed the working-space gamut or the output conversion range (e.g., values outside [0, 1] after sRGB encoding).
- **R6.2** Surface clipping as a low-cost overlay on the preview (zebra pattern, toggleable) and as a persistent badge in the scope panel.
- **R6.3** Clipping detection runs as part of the scope compute pass (shared reduction, not a second pass) so it adds negligible cost.

## R7 — SDR/HDR Warning States

- **R7.1** When source metadata indicates HDR content (e.g., Rec.2020 primaries, PQ/HLG transfer) and the editor working space is SDR, show a visible warning badge on the clip and in the Inspector.
- **R7.2** When HDR content is detected without full HDR mastering support, apply a best-effort tone-map normalization (simple Reinhard or BT.2408) rather than clipping or displaying raw linear.
- **R7.3** Warn when export settings are SDR but the project contains HDR-origin clips; do not silently encode clipped values.
- **R7.4** HDR warnings are informational and do not block editing; full HDR mastering is out of scope for this phase.

## R8 — UI Layout

- **R8.1** Scopes panel sits as a collapsible drawer/panel below or beside the preview canvas, using the dark professional-tool aesthetic.
- **R8.2** Scope views are arranged in a 2×2 grid by default; each view supports a fullscreen toggle.
- **R8.3** The Inspector gains a read-only **Colour** section showing source metadata and any active warnings.
- **R8.4** Clipping warnings appear as a badge in the scope panel header and as a toggleable zebra overlay on the preview canvas.
- **R8.5** Scope panel visibility and individual scope views are persisted in user preferences (IndexedDB, not project data).

## R9 — Tests

- **R9.1** Unit-test the pipeline stage ordering function — verify that all stages execute in the declared order and that no stage is silently skipped.
- **R9.2** Golden-test selected colour transforms: sRGB → linear → sRGB round-trip; known BT.709 → Rec.601 matrix; Reinhard tone-map preserves relative luminance order.
- **R9.3** Unit-test scope data types: `ScopeResult` packing/unpacking; SAB ring-buffer write/read correctness.
- **R9.4** A pipeline parity test proves that the preview and export composite path calls the same stage-ordering function with the same inputs.
- **R9.5** Performance benchmark: scope updates must not increase frame time by more than 5% at 10 Hz / 1/4 resolution on the reference throttled throughput tier.
- **R9.6** A degraded-scope integration test exercises the non-subgroups fallback and verifies numeric equivalence within display tolerance.
