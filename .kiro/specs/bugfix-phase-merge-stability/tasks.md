# Tasks: Bugfix — merged-phase stability

> Status: **Active**. Tasks map to the bugs in `bugfix.md` and the design in `design.md`.

## T1 — Capability tier correctness (B1, B2, B8)

- [x] **T1.1** Add pure helpers `anyVideoDecodeSupported`, `anyVideoEncodeSupported`,
  `anyAudioDecodeSupported`, `anyAudioEncodeSupported` to `capability-probe-v2.ts`.
- [x] **T1.2** Rewrite `deriveCapabilityTierV2`: `core-webgpu` requires WebGPU core + usable video
  decode + SAB + `crossOriginIsolated` + OffscreenCanvas; **no AV1/encode requirement**.
- [x] **T1.3** Keep `exportConstraintsForProbe` representing codec availability separately (AV1 only
  on core + `av1Encode`).
- [x] **T1.4** Update tests: core survives missing AV1 encode (AV1 absent from constraints);
  `VideoDecoder` present + no supported codec ⇒ `shell-only`; export-constraint sets for core(H.264),
  core(H.264+VP9, no AV1), compatibility-webgpu, shell-only; helper unit tests.

## T2 — Honest compatibility labeling (B3)

- [x] **T2.1** Add `src/engine/compatibility/compat-status.ts` with implemented-path flags and
  `compatibilityReadiness(tier)` returning the honest not-available-yet note.
- [x] **T2.2** Use the readiness note in the non-core tier labeling/status surface; do not render
  preview/export controls for unwired paths.
- [x] **T2.3** Unit-test `compat-status.ts`.

## T3 — No main-thread transport-clock SAB writes (B4)

- [x] **T3.1** Remove the `Float64Array(sab)` zeroing in `App.tsx` `handleWorkerCrash`; rely on the
  restarted worker's authoritative reset; document the audio master-clock exception.
- [x] **T3.2** Add `src/ui/clock-sab-guard.test.ts` asserting `App.tsx` does not write the clock SAB.

## T4 — Caption transcript performance (B5)

- [x] **T4.1** Add `src/ui/transcript-window.ts` (`computeSegmentWindow`).
- [x] **T4.2** `TranscriptPanel.tsx`: memoize selection into a `Set`; render only the windowed slice;
  keep text commit on blur.
- [x] **T4.3** Add `src/ui/transcript-window.test.ts` with a 5,000-segment bounded-window test.

## T5 — Diagnostics cost + recent-error merge (B6)

- [x] **T5.1** Cache decoder/encoder probes for the session in `engine/diagnostics.ts`; add
  `invalidateDiagnosticProbeCache()`.
- [x] **T5.2** Short-TTL cache for the storage estimate.
- [x] **T5.3** Merge repeated recent errors by id, preserving `occurrenceCount`/`firstOccurredAt`.
- [x] **T5.4** Tests: repeated snapshot builds probe codecs once until invalidation;
  recent-error dedup preserves count.

## T6 — Scope gating (B7)

- [x] **T6.1** Add `SCOPES_FEATURE_ENABLED` and `resetScopeSlot` to `engine/scopes.ts`.
- [x] **T6.2** Gate `setScopesEnabled` in `gpu.ts`; reset slot before write in `dispatchScopes`;
  add `scopesActive` accessor; gate `toggle-scopes` in the worker.
- [x] **T6.3** Tests: flag-off ⇒ no dispatch; enabling does not change submissions/frame; slot reset.

## T7 — Build & test gate (B9, B10)

- [x] **T7.1** Audit worker restart/recovery flow (listeners, canvas, signals, autosave).
- [x] **T7.2** `npm run build` green (strict TypeScript).
- [x] **T7.3** `npm test` green; test count does not decrease.

## Remaining intentionally-disabled compatibility paths (unchanged by this bugfix)

- Phase 26 T3 (compat WebGPU preview), T4 (Canvas2D compositor), T5 (compat/limited export),
  T4.5/T5 abort + audio export, and the T9/T10 smoke/manual matrices remain **not implemented** and
  are now honestly labeled rather than exposed as working.
</content>
