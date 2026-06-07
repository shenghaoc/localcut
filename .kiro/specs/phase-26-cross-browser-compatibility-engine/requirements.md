# Requirements: Phase 26 — Cross-browser Compatibility Engine

> **Optional phase.** Expands useful workflows across Safari and Firefox without weakening the premium Chromium path.

## R0 — Hard Constraints

- **R0.1** The premium accelerated path (WebGPU core + WebCodecs + SAB + OffscreenCanvas + COOP/COEP) must not regress in correctness, performance, or per-frame submission count.
- **R0.2** Reduced-capability modes must remain fully client-side; browser limitations may not be solved by uploading user media to a server.
- **R0.3** All tier selection must derive from runtime feature probes. User-agent string must never be used for branching logic, only for display in the diagnostic panel.
- **R0.4** Reduced modes must not claim desktop-class performance or full export parity with the premium tier.
- **R0.5** Missing codec, container muxing, or export support must be surfaced to the user before they attempt the operation, not discovered after a failure.
- **R0.6** No unbounded main-thread decode, encode, composite, or pixel-processing loops in any capability tier.
- **R0.7** Every `VideoFrame` and `ImageBitmap` created in any compatibility path must be `.close()`d or released exactly once.

## R1 — Capability Probing

- **R1.1** Probe each of the following independently at session start, before the pipeline worker is initialized: `crossOriginIsolated`, `SharedArrayBuffer`, WebGPU standard adapter, WebGPU compatibility-mode adapter (`featureLevel: 'compatibility'`), WebCodecs `VideoDecoder` presence (`webCodecsDecode`) and `VideoEncoder` presence (`webCodecsEncode`), per-codec decode support (H.264, VP9, AV1), per-codec encode support (H.264, VP9, AV1), WebCodecs audio decode (AAC, Opus), WebCodecs audio encode (AAC, Opus), File System Access API (`showOpenFilePicker`), OPFS (`navigator.storage.getDirectory`), `AudioWorklet`, `OffscreenCanvas`.
- **R1.2** Each probed feature must report one of three states: `supported`, `unsupported`, or `unknown` (probe inconclusive or threw unexpectedly).
- **R1.3** The full probe result must be resolved before the worker is spawned; the resolved `CapabilityTierV2` is immutable for the session lifetime.
- **R1.4** A reference capability matrix for Chromium (Chrome/Edge), Safari, and Firefox must be maintained in `design.md` and updated whenever a browser ships a materially relevant API change.

## R2 — CapabilityTierV2

- **R2.1** Define four named tiers in ascending capability order:
  - `core-webgpu` — WebCodecs decode + WebGPU standard adapter + SAB + OffscreenCanvas + `crossOriginIsolated` + the full required video encode probe set (H.264, VP9, AV1). Full premium experience with no restrictions.
  - `compatibility-webgpu` — WebGPU (standard or compatibility adapter) present + WebCodecs decode present + OffscreenCanvas present; SAB or COOP/COEP absent, or encode codec set is reduced. GPU-rendered preview with SAB when available or rAF-message clock when SAB is absent; encode where probed; no required SAB-dependent features.
  - `limited-webcodecs` — WebCodecs decode present + OffscreenCanvas present; no WebGPU. Canvas2D OffscreenCanvas compositing, SAB when available or rAF-message clock when SAB is absent, no WGSL effects.
  - `shell-only` — Neither WebGPU nor WebCodecs available. Timeline editing and project management only; no preview or export.
- **R2.2** Tier derivation must be a pure function of the probe result; identical probe inputs must always produce the same tier.
- **R2.3** The active tier must be visible in the persistent status bar and in the diagnostic panel at all times.
- **R2.4** The existing `CapabilityTier` type from Phase 8 must continue to work; `CapabilityTierV2` supplements it. The UI may migrate display to V2 labels progressively.

## R3 — WebGPU Compatibility Mode

- **R3.1** Probe the standard and compatibility adapters independently and record each result in `webGPUCore`/`webGPUCompat`; do not short-circuit `webGPUCompat` based on the standard-adapter result, so the diagnostic panel reports each adapter's true availability. Set `compatibilityAdapter: true` only when the standard probe fails but `requestAdapter({ featureLevel: 'compatibility' })` succeeds; in that case classify the session as `compatibility-webgpu` if WebCodecs decode and OffscreenCanvas are also present.
- **R3.1a** Standard-adapter sessions must also use the reduced compatibility preview path when the resolved tier is `compatibility-webgpu` because of missing SAB/COOP or reduced encode support.
- **R3.2** The compatibility-mode pipeline must not call `importExternalTexture`; frame ingestion must use `copyExternalImageToTexture` via `createImageBitmap` instead.
- **R3.3** Shaders compiled for the compatibility pipeline must not request `shader-f16`, `subgroups`, or `timestamp-query` unless each is independently re-probed on the compatibility adapter.
- **R3.4** Ping-pong textures in the compatibility pipeline must use `rgba8unorm` when f16 storage is unavailable.
- **R3.5** A single `queue.submit` per frame must be preserved in the compatibility GPU pipeline.
- **R3.6** The status bar must display a distinct label (e.g. "GPU (compat)") when the compatibility adapter is active; it must not display the same badge as `core-webgpu`.
- **R3.7** The `ImageBitmap` created for `copyExternalImageToTexture` must be closed immediately after the GPU copy.

## R4 — Reduced Preview

- **R4.1** `compatibility-webgpu` preview: GPU-rendered via OffscreenCanvas; SAB clock when available, otherwise the worker reports transport over a `clock-update` message (the worker stays the sole clock writer; the main thread never posts ticks back); reduced effect set (color-grade and transform only; no LUT, no f16, no subgroups); resolution proxy capped below the premium default.
- **R4.2** `limited-webcodecs` preview: Canvas2D compositing of decoded `VideoFrame` bitmaps via `createImageBitmap` in an OffscreenCanvas worker; SAB clock when available, otherwise the worker reports transport over a `clock-update` message; resolution capped at 1280×720; no GPU effects applied; decoded frame queue bounded to 3 frames ahead.
- **R4.3** `shell-only` preview: the preview panel renders a persistent, plain-language "Preview unavailable" message; all playback transport controls are disabled.
- **R4.4** Every reduced preview mode must display a persistent labeled badge stating the active tier and what is absent.
- **R4.5** The `clock-update` message path must not be used when SAB is available; the choice must be driven by the probe result (`clockView === null`), not a flag. The main thread must never seek the worker per frame; the worker's playback loop is the single time source.

## R5 — Reduced Export

- **R5.1** The export dialog must display an encode and mux support summary for the active tier before the user initiates export; supported codec/container pairs are selectable, unsupported pairs are visibly flagged with a reason.
- **R5.2** `compatibility-webgpu` export: WebCodecs encode where the per-codec encode probe reports `supported` and a muxable container pair is known; unavailable codecs remain visible but disabled in the picker; falls back to a blob download if the File System Access API is unavailable.
- **R5.3** `limited-webcodecs` export: Canvas2D raster path per frame → WebCodecs encode (H.264 or VP9 only, probed) → Mediabunny mux → download blob; GPU effects are not applied; output is labeled "Limited export — GPU effects not applied".
- **R5.4** `shell-only`: export controls are not rendered; the export button shows an unavailability message explaining which feature is missing and what browser would enable it.
- **R5.5** Export backpressure must be enforced in all tiers: check `encoder.encodeQueueSize` before each frame and await when the queue is full; no frame may be submitted to an unbounded encode queue.
- **R5.6** A failed encode attempt in any compatibility tier must report the codec, the tier, and a suggested action (e.g. "Switch to Chrome for AV1 export") rather than a generic error.

## R6 — Diagnostic Panel

- **R6.1** The existing capability panel from Phase 8 must be extended with a per-feature row for every probed API.
- **R6.2** Each row must show: feature name, probe result chip (`supported` / `unsupported` / `unknown`), whether the feature is active in the current tier, and a suggested action when the feature is absent.
- **R6.3** The panel must display the resolved `CapabilityTierV2` badge prominently at the top with the same color coding used in the status bar.
- **R6.4** Browser name and approximate version derived from `navigator.userAgent` must appear in the panel for user-facing diagnostics; this string must not be used to gate any code path.
- **R6.5** The panel must surface actionable guidance when COOP/COEP headers are absent. It may say headers would unlock `core-webgpu` only when all other core prerequisites are already supported; otherwise it must phrase COOP/COEP as one missing requirement.
- **R6.6** The codec sub-section must list all ten probed codec/direction combinations with their individual support state, not just the active export codec.

## R7 — Tests

- **R7.1** A `src/engine/compatibility/capability-fixtures.ts` module must export one synthetic `CapabilityProbeResult` per tier, each representing the minimum viable configuration for that tier.
- **R7.2** Unit tests must cover: tier derivation for all four tiers; correct selection of `compatibility-webgpu` vs `core-webgpu` based on SAB and adapter availability; codec-level probe mapping to the export constraints visible in the dialog; diagnostic panel row generation from probe results.
- **R7.3** Fixture-based smoke tests must exist for the `core-webgpu` and `limited-webcodecs` tiers (import mock, composite, export mock); `compatibility-webgpu` and `shell-only` must have graceful-failure tests asserting the correct UI state and absence of crashes.
- **R7.4** A throughput comparison test must assert that the `core-webgpu` path (mocked GPU) processes frames at least as fast as before this phase; test failure on throughput regression blocks the merge.
- **R7.5** Tests must assert that `VideoFrame.close()` is called exactly once per frame in the canvas compositor and the compat export path using a spy factory helper.

## R8 — Isolation and Non-regression

- **R8.1** All compatibility modules must live under `src/engine/compatibility/` and must not import from the accelerated pipeline modules directly.
- **R8.2** The accelerated `VideoFrame → importExternalTexture → compute chain → queue.submit` path in `src/engine/worker.ts` must not be modified by this phase.
- **R8.3** `npm run build` and `npm test` must remain green; the test count must not decrease.
- **R8.4** The `shell-only` tier must never crash or throw an unhandled rejection during normal use; all operations must degrade gracefully with a visible message.
