# Design: Bugfix — merged-phase stability

This document describes the concrete fixes for the bugs in `bugfix.md`. Each section maps to a bug
ID and lists the touched files, the change, and the invariant the change protects.

## D1 — Capability tier derivation (B1, B2)

`src/engine/capability-probe-v2.ts`

Rewrite `deriveCapabilityTierV2` to derive from real codec probes, exposing pure helpers so the
logic is unit-testable:

```ts
export function anyVideoDecodeSupported(c: CodecProbeResult): boolean // h264|vp9|av1 decode
export function anyVideoEncodeSupported(c: CodecProbeResult): boolean // h264|vp9|av1 encode
export function anyAudioDecodeSupported(c: CodecProbeResult): boolean // aac|opus decode
export function anyAudioEncodeSupported(c: CodecProbeResult): boolean // aac|opus encode
```

Tier rules:

- `core-webgpu` ⇐ `webGPUCore === 'supported'` **and** `anyVideoDecodeSupported` **and**
  `sharedArrayBuffer === 'supported'` **and** `crossOriginIsolated` **and**
  `offscreenCanvas === 'supported'`. **AV1/encode is not required.**
- `compatibility-webgpu` ⇐ (WebGPU core or compat) **and** `anyVideoDecodeSupported` **and**
  `offscreenCanvas`.
- `limited-webcodecs` ⇐ `anyVideoDecodeSupported` **and** `offscreenCanvas`.
- `shell-only` ⇐ otherwise (no WebGPU path **and** no usable video-decode path, or no
  OffscreenCanvas).

`exportConstraintsForProbe` is unchanged in shape: H.264/MP4 when `h264Encode` is supported, VP9/WebM
when `vp9Encode` is supported, AV1/WebM only on `core-webgpu` with `av1Encode` supported. Because tier
no longer depends on encode, AV1-less core sessions keep `core-webgpu` while AV1 simply drops out of
the export constraint set.

Tests (`capability-probe-v2.test.ts`): keep the four-tier fixtures; replace the old
"AV1-encode downgrades core" test with "core-webgpu survives missing AV1 encode (AV1 absent from
export constraints)"; add "VideoDecoder present but no supported import codec ⇒ shell-only"; add
helper unit tests.

## D2 — Honest compatibility status (B3)

New module `src/engine/compatibility/compat-status.ts` is the single source of truth for which
reduced paths are wired:

```ts
export const COMPAT_PREVIEW_IMPLEMENTED = false;   // Phase 26 T3
export const COMPAT_EXPORT_IMPLEMENTED  = false;   // Phase 26 T5 (compat-webgpu)
export const LIMITED_PREVIEW_IMPLEMENTED = false;  // Phase 26 T4
export const LIMITED_EXPORT_IMPLEMENTED  = false;  // Phase 26 T5 (limited-webcodecs)
export function compatibilityReadiness(tier): { previewReady; exportReady; note }
```

`note` for unfinished tiers is exactly:
`"Compatibility foundation detected — reduced preview/export not available yet"`.

The UI consumes this when labeling a non-core tier and never renders preview/export controls for a
tier whose `previewReady`/`exportReady` is false. Today export is already gated to the accelerated
tier and compatibility import is a labeled thumbnail-only fallback, so this change is primarily honest
labeling plus a guard the UI/tests can assert against. Unit-tested directly.

## D3 — No main-thread transport-clock SAB writes (B4)

`src/ui/App.tsx` `handleWorkerCrash`: remove the `new Float64Array(sab)` zeroing block. The restarted
worker resets the clock authoritatively in its `init` handler (`writeClockFull(0,0,false)`); during
the brief crash window the last values persist harmlessly and `previewKey` remounts the canvas.

The audio master clock (Phase 5) is intentionally out of scope: the **audio worklet** (audio thread,
not the main thread) is the authoritative audio-clock writer, and `audio-engine.ts` primes the
`CLOCK_AUDIO` anchor at `play()`/`seek()` to win the generation-sync race with the worklet. That is
the established Phase 5 design, documented in a comment, and is not the regression.

Regression test `src/ui/clock-sab-guard.test.ts`: read `App.tsx` source and assert it does not
construct a `Float64Array` over the clock SAB (the transport clock is owned by `clock.ts` for reads
and the worker for writes).

## D4 — Caption transcript windowing (B5)

New pure helper `src/ui/transcript-window.ts`:

```ts
export const TRANSCRIPT_WINDOW_RADIUS = 120;
export function computeSegmentWindow(total, activeIndex, radius?): { start; end; before; after }
```

`TranscriptPanel.tsx`:

- Memoize `selectedSegmentIds` into a `Set` (`selectedIdSet`) used for per-row membership.
- Render only the windowed slice of `track.segments` around the active segment, with lightweight
  "N earlier/later" affordances so the list stays navigable but bounded.
- Keep text commit on blur (already the case); timing/style commits remain on change (cheap, discrete).

Test `src/ui/transcript-window.test.ts`: a 5,000-segment input yields a window whose size is bounded
by `2*radius+1`, clamps at both ends, and always includes the active index.

## D5 — Diagnostics probe/storage caching + recent-error merge (B6)

`src/engine/diagnostics.ts`:

- Module-level session caches for decoder/encoder probe results
  (`cachedDecoderProbe`/`cachedEncoderProbe`), populated on first use and reused thereafter.
- A short-TTL cache (default 2s) for the storage estimate so repeated snapshot builds during a single
  open/refresh burst don't hammer `navigator.storage.estimate()`.
- `export function invalidateDiagnosticProbeCache()` to drop the caches on demand (e.g. after a
  capability change) — caches are otherwise never recomputed.

`src/diagnostics/recent-errors.ts`:

- Extend `RecentError` with `occurrenceCount: number`, `firstOccurredAt: string`, and reuse
  `occurredAt` as the last-seen time.
- `addRecentError` merges by `subsystem+code`: instead of dropping the prior entry, it folds it into
  one updated entry that bumps `occurrenceCount`, updates `occurredAt`/message, and keeps
  `firstOccurredAt`. Capacity/drop accounting is unchanged for genuinely distinct errors.

Tests: `recent-errors.test.ts` asserts the dedup path now preserves `occurrenceCount === 2` and keeps
`firstOccurredAt`; a new `diagnostics.test.ts` asserts repeated `buildWorkerDiagnosticSnapshot` calls
probe codecs exactly once until `invalidateDiagnosticProbeCache()` is called.

## D6 — Scope gating (B7)

`src/engine/scopes.ts`:

- `export const SCOPES_FEATURE_ENABLED = false;` — the single product flag.
- `export function resetScopeSlot(buffer, slotOffset, dataFloats)` — zeroes the slot header + data
  before accumulation; unit-tested.

`src/engine/gpu.ts`:

- `setScopesEnabled(enabled)` becomes `this.scopesEnabled = enabled && SCOPES_FEATURE_ENABLED;`.
- Add a `get scopesActive()` accessor for tests.
- `dispatchScopes` resets the heartbeat slot via `resetScopeSlot` before writing the sequence, stays
  inside the single encoder/`queue.submit`, and never reads pixels back.

`src/engine/worker.ts` `toggle-scopes`: routes through the gated `setScopesEnabled`, so it cannot turn
scopes on while the flag is off.

Tests (`gpu.test.ts`): with the flag off, `setScopesEnabled(true)` leaves `scopesActive === false` and
`present()` issues exactly one submit; forcing the internal flag on still yields one submit (single-
submission invariant holds with scopes). `scopes.test.ts`: `resetScopeSlot` zeroes the region.

## D7 — Export dialog (B8)

`ExportDialog.tsx` already keeps unsupported codecs visible-but-disabled with per-codec reasons and a
tier-constraints section. With D1 in place the tier no longer collapses on missing AV1 encode, so the
dialog behaves correctly. Coverage is added in `capability-probe-v2.test.ts` for the constraint sets
of: core + H.264 only, core + H.264/VP9 (no AV1), compatibility-webgpu (no AV1), and shell-only.

## D8 — Worker restart correctness (B9)

`App.tsx` recovery path is reviewed and tightened where needed:

- `handleWorkerCrash` clears `workerReady`, `exporting`, `importing`; `restartWorker` detaches the old
  `error` listener, disposes + terminates the old worker, resets `initSent`, and bumps `previewKey`
  so a fresh OffscreenCanvas is transferred (the old one is gone with the terminated worker).
- The autosave/restore offer remains the recovery surface for unsaved state; no silent project reset
  is introduced by this bugfix.

This is primarily an audit; the concrete code change is the SAB-write removal (D3). The restart flow
is otherwise already correct.

## Test & build gate (B10)

`npm run build` (strict `tsc` + Vite) and `npm test` (Vitest) must pass. New/updated tests:
`capability-probe-v2.test.ts`, `recent-errors.test.ts`, `diagnostics.test.ts`,
`transcript-window.test.ts`, `clock-sab-guard.test.ts`, `scopes.test.ts`/`gpu.test.ts`,
`compat-status.test.ts`.
</content>
