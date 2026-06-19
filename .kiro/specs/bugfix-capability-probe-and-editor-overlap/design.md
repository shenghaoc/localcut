# Design — Capability-probe false negatives + editor chrome overlap

> Status: **Proposed**. Each design entry Dn maps to bug Bn in [`bugfix.md`](./bugfix.md). The recurring theme for B1–B4 is one defect: H.264 codec strings encode a fixed **level** that is too low for the probe resolution, so `VideoEncoder.isConfigSupported` rejects the config on a fully capable encoder.

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
- **D2 (B2, recording):** in `probeVideoEncodeRealtime`, replace `'avc1.42001E'` with `h264ConstrainedBaseline(1920, 1080)` → 8160 MBs → L4.0 (`avc1.42E028`), which encodes `true` under `latencyMode:'realtime'` + `hardwareAcceleration:'prefer-hardware'`. Keep the realtime/HW hints unchanged.

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
	const src = `self.onmessage = async () => {
		try {
			const root = await navigator.storage.getDirectory();
			const name = '_cap_probe_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.tmp';
			const handle = await root.getFileHandle(name, { create: true });
			if (typeof handle.createSyncAccessHandle !== 'function') { self.postMessage('unsupported'); return; }
			const access = await handle.createSyncAccessHandle();
			access.close();
			await root.removeEntry(name);
			self.postMessage('supported');
		} catch { self.postMessage('unknown'); }
	};`;
	const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
	const worker = new Worker(url);
	try {
		return await new Promise<FeatureSupport>((resolve) => {
			const timer = setTimeout(() => resolve('unknown'), 3_000);
			worker.onmessage = (e) => { clearTimeout(timer); resolve(e.data as FeatureSupport); };
			worker.onerror = () => { clearTimeout(timer); resolve('unknown'); };
			worker.postMessage('go');
		});
	} finally {
		worker.terminate();
		URL.revokeObjectURL(url);
	}
}
```

`probeCaptureCapabilities` awaits this in place of the current main-thread `probeOpfsSyncAccessHandle`. Confirmed on the reference machine: the worker path returns `'supported'`. (Keep the bundle worker-free — this is a transient blob worker, not a build entry.)

## D4 — Make the Program Mode / recording-blocked message name the real cause

Two changes, no new gates:

1. With D2 + D3 landed, `recordingAvailable()` (and therefore `deriveProgramModeSupport()`) passes on the reference profile via the corrected sub-probes — no logic change needed there.
2. Replace the static string at [`ProgramPanel.tsx:105`](../../../src/ui/ProgramPanel.tsx) (and the equivalents in [`diagnostics.ts:409,412`](../../../src/engine/diagnostics.ts)) with a derived reason. Reuse `captureUnavailableReasons(probe)` ([`RecordPanel.tsx:151-170`](../../../src/ui/RecordPanel.tsx)) — promote it to a shared helper (e.g. `src/engine/capability-probe-v2.ts` or a small `capture-reasons.ts`) and render the concrete list ("Realtime video encode is unavailable.", etc.) plus the WebGPU-core check, instead of asserting WebGPU/WebCodecs are missing when they are not.

## D5 — Align recording's track-transfer gate with publish

Preferred fix: give recording the same bounded **main-frames** fallback publish uses. Publish's `selectTapMode` ([`publish-controller.ts:40-44`](../../../src/ui/publish-controller.ts)) chooses worker-transfer when `transferableMediaStreamTrack === 'supported'` and otherwise a main-thread generator with one-frame-per-transfer ([`publish-controller.ts:264-273`](../../../src/ui/publish-controller.ts), worker side [`worker.ts:1358-1370`](../../../src/engine/worker.ts)). The capture path has `MediaStreamTrackProcessor` available, so it can read frames and hand them to the writer worker through the same labeled, bounded compatibility route.

- Relax `recordingAvailable()` so `transferableMediaStreamTrack` is **not** a hard requirement when `mediaStreamTrackProcessor === 'supported'`; instead select a capture tap mode mirroring `selectTapMode`.
- Surface the degraded mode in the Record panel (a labeled "compatibility capture" note), consistent with the architecture's "slower paths must be explicit and visibly labeled" rule.

Fallback fix (if the bounded capture path is out of scope for this cycle): keep the gate but make the message precise — state that recording needs transferable MediaStreamTrack and that it can be enabled via `chrome://flags/#enable-experimental-web-platform-features` — so the user is not left thinking the browser is simply unsupported. Decide between these in T5.1; the preferred path is the main-frames fallback.

## D6 — Consolidate the workspace layout rules; fix the responsive collapse

The Ark editor-kit block at [`global.css:7641-7780`](../../../src/global.css) is now the live rule set (live columns `364px 756px 360px` match `:7649`). The original block at [`:1681-1692`](../../../src/global.css) and the `@media (max-width:900px)` collapse at [`:4710-4717`](../../../src/global.css) are dead/overridden because the duplicate is later in source with equal specificity (and `@media` adds no specificity).

**Fix.**

1. **Single source of truth.** Delete the superseded original `.workspace`/`.dock-left`/`.side-rail` declarations (or the duplicate) so exactly one block defines the workspace grid. Keep the Ark visuals; the issue is duplication + breakpoint, not the look.
2. **Let columns shrink or move the breakpoint.** The grid's true minimum is `364 + 480 + 360` + gaps/padding ≈ 1236px, but the collapse only fires at ≤900px — a broken dead zone. Choose one:
   - **(a)** lower the middle floor so the grid can shrink: `364px minmax(0, 1fr) 360px` (preview shrinks gracefully; matches the original intent at `:1691`), **and/or**
   - **(b)** raise the single-column collapse breakpoint to fire before the layout's minimum, e.g. `@media (max-width: 1240px)`, and ensure that rule lives **after** (or with higher specificity than) the base workspace block so it actually wins.
3. **Re-attach the collapse to the surviving block.** After consolidation, verify the `@media` collapse selector set (`.workspace, .workspace.has-bin, .workspace.rail-collapsed, .workspace.has-bin.rail-collapsed`) targets the same block and is ordered to win.

Recommended combination: (a) `minmax(0,1fr)` middle column **and** keep a single-column collapse at a breakpoint ≥ the true minimum, eliminating both the overflow and the dead zone.

## D7 — Surface WebNN as a capability/diagnostics row

Add a read-only WebNN row to the capability/diagnostics surface (e.g. [`CapabilityMatrixPanel.tsx`](../../../src/ui/CapabilityMatrixPanel.tsx) and/or the ML-runtime section of [`diagnostic-snapshot.ts:324-332`](../../../src/ui/diagnostic-snapshot.ts)):

- Source the value from the existing probes: `navigator.ml` presence (already read by `preferredCleanupAcceleratorFromPlatform`/`probeBeauty`) and the resolved ORT EP (`ortEp`).
- Label clearly that WebNN is an **accelerator**, not a tier — e.g. "WebNN (ML acceleration): available · ORT EP: webnn". This answers "is my WebNN flag picked up?" without implying the "Core WebGPU" tier depends on it.

No change to tier derivation — `deriveCapabilityTierV2` remains WebGPU-only by design.

## D8 — Reconcile the Live Audio Chain "Noise Suppression" insert

Two acceptable options at [`LiveAudioChainPanel.tsx:189-198`](../../../src/ui/LiveAudioChainPanel.tsx):

- **Preferred (relabel + link):** change the status from "Available in a future update" to a pointer such as "Use Voice Cleanup / Local Audio Cleanup" and link/scroll to those panels. Lowest risk; removes the false impression while keeping the live-monitor chain scope honest (its denoiser insert genuinely is not implemented).
- **Optional (wire it):** drive the insert from the shipped RNNoise denoiser already loaded for Voice Cleanup ([`App.tsx` `loadVoiceCleanupWasm`](../../../src/ui/App.tsx)) via the live-chain SAB path (`writeDenoiserBypassToSab`). Larger change; only if the live-monitor denoiser is genuinely in scope this cycle.

Pick the relabel in T8.1 unless wiring is explicitly requested.
