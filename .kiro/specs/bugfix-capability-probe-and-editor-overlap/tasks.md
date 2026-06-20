# Tasks — Capability-probe false negatives + editor chrome overlap

> Status: **Implemented — in review** (T1–T11; `pnpm run check` green). The off-main-thread main-frames recording fallback **T5.5 is now implemented + verified in real Chromium** (it was deferred out of the original PR #130 to its own branch — this is that branch). The editor-chrome IA reorganization remains a **separate branch**. Remaining items are **manual/on-device verification** (T6.4, T10, T11.4) that need the deployed build + real interaction. Tasks map to bugs (Bn) in [`bugfix.md`](./bugfix.md) and design entries (Dn) in [`design.md`](./design.md).

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

Decision: PR #130 shipped an **honest gate** (T5.1–T5.4); the deferred **off-main-thread main-frames path is now implemented (T5.5)** on this branch, so recording no longer hard-requires Transferable MediaStreamTrack.

- [x] T5.1 ~~Keep `recordingAvailable()` requiring `transferableMediaStreamTrack !== 'unsupported'`~~ **Superseded by T5.5:** `recordingAvailable()` now gates on `MediaStreamTrackProcessor` only (the universal requirement of both data-plane paths); transfer just selects the path via `selectCaptureMode`.
- [x] T5.2 Make `captureUnavailableReasons` surface the actionable reason when transfer is unsupported (names the `chrome://flags/#enable-experimental-web-platform-features` workaround), independent of MSTP. **T5.5 update:** gated behind a `requireTransferableTrack` option — Program/diagnostics keep it (default `true`); RecordPanel passes `false` (recording degrades instead of blocking) and shows a non-blocking compatibility-mode note + flag hint.
- [x] T5.3 Remove the non-functional main-frames runtime (`startMstpReaders` posting `{type:'video-frame'}` to the writer worker — unhandled, dropped + leaked frames, empty-transfer `DataCloneError`) and its compat badge / dead CSS.
- [x] T5.4 Tests updated for the relaxed gate: `recordingAvailable` true on a fully capable profile, when transfer is `unknown`, **and now when transfer is `unsupported` but MSTP is supported** (main-frames fallback); false only when MSTP is unsupported. `selectCaptureMode` + `deriveProgramModeSupport` (Program Mode still gated on transfer) covered; `captureUnavailableReasons` shows the flag-hint only when `requireTransferableTrack` is set.
- [x] T5.5 Real off-main-thread main-frames capture — **implemented + verified** (D5). Trackless `TrackPipeline.pushFrame` input mode + `CaptureSession.pushFrame` router (shared encode/close-once step with the reader loop); `capture-add-source.track` optional + new `capture-push-frame` pipeline-worker message (routes to the **pipeline** encoder, frame transferred, closed exactly once); main-thread `startCaptureFrameReader` + App/RecordPanel wiring; `recordingAvailable`/`selectCaptureMode` relaxed. Verified against a live capture in headless Chromium (`main-frames-capture.browser.test.ts`: canvas `captureStream` → MSTP → push pipeline → real `VideoEncoder` → non-empty encoded chunks with a key frame).

## T6 — Consolidate workspace layout + fix responsive collapse (B6, D6)

- [x] T6.1 Remove the superseded duplicate so exactly one `.workspace`/`.dock-left`/`.side-rail` rule set remains in [`global.css`](../../../src/global.css) (keep the Ark visuals).
- [x] T6.2 Set the middle track to `minmax(0,1fr)` so it can shrink, and raise the single-column collapse breakpoint to ~1240px.
- [x] T6.3 **Re-declare `display: grid; flex: 1; min-height: 0` on the surviving `.workspace` block** (the deleted original was the only source of these; without them the grid is inert above the breakpoint and panels stack full-width). Confirm `.has-bin`/`.rail-collapsed`/`.has-bin.rail-collapsed` all resolve from the surviving block.
- [ ] T6.4 Manual check: no overlap between dock-left, preview, and side-rail at ~960px, ~1100px, ~1280px, ~1512px, and ultra-wide; single-column collapse at ≤1240px.

## T7 — Surface WebNN capability (B7, D7)

- [x] T7.1 Add a read-only WebNN row (presence of `navigator.ml` + resolved ORT EP) to [`CapabilityMatrixPanel.tsx`](../../../src/ui/CapabilityMatrixPanel.tsx) and/or the ML-runtime section of [`diagnostic-snapshot.ts`](../../../src/ui/diagnostic-snapshot.ts), labeled as an accelerator (not a tier).
- [x] T7.2 Unit test for `webnnRow`: extracted the pure row builders to [`src/ui/capability-rows.ts`](../../../src/ui/capability-rows.ts) (JSX-free, node-testable) and added [`capability-rows.test.ts`](../../../src/ui/capability-rows.test.ts) — supported + active when `beauty.webnn==='supported'` and the ORT EP is `webnn`; supported-not-active for a different EP; flag hint when absent; and `'unknown'` from the probe never reads as supported (no live `navigator.ml`).

## T8 — Reconcile Live Audio Chain noise-suppression label (B8, D8)

- [x] T8.1 Remove the disabled insert at [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx), or wire it to the shipped RNNoise denoiser if explicitly in scope.
- [x] T8.2 Verify no remaining UI copy implies the app lacks noise suppression.

## T11 — Media Bin delete button in frame (B9, D9)

- [x] T11.1 Shrink `.media-bin-thumb` (64×36 → 48×27) and `.media-bin-button` (24 → 22px) + tighten `.media-bin-actions` gap; mark actions/buttons `flex: 0 0 auto`.
- [x] T11.2 Add `overflow-x: hidden` to `.media-bin-list` so no horizontal scrollbar can appear.
- [x] T11.3 Validated live (DOM-injected item): delete button stays in frame at the 236px-dock bin (~162px) and all wider widths; no horizontal scroll.
- [ ] T11.4 Manual check with real imported media at a narrow window + after the service worker updates.

## T9 — Quality gate

- [x] T9.1 `pnpm run check` green (format:check + lint + typecheck + Vitest + production build).
- [x] T9.2 Test count does not decrease (212 files / 2377 tests); new tests for H.264 level (T1.4/T2.2), worker OPFS probe (T3.3), capture reasons incl. "never mentions WebGPU/WebCodecs" (T4.3), the recording gate (T5.4), and the WebNN row (T7.2) all included.
- [x] T9.3 Every `VideoFrame` in any touched capture/publish path closed exactly once (no regressions from T5).

## T10 — Manual verification (reference profile)

- [ ] T10.1 On Chrome (macOS, WebGPU + COOP/COEP isolation): export dialog offers **H.264/MP4**; Record panel shows no "Realtime video encode"/"OPFS SyncAccessHandle" reasons; Recording and Program Mode are available (or degrade with an accurate, labeled reason).
- [ ] T10.2 Resize the window through 900–1280px: no dock/preview/side-rail overlap.
- [ ] T10.3 Diagnostics shows a WebNN row reflecting the enabled flag; the Live Audio Chain no longer claims noise suppression is "available in a future update".

## Out-of-scope follow-ups (flag if encountered)

- [x] Browser-support matrix / docs note — **not needed**: `docs/exporting.md` ("only codecs your browser can actually encode are offered") and `docs/browser-limitations.md` already describe the intended behavior accurately; B1 makes the app match the docs rather than the other way around.
- [x] ~~If T5 lands the fallback-message path only, file a follow-up for the bounded main-frames capture route.~~ Done — T5.5 implemented the off-main-thread main-frames capture route on this branch.
- [ ] Optional polish: pause the per-source main-thread reader while a main-frames session is **paused** (frames are read + forwarded and safely dropped/closed worker-side — correct but slightly wasteful). The **stop/auto-stop** case is already handled — readers stop when the session enters `'stopping'`.

