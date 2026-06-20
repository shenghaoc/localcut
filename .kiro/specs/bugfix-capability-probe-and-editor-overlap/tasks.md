# Tasks — Capability-probe false negatives + editor chrome overlap & IA

> Status: **Part 1 (T1–T11): Implemented — merged (#130 + #131)** (`pnpm run check` green; the off-main-thread main-frames recording fallback **T5.5 landed + was verified in real Chromium** in #131; remaining items are **manual/on-device verification** — T6.4, T10, T11.4 — that need the deployed build + real interaction). **Part 2 Phase 1 (IA-T1–IA-T3): Implemented on this branch** (copy/labelling/density; no nav restructure). **Part 2 Phases 2–3 (IA-T4–IA-T7): Proposed.** Tasks map to bugs (Bn) in [`bugfix.md`](./bugfix.md) and design entries (Dn) in [`design.md`](./design.md).

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


---

# Part 2 — Editor chrome IA (B10–B16, D10–D16)

Ordered by the design's incremental rollout — Phase 1 is copy/labelling/density (low risk), Phase 2 restructures the right rail, Phase 3 the left rail. Resolve the three **Open decisions** (design Part 2) before Phase 2/3.

## Phase 1 — Labels, dedupe, density (no nav restructure)

### IA-T1 — Menu/toolbar dedupe (B13, D13)

- [x] IA-T1.1 Remove the per-menu `Search actions…` items from each `MENU_GROUPS` entry in [`Toolbar.tsx`](../../../src/ui/Toolbar.tsx); keep the single `command-search` trigger. Menu taxonomy extracted to a pure, testable [`toolbar-menus.ts`](../../../src/ui/toolbar-menus.ts) (`buildMenuBarGroups`).
- [x] IA-T1.2 Move `Browser capabilities` to one home under `Help`; remove from `View` and the top-strip `Capabilities` chip. The `View` menu (only ever holding the capability item + the duplicate palette) is dropped rather than shown empty — its `layout/panels/scopes/overlays` content is a Phase 2/3 addition.
- [x] IA-T1.3 Remove the top-strip `Help` chip; keep the `Help` menu (now `User guide` + `Browser capabilities`).
- [x] IA-T1.4 Collapse the launcher strip to frequent/contextual tools (Go Live, callout, Keys); route Audio Cleanup/Captions/Translate/Reframe/Silence through the command palette (⌘K). Right-rail destinations are the Phase 2 home; Phase 1 routes via the palette only.
- [x] IA-T1.5 Update Toolbar component tests: [`toolbar-menus.test.ts`](../../../src/ui/toolbar-menus.test.ts) (menu dedupe), [`Toolbar.browser.test.tsx`](../../../src/__browser__/Toolbar.browser.test.tsx) (collapsed strip), [`editor-chrome-ia.test.ts`](../../../src/ui/editor-chrome-ia.test.ts) (source-level guards).

### IA-T2 — Audio cleanup disambiguation (B12, D12)

- [x] IA-T2.1 Rename the top-toolbar `Cleanup` action to **`Audio Cleanup`** and gate on a selected clip — now a clip-gated command-palette action (`audioCleanupAvailable` ← `selectedAudioCleanupClip()`); disabled with a "Select an audio clip first" hint when nothing is selected.
- [x] IA-T2.2 Rename the right-rail `voice-cleanup` tab `Cleanup` → `Voice FX` ([`App.tsx`](../../../src/ui/App.tsx) `SIDE_RAIL_TABS`); no bare `Cleanup` left anywhere.
- [x] IA-T2.3 Assert label uniqueness across the three audio surfaces (live chain `Audio`, right-rail `Voice FX`, palette `Audio Cleanup`) in [`editor-chrome-ia.test.ts`](../../../src/ui/editor-chrome-ia.test.ts).

### IA-T3 — Compact unavailable states (B16, D16)

- [x] IA-T3.1 Collapse the `captureUnavailableReasons(probe)` body list in [`RecordPanel.tsx`](../../../src/ui/RecordPanel.tsx)/[`ProgramPanel.tsx`](../../../src/ui/ProgramPanel.tsx) to a one-line status chip + `<details>` via the shared [`CaptureUnavailableNotice`](../../../src/ui/CaptureUnavailableNotice.tsx); Record keeps its source-action buttons as the call-to-action.
- [x] IA-T3.2 Reuse the disclosure styling (`.capture-unavailable*` in [`global.css`](../../../src/global.css)); reason data/copy unchanged (still sourced from `captureUnavailableReasons`).
- [x] IA-T3.3 Update the affected `__browser__` panel tests: [`RecordPanel.browser.test.tsx`](../../../src/__browser__/RecordPanel.browser.test.tsx), [`ProgramPanel.browser.test.tsx`](../../../src/__browser__/ProgramPanel.browser.test.tsx).

## Phase 2 — Right rail by job (B10, B14, D10, D14)

### IA-T4 — Collapse seven tabs to four job destinations

- [ ] IA-T4.1 Replace `SIDE_RAIL_TABS` ([`App.tsx:354`](../../../src/ui/App.tsx)) with `Inspector`/`Text`/`Audio`/`Capture`; update `SideRailTab`, `isSideRailTab`, `openSideRailTab`, `SIDE_RAIL_COLLAPSED_KEY`, and keyboard-map tab ids together.
- [ ] IA-T4.2 `Text` = Captions + language tools; `Capture` = Record · Program · Replay · go-live (secondary segmented control); `Audio` = live chain + Voice FX.
- [ ] IA-T4.3 Add the in-panel secondary segmented control; ensure it fits/wraps within ~302px.
- [ ] IA-T4.4 **Remove `overflow-x: auto` + hidden scrollbar from `.side-rail-tab-bar`** and delete the duplicate blocks in [`global.css`](../../../src/global.css) (~2240, ~6834, ~7854) so one definition governs.
- [ ] IA-T4.5 Fallback only if overflow remains: add a **visible** "⋯ More" overflow menu (never a hidden scroll region).
- [ ] IA-T4.6 Update App/right-rail browser + keyboard tests; migrate the persisted collapsed-key value (old ids → new).

### IA-T5 — Verify right-rail fit

- [ ] IA-T5.1 At 1280×720: all four destinations fully visible/clickable; activating one does not clip another; no `overflow-x` scroll on the tab bar.

## Phase 3 — Left rail + Beats (B11, B15, D11, D15)

### IA-T6 — Left rail → library switcher (Option B)

- [ ] IA-T6.1 Reduce `.dock-rail` ([`App.tsx:4299`](../../../src/ui/App.tsx)) to `Media`/`Beats`; make each switch `.dock-library` content (or a header toggle if only two).
- [ ] IA-T6.2 Remove the dead `Media` button; move workflow launchers to palette/menus and/or right-rail destinations; `Scopes` → `View`; `Project`/`Output` → `Project` menu + toolbar.
- [ ] IA-T6.3 Route import/picker failures through the recent-error log, not the status line.

### IA-T7 — Beat Detection home (B15, D15)

- [ ] IA-T7.1 Present `BeatPanel` as a Media-Analysis sub-section shown when an audio source is selected (or the left-rail `Beats` destination from IA-T6).
- [ ] IA-T7.2 Link Beats state to the transport `Beat`-snap toggle (shared signal) with a one-line affordance.

## Part 2 quality gate (each phase)

- [ ] IA-G1 `pnpm run check` green (format + lint + typecheck + Vitest + build).
- [ ] IA-G2 Test count does not decrease; updated component/keyboard tests reflect the new IA.
- [ ] IA-G3 Existing ARIA roles (`tab`/`tabpanel`/`region`) remain correct after restructure.
- [ ] IA-G4 Re-run the audit captures (or a focused subset) at 1280×720 to confirm each finding is resolved.
