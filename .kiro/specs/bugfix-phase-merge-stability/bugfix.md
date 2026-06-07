# Bugfix — Stabilize merged phases for UI performance, capability correctness, and unfinished compatibility paths

> Status: **Active**. Bugfix spec for regressions surfaced after merging the post–Phase 17 work
> (media conformance, editing tools, colour/scopes, captions, packaging, render queue, diagnostics,
> and the cross-browser compatibility foundation).

## Summary

The merged phases introduced a set of regressions and "looks-finished-but-isn't" surfaces. This
spec audits and fixes them without expanding the product's scope. **There is no AI in this product
and none is added here.** The architecture is preserved exactly:

- SolidJS UI on the main thread; the pipeline worker owns media, timeline, playback, WebGPU,
  export, and authoritative transport-clock writes.
- Mediabunny remains the primary media I/O layer.
- No server-side media compute; no sustained decode/encode/GPU/media work on the main thread.
- No Canvas2D/`getImageData` CPU readback in the accelerated preview/export hot path.
- Compatibility paths stay explicit, reduced, and honestly labeled. Unfinished compatibility
  features must not appear product-ready.

## Bugs

### B1 — `CapabilityTierV2` is too strict (core requires AV1 encode)

`deriveCapabilityTierV2` (`src/engine/capability-probe-v2.ts`) required H.264 **and** VP9 **and**
AV1 *encode* before selecting `core-webgpu`. A fully capable Chromium/Edge session that lacks AV1
encode (common) was incorrectly demoted to `compatibility-webgpu`, disabling the accelerated editor.

**Expected:** `core-webgpu` means the accelerated preview/editing path is available. It requires
WebGPU core, usable WebCodecs **decode** for at least one import codec, SharedArrayBuffer,
`crossOriginIsolated === true`, and OffscreenCanvas. It must **not** require AV1 (or any specific)
encode. Export-codec availability is represented separately via export constraints.

### B2 — WebCodecs decode classified from constructor presence, not real probes

Tier derivation treated `webCodecsDecode === 'supported'` (i.e. `typeof VideoDecoder !== 'undefined'`)
as "decode works". A browser that exposes the `VideoDecoder` constructor but supports **no** import
codec was eligible for `limited-webcodecs`.

**Expected:** Derive from actual per-codec probes. Define
`anyVideoDecodeSupported`, `anyVideoEncodeSupported`, `anyAudioDecodeSupported`,
`anyAudioEncodeSupported`. Reduced preview tiers require usable video *decode*. `shell-only` triggers
when there is neither a WebGPU path nor a usable video-decode path.

### B3 — Unfinished compatibility tiers look product-ready

Phase 26 T3/T4/T5 (compat WebGPU preview, Canvas2D compositor, limited export, abort handling,
audio export, smoke tests) are unfinished. The UI must not imply that `compatibility-webgpu` or
`limited-webcodecs` deliver full editing/export. Where a reduced path is not wired, it must say so
("Compatibility foundation detected — reduced preview/export not available yet") rather than
pretending it works. Import/export controls must only appear when the path is actually implemented.
Core accelerated behavior is unchanged.

### B4 — Main thread writes the clock SAB during crash recovery

`App.tsx`'s `handleWorkerCrash` zeroed the transport-clock `SharedArrayBuffer` directly
(`new Float64Array(sab); view[0]=view[1]=view[2]=0`). The worker must remain the sole writer of the
transport clock; the restarted worker already publishes an authoritative reset on init.

**Expected:** UI recovery code does not mutate the transport-clock SAB. Display state is reset by the
restarted worker's init write (and `createSharedClock().applyUpdate` in non-SAB tiers).

### B5 — Caption transcript UI renders every segment

`TranscriptPanel.tsx` rendered every caption segment in one `<For>` and tested selection membership
with `Array.includes` per row (O(segments × selection)). Large SRT/WebVTT files (thousands of
segments) blow up the DOM and main-thread work.

**Expected:** Window the rendered rows around the active segment, memoize `selectedSegmentIds` as a
`Set`, and keep text edits committing on blur (not per keystroke). Rendering stays bounded for very
large files.

### B6 — Diagnostics re-probes codecs and storage on every snapshot

`buildWorkerDiagnosticSnapshot` (`src/engine/diagnostics.ts`) called `probeDecoders()`,
`probeEncoders()`, and `navigator.storage.estimate()` on **every** snapshot request, and the recent-
error log dropped repeated errors that shared subsystem/code (losing recurrence information).

**Expected:** Cache codec-probe results for the session (reused across snapshots; explicit
invalidation only). Cache the storage estimate with a short TTL. Merge repeated recent errors by id,
preserving an occurrence count and last-seen timestamp instead of silently dropping them.

### B7 — Scope/colour (Phase 21) path not safely gated

The scope dispatch (`PreviewRenderer.dispatchScopes`) is a placeholder; the full scope
UI/worker/SAB/throttling pipeline is unfinished and `ScopePanel` is not wired into the app. It must
be impossible for a scope pass to run by default.

**Expected:** Gate scopes behind an explicit feature flag (default off). With the flag off,
`setScopesEnabled(true)` is a no-op. Scope dispatch must stay within the single per-frame
`queue.submit`, must reset its SAB slots before writing, and must never introduce CPU pixel readback.
Preview and export keep sharing the same compositing path.

### B8 — Export dialog must separate tier from codec availability

Unsupported codecs must stay **visible but disabled** with a reason; the editor tier must not be
downgraded because AV1 export is unavailable. (Largely already correct in `ExportDialog.tsx`; this
bugfix makes it correct end-to-end once B1/B2 land and adds coverage.)

### B9 — Worker restart / project recovery correctness

Manual restart and crash restart must clear `workerReady`/`webgpuAvailable` accurately, not leave old
`error` listeners attached, not reuse a transferred OffscreenCanvas, reinitialize audio/SAB buffers,
and never silently lose unsaved project state (surface the autosave/restore path instead).

### B10 — Build & test hard gate

`npm run build` and `npm test` must both be green, with added/updated tests for the bugs above and no
decrease in meaningful test coverage.

## Non-goals

- No AI of any kind.
- No new product features; no Mediabunny replacement; no server media processing.
- Do not implement the full compatibility preview/export pipelines unless required to fix an exposed
  broken state.
- Do not broaden browser-support claims.

## Acceptance criteria

- A fully capable Chromium/Edge session (COOP/COEP, SAB, WebGPU, OffscreenCanvas, usable video
  decode, H.264 export) is `core-webgpu` even when AV1 export is unavailable.
- The export picker disables unsupported codecs without downgrading the editor tier.
- A browser with the `VideoDecoder` constructor but no supported import codec does **not** get
  `limited-webcodecs`.
- Compatibility tiers do not expose preview/export controls unless the path is wired and tested.
- The UI does not write to the transport-clock SAB.
- Large caption files do not render every row at once.
- Diagnostics does not re-probe codecs every render/open cycle unless explicitly invalidated.
- Scopes are safely disabled behind a feature flag (or fully gated/throttled/reset).
- `npm run build` and `npm test` pass.
</content>
</invoke>
