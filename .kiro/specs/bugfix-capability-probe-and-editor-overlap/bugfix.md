# Bugfix — Capability-probe false negatives + editor chrome overlap

> Status: **Proposed** — features that should work on a fully capable Chromium profile (WebGPU + WebNN + COOP/COEP isolation) are reported unavailable, the editor side docks overlap on narrower windows, and two UI strings misrepresent what the app can do.

## Summary

A user running Chrome 149 on macOS (WebGPU on, `navigator.ml`/WebNN flag enabled, `crossOriginIsolated === true`, tier reported as **Core WebGPU**) hit a cluster of features that say they are unavailable even though the platform supports them. Direct probing on that profile (see **Environment / evidence** below) shows that several capability probes in [`capability-probe-v2.ts`](../../../src/engine/capability-probe-v2.ts) produce **false negatives** because they request H.264 at a codec **level** too low for the probe resolution, or probe a Worker-only API from the main thread. These false negatives silently drop **H.264/MP4 export** and block **Recording** and **Program Mode**.

Separately, the Ark editor-kit UI (PR #125) appended a **second copy** of the workspace layout rules to [`global.css`](../../../src/global.css); because the duplicate is later in source order with equal specificity, it overrides both the original rules and the `@media` collapse, causing the left dock and right side-rail to overlap the preview on narrower viewports. Two UI strings (`publish.*` diagnostics and the Live Audio Chain "Noise Suppression" insert) also read as hard failures or missing features when they are actually optional/handled elsewhere.

This spec bundles eight bugs (B1–B8) found from one capable Chrome profile. B1–B4 are the high-impact "feature falsely unavailable" defects; B5 is a too-strict gate with a missing fallback; B6 is the layout regression; B7–B8 are message/clarity fixes.

## Environment / evidence

Probed live against `https://browser-editor.shenghaoc.workers.dev/` (commit `ff3b12c`), Chrome 149, macOS, `crossOriginIsolated === true`, `navigator.gpu` present, `navigator.ml` present.

`VideoEncoder.isConfigSupported` (H.264) — the level digit is the last codec byte (`1E`=L3.0, `1F`=L3.1, `20`=L3.2, `28`=L4.0, `29`=L4.1):

| Config | Result |
| --- | --- |
| `avc1.42E01E` (L3.0) encode @ 1280×720 — **the value `probeCodecs` uses** | **`false`** |
| `avc1.42E01F` (L3.1) encode @ 1280×720 | `true` |
| `avc1.42E020` (L3.2) encode @ 1280×720 | `true` |
| `avc1.42001E` (L3.0) realtime+HW @ 1920×1080 — **the value `probeVideoEncodeRealtime` uses** | **`false`** |
| `avc1.42E028` (L4.0) realtime+HW @ 1920×1080 | `true` |
| `avc1.42E029` (L4.1) realtime+HW @ 1920×1080 | `true` |
| `avc1.42E01E` (L3.0) **decode** @ 1280×720 | `true` (decoders ignore the level → tier unaffected) |

OPFS `FileSystemFileHandle.createSyncAccessHandle`:

| Context | `typeof handle.createSyncAccessHandle` | Probe result |
| --- | --- | --- |
| Main thread (where `probeCapabilities` runs) | `undefined` → throws `TypeError` | `'unknown'` (treated as unavailable) |
| Dedicated Worker (where `CaptureWriterWorker` runs) | `'function'` | `'supported'` |

Other genuine results on this profile: `MediaStreamTrackProcessor` ✓, `MediaStreamTrackGenerator` ✓, `RTCPeerConnection` ✓, `getDisplayMedia` ✓, VP9 encode ✓, AV1 encode ✓; `structuredClone(track,{transfer:[track]})` → `DataCloneError` (transferable MediaStreamTrack genuinely off); `RTCRtpSender.prototype.generateKeyFrame` → `undefined` (genuinely absent).

**Recording-blocker completeness.** `recordingAvailable()` (capability-probe-v2.ts:533-543) reads seven inputs. On this profile, four pass — `mediaStreamTrackProcessor:'supported'`, `displayCapture:'supported'`, `audioEncodeOpus:true`, `audioEncodeAac:true` (all probed live) — leaving exactly three failures: `videoEncodeRealtime` (B2, false negative), `opfsSyncAccessHandle` (B3, false negative), and `transferableMediaStreamTrack` (B5, genuine + too-strict gate). Therefore **B2 + B3 + B5 are the complete set of recording blockers** on the reference profile; fixing them fully restores Recording (and, via the cascade, Program Mode). The deployed build is commit `ff3b12c` (= current `main`), so every bug here reproduces on HEAD — not a stale deploy.

Live computed `.workspace.has-bin` columns were `364px 756px 360px` — matching the duplicate rule at `global.css:7649` (`364px minmax(480px,1fr) 360px`), **not** the original rule at `global.css:1691` (`232px minmax(0,1fr) 320px`), confirming the duplicate is the active rule.

## Bugs

### B1 — H.264/MP4 export silently dropped (probe codec level too low for resolution)

- **Where:** [`capability-probe-v2.ts:52-56`](../../../src/engine/capability-probe-v2.ts) (`videoCodecStrings.h264 = 'avc1.42E01E'`) used by `probeCodecs` at `width:1280,height:720` ([`:132`](../../../src/engine/capability-probe-v2.ts)); consumed by `exportConstraintsForProbe` ([`:292-306`](../../../src/engine/capability-probe-v2.ts)).
- **Observed:** `codecs.h264Encode === 'unsupported'`, so `exportConstraintsForProbe` never pushes `{codec:'h264',container:'mp4'}`. On a machine that encodes H.264 fine, the most-compatible export target is missing; only VP9/AV1 are offered.
- **Expected:** H.264/MP4 is offered whenever the platform can encode H.264 at the export resolution.
- **Root cause:** `avc1.42E01E` is H.264 **Level 3.0** (max ≈ 720×576). 1280×720 exceeds it, so `VideoEncoder.isConfigSupported` correctly returns `supported:false`. The matching **decode** probe passes only because decoders ignore the level — so the tier is unaffected and the breakage is export-only and silent.

### B2 — Recording falsely blocked: realtime-encode probe uses an invalid H.264 level for 1080p

- **Where:** [`probeVideoEncodeRealtime`, `capability-probe-v2.ts:372-388`](../../../src/engine/capability-probe-v2.ts) — `codec:'avc1.42001E'` at `1920×1080`.
- **Observed:** `capture.videoEncodeRealtime === 'unsupported'` → RecordPanel lists "Realtime video encode is unavailable." ([`RecordPanel.tsx:163-164`](../../../src/ui/RecordPanel.tsx)) and `recordingAvailable()` returns false.
- **Expected:** Realtime 1080p H.264 encode is detected on hardware that supports it (it does here).
- **Root cause:** Same level defect as B1 — Level 3.0 (`…1E`) cannot represent 1080p, so the probe is always `false` on a spec-compliant browser regardless of real capability.

### B3 — Recording falsely blocked: OPFS SyncAccessHandle probed on the wrong thread

- **Where:** [`probeOpfsSyncAccessHandle`, `capability-probe-v2.ts:406-421`](../../../src/engine/capability-probe-v2.ts), called from `probeCapabilities` ([`:580`](../../../src/engine/capability-probe-v2.ts)) which runs on the **main thread** at App startup.
- **Observed:** `handle.createSyncAccessHandle()` throws `TypeError: ... is not a function` on the main thread → probe returns `'unknown'` → RecordPanel lists "OPFS SyncAccessHandle is unavailable." ([`RecordPanel.tsx:166-167`](../../../src/ui/RecordPanel.tsx)) and `recordingAvailable()` returns false.
- **Expected:** The probe reports `'supported'` when the API works in the context where it is actually used (the capture writer worker), which it does on this machine.
- **Root cause:** `FileSystemFileHandle.createSyncAccessHandle()` is exposed only in **Worker** global scopes, never on `Window`. The probe tests the wrong context. The real consumer is [`CaptureWriterWorker`](../../../src/engine/capture/writer-worker.ts), a worker — so capture would actually work.

### B4 — "Program Mode requires a Chromium browser with WebGPU and WebCodecs" is inaccurate and cascades from B2/B3/B5

- **Where:** [`deriveProgramModeSupport`, `capability-probe-v2.ts:547-551`](../../../src/engine/capability-probe-v2.ts) (depends on `recordingAvailable()`); message at [`ProgramPanel.tsx:105`](../../../src/ui/ProgramPanel.tsx) and [`diagnostics.ts:409,412`](../../../src/engine/diagnostics.ts).
- **Observed:** Because `recordingAvailable()` is falsely false (B2 + B3) — and genuinely false via B5 — Program Mode reports unavailable with a message that blames missing "WebGPU and WebCodecs."
- **Expected:** Program Mode is available once the real capture prerequisites pass; when it is not, the message names the **actual** missing capability rather than WebGPU/WebCodecs (both present here).
- **Root cause:** The gate is a pure cascade of `recordingAvailable()`, and the user-facing copy hard-codes a WebGPU/WebCodecs explanation that does not match the true blocker.

### B5 — Recording hard-requires transferable MediaStreamTrack; publish treats the same gap as optional

- **Where:** [`recordingAvailable`, `capability-probe-v2.ts:533-543`](../../../src/engine/capability-probe-v2.ts) requires `capture.transferableMediaStreamTrack !== 'unsupported'`, while publish's [`selectTapMode`, `publish-controller.ts:40-44`](../../../src/ui/publish-controller.ts) falls back to a bounded **main-frames** mode when track transfer is missing.
- **Observed:** On this profile `transferableMediaStreamTrack === 'unsupported'` (genuine `DataCloneError`), so Recording is blocked even though `MediaStreamTrackProcessor` is supported and publish would degrade gracefully under the identical condition.
- **Expected:** Recording either uses the same bounded main-frames fallback as publish, or — if a worker-side track transfer is truly required — the gate and message say so precisely (and the `chrome://flags/#enable-experimental-web-platform-features` workaround is surfaced).
- **Root cause:** Recording's availability gate is stricter than the architecture requires; the publish path already proves a fallback exists for the same missing capability.

### B6 — Editor workspace overlap: duplicate `.workspace` rules override the responsive collapse

- **Where:** [`global.css:7641-7780`](../../../src/global.css) (Ark editor-kit block, PR #125) duplicates and overrides the original [`global.css:1681-1692`](../../../src/global.css) rules and the `@media (max-width:900px)` single-column collapse at [`global.css:4710-4717`](../../../src/global.css).
- **Observed:** `.workspace.has-bin` resolves to `364px minmax(480px,1fr) 360px` (live-confirmed). Below ~1236px the middle track cannot shrink past its 480px floor while the 364px dock and 360px rail stay fixed, so the grid overflows and the side docks overlap/clip the preview. The `@media (max-width:900px)` rule that should collapse to a single column never wins.
- **Expected:** One authoritative workspace rule set; columns that shrink gracefully or a breakpoint that fires before the layout's true minimum width, with no overlap at any viewport.
- **Root cause:** Two `.workspace`/`.dock-left`/`.side-rail` rule blocks now coexist. With equal specificity, the later block (line 7641) wins — and because `@media` does not raise specificity, it also defeats the narrow-screen collapse at line 4710. A dead zone of ~900–1236px results where neither the layout fits nor the breakpoint triggers.

### B7 — WebNN is detected and used but never surfaced as a capability

- **Where:** WebNN is probed in [`probeBeauty`/`preferredCleanupAcceleratorFromPlatform`, `capability-probe-v2.ts:67-81,511-519`](../../../src/engine/capability-probe-v2.ts) and used by [`dtln-ort-runtime.ts:37-41`](../../../src/engine/audio-cleanup/dtln-ort-runtime.ts) and [`beauty-runtime.ts:70-89`](../../../src/engine/beauty/beauty-runtime.ts), but is only shown indirectly as the cleanup-accelerator value ([`CapabilityMatrixPanel.tsx:278-288`](../../../src/ui/CapabilityMatrixPanel.tsx), [`AudioCleanupPanel.tsx:160-162`](../../../src/ui/AudioCleanupPanel.tsx)).
- **Observed:** The "Core WebGPU" tier label says nothing about WebNN (correctly — the tier is WebGPU-only), and there is no row that answers "is WebNN available?", so a user who enabled the WebNN flag cannot confirm it was picked up.
- **Expected:** A diagnostics/capability row reflects WebNN (`navigator.ml`) availability and the active ORT execution provider, so an enabled flag is visibly confirmed.
- **Root cause:** WebNN was wired into runtime selection but never given a user-visible capability indicator.

### B8 — "Noise Suppression — Available in a future update" misrepresents a shipped capability

- **Where:** [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx) hardcodes a disabled "Available in a future update" denoiser insert.
- **Observed:** The app already ships working noise suppression — Phase 36 **Voice Cleanup** (RNNoise WASM, the "Cleanup" tab) and Phase 27/28 **Local Audio Cleanup** (ORT DTLN, the Audio Cleanup panel). The Live Audio Chain insert reads as if the app has no denoiser at all.
- **Expected:** The insert either wires to the existing RNNoise/DTLN denoiser, or is relabeled to point users to Voice Cleanup / Audio Cleanup so it does not imply the feature is absent.
- **Root cause:** A placeholder insert label was never reconciled with the noise-suppression features shipped in later phases.

## Non-goals

- Implementing transferable MediaStreamTrack support in the browser, or shipping a new main-thread frame-reading capture path beyond reusing publish's existing bounded main-frames fallback (B5 may land as "accurate gate + workaround surfaced" if the fallback proves out of scope).
- Adding `generateKeyFrame` support or changing WHIP GOP behavior — it is already correctly optional (publish degrades to platform-default GOP).
- The "GPU (compat)" / `limited-webcodecs` / `shell-only` tiers and their derivation (B-bugs here are encode/OPFS/layout/UX only; tier derivation is correct).
- Redesigning the editor chrome; B6 is a CSS consolidation, not a visual redesign.
- Rebuilding the Live Audio Chain DSP; B8 is wiring/relabeling only.

## Acceptance criteria

1. On a Chromium profile that can encode H.264, **H.264/MP4 appears in the export codec list** (`exportConstraintsForProbe` includes it); probing no longer fails purely due to codec **level** (B1).
2. `capture.videoEncodeRealtime` reports `'supported'` on hardware that supports realtime 1080p H.264; "Realtime video encode is unavailable" no longer shows on such hardware (B2).
3. `capture.opfsSyncAccessHandle` reflects the capability in the **worker** context where it is used; "OPFS SyncAccessHandle is unavailable" no longer shows when a worker can create a sync access handle (B3).
4. With B2 + B3 fixed, **Recording and Program Mode are available** on the reference profile (subject to B5), and the Program Mode unavailable message names the **actual** missing capability rather than WebGPU/WebCodecs (B4).
5. Recording either degrades via the same bounded main-frames fallback publish uses, or its gate/message accurately states the requirement and surfaces the experimental-flag workaround (B5).
6. There is exactly **one** authoritative `.workspace`/`.dock-left`/`.side-rail` rule set; the editor shows **no overlap** between the left dock, preview, and right side-rail across viewport widths from the collapse breakpoint up to ultra-wide, including the previously broken ~900–1236px range (B6).
7. A capability/diagnostics row reflects **WebNN** availability and the active ORT execution provider (B7).
8. The Live Audio Chain no longer states noise suppression is "available in a future update" while the app ships Voice Cleanup / Local Audio Cleanup — it is wired or relabeled to point at them (B8).
9. `pnpm run check` is green and the unit-test count does not decrease; new probe unit tests cover B1–B3 (and B5 if the fallback lands).
