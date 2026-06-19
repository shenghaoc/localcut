# Tasks — Capability-probe false negatives + editor chrome overlap

> Status: **Proposed**. Tasks map to bugs (Bn) in [`bugfix.md`](./bugfix.md) and design entries (Dn) in [`design.md`](./design.md). Order: land the H.264-level + OPFS probe fixes first (they unblock export, recording, and program mode), then the gate/message/layout/UX items.

## T1 — H.264 level helper + general codec probe (B1, D1)

- [ ] T1.1 Add `h264ConstrainedBaseline(width, height)` to [`capability-probe-v2.ts`](../../../src/engine/capability-probe-v2.ts) returning a Constrained-Baseline codec string whose level covers the frame size (MaxFS ladder per D1).
- [ ] T1.2 Use the helper for the H.264 decode **and** encode probes in `probeCodecs` (1280×720 → L3.1 `avc1.42E01F`). Keep VP9/AV1/audio strings unchanged.
- [ ] T1.3 Confirm `exportConstraintsForProbe` now includes `{codec:'h264',container:'mp4'}` on an H.264-capable profile (no logic change expected — the input value is the fix).
- [ ] T1.4 Unit test: `h264ConstrainedBaseline` returns L3.0 for ≤720×576, L3.1 for 720p, L4.0 for 1080p, ≥L5.1 for 2160p; a stubbed `VideoEncoder.isConfigSupported` that rejects L3.0@720p but accepts L3.1@720p yields `h264Encode:'supported'`.

## T2 — Realtime-encode probe level (B2, D2)

- [ ] T2.1 In `probeVideoEncodeRealtime`, replace `'avc1.42001E'` with `h264ConstrainedBaseline(1920,1080)` (→ L4.0 `avc1.42E028`); keep `latencyMode:'realtime'` + `hardwareAcceleration:'prefer-hardware'`.
- [ ] T2.2 Unit test: with a fake encoder that accepts L4.0@1080p realtime but rejects L3.0@1080p, `capture.videoEncodeRealtime === 'supported'`.

## T3 — OPFS SyncAccessHandle worker probe (B3, D3)

- [ ] T3.1 Add `probeOpfsSyncAccessHandleInWorker()` (transient blob dedicated worker, ~3s timeout, terminate in `finally`) per D3.
- [ ] T3.2 Call it from `probeCaptureCapabilities` in place of the main-thread `probeOpfsSyncAccessHandle`; remove or retain the old function only as the worker body's logic.
- [ ] T3.3 Unit/browser test: in a worker context the probe resolves `'supported'` when `createSyncAccessHandle` exists; a thrown create resolves `'unknown'`; absence of `Worker`/OPFS resolves `'unsupported'`.

## T4 — Recording/Program Mode availability + accurate messaging (B4, D4)

- [ ] T4.1 Verify `recordingAvailable()` and `deriveProgramModeSupport()` pass on the reference profile once T2 + T3 land (and T5 for track-transfer).
- [ ] T4.2 Promote `captureUnavailableReasons(probe)` to a shared helper and render the concrete reason list (plus the WebGPU-core check) at [`ProgramPanel.tsx:105`](../../../src/ui/ProgramPanel.tsx) and the [`diagnostics.ts:409,412`](../../../src/engine/diagnostics.ts) messages — replacing the static "requires a Chromium browser with WebGPU and WebCodecs" text.
- [ ] T4.3 Unit test: the Program Mode reason string for a probe with WebGPU present but realtime-encode missing names "Realtime video encode", not WebGPU/WebCodecs.

## T5 — Recording track-transfer gate (B5, D5)

- [ ] T5.1 Decide: **(preferred)** add the bounded main-frames capture fallback mirroring publish's `selectTapMode`, or **(fallback)** keep the gate and make the message precise + surface the `chrome://flags/#enable-experimental-web-platform-features` workaround.
- [ ] T5.2 If preferred path: relax `recordingAvailable()` so `transferableMediaStreamTrack` is not hard-required when `mediaStreamTrackProcessor === 'supported'`; select the capture tap mode accordingly and label the degraded path in [`RecordPanel.tsx`](../../../src/ui/RecordPanel.tsx).
- [ ] T5.3 If fallback path: update the RecordPanel reason copy and add the flag hint; leave the gate intact.
- [ ] T5.4 Test the chosen behavior (mode selection or message) with `transferableMediaStreamTrack:'unsupported'` + `mediaStreamTrackProcessor:'supported'`.

## T6 — Consolidate workspace layout + fix responsive collapse (B6, D6)

- [ ] T6.1 Remove the superseded duplicate so exactly one `.workspace`/`.dock-left`/`.side-rail` rule set remains in [`global.css`](../../../src/global.css) (keep the Ark visuals).
- [ ] T6.2 Set the middle track to `minmax(0,1fr)` so it can shrink, and/or raise the single-column collapse breakpoint to ≥ the layout minimum (~1240px), ensuring the collapse rule wins the cascade against the base workspace block.
- [ ] T6.3 Confirm `.workspace.has-bin`, `.workspace.rail-collapsed`, and `.workspace.has-bin.rail-collapsed` all resolve from the surviving block.
- [ ] T6.4 Manual check: no overlap between dock-left, preview, and side-rail at ~900px, ~1100px, ~1280px, and ultra-wide; collapse behaves at the breakpoint.

## T7 — Surface WebNN capability (B7, D7)

- [ ] T7.1 Add a read-only WebNN row (presence of `navigator.ml` + resolved ORT EP) to [`CapabilityMatrixPanel.tsx`](../../../src/ui/CapabilityMatrixPanel.tsx) and/or the ML-runtime section of [`diagnostic-snapshot.ts`](../../../src/ui/diagnostic-snapshot.ts), labeled as an accelerator (not a tier).
- [ ] T7.2 Unit/browser test: row reads "available" when `navigator.ml` is present and the EP is `webnn`.

## T8 — Reconcile Live Audio Chain noise-suppression label (B8, D8)

- [ ] T8.1 Relabel the disabled insert at [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx) to point at Voice Cleanup / Local Audio Cleanup (preferred), or wire it to the shipped RNNoise denoiser if explicitly in scope.
- [ ] T8.2 Verify no remaining UI copy implies the app lacks noise suppression.

## T9 — Quality gate

- [ ] T9.1 `pnpm run check` green (format:check + lint + typecheck + Vitest + production build).
- [ ] T9.2 Test count does not decrease; new probe tests (T1.4, T2.2, T3.3, T4.3, T5.4, T7.2) included.
- [ ] T9.3 Every `VideoFrame` in any touched capture/publish path closed exactly once (no regressions from T5).

## T10 — Manual verification (reference profile)

- [ ] T10.1 On Chrome (macOS, WebGPU + COOP/COEP isolation): export dialog offers **H.264/MP4**; Record panel shows no "Realtime video encode"/"OPFS SyncAccessHandle" reasons; Recording and Program Mode are available (or degrade with an accurate, labeled reason).
- [ ] T10.2 Resize the window through 900–1280px: no dock/preview/side-rail overlap.
- [ ] T10.3 Diagnostics shows a WebNN row reflecting the enabled flag; the Live Audio Chain no longer claims noise suppression is "available in a future update".

## Out-of-scope follow-ups (flag if encountered)

- [ ] Browser-support matrix entry / docs note that H.264 export + recording now probe at resolution-correct levels.
- [ ] If T5 lands the fallback-message path only, file a follow-up for the bounded main-frames capture route.
