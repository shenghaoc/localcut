# Tasks: Phase 26 — Cross-browser Compatibility Engine

> Status: **Optional / Planned**. Expand useful workflows across Safari and Firefox while keeping the premium Chromium path unchanged. Build the probe and tier model first; compatibility pipelines build on top.

## T1 — Probe and CapabilityTierV2 model

- [ ] **T1.1** Add `CapabilityTierV2`, `FeatureSupport`, `CodecProbeResult`, and `CapabilityProbeResult` to `src/protocol.ts`; keep the existing `CapabilityTier` type from Phase 8 unchanged.
- [ ] **T1.2** Create `src/engine/capability-probe-v2.ts`: implement `probeCapabilities(): Promise<CapabilityProbeResult>` that tests each feature independently, catches all probe errors (maps to `'unknown'`), and returns the full result before the worker is spawned.
- [ ] **T1.3** Implement `deriveCapabilityTierV2(probe): CapabilityTierV2` as a pure function in the same module; export it separately so it can be unit-tested without async setup.
- [ ] **T1.4** Implement per-codec probing using `VideoDecoder.isConfigSupported` and `VideoEncoder.isConfigSupported` with representative codec strings for H.264, VP9, AV1 video and AAC, Opus audio.
- [ ] **T1.5** Probe both `requestAdapter()` (standard) and `requestAdapter({ featureLevel: 'compatibility' })` in sequence; set `compatibilityAdapter: true` only when the standard probe fails but the compat probe succeeds.
- [ ] **T1.6** Call `probeCapabilities()` in the app's initialization sequence before the `init` message is posted to the pipeline worker; attach the probe result to the `WorkerInitV2` payload.
- [ ] **T1.7** Create `src/engine/compatibility/capability-fixtures.ts`: export `probeResultFor(tier: CapabilityTierV2): CapabilityProbeResult` returning a synthetic minimum-viable probe result for each tier; used by all compatibility tests.
- [ ] **T1.8** Unit-test `deriveCapabilityTierV2`: verify all four tier outcomes; verify `compatibility-webgpu` triggers when SAB is absent but WebGPU is present; verify `core-webgpu` requires all preconditions; verify `shell-only` when both WebGPU and WebCodecs decode probes are `'unsupported'`.
- [ ] **T1.9** Unit-test codec probe mapping: verify that the derived export constraint set matches the codec probe results (e.g. `vp9Encode: 'unsupported'` removes VP9 from available export codecs).

## T2 — Protocol additions

- [ ] **T2.1** Add `WorkerInitV2` (extends existing `WorkerInit` with `probeResult: CapabilityProbeResult`) to `src/protocol.ts`; update the worker's `init` handler to accept and store the probe result.
- [ ] **T2.2** Add `CapabilityProbeV2Message { type: 'capability-probe-v2'; result: CapabilityProbeResult }` to the worker state message union in `src/protocol.ts`; post this message from the worker after init alongside the existing `capability-probe` message.
- [ ] **T2.3** Update the main-thread message handler in the UI to receive and store `capability-probe-v2`; expose the result via a new `capabilityProbeV2` signal; keep the Phase 8 `capabilityTier` signal unchanged.

## T3 — WebGPU compatibility mode preview

- [ ] **T3.1** Create `src/engine/compatibility/compat-webgpu-preview.ts`: GPU preview pipeline that uses `copyExternalImageToTexture` for frame ingestion instead of `importExternalTexture`; must not import from `src/engine/worker.ts` or the accelerated pipeline.
- [ ] **T3.2** Implement `rgba8unorm` ping-pong texture allocation as the default; skip f16 texture formats regardless of adapter feature list.
- [ ] **T3.3** Limit the active effect set to `color-grade` and `transform`; skip LUT, custom compute kernels, and any pass requiring f16 or subgroups.
- [ ] **T3.4** Ensure `videoFrame.close()` is called immediately after `createImageBitmap(videoFrame)` completes, before the bitmap is passed to `copyExternalImageToTexture`.
- [ ] **T3.5** Preserve a single `queue.submit` per frame; add a unit test asserting the submission count stays at one across five simulated frames using a mock GPUDevice.
- [ ] **T3.6** Wire the compat GPU pipeline into the worker's init branch: when `probeResult.compatibilityAdapter === true`, instantiate `compat-webgpu-preview.ts` instead of the standard preview pipeline.

## T4 — Canvas2D compositor (`limited-webcodecs` tier)

- [ ] **T4.1** Create `src/engine/compatibility/canvas-compositor.ts`: OffscreenCanvas 2D compositor worker module; accepts `clock-tick { time }` messages and composites the resolved timeline frame at that timestamp.
- [ ] **T4.2** Implement per-layer decode via `VideoDecoder`; apply `resizeWidth = Math.min(sourceWidth, 1280)` at `createImageBitmap` to cap resolution; close each `VideoFrame` exactly once after `createImageBitmap` returns.
- [ ] **T4.3** Bound the decoded frame queue to 3 frames per track; drop the oldest decoded frame (closing it) when the queue is full before decoding a new one.
- [ ] **T4.4** Implement Z-order layer compositing using `globalAlpha = clip.opacity` and `drawImage`; call `bitmap.close()` on each bitmap after `drawImage`.
- [ ] **T4.5** Drive the decode loop via `AbortController`; exit cleanly when `pause`, `seek`, or `close` commands arrive.
- [ ] **T4.6** Unit-test that `VideoFrame.close()` and `ImageBitmap.close()` are each called exactly once per frame using spy objects from `capability-fixtures.ts`.
- [ ] **T4.7** Unit-test that the frame queue drops and closes the oldest frame when it exceeds the 3-frame bound.

## T5 — Compatibility export (`limited-webcodecs` tier)

- [ ] **T5.1** Create `src/engine/compatibility/compat-export.ts`: Canvas2D raster → `VideoFrame` → `VideoEncoder` → Mediabunny mux → download blob pipeline.
- [ ] **T5.2** Codec selection: probe H.264 first, then VP9; use the first successfully probed codec; abort with a user-facing error if neither is supported.
- [ ] **T5.3** Enforce `encodeQueueSize < 4` before submitting each frame; await if the queue is full; do not submit to an unbounded queue.
- [ ] **T5.4** Append `(limited)` to the suggested download filename; emit `ExportProgress` messages using the existing model so the existing progress UI works without changes.
- [ ] **T5.5** Handle audio export: if `aacEncode` or `opusEncode` probe is `'supported'`, mux audio alongside video; otherwise export video-only and emit a `compatibility-audio-unavailable` warning message to the UI.
- [ ] **T5.6** Close each `ImageBitmap` immediately after `new VideoFrame(bitmap, ...)` and each `VideoFrame` after `encoder.encode(frame)`; unit-test both call sites with spy helpers.
- [ ] **T5.7** Unit-test: simulate a 3-frame encode sequence, assert encoded chunks are produced and close calls fire exactly once per frame.

## T6 — Clock degradation path

- [ ] **T6.1** Add rAF-message clock support to the worker's message handler: on `clock-tick { time: number }`, update the worker's internal `currentTime` and trigger a preview frame at that timestamp; activate this path only when the probe result has `sharedArrayBuffer !== 'supported'`.
- [ ] **T6.2** In the main-thread app initialization, when `probe.sharedArrayBuffer !== 'supported'`, start an rAF loop that posts `{ type: 'clock-tick', time: audioCtx.currentTime }` to the worker; stop the loop when the worker reports `paused` or is destroyed.
- [ ] **T6.3** Unit-test that the `clock-tick` path is activated only when `sharedArrayBuffer !== 'supported'` and never when SAB is available.

## T7 — Diagnostic panel (`CapabilityMatrixPanel`)

- [ ] **T7.1** Create `src/ui/CapabilityMatrixPanel.tsx`: a SolidJS component that renders one row per probed feature using the `capabilityProbeV2` signal from T2.3; each row shows feature name, support chip, active-in-tier badge, and action link.
- [ ] **T7.2** Display the `CapabilityTierV2` badge at the top of the panel with a distinct color per tier; reuse the status-bar color tokens.
- [ ] **T7.3** Render `navigator.userAgent` in a collapsible "Browser info" row for diagnostics; do not reference it in any logic.
- [ ] **T7.4** Show the COOP/COEP action link when `probe.crossOriginIsolated === false`, explaining that serving with the required headers would enable `core-webgpu`.
- [ ] **T7.5** Import `CapabilityMatrixPanel` into the existing `CapabilityPanel`; add it as a new expandable section below the existing content without removing anything.
- [ ] **T7.6** Add `onCleanup` for any signals or event listeners registered in the component.

## T8 — Export dialog tier constraints

- [ ] **T8.1** Add a "Current tier constraints" collapsible section to `ExportDialog.tsx`; show it only when the active `CapabilityTierV2` is not `core-webgpu`.
- [ ] **T8.2** Populate the section from the codec probe results in `capabilityProbeV2`: each unavailable codec renders a disabled row with a one-line explanation and a "Why?" link that opens the diagnostic panel.
- [ ] **T8.3** Keep unavailable codec options present but disabled (with tooltip) in the codec picker; never hide them so users can see what their browser cannot encode.

## T9 — Non-regression and integration tests

- [ ] **T9.1** Unit-test tier derivation from `capability-fixtures.ts` probes: assert the correct tier for all four fixture variants and for boundary conditions (SAB present but no COOP, GPU compat only, etc.).
- [ ] **T9.2** Fixture smoke test for `core-webgpu`: mock-import a clip, run through canvas-compositor module with a `core-webgpu` fixture (compositor disabled), assert no compatibility module is instantiated.
- [ ] **T9.3** Fixture smoke test for `limited-webcodecs`: run the canvas compositor with a synthetic `VideoDecoder` mock through three frames; assert composited frames are produced and all frames/bitmaps are closed.
- [ ] **T9.4** Graceful-failure test for `compatibility-webgpu`: simulate missing SAB and COOP/COEP; assert `compatibility-webgpu` tier is derived, rAF-message clock is activated, and no SAB access is attempted.
- [ ] **T9.5** Graceful-failure test for `shell-only`: simulate no WebGPU and no WebCodecs; assert preview panel shows unavailability message, export button is hidden, and no worker pipeline is started.
- [ ] **T9.6** Throughput non-regression test: mock-process 60 frames through the accelerated pipeline path (using mocked GPU/codec); assert processing finishes within the same time budget as the pre-phase baseline; fail loudly on regression.
- [ ] **T9.7** `VideoFrame.close()` invariant tests: run canvas compositor and compat export paths with `VideoFrame` spies; assert `close()` is called exactly once per frame in all code paths including abort and error paths.
- [ ] **T9.8** `npm run build` green with strict TypeScript; `npm test` green with test count higher than before this phase.

## T10 — Manual verification matrix

- [ ] **T10.1** Chrome/Edge (COOP/COEP served): status bar shows `core-webgpu`; import MP4, play, seek, export H.264 — full path identical to pre-phase behavior; no regressions.
- [ ] **T10.2** Chrome/Edge (COOP/COEP headers removed from dev server): status bar shows `compatibility-webgpu`; GPU preview plays; export available for probed codecs; export dialog shows tier constraints section.
- [ ] **T10.3** Chrome/Edge with compat adapter forced (dev override): status bar shows `GPU (compat)`; preview plays via compat pipeline; `importExternalTexture` not called (verified via console or source breakpoint).
- [ ] **T10.4** Safari 17+: status bar shows `compatibility-webgpu`; preview plays if WebGPU adapter available; H.264 encode attempted; diagnostic panel shows FSAPI as unsupported; project save falls back to OPFS or download.
- [ ] **T10.5** Firefox 126+: status bar shows `limited-webcodecs`; Canvas2D preview composites frames; effects row in diagnostic panel shows "unavailable in this tier"; export button disabled with explanation; no crash or unhandled rejection.
- [ ] **T10.6** Any browser with all APIs blocked (simulate via overriding globals): status bar shows `shell-only`; timeline panel loads; preview panel shows unavailability message; export panel is hidden; no exceptions thrown.
- [ ] **T10.7** Diagnostic panel manual check (all browsers): every probed feature row visible; active tier badge matches status bar; action links present for absent features.
- [ ] **T10.8** Export dialog manual check (non-`core-webgpu` tier): tier constraints section visible and accurate; unavailable codecs disabled but visible; "Why?" link opens diagnostic panel.
