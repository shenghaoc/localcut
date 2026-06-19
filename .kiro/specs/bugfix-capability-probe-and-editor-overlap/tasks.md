# Tasks — Capability-probe false negatives + editor chrome overlap

> Status: **Implemented — in review**. Code landed and `pnpm run check` is green (212 files, 2359 tests, production build). Remaining unchecked items are manual/on-device verification (T6.4, T10) and the deferred off-main capture path (T5.5). Tasks map to bugs (Bn) in [`bugfix.md`](./bugfix.md) and design entries (Dn) in [`design.md`](./design.md).

## T1 — H.264 level helper + general codec probe (B1, D1)

- [x] T1.1 Add `h264ConstrainedBaseline(width, height)` to [`capability-probe-v2.ts`](../../../src/engine/capability-probe-v2.ts) returning a Constrained-Baseline codec string whose level covers the frame size (MaxFS ladder per D1).
- [x] T1.2 Use the helper for the H.264 decode **and** encode probes in `probeCodecs` (1280×720 → L3.1 `avc1.42E01F`). Keep VP9/AV1/audio strings unchanged.
- [x] T1.3 Confirm `exportConstraintsForProbe` now includes `{codec:'h264',container:'mp4'}` on an H.264-capable profile (no logic change expected — the input value is the fix).
- [x] T1.4 Unit test: `h264ConstrainedBaseline` returns L3.0 for ≤720×576, L3.1 for 720p, L4.0 for 1080p, ≥L5.1 for 2160p; a stubbed `VideoEncoder.isConfigSupported` that rejects L3.0@720p but accepts L3.1@720p yields `h264Encode:'supported'`.

## T2 — Realtime-encode probe level (B2, D2)

- [x] T2.1 In `probeVideoEncodeRealtime`, replace `'avc1.42001E'` with `h264ConstrainedBaseline(1920,1080)` (→ L4.0 `avc1.42E028`); keep `latencyMode:'realtime'` + `hardwareAcceleration:'prefer-hardware'`.
- [x] T2.2 Unit test: with a fake encoder that accepts L4.0@1080p realtime but rejects L3.0@1080p, `capture.videoEncodeRealtime === 'supported'`.

## T3 — OPFS SyncAccessHandle worker probe (B3, D3)

- [x] T3.1 Add `probeOpfsSyncAccessHandleInWorker()` (transient blob dedicated worker, ~3s timeout, terminate in `finally`) per D3.
- [x] T3.2 Call it from `probeCaptureCapabilities` in place of the main-thread `probeOpfsSyncAccessHandle`; remove or retain the old function only as the worker body's logic.
- [x] T3.3 Unit/browser test: in a worker context the probe resolves `'supported'` when `createSyncAccessHandle` exists; a thrown create resolves `'unknown'`; absence of `Worker`/OPFS resolves `'unsupported'`.

## T4 — Recording/Program Mode availability + accurate messaging (B4, D4)

- [x] T4.1 Verify `recordingAvailable()` and `deriveProgramModeSupport()` pass on the reference profile once T2 + T3 land (and T5 for track-transfer).
- [x] T4.2 Promote `captureUnavailableReasons(probe)` to a shared helper and render the concrete reason list (plus the WebGPU-core check) at [`ProgramPanel.tsx:105`](../../../src/ui/ProgramPanel.tsx) and the [`diagnostics.ts:409,412`](../../../src/engine/diagnostics.ts) messages — replacing the static "requires a Chromium browser with WebGPU and WebCodecs" text.
- [x] T4.3 Unit test: the Program Mode reason string for a probe with WebGPU present but realtime-encode missing names "Realtime video encode", not WebGPU/WebCodecs.

## T5 — Recording track-transfer gate (B5, D5)

Decision: **honest gate now, off-main-thread main-frames path deferred** (D5). The capture encode path is track-based with no trackless push-frame seam, so a correct fallback is a verifiable engine feature, not a bugfix-sized change.

- [x] T5.1 Keep `recordingAvailable()` requiring `transferableMediaStreamTrack !== 'unsupported'` (worker-track transfer needs it), with a comment pointing at the deferred task.
- [x] T5.2 Make `captureUnavailableReasons` surface the actionable reason when transfer is unsupported (names the `chrome://flags/#enable-experimental-web-platform-features` workaround), independent of MSTP.
- [x] T5.3 Remove the non-functional main-frames runtime (`startMstpReaders` posting `{type:'video-frame'}` to the writer worker — unhandled, dropped + leaked frames, empty-transfer `DataCloneError`) and its compat badge / dead CSS.
- [x] T5.4 Tests updated: `recordingAvailable` false when transfer `unsupported`, true on a fully capable profile and when transfer is `unknown`; `captureUnavailableReasons` shows the flag-hint reason only when transfer is `unsupported`.
- [ ] T5.5 (deferred → Out-of-scope) Real off-main-thread main-frames capture: new `TrackPipeline` push-frame input mode + pipeline-worker message + `VideoFrame` lifecycle, verified against a live capture session.

## T6 — Consolidate workspace layout + fix responsive collapse (B6, D6)

- [x] T6.1 Remove the superseded duplicate so exactly one `.workspace`/`.dock-left`/`.side-rail` rule set remains in [`global.css`](../../../src/global.css) (keep the Ark visuals).
- [x] T6.2 Set the middle track to `minmax(0,1fr)` so it can shrink, and raise the single-column collapse breakpoint to ~1240px.
- [x] T6.3 **Re-declare `display: grid; flex: 1; min-height: 0` on the surviving `.workspace` block** (the deleted original was the only source of these; without them the grid is inert above the breakpoint and panels stack full-width). Confirm `.has-bin`/`.rail-collapsed`/`.has-bin.rail-collapsed` all resolve from the surviving block.
- [ ] T6.4 Manual check: no overlap between dock-left, preview, and side-rail at ~960px, ~1100px, ~1280px, ~1512px, and ultra-wide; single-column collapse at ≤1240px.

## T7 — Surface WebNN capability (B7, D7)

- [x] T7.1 Add a read-only WebNN row (presence of `navigator.ml` + resolved ORT EP) to [`CapabilityMatrixPanel.tsx`](../../../src/ui/CapabilityMatrixPanel.tsx) and/or the ML-runtime section of [`diagnostic-snapshot.ts`](../../../src/ui/diagnostic-snapshot.ts), labeled as an accelerator (not a tier).
- [ ] T7.2 Test the row (`webnnRow`) reads "available" when `navigator.ml` is present and the EP is `webnn`. Not yet covered — `webnnRow` is internal to `CapabilityMatrixPanel.tsx`; it's a trivial derivation currently verified manually (T10.3). Add a component test or export the helper for a unit test.

## T8 — Reconcile Live Audio Chain noise-suppression label (B8, D8)

- [x] T8.1 Relabel the disabled insert at [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx) to point at Voice Cleanup / Local Audio Cleanup (preferred), or wire it to the shipped RNNoise denoiser if explicitly in scope.
- [x] T8.2 Verify no remaining UI copy implies the app lacks noise suppression.

## T9 — Quality gate

- [x] T9.1 `pnpm run check` green (format:check + lint + typecheck + Vitest + production build).
- [x] T9.2 Test count does not decrease (212 files / 2359 tests); new tests for H.264 level (T1.4/T2.2), worker OPFS probe (T3.3), capture reasons incl. "never mentions WebGPU/WebCodecs" (T4.3), and the recording gate (T5.4) included. WebNN row (T7.2) still pending.
- [x] T9.3 Every `VideoFrame` in any touched capture/publish path closed exactly once (no regressions from T5).

## T10 — Manual verification (reference profile)

- [ ] T10.1 On Chrome (macOS, WebGPU + COOP/COEP isolation): export dialog offers **H.264/MP4**; Record panel shows no "Realtime video encode"/"OPFS SyncAccessHandle" reasons; Recording and Program Mode are available (or degrade with an accurate, labeled reason).
- [ ] T10.2 Resize the window through 900–1280px: no dock/preview/side-rail overlap.
- [ ] T10.3 Diagnostics shows a WebNN row reflecting the enabled flag; the Live Audio Chain no longer claims noise suppression is "available in a future update".

## Out-of-scope follow-ups (flag if encountered)

- [ ] Browser-support matrix entry / docs note that H.264 export + recording now probe at resolution-correct levels.
- [ ] If T5 lands the fallback-message path only, file a follow-up for the bounded main-frames capture route.
