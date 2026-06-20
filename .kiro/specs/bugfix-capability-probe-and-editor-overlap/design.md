# Design — Capability-probe false negatives + editor chrome overlap & IA

> Status: **Part 1 (D1–D9): Implemented — merged (#130 + #131).** **Part 2 (D10–D16, editor-chrome IA): this branch — Phase 1 implemented, Phases 2–3 proposed.** Each design entry Dn maps to bug Bn in [`bugfix.md`](./bugfix.md). The recurring theme for B1–B4 is one defect: H.264 codec strings encode a fixed **level** that is too low for the probe resolution, so `VideoEncoder.isConfigSupported` rejects the config on a fully capable encoder. D5 first shipped (#130) as an honest gate, then the deferred off-main-thread main-frames capture path **landed (T5.5, #131)**; D6 gained a consolidation gotcha (`display: grid` must survive).

## D1 / D2 — Pick an H.264 level that matches the probe resolution

**Shared root cause.** `avc1.42E01E` and `avc1.42001E` are both H.264 **Level 3.0** (final byte `0x1E`). Level 3.0 maxes out near 720×576; both the general codec probe (1280×720) and the realtime probe (1920×1080) exceed it, so encode probing returns `false` regardless of hardware.

**Fix.** Introduce one helper that returns an H.264 codec string whose level covers a given frame size, and use it for **every** H.264 probe (general encode/decode and realtime). Driving the level off the resolution keeps the probe honest if the probe dimensions ever change.

```ts
// capability-probe-v2.ts
// H.264 Annex-A level_idc in hex (codec string final byte): 30=L3.0, 31=L3.1,
// 32=L3.2, 40=L4.0, 41=L4.1, 42=L4.2. We pick the lowest level whose
// MaxFS (macroblocks/frame) covers width*height so isConfigSupported is not
// rejected purely on level. Constrained Baseline profile prefix = 42E0.
function h264ConstrainedBaseline(width: number, height: number): string {
	const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
	// MaxFS per level (H.264 Table A-1): L3.0=1620, L3.1=3600, L3.2=5120,
	// L4.0/4.1=8192, L4.2=8704, L5.0=22080, L5.1=36864.
	const level =
		mbs <= 1620 ? 0x1e :
		mbs <= 3600 ? 0x1f :
		mbs <= 5120 ? 0x20 :
		mbs <= 8192 ? 0x28 :
		mbs <= 22080 ? 0x32 :
		0x33; // L5.1 covers 4K
	return `avc1.42E0${level.toString(16).toUpperCase().padStart(2, '0')}`;
}
```

- **D1 (B1, export):** replace the static `videoCodecStrings.h264` use in `probeCodecs` with `h264ConstrainedBaseline(width, height)` for both the decode and encode probes (decode already passes, but keep them symmetric so a future resolution bump can't silently regress decode). 1280×720 → 3600 MBs → L3.1 (`avc1.42E01F`), which the evidence table shows encodes `true`.
- **D2 (B2, recording) — revised:** the realtime probe must test the codec recording **actually configures**, not just any valid-level H.264 (Codex review). Recording's encoder picks from `CAPTURE_VIDEO_CODEC_FALLBACKS` (`['avc1.64002a', 'avc1.42e02a', 'avc1.42002a']`, all High/Baseline **Level 4.2**) — the worker builds its candidate list from that constant. So `probeVideoEncodeRealtime` iterates the same constant and returns `'supported'` if **any** candidate is realtime-encodable (`'unknown'` only if none pass but some threw). This avoids a false positive where the probe asks for Baseline L4.0 but recording then fails to `configure()` `avc1.64002a` on a profile that rejects High Profile. (`h264ConstrainedBaseline` stays in use for the export-codec probe, D1.)

**Why not just hardcode L4.2 everywhere?** A hardcoded high level works for these two resolutions but reintroduces the same trap if a probe is added at 4K (L4.2 maxes ~2048×1080 area-wise; 4K needs L5.1). Deriving from the frame size is the durable fix and is trivially unit-testable.

**Note on the publish probe.** `probeLivePublish` already probes hardware H.264 at 1080p with `avc1.42e029` (Level 4.1) — that one is correct and needs no change; it is the precedent this design generalizes.

## D3 — Probe OPFS SyncAccessHandle in a Worker, not on the main thread

`createSyncAccessHandle()` exists only in Worker scopes. The probe must run where the capability is real.

**Fix.** Move the OPFS sync-handle probe into a tiny inline (blob) dedicated worker spawned once during `probeCapabilities`, awaited with a short timeout, and terminated immediately. The worker runs the same create/close/remove dance and posts back `'supported' | 'unsupported' | 'unknown'`.

```ts
// capability-probe-v2.ts
async function probeOpfsSyncAccessHandleInWorker(): Promise<FeatureSupport> {
	if (typeof Worker === 'undefined' || typeof navigator?.storage?.getDirectory !== 'function') {
		return 'unsupported';
	}
	// The worker removes the temp file and posts the result as its LAST action, so
	// the parent's worker.terminate() (fired on message receipt) cannot race the
	// cleanup and leave a _cap_probe_*.tmp behind on every startup.
	const src = `self.onmessage = async () => {
		let result = 'unknown';
		let root, name, created = false;
		try {
			root = await navigator.storage.getDirectory();
			name = '_cap_probe_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.tmp';
			const handle = await root.getFileHandle(name, { create: true });
			created = true;
			if (typeof handle.createSyncAccessHandle !== 'function') {
				result = 'unsupported';
			} else {
				const access = await handle.createSyncAccessHandle();
				access.close();
				result = 'supported';
			}
		} catch { result = 'unknown'; }
		if (created && root && name) { try { await root.removeEntry(name); } catch {} }
		self.postMessage(result);
	};`;
	const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
	let worker: Worker | undefined;
	try {
		worker = new Worker(url);
		const w = worker;
		return await new Promise<FeatureSupport>((resolve) => {
			const timer = setTimeout(() => resolve('unknown'), 3_000);
			w.onmessage = (e) => { clearTimeout(timer); resolve(e.data as FeatureSupport); };
			w.onerror = () => { clearTimeout(timer); resolve('unknown'); };
			w.postMessage('go');
		});
	} catch {
		return 'unknown';
	} finally {
		worker?.terminate();
		// Revoke only after the worker has loaded + finished (or timed out): some
		// browsers fetch the worker script asynchronously, so an immediate revoke
		// after `new Worker` can abort the load. The finally still runs if `new
		// Worker` throws, so the URL is never leaked either.
		URL.revokeObjectURL(url);
	}
}
```

`probeCaptureCapabilities` awaits this in place of the current main-thread `probeOpfsSyncAccessHandle`. Confirmed on the reference machine: the worker path returns `'supported'`. (Keep the bundle worker-free — this is a transient blob worker, not a build entry.) Temp-file/Object-URL leaks and the terminate-vs-cleanup race were all closed (Gemini + Codex review).

## D4 — Make the Program Mode / recording-blocked message name the real cause

Two changes, no new gates:

1. With D2 + D3 landed, `recordingAvailable()` (and therefore `deriveProgramModeSupport()`) passes on the reference profile via the corrected sub-probes — no logic change needed there.
2. Replace the static string at `ProgramPanel.tsx` (and the equivalents in `diagnostics.ts`) with a derived reason from the shared `src/engine/capture-reasons.ts` helper, instead of asserting WebGPU/WebCodecs are missing when they are not.

`captureUnavailableReasons(probe)` must enumerate **every** hard gate in `recordingAvailable()` — not just the capture probes (Codex review). That includes the tier-level gates that compose `tier === 'core-webgpu'` (cross-origin isolation, `SharedArrayBuffer`, `OffscreenCanvas`, WebGPU core, video decode) **and** `audioEncodeOpus`, so a reduced-tier profile (capture probes pass, but COOP/COEP or SAB missing) never renders "Program Mode is unavailable:" with an empty list. Because it now reads top-level probe fields, the diagnostics worker passes the **full** `CapabilityProbeResult` (not a `{capture}`-only cast). `ProgramPanel` renders the list via a `createMemo`, drops the redundant separate WebGPU note (WebGPU core is in the list), and keeps a "Required capabilities are missing." fallback for any uncovered gate.

## D5 — Recording track-transfer gate: honest message, then the off-main main-frames fallback (now implemented, T5.5)

**History.** Part 1 shipped an honest gate: `recordingAvailable()` kept `transferableMediaStreamTrack !== 'unsupported'` and `captureUnavailableReasons` surfaced the actionable `chrome://flags/#enable-experimental-web-platform-features` workaround, while the real off-main-thread fallback was deferred to T5.5. **T5.5 is now implemented** — recording no longer hard-requires Transferable MediaStreamTrack.

Why it needed its own task: unlike publish (whose `selectTapMode` already had a wired worker-side main-frames mode — [`publish-controller.ts:40-44`](../../../src/ui/publish-controller.ts), [`worker.ts:1358-1370`](../../../src/engine/worker.ts)), **recording's encode path was track-based end to end** — `capture-add-source` transferred the `MediaStreamTrack` into the worker, where `CaptureSession.addSource(... track ...)` built a per-source `TrackPipeline` owning the in-worker `MediaStreamTrackProcessor` + realtime encoder, with **no trackless "push-frame" seam**.

> An initial (reverted) attempt posted main-thread frames as `{type:'video-frame'}` to the **writer** worker, which has no such handler ([`writer-worker.ts`](../../../src/engine/capture/writer-worker.ts) handles only `write-*`/`scan`/`discard`); frames were silently dropped and leaked (never `.close()`d), and a `MessagePort` was passed with an empty transfer list (`DataCloneError`). The implemented path below avoids all three: frames route to the **pipeline** worker's encoder, are closed exactly once, and frames (not ports) are transferred.

**Implemented design (T5.5).** Mirror publish's data-plane split, but with frames flowing **main → worker** (recording) instead of worker → main (publish):

- **Trackless push pipeline.** `TrackPipeline`'s `track` becomes optional; omitting it builds a *push pipeline* that configures the encoder up front and exposes `pushFrame(frame)` instead of running an in-worker `MediaStreamTrackProcessor` reader. The per-frame encode step (compose-tap clone, `encodeQueueSize` backpressure drop, key-frame cadence, `frame.close()` in a `finally`) is extracted and **shared** by the reader loop and `pushFrame`, so both input paths honour the close-exactly-once invariant identically. `CaptureSession.addSource(… track: null …)` builds it; `CaptureSession.pushFrame(sourceId, frame)` routes a frame (and closes it if the source id is unknown). Pause gates input + flushes; resume forces a key frame at the resume point.
- **New pipeline-worker message.** `capture-add-source.track` is now optional (omitted ⇒ push pipeline); `{type:'capture-push-frame', sourceId, frame}` forwards one frame to the **pipeline** worker (not the writer), transferring the frame; the worker routes it to `CaptureSession.pushFrame`, or closes it if there is no active session — so a transferred frame never leaks.
- **Main-thread reader.** `startCaptureFrameReader(track, pushFrame, onError)` ([`capture-frame-reader.ts`](../../../src/ui/capture-frame-reader.ts)) runs a per-source main-thread `MediaStreamTrackProcessor` and forwards each frame via `bridge.send({type:'capture-push-frame', …}, [frame])`. It only closes a frame itself when read after `stop()` (i.e. when it will not be forwarded); every forwarded frame is closed once by the worker. This is the explicit, capability-tiered compatibility path the hard gate allows — it shuttles frame handles, doing no pixel processing.
- **Mode selection.** `selectCaptureMode(probe)` returns `'worker-track'` when `transferableMediaStreamTrack === 'supported'`, else `'main-frames'` (`'unknown'` takes the safe main-frames path — never risks a `DataCloneError`). `recordingAvailable()` drops the transfer requirement and now gates only on `MediaStreamTrackProcessor` (the universal requirement of both paths). RecordPanel renders a non-blocking **compatibility-mode** note in main-frames mode and passes `requireTransferableTrack: false` to `captureUnavailableReasons` so transfer is never a blocking reason there.
- **Program Mode unchanged.** Program Mode still transfers every source track into the worker (no main-frames path), so `deriveProgramModeSupport` additionally requires `transferableMediaStreamTrack !== 'unsupported'`, and `captureUnavailableReasons` keeps its default `requireTransferableTrack: true` for the Program/diagnostics surfaces.

**Verification.** `src/engine/capture/main-frames-capture.browser.test.ts` runs the real path in headless Chromium — a canvas `captureStream()` track → `startCaptureFrameReader` → push `TrackPipeline` → real `VideoEncoder` — and asserts non-empty encoded chunks with a key frame (i.e. the output contains encoded video, not an empty file). Unit tests cover the push pipeline (`track-pipeline.test.ts`), the `CaptureSession.pushFrame` router (`capture-session.test.ts`), the relaxed gate + `selectCaptureMode` + Program-Mode gating (`capability-probe-v2.test.ts`), and the `requireTransferableTrack` option (`capture-reasons.test.ts`).

## D6 — Consolidate the workspace layout rules; fix the responsive collapse

The Ark editor-kit block at [`global.css:7641-7780`](../../../src/global.css) is now the live rule set (live columns `364px 756px 360px` match `:7649`). The original block at [`:1681-1692`](../../../src/global.css) and the `@media (max-width:900px)` collapse at [`:4710-4717`](../../../src/global.css) are dead/overridden because the duplicate is later in source with equal specificity (and `@media` adds no specificity).

**Fix.**

1. **Single source of truth.** Delete the superseded original `.workspace`/`.dock-left`/`.side-rail` declarations (or the duplicate) so exactly one block defines the workspace grid. Keep the Ark visuals; the issue is duplication + breakpoint, not the look.
2. **Let columns shrink or move the breakpoint.** The grid's true minimum is `364 + 480 + 360` + gaps/padding ≈ 1236px, but the collapse only fires at ≤900px — a broken dead zone. Choose one:
   - **(a)** lower the middle floor so the grid can shrink: `364px minmax(0, 1fr) 360px` (preview shrinks gracefully; matches the original intent at `:1691`), **and/or**
   - **(b)** keep the single-column collapse for genuinely mobile widths (`@media (max-width: 900px)`), and ensure that rule lives **after** (or with higher specificity than) the base workspace block so it actually wins. With `minmax(0, 1fr)` the columns shrink gracefully above the breakpoint, so it need not be raised (an over-raised breakpoint would force the mobile toolbar/timeline onto 1024–1200px desktops — Gemini review).
3. **Re-attach the collapse to the surviving block.** After consolidation, verify the `@media` collapse selector set (`.workspace, .workspace.has-bin, .workspace.rail-collapsed, .workspace.has-bin.rail-collapsed`) targets the same block and is ordered to win.

Recommended combination: (a) `minmax(0,1fr)` middle column **and** keep a single-column collapse at a breakpoint ≥ the true minimum, eliminating both the overflow and the dead zone.

**Consolidation gotcha (must verify):** the deleted original block was the *only* declaration of `display: grid` (plus `flex: 1; min-height: 0`) on `.workspace`; the Ark duplicate only overrode `grid-template-columns`/`gap`/`padding`/`background` and inherited the rest. The surviving consolidated block **must re-declare `display: grid; flex: 1; min-height: 0`** — otherwise `grid-template-columns` is inert above the collapse breakpoint and the three panels stack full-width (a worse regression than the original overlap). Shipped: `.workspace { display: grid; flex: 1; min-height: 0; gap: 6px; padding: 6px; grid-template-columns: minmax(0,1fr) 304px }`, `has-bin` = `236px minmax(0,1fr) 304px`, collapse to `display: flex; flex-direction: column` at `@media (max-width: 900px)`.

**Cascade-order gotcha (must verify):** the single-column collapse `@media` and the base `.workspace { display: grid }` rule have **equal specificity** (media queries add none), so the collapse only wins if it is **later in source order**. The base grid block lives near the end of the file (~line 6319), so the collapse `@media (max-width: 900px)` must be placed **immediately after it** — not in the earlier (~line 4517) responsive block, where the later base grid rule overrides it and the multi-column grid persists below the breakpoint. Shipped: the collapse `@media` sits right after the base `.workspace` block; the stale earlier copy was removed.

## D7 — Surface WebNN as a capability/diagnostics row

Add a read-only WebNN row to the capability/diagnostics surface (e.g. [`CapabilityMatrixPanel.tsx`](../../../src/ui/CapabilityMatrixPanel.tsx) and/or the ML-runtime section of [`diagnostic-snapshot.ts:324-332`](../../../src/ui/diagnostic-snapshot.ts)):

- Source the value from the existing probes: `navigator.ml` presence (already read by `preferredCleanupAcceleratorFromPlatform`/`probeBeauty`) and the resolved ORT EP (`ortEp`).
- Label clearly that WebNN is an **accelerator**, not a tier — e.g. "WebNN (ML acceleration): available · ORT EP: webnn". This answers "is my WebNN flag picked up?" without implying the "Core WebGPU" tier depends on it.

No change to tier derivation — `deriveCapabilityTierV2` remains WebGPU-only by design.

## D8 — Reconcile the Live Audio Chain "Noise Suppression" insert

Two acceptable options at [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx):

- **Preferred (remove placeholder):** delete the disabled "Noise Suppression" row from the Live Audio Chain. The live-monitor chain should show owned inserts only; Voice Cleanup and Local Audio Cleanup remain available in their own panels.
- **Optional (wire it):** drive the insert from the shipped RNNoise denoiser already loaded for Voice Cleanup ([`App.tsx` `loadVoiceCleanupWasm`](../../../src/ui/App.tsx)) via the live-chain SAB path (`writeDenoiserBypassToSab`). Larger change; only if the live-monitor denoiser is genuinely in scope this cycle.

Pick removal in T8.1 unless wiring is explicitly requested.

## D9 — Keep the Media Bin Add/Remove buttons in frame at narrow dock widths

The item's irreducible width must be **below** the narrowest media-bin width so the actions never overflow. Two changes in [`global.css`](../../../src/global.css), validated live (item min-content drops ~165px → ~141px; delete stays visible down to ~155px, comfortably under the 236px-dock bin of ~162px):

- Shrink the bin thumbnail `.media-bin-thumb` 64×36 → **48×27** and the `.media-bin-button`s 24 → **22px** (+ tighter `.media-bin-actions` gap). The meta column is already `minmax(0, 1fr)` and ellipsises, so it absorbs the remaining squeeze.
- Add `overflow-x: hidden` to `.media-bin-list` so the `overflow-y: auto` can no longer compute `overflow-x` to `auto` — no horizontal scrollbar, ever. (Safe because the footprint reduction guarantees the row fits the dock at every non-collapsed width; in the single-column collapse the dock is full-width.)

This composes with B6/D6: the 236px dock leaves the bin ~162px, which the reduced footprint fits. Marking the actions `flex: 0 0 auto` keeps them from being compressed before the meta text.


---

# Part 2 — Editor chrome IA design (D10–D16)

> Maps to B10–B16. Guiding move: **consolidate by user job, give every nav control one honest behavior, and never hide primary navigation behind a scrollbar.** Code anchors current as of branch `claude/laughing-colden-c29248`. Status: Phase 1 (IA-T1–IA-T3) implemented; Phases 2–3 proposed.

## Target information architecture

The audit's proposed reorganization, adopted as the design target:

**Top menu bar** (`Toolbar.tsx` `MENU_GROUPS`) — the command taxonomy:

| Menu | Commands (implemented only) |
| --- | --- |
| Project | New, Import, Project bundle, Collect media, Export |
| Edit | Undo, Redo, Delete, split/ripple/roll editing |
| Clip | clip-specific operations only |
| Timeline | snapping, beat grid, tracks, markers, safe areas |
| View | layout, panels, scopes, overlays (NOT Browser capabilities) |
| Help | User guide, Browser capabilities, Diagnostics |

**Top toolbar** — frequent actions + status only: Import, Undo/Redo, Transport, Timecode, Snap/Beat toggles, master level, Export. The long launcher strip ([`Toolbar.tsx:664-740`](../../../src/ui/Toolbar.tsx): Cleanup, Captions, Translate, Reframe, Silence, Capabilities, Help) is removed/collapsed; infrequent tools move to the palette (⌘K) and menus.

**Left rail** — Option B (library/source): `Media`, `Beats`, optionally `Project` (D11).

**Right rail** — ≤4 contextual destinations: `Inspector`, `Text`, `Audio`, `Capture`; the current seven become secondary segmented controls *inside* these (D14).

## D10 — Right-rail navigation that fits (B10)

`SIDE_RAIL_TABS` ([`App.tsx:354-362`](../../../src/ui/App.tsx)) has seven entries; the tab bar is `display:flex; overflow-x:auto` with a hidden/thin scrollbar ([`global.css:6834-6845`](../../../src/global.css), plus duplicates at ~2240, ~7854). 374px of tabs in a ~302px rail ⇒ scroll/clip/strip-shift.

- **Preferred:** fold to the four job destinations (D14). Four short labels (`Inspector`/`Text`/`Audio`/`Capture` ≈ 204px) fit 302px ⇒ **remove `overflow-x:auto` from `.side-rail-tab-bar`** entirely. Within a destination, a secondary segmented control (e.g. `Capture` → `Record | Program | Replay`) fits or wraps.
- **Fallback (if the four-tab regroup is deferred):** replace the hidden scrollbar with a **visible** "⋯ More" overflow menu so no destination is silently hidden. Never keep `overflow-x:auto` + hidden scrollbar for primary nav (same rule as media-bin B9).
- Either way: delete the redundant `.side-rail-tab-bar` rule blocks so one definition governs (the duplicate-rule trap from B6 exists here too).

## D11 — Left rail: one honest behavior (B11)

`.dock-rail` ([`App.tsx:4299-4334`](../../../src/ui/App.tsx)) mixes import picker / dead label / right-rail switches / overlays / modals / scroll.

**Option B (recommended):** demote the left rail to a **library/source switcher**:

- Keep `Media` and `Beats` as left-dock sections (they already render in `.dock-library`); make each actually switch the dock content (or replace the rail with a header toggle if only two).
- Move workflow launchers off the rail: `Record`/`Captions`/`Program`/`Replay`/`AI`/`Reframe`/`Silence` → command palette + relevant menus, and/or open their right-rail destination (D14). `Scopes` → `View`. `Project`/`Output` (import/export) → `Project` menu + toolbar.
- Remove the dead no-handler `Media` button; route import/picker failures through the recent-error log, not the status line.

**Why not Option A (full dock switcher):** the left dock today only has Media + Beats content; a six-destination dock switcher implies building five new left-dock panels — much larger. Option B fixes the dishonest-nav problem now; a dock switcher is a follow-up if those panels materialise.

## D12 — Audio cleanup disambiguation (B12)

- Right-rail live chain stays **`Audio`**.
- Fold Voice Cleanup under **`Audio`** as a secondary control (D14), or rename the tab to **`Voice FX`** / **`Voice Chain`** — never a bare `Cleanup`.
- The top-toolbar selected-clip action is renamed **`Audio Cleanup`** (it already opens the per-clip workflow) and clip-gated; no collision with the right-rail `Audio`. (B8 already removed the misleading "Noise Suppression" insert.)

## D13 — Menu taxonomy, no duplicate access (B13)

In [`Toolbar.tsx`](../../../src/ui/Toolbar.tsx):

- Remove the per-menu `{ id: 'palette', label: 'Search actions…' }` (lines ~251/267/283/302/311/320); keep the single `command-search` Popover trigger (~416).
- Keep `Browser capabilities` in **one** place — under `Help` (with Diagnostics); drop it from `View` (~309) and the top-strip `Capabilities` chip (~726).
- Drop the top-strip `Help` chip (~735); keep the `Help` menu.
- Collapse the launcher strip (~664–740) to frequent actions; route Cleanup/Captions/Translate/Reframe/Silence via the palette + their right-rail destinations.

## D14 — Right rail by job (B14)

Replace `SIDE_RAIL_TABS` (7) with four job destinations, each holding the former tabs as secondary segmented controls:

| Destination | Holds |
| --- | --- |
| `Inspector` | contextual clip properties (unchanged) |
| `Text` | Captions + translation/copy tools |
| `Audio` | live chain + Voice FX (+ selected-clip cleanup entry) |
| `Capture` | Record · Program · Replay · go-live/WHIP setup |

`isSideRailTab`, `openSideRailTab`, the persisted `SIDE_RAIL_COLLAPSED_KEY`, and any keyboard-map entry referencing tab ids must change together; migrate the persisted collapsed-key value safely. The secondary control is a small in-panel `Tabs`/segmented group. Subsumes D10 (four labels fit, so the scroll pattern is removed).

## D15 — Beat Detection home (B15)

Present Beats as a **Media Analysis** sub-section that appears when an audio source is selected, and link its state to the transport `Beat`-snap toggle (shared signal) with a one-line "snapping uses these beats" affordance. If the left rail becomes a `Media`/`Beats` switcher (D11), `Beats` is that destination.

## D16 — Compact unavailable states (B16)

Collapse the `captureUnavailableReasons(probe)` body list in `RecordPanel`/`ProgramPanel` into a **one-line status chip** ("Recording unavailable — 2 requirements") with the full list behind a `<details>`/disclosure (reuse diagnostics styling), keeping a primary call-to-action (e.g. "Open Diagnostics" or the transferable-track flag hint). Reason data/copy unchanged (from B4/D4) — only the density.

## Part 2 rollout

Incremental, smallest blast radius first — each independently shippable and keeping `pnpm run check` green:

1. **D13** (menu/toolbar dedupe) + **D12** (audio labels) + **D16** (compact unavailable) — copy/labelling/density, no nav restructure.
2. **D10** (remove hidden-scroll right-rail nav) via **D14** (four job destinations + secondary controls).
3. **D11** (left rail → library switcher) + **D15** (Beats home).

Update the affected `__browser__` component tests and any keyboard-map tests that reference tab ids at each step.

## Open decisions (Part 2 — resolve at design review)

1. **Left rail direction (D11):** Option A (full dock switcher) vs **B** (library/source only, recommended).
2. **Right-rail destination set (D14):** confirm `Captions`→`Text` and `Record`/`Program`/`Replay`→`Capture` grouping.
3. Ship Part 2 incrementally (recommended) vs one redesign PR.
